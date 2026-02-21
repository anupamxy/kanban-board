/**
 * Zustand store — single source of truth for the board state.
 *
 * Optimistic UI pattern:
 *   1. User action → immediately mutate local state (optimistic)
 *   2. Send mutation over WebSocket
 *   3. Server ACKs with authoritative state → reconcile (replace optimistic with real)
 *   4. On conflict → server sends CONFLICT_RESOLVED → show notification, revert if needed
 */

import { create } from 'zustand';
import {
  Task,
  Column,
  PresenceUser,
  ConflictResolvedPayload,
  ConnectionStatus,
  QueuedOperation,
} from '../types';
import { v4 as uuidv4 } from 'uuid';

interface ConflictNotification {
  id: string;
  taskId: string;
  resolution: 'MERGED' | 'REJECTED';
  reason: string;
  timestamp: number;
}

interface BoardState {
  // Board data
  tasks: Task[];
  presence: PresenceUser[];
  connectionStatus: ConnectionStatus;
  offlineQueue: QueuedOperation[];
  conflicts: ConflictNotification[];

  // Identity
  clientId: string;
  username: string;

  // Actions
  setConnectionStatus: (status: ConnectionStatus) => void;
  setInitialState: (tasks: Task[], presence: PresenceUser[]) => void;

  // Optimistic mutations
  optimisticCreateTask: (tempId: string, columnId: Column, position: number) => Task;
  confirmTaskCreated: (task: Task, tempId: string) => void;

  optimisticUpdateTask: (taskId: string, changes: Partial<Pick<Task, 'title' | 'description'>>) => void;
  confirmTaskUpdated: (task: Task) => void;

  optimisticMoveTask: (taskId: string, columnId: Column, position: number) => void;
  confirmTaskMoved: (task: Task) => void;

  optimisticDeleteTask: (taskId: string) => void;
  confirmTaskDeleted: (taskId: string) => void;

  // Server-pushed state
  applyServerTask: (task: Task) => void;
  applyTaskDeleted: (taskId: string) => void;
  applyRebalanced: (columnId: Column, tasks: Task[]) => void;
  applyPresenceUpdate: (users: PresenceUser[]) => void;
  applyConflict: (payload: ConflictResolvedPayload) => void;

  // Offline queue
  enqueueOperation: (op: QueuedOperation) => void;
  clearQueue: () => void;

  // Conflict notifications
  dismissConflict: (id: string) => void;
}

/** Generate stable client identity (persisted in sessionStorage) */
function getOrCreateClientId(): string {
  const stored = sessionStorage.getItem('kanban_clientId');
  if (stored) return stored;
  const id = uuidv4();
  sessionStorage.setItem('kanban_clientId', id);
  return id;
}

function getOrCreateUsername(): string {
  const stored = sessionStorage.getItem('kanban_username');
  if (stored) return stored;
  const adjectives = ['Swift', 'Bold', 'Bright', 'Calm', 'Keen', 'Wise', 'Cool'];
  const nouns = ['Panda', 'Tiger', 'Eagle', 'Shark', 'Wolf', 'Bear', 'Fox'];
  const name = `${adjectives[Math.floor(Math.random() * adjectives.length)]}${nouns[Math.floor(Math.random() * nouns.length)]}`;
  sessionStorage.setItem('kanban_username', name);
  return name;
}

export const useBoardStore = create<BoardState>((set, get) => ({
  tasks: [],
  presence: [],
  connectionStatus: 'connecting',
  offlineQueue: [],
  conflicts: [],
  clientId: getOrCreateClientId(),
  username: getOrCreateUsername(),

  setConnectionStatus: (status) => set({ connectionStatus: status }),

  setInitialState: (tasks, presence) =>
    set({ tasks: tasks.sort((a, b) => a.position - b.position), presence }),

  // ── Optimistic creates ──────────────────────────────────────────────────
  optimisticCreateTask: (tempId, columnId, position) => {
    const optimistic: Task = {
      id: tempId,
      title: 'New Task',
      description: '',
      columnId,
      position,
      version: 0,
      titleVersion: 0,
      descriptionVersion: 0,
      columnVersion: 0,
      positionVersion: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isOptimistic: true,
    };
    set((s) => ({ tasks: [...s.tasks, optimistic] }));
    return optimistic;
  },

  confirmTaskCreated: (task, tempId) =>
    set((s) => ({
      tasks: s.tasks.map((t) => (t.id === tempId ? { ...task, isOptimistic: false } : t)),
    })),

  // ── Optimistic updates ──────────────────────────────────────────────────
  optimisticUpdateTask: (taskId, changes) =>
    set((s) => ({
      tasks: s.tasks.map((t) =>
        t.id === taskId ? { ...t, ...changes, isOptimistic: true } : t
      ),
    })),

  confirmTaskUpdated: (task) =>
    set((s) => ({
      tasks: s.tasks.map((t) => (t.id === task.id ? { ...task, isOptimistic: false } : t)),
    })),

  // ── Optimistic moves ────────────────────────────────────────────────────
  optimisticMoveTask: (taskId, columnId, position) =>
    set((s) => ({
      tasks: s.tasks.map((t) =>
        t.id === taskId ? { ...t, columnId, position, isOptimistic: true } : t
      ),
    })),

  confirmTaskMoved: (task) =>
    set((s) => ({
      tasks: s.tasks.map((t) => (t.id === task.id ? { ...task, isOptimistic: false } : t)),
    })),

  // ── Optimistic deletes ──────────────────────────────────────────────────
  optimisticDeleteTask: (taskId) =>
    set((s) => ({ tasks: s.tasks.filter((t) => t.id !== taskId) })),

  confirmTaskDeleted: (taskId) =>
    set((s) => ({ tasks: s.tasks.filter((t) => t.id !== taskId) })),

  // ── Server-pushed state ─────────────────────────────────────────────────
  applyServerTask: (task) =>
    set((s) => {
      const exists = s.tasks.find((t) => t.id === task.id);
      if (exists) {
        return { tasks: s.tasks.map((t) => (t.id === task.id ? { ...task, isOptimistic: false } : t)) };
      }
      return { tasks: [...s.tasks, task] };
    }),

  applyTaskDeleted: (taskId) =>
    set((s) => ({ tasks: s.tasks.filter((t) => t.id !== taskId) })),

  applyRebalanced: (columnId, tasks) =>
    set((s) => {
      const otherTasks = s.tasks.filter((t) => t.columnId !== columnId);
      return { tasks: [...otherTasks, ...tasks] };
    }),

  applyPresenceUpdate: (users) => set({ presence: users }),

  applyConflict: (payload) => {
    // Reconcile the task to the authoritative server state
    set((s) => ({
      tasks: s.tasks.map((t) =>
        t.id === payload.taskId ? { ...payload.task, isOptimistic: false } : t
      ),
      conflicts: [
        ...s.conflicts,
        {
          id: uuidv4(),
          taskId: payload.taskId,
          resolution: payload.resolution,
          reason: payload.reason,
          timestamp: Date.now(),
        },
      ],
    }));
  },

  // ── Offline queue ───────────────────────────────────────────────────────
  enqueueOperation: (op) =>
    set((s) => ({ offlineQueue: [...s.offlineQueue, op] })),

  clearQueue: () => set({ offlineQueue: [] }),

  // ── Conflict notifications ──────────────────────────────────────────────
  dismissConflict: (id) =>
    set((s) => ({ conflicts: s.conflicts.filter((c) => c.id !== id) })),
}));
