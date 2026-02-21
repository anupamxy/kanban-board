export type Column = 'todo' | 'inprogress' | 'done';

export const COLUMN_LABELS: Record<Column, string> = {
  todo: 'To Do',
  inprogress: 'In Progress',
  done: 'Done',
};

export const ALL_COLUMNS: Column[] = ['todo', 'inprogress', 'done'];

export interface Task {
  id: string;
  title: string;
  description: string;
  columnId: Column;
  position: number;
  version: number;
  titleVersion: number;
  descriptionVersion: number;
  columnVersion: number;
  positionVersion: number;
  createdAt: string;
  updatedAt: string;
  // Optimistic-only fields (not persisted)
  isOptimistic?: boolean;
  optimisticError?: string;
}

export interface PresenceUser {
  clientId: string;
  username: string;
  color: string;
  viewingTask?: string;
  editingTask?: string;
  connectedAt: string;
}

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'reconnecting';

// ── WebSocket message types (mirrored from backend) ─────────────────────────

export type ServerMessage =
  | { type: 'INITIAL_STATE'; payload: { tasks: Task[]; presence: PresenceUser[] } }
  | { type: 'TASK_CREATED'; payload: { task: Task; tempId: string } }
  | { type: 'TASK_UPDATED'; payload: Task }
  | { type: 'TASK_DELETED'; payload: { taskId: string } }
  | { type: 'TASK_MOVED'; payload: Task }
  | { type: 'CONFLICT_RESOLVED'; payload: ConflictResolvedPayload }
  | { type: 'REBALANCED'; payload: { columnId: Column; tasks: Task[] } }
  | { type: 'PRESENCE_UPDATE'; payload: PresenceUser[] }
  | { type: 'ERROR'; payload: { code: string; message: string; taskId?: string } }
  | { type: 'ACK'; payload: { operationType: string; taskId: string } };

export interface ConflictResolvedPayload {
  taskId: string;
  resolution: 'MERGED' | 'REJECTED';
  task: Task;
  mergedFields: string[];
  rejectedFields: string[];
  reason: string;
}

export interface QueuedOperation {
  type: 'CREATE_TASK' | 'UPDATE_TASK' | 'DELETE_TASK' | 'MOVE_TASK';
  payload: Record<string, unknown>;
  enqueuedAt: string;
}
