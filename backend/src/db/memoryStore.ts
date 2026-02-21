/**
 * In-memory store — drop-in replacement for PostgreSQL when DATABASE_URL
 * is not set. Useful for local development / demo without a database.
 * Data is lost on server restart.
 */

import { v4 as uuidv4 } from 'uuid';
import { Task, Column, TaskMutation, ConflictResolvedPayload } from '../types';
import { analyseConflict, buildResolutionReason } from '../services/conflictResolver';
import { INITIAL_STEP, MIN_GAP, positionBetween } from '../services/orderingAlgorithm';

// Seed with a few demo tasks so the board isn't empty
let tasks: Task[] = [
  makeTask('todo',       65536,  'Welcome to Kanban!', 'Double-click to edit. Drag to move.'),
  makeTask('todo',       131072, 'Read the DESIGN.md', 'Explains the conflict resolution strategy.'),
  makeTask('inprogress', 65536,  'Build something cool', 'This task is in progress.'),
  makeTask('done',       65536,  'Set up the project',  'Done! ✓'),
];

function makeTask(columnId: Column, position: number, title: string, description = ''): Task {
  const now = new Date().toISOString();
  return {
    id: uuidv4(),
    title,
    description,
    columnId,
    position,
    version: 1,
    titleVersion: 1,
    descriptionVersion: 1,
    columnVersion: 1,
    positionVersion: 1,
    createdAt: now,
    updatedAt: now,
  };
}

function bumpVersion(task: Task, fields: (keyof TaskMutation)[]): Task {
  const newVersion = task.version + 1;
  const updated: Task = { ...task, version: newVersion, updatedAt: new Date().toISOString() };
  for (const f of fields) {
    if (f === 'title') updated.titleVersion = newVersion;
    if (f === 'description') updated.descriptionVersion = newVersion;
    if (f === 'columnId') updated.columnVersion = newVersion;
    if (f === 'position') updated.positionVersion = newVersion;
  }
  return updated;
}

export function mem_getAllTasks(): Task[] {
  return [...tasks].sort((a, b) => {
    if (a.columnId !== b.columnId) return a.columnId.localeCompare(b.columnId);
    return a.position - b.position;
  });
}

export function mem_positionAtEnd(columnId: Column): number {
  const positions = tasks.filter(t => t.columnId === columnId).map(t => t.position);
  return positions.length === 0 ? INITIAL_STEP : Math.max(...positions) + INITIAL_STEP;
}

export function mem_createTask(payload: {
  tempId: string; title: string; description: string;
  columnId: Column; position: number;
}): Task {
  const pos = payload.position > 0 ? payload.position : mem_positionAtEnd(payload.columnId);
  const task = makeTask(payload.columnId, pos, payload.title.trim() || 'New Task', payload.description);
  tasks.push(task);
  return task;
}

export function mem_updateTask(payload: {
  taskId: string; baseVersion: number; changes: Partial<TaskMutation>;
}): { task: Task; conflict: ConflictResolvedPayload | null } {
  const idx = tasks.findIndex(t => t.id === payload.taskId);
  if (idx === -1) throw new Error(`Task ${payload.taskId} not found`);
  const current = tasks[idx];
  const analysis = analyseConflict(current, payload.baseVersion, payload.changes);

  if (analysis.fullyRejected) {
    return {
      task: current,
      conflict: {
        taskId: current.id, resolution: 'REJECTED', task: current,
        mergedFields: [], rejectedFields: analysis.rejectedFields,
        reason: buildResolutionReason(analysis),
      },
    };
  }

  const changedFields = Object.keys(analysis.mergedChanges) as (keyof TaskMutation)[];
  let updated = bumpVersion(current, changedFields);
  for (const [k, v] of Object.entries(analysis.mergedChanges)) {
    (updated as unknown as Record<string, unknown>)[k] = v;
  }
  tasks[idx] = updated;

  const conflict = analysis.hasConflict
    ? { taskId: updated.id, resolution: 'MERGED' as const, task: updated,
        mergedFields: analysis.mergedFields, rejectedFields: analysis.rejectedFields,
        reason: buildResolutionReason(analysis) }
    : null;

  return { task: updated, conflict };
}

export function mem_moveTask(payload: {
  taskId: string; baseVersion: number; columnId: Column; position: number;
}): { task: Task; conflict: ConflictResolvedPayload | null; needsRebalance: boolean } {
  const idx = tasks.findIndex(t => t.id === payload.taskId);
  if (idx === -1) throw new Error(`Task ${payload.taskId} not found`);
  const current = tasks[idx];
  const changes: Partial<TaskMutation> = { columnId: payload.columnId, position: payload.position };
  const analysis = analyseConflict(current, payload.baseVersion, changes);

  if (analysis.fullyRejected) {
    return { task: current, conflict: {
        taskId: current.id, resolution: 'REJECTED', task: current,
        mergedFields: [], rejectedFields: analysis.rejectedFields,
        reason: buildResolutionReason(analysis),
      }, needsRebalance: false };
  }

  const newColumnId = (analysis.mergedChanges.columnId ?? current.columnId) as Column;
  const newPosition = analysis.mergedChanges.position ?? current.position;
  let updated = bumpVersion(current, ['columnId', 'position']);
  updated = { ...updated, columnId: newColumnId, position: newPosition };
  tasks[idx] = updated;

  // Check if any neighbour is too close
  const neighbours = tasks
    .filter(t => t.columnId === newColumnId && t.id !== updated.id)
    .map(t => Math.abs(t.position - newPosition));
  const needsRebalance = neighbours.some(d => d < MIN_GAP);

  const conflict = analysis.hasConflict
    ? { taskId: updated.id, resolution: 'MERGED' as const, task: updated,
        mergedFields: analysis.mergedFields, rejectedFields: analysis.rejectedFields,
        reason: buildResolutionReason(analysis) }
    : null;

  return { task: updated, conflict, needsRebalance };
}

export function mem_deleteTask(payload: {
  taskId: string;
}): { deleted: boolean; task: Task | null } {
  const idx = tasks.findIndex(t => t.id === payload.taskId);
  if (idx === -1) return { deleted: false, task: null };
  const [removed] = tasks.splice(idx, 1);
  return { deleted: true, task: removed };
}

export function mem_rebalanceColumn(columnId: Column): Task[] {
  const colTasks = tasks.filter(t => t.columnId === columnId)
    .sort((a, b) => a.position - b.position);
  const updated: Task[] = [];
  for (let i = 0; i < colTasks.length; i++) {
    const idx = tasks.findIndex(t => t.id === colTasks[i].id);
    const newPos = (i + 1) * INITIAL_STEP;
    const newTask = bumpVersion(colTasks[i], ['position']);
    tasks[idx] = { ...newTask, position: newPos };
    updated.push(tasks[idx]);
  }
  return updated;
}
