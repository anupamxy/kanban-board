/**
 * Task Service — all database operations for tasks.
 * Every write uses a transaction to ensure atomicity.
 */

import { PoolClient } from 'pg';
import { pool, withTransaction } from '../db';
import {
  Column,
  Task,
  TaskRow,
  CreateTaskPayload,
  UpdateTaskPayload,
  MoveTaskPayload,
  DeleteTaskPayload,
  ConflictResolvedPayload,
} from '../types';
import { analyseConflict, buildResolutionReason } from './conflictResolver';
import { positionAtEnd, rebalanceColumn, MIN_GAP } from './orderingService';

/** Convert a database row (snake_case) to a Task (camelCase) */
export function rowToTask(row: TaskRow): Task {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    columnId: row.column_id as Column,
    position: row.position,
    version: row.version,
    titleVersion: row.title_version,
    descriptionVersion: row.description_version,
    columnVersion: row.column_version,
    positionVersion: row.position_version,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
  };
}

/** Fetch all tasks ordered by column then position */
export async function getAllTasks(): Promise<Task[]> {
  const { rows } = await pool.query<TaskRow>(
    `SELECT * FROM tasks ORDER BY column_id, position`
  );
  return rows.map(rowToTask);
}

/** Fetch a single task by id */
export async function getTaskById(
  id: string,
  client?: PoolClient
): Promise<Task | null> {
  const db = client ?? pool;
  const { rows } = await db.query<TaskRow>(
    `SELECT * FROM tasks WHERE id = $1`,
    [id]
  );
  return rows.length ? rowToTask(rows[0]) : null;
}

/**
 * Create a new task.
 * If `position` from the client is provided, use it — otherwise append to end.
 */
export async function createTask(
  payload: CreateTaskPayload
): Promise<Task> {
  return withTransaction(async (client) => {
    const position =
      payload.position > 0
        ? payload.position
        : await positionAtEnd(payload.columnId, client);

    const { rows } = await client.query<TaskRow>(
      `INSERT INTO tasks (title, description, column_id, position)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [payload.title.trim() || 'New Task', payload.description ?? '', payload.columnId, position]
    );
    return rowToTask(rows[0]);
  });
}

/**
 * Update task fields (title / description).
 * Uses field-level conflict resolution against baseVersion.
 *
 * Returns either:
 *  - The updated task (no conflict, or partial merge)
 *  - A ConflictResolvedPayload (fully rejected)
 */
export async function updateTask(
  payload: UpdateTaskPayload
): Promise<{ task: Task; conflict: ConflictResolvedPayload | null }> {
  return withTransaction(async (client) => {
    // Lock the row for the duration of this transaction
    const { rows: lockRows } = await client.query<TaskRow>(
      `SELECT * FROM tasks WHERE id = $1 FOR UPDATE`,
      [payload.taskId]
    );
    if (!lockRows.length) throw new Error(`Task ${payload.taskId} not found`);

    const current = rowToTask(lockRows[0]);
    const analysis = analyseConflict(current, payload.baseVersion, payload.changes);

    if (analysis.fullyRejected) {
      return {
        task: current,
        conflict: {
          taskId: current.id,
          resolution: 'REJECTED',
          task: current,
          mergedFields: [],
          rejectedFields: analysis.rejectedFields,
          reason: buildResolutionReason(analysis),
        },
      };
    }

    // Build a dynamic UPDATE touching only the merged fields
    const sets: string[] = [];
    const params: unknown[] = [];
    let paramIdx = 1;
    const newVersion = current.version + 1;

    if (analysis.mergedChanges.title !== undefined) {
      sets.push(`title = $${paramIdx++}`, `title_version = $${paramIdx++}`);
      params.push(analysis.mergedChanges.title, newVersion);
    }
    if (analysis.mergedChanges.description !== undefined) {
      sets.push(`description = $${paramIdx++}`, `description_version = $${paramIdx++}`);
      params.push(analysis.mergedChanges.description, newVersion);
    }
    sets.push(`version = $${paramIdx++}`);
    params.push(newVersion);
    params.push(payload.taskId);

    const { rows } = await client.query<TaskRow>(
      `UPDATE tasks SET ${sets.join(', ')} WHERE id = $${paramIdx} RETURNING *`,
      params
    );
    const updated = rowToTask(rows[0]);

    const conflict = analysis.hasConflict
      ? {
          taskId: updated.id,
          resolution: 'MERGED' as const,
          task: updated,
          mergedFields: analysis.mergedFields,
          rejectedFields: analysis.rejectedFields,
          reason: buildResolutionReason(analysis),
        }
      : null;

    return { task: updated, conflict };
  });
}

/**
 * Move a task to a new column and/or position.
 * Uses field-level conflict resolution on {columnId, position}.
 */
export async function moveTask(
  payload: MoveTaskPayload
): Promise<{ task: Task; conflict: ConflictResolvedPayload | null; needsRebalance: boolean }> {
  return withTransaction(async (client) => {
    const { rows: lockRows } = await client.query<TaskRow>(
      `SELECT * FROM tasks WHERE id = $1 FOR UPDATE`,
      [payload.taskId]
    );
    if (!lockRows.length) throw new Error(`Task ${payload.taskId} not found`);

    const current = rowToTask(lockRows[0]);
    const changes = { columnId: payload.columnId, position: payload.position };
    const analysis = analyseConflict(current, payload.baseVersion, changes);

    if (analysis.fullyRejected) {
      return {
        task: current,
        conflict: {
          taskId: current.id,
          resolution: 'REJECTED',
          task: current,
          mergedFields: [],
          rejectedFields: analysis.rejectedFields,
          reason: buildResolutionReason(analysis),
        },
        needsRebalance: false,
      };
    }

    const newVersion = current.version + 1;
    const newColumnId = analysis.mergedChanges.columnId ?? current.columnId;
    const newPosition = analysis.mergedChanges.position ?? current.position;

    const { rows } = await client.query<TaskRow>(
      `UPDATE tasks
       SET column_id         = $1,
           position          = $2,
           column_version    = $3,
           position_version  = $3,
           version           = $3
       WHERE id = $4
       RETURNING *`,
      [newColumnId, newPosition, newVersion, payload.taskId]
    );
    const updated = rowToTask(rows[0]);

    // Check if fractional gap is now too small — flag for rebalance
    const { rows: neighbours } = await client.query<{ position: number }>(
      `SELECT position FROM tasks
       WHERE column_id = $1 AND id != $2
       ORDER BY ABS(position - $3) ASC
       LIMIT 2`,
      [newColumnId, payload.taskId, newPosition]
    );
    const needsRebalance = neighbours.some(
      (n) => Math.abs(n.position - newPosition) < MIN_GAP
    );

    const conflict = analysis.hasConflict
      ? {
          taskId: updated.id,
          resolution: 'MERGED' as const,
          task: updated,
          mergedFields: analysis.mergedFields,
          rejectedFields: analysis.rejectedFields,
          reason: buildResolutionReason(analysis),
        }
      : null;

    return { task: updated, conflict, needsRebalance };
  });
}

/** Hard-delete a task */
export async function deleteTask(
  payload: DeleteTaskPayload
): Promise<{ deleted: boolean; task: Task | null }> {
  return withTransaction(async (client) => {
    // Optimistic check: if version has advanced, we still allow delete
    // (deletion is idempotent and irreversible, so it always wins)
    const { rows } = await client.query<TaskRow>(
      `DELETE FROM tasks WHERE id = $1 RETURNING *`,
      [payload.taskId]
    );
    if (!rows.length) return { deleted: false, task: null };
    return { deleted: true, task: rowToTask(rows[0]) };
  });
}

/** Fetch all tasks in a given column, ordered by position */
export async function getTasksByColumn(columnId: Column): Promise<Task[]> {
  const { rows } = await pool.query<TaskRow>(
    `SELECT * FROM tasks WHERE column_id = $1 ORDER BY position`,
    [columnId]
  );
  return rows.map(rowToTask);
}
