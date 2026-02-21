/**
 * Fractional Indexing — O(1) amortized per move.
 *
 * Tasks are assigned floating-point `position` values. Inserting between two
 * tasks takes the midpoint. When precision is exhausted (gap < MIN_GAP) the
 * affected column is rebalanced in a single atomic transaction: tasks are
 * assigned evenly-spaced positions (STEP apart), which is O(n) but happens
 * very rarely (O(log n) times per 2^52 operations ≈ never in practice).
 */

import { PoolClient } from 'pg';
import { pool, withTransaction } from '../db';
import { Column, Task, TaskRow } from '../types';
import { rowToTask } from './taskService';

export const INITIAL_STEP = 65_536; // gap between new tasks
export const MIN_GAP = 0.5;        // rebalance trigger threshold

/**
 * Compute the position to insert a task at the end of a column.
 * Returns INITIAL_STEP if the column is empty, or max_position + INITIAL_STEP.
 */
export async function positionAtEnd(
  columnId: Column,
  client?: PoolClient
): Promise<number> {
  const query = `
    SELECT COALESCE(MAX(position), 0) AS max_pos
    FROM tasks
    WHERE column_id = $1
  `;
  const db = client ?? pool;
  const { rows } = await db.query(query, [columnId]);
  return (rows[0].max_pos as number) + INITIAL_STEP;
}

/**
 * Compute the position to insert between `beforePosition` and `afterPosition`.
 * If `beforePosition` is null, insert before `afterPosition` (at afterPos - INITIAL_STEP/2).
 * If `afterPosition` is null, insert after `beforePosition` (at beforePos + INITIAL_STEP/2).
 *
 * Returns null if the gap is too small — caller should rebalance.
 */
export function positionBetween(
  beforePosition: number | null,
  afterPosition: number | null
): number | null {
  if (beforePosition === null && afterPosition === null) {
    return INITIAL_STEP;
  }
  if (beforePosition === null) {
    // Insert before the first task
    const pos = (afterPosition as number) / 2;
    return pos < MIN_GAP ? null : pos;
  }
  if (afterPosition === null) {
    return beforePosition + INITIAL_STEP;
  }
  const gap = afterPosition - beforePosition;
  if (gap < MIN_GAP) return null;
  return beforePosition + gap / 2;
}

/**
 * Rebalance all tasks in a column: assign evenly-spaced positions.
 * Returns the updated task rows.
 * This is O(n) but called rarely.
 */
export async function rebalanceColumn(
  columnId: Column
): Promise<Task[]> {
  return withTransaction(async (client) => {
    // Lock rows for this column to prevent concurrent writes during rebalance
    const { rows: existingRows } = await client.query<TaskRow>(
      `SELECT * FROM tasks WHERE column_id = $1 ORDER BY position FOR UPDATE`,
      [columnId]
    );

    const updates: Task[] = [];
    for (let i = 0; i < existingRows.length; i++) {
      const newPos = (i + 1) * INITIAL_STEP;
      const newVersion = existingRows[i].version + 1;
      const { rows } = await client.query<TaskRow>(
        `UPDATE tasks
         SET position = $1,
             version = $2,
             position_version = $2
         WHERE id = $3
         RETURNING *`,
        [newPos, newVersion, existingRows[i].id]
      );
      updates.push(rowToTask(rows[0]));
    }
    return updates;
  });
}
