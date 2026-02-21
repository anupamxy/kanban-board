export type Column = 'todo' | 'inprogress' | 'done';

export const COLUMNS: Column[] = ['todo', 'inprogress', 'done'];

export interface Task {
  id: string;
  title: string;
  description: string;
  columnId: Column;
  position: number;
  version: number;
  // Field-level version tracking for conflict resolution
  titleVersion: number;
  descriptionVersion: number;
  columnVersion: number;
  positionVersion: number;
  createdAt: string;
  updatedAt: string;
}

// What a client sends when mutating a task
export interface TaskMutation {
  title?: string;
  description?: string;
  columnId?: Column;
  position?: number;
}

export interface PresenceUser {
  clientId: string;
  username: string;
  color: string;
  viewingTask?: string;
  editingTask?: string;
  connectedAt: string;
}

// ── WebSocket message types ──────────────────────────────────────────────────

// Client → Server
export type ClientMessage =
  | { type: 'CREATE_TASK'; payload: CreateTaskPayload }
  | { type: 'UPDATE_TASK'; payload: UpdateTaskPayload }
  | { type: 'DELETE_TASK'; payload: DeleteTaskPayload }
  | { type: 'MOVE_TASK'; payload: MoveTaskPayload }
  | { type: 'PRESENCE_UPDATE'; payload: PresenceUpdatePayload }
  | { type: 'SYNC_REQUEST'; payload: SyncRequestPayload }
  | { type: 'REPLAY_QUEUE'; payload: ReplayQueuePayload };

export interface CreateTaskPayload {
  clientId: string;
  tempId: string; // client-side temp id for optimistic UI
  title: string;
  description: string;
  columnId: Column;
  position: number;
}

export interface UpdateTaskPayload {
  clientId: string;
  taskId: string;
  baseVersion: number; // version the client last saw
  changes: {
    title?: string;
    description?: string;
  };
}

export interface DeleteTaskPayload {
  clientId: string;
  taskId: string;
  baseVersion: number;
}

export interface MoveTaskPayload {
  clientId: string;
  taskId: string;
  baseVersion: number;
  columnId: Column;
  position: number;
}

export interface PresenceUpdatePayload {
  clientId: string;
  username: string;
  viewingTask?: string;
  editingTask?: string;
}

export interface SyncRequestPayload {
  clientId: string;
}

export interface ReplayQueuePayload {
  clientId: string;
  operations: QueuedOperation[];
}

export interface QueuedOperation {
  type: 'CREATE_TASK' | 'UPDATE_TASK' | 'DELETE_TASK' | 'MOVE_TASK';
  payload: CreateTaskPayload | UpdateTaskPayload | DeleteTaskPayload | MoveTaskPayload;
  enqueuedAt: string;
}

// Server → Client
export type ServerMessage =
  | { type: 'INITIAL_STATE'; payload: InitialStatePayload }
  | { type: 'TASK_CREATED'; payload: TaskCreatedPayload }
  | { type: 'TASK_UPDATED'; payload: Task }
  | { type: 'TASK_DELETED'; payload: TaskDeletedPayload }
  | { type: 'TASK_MOVED'; payload: Task }
  | { type: 'CONFLICT_RESOLVED'; payload: ConflictResolvedPayload }
  | { type: 'REBALANCED'; payload: RebalancedPayload }
  | { type: 'PRESENCE_UPDATE'; payload: PresenceUser[] }
  | { type: 'ERROR'; payload: ErrorPayload }
  | { type: 'ACK'; payload: AckPayload };

export interface InitialStatePayload {
  tasks: Task[];
  presence: PresenceUser[];
}

export interface TaskCreatedPayload {
  task: Task;
  tempId: string; // echo back so client can replace optimistic placeholder
}

export interface TaskDeletedPayload {
  taskId: string;
}

export interface ConflictResolvedPayload {
  taskId: string;
  resolution: 'MERGED' | 'REJECTED';
  task: Task; // authoritative final state
  mergedFields: string[];
  rejectedFields: string[];
  reason: string;
}

export interface RebalancedPayload {
  columnId: Column;
  tasks: Task[]; // all tasks in that column with updated positions
}

export interface ErrorPayload {
  code: string;
  message: string;
  taskId?: string;
}

export interface AckPayload {
  operationType: string;
  taskId: string;
}

// Database row shape (snake_case from PostgreSQL)
export interface TaskRow {
  id: string;
  title: string;
  description: string;
  column_id: string;
  position: number;
  version: number;
  title_version: number;
  description_version: number;
  column_version: number;
  position_version: number;
  created_at: Date;
  updated_at: Date;
}
