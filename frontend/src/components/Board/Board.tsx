/**
 * Board — root drag-and-drop container.
 *
 * Handles:
 * - DndContext setup with collision detection
 * - Drag-over (cross-column move) detection
 * - Drag-end: compute final position via fractional indexing and send MOVE_TASK
 * - Optimistic moves so the UI responds instantly
 */

import React, { useCallback, useState } from 'react';
import {
  DndContext,
  DragStartEvent,
  DragOverEvent,
  DragEndEvent,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragOverlay,
} from '@dnd-kit/core';
import { arrayMove } from '@dnd-kit/sortable';
import { v4 as uuidv4 } from 'uuid';
import { useBoardStore } from '../../store/boardStore';
import { useWebSocket } from '../../hooks/useWebSocket';
import { useOfflineQueue } from '../../hooks/useOfflineQueue';
import { Column as ColumnComponent } from '../Column/Column';
import { PresenceBar } from '../Presence/PresenceBar';
import { ConnectionStatus } from '../ConnectionStatus/ConnectionStatus';
import { ErrorBoundary } from '../ErrorBoundary/ErrorBoundary';
import { ALL_COLUMNS, Column, Task } from '../../types';
import { positionAtEnd, positionForIndex } from '../../lib/fractionalIndex';

export function Board() {
  const { send } = useWebSocket();
  const { sendOrQueue } = useOfflineQueue(send);

  const {
    tasks,
    presence,
    clientId,
    conflicts,
    dismissConflict,
    optimisticCreateTask,
    optimisticUpdateTask,
    optimisticMoveTask,
    optimisticDeleteTask,
  } = useBoardStore();

  const [activeTask, setActiveTask] = useState<Task | null>(null);
  // Track which column a card is hovering over during drag
  const [overColumn, setOverColumn] = useState<Column | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  // ── Task groups by column ─────────────────────────────────────────────
  const tasksByColumn = ALL_COLUMNS.reduce<Record<Column, Task[]>>((acc, col) => {
    acc[col] = tasks.filter((t) => t.columnId === col).sort((a, b) => a.position - b.position);
    return acc;
  }, {} as Record<Column, Task[]>);

  // ── Create task ───────────────────────────────────────────────────────
  const handleCreateTask = useCallback(
    (columnId: Column) => {
      const tempId = `temp-${uuidv4()}`;
      const columnPositions = tasksByColumn[columnId].map((t) => t.position);
      const position = positionAtEnd(columnPositions);

      optimisticCreateTask(tempId, columnId, position);

      sendOrQueue('CREATE_TASK', {
        clientId,
        tempId,
        title: 'New Task',
        description: '',
        columnId,
        position,
      });
    },
    [clientId, tasksByColumn, optimisticCreateTask, sendOrQueue]
  );

  // ── Update task ───────────────────────────────────────────────────────
  const handleUpdateTask = useCallback(
    (taskId: string, changes: { title?: string; description?: string }) => {
      const task = tasks.find((t) => t.id === taskId);
      if (!task) return;

      optimisticUpdateTask(taskId, changes);

      sendOrQueue('UPDATE_TASK', {
        clientId,
        taskId,
        baseVersion: task.version,
        changes,
      });
    },
    [clientId, tasks, optimisticUpdateTask, sendOrQueue]
  );

  // ── Delete task ───────────────────────────────────────────────────────
  const handleDeleteTask = useCallback(
    (taskId: string) => {
      const task = tasks.find((t) => t.id === taskId);
      if (!task) return;

      optimisticDeleteTask(taskId);

      sendOrQueue('DELETE_TASK', {
        clientId,
        taskId,
        baseVersion: task.version,
      });
    },
    [clientId, tasks, optimisticDeleteTask, sendOrQueue]
  );

  // ── Presence ──────────────────────────────────────────────────────────
  const handlePresence = useCallback(
    (viewingTask?: string, editingTask?: string) => {
      const username = useBoardStore.getState().username;
      send('PRESENCE_UPDATE', { clientId, username, viewingTask, editingTask });
    },
    [clientId, send]
  );

  // ── Drag handlers ─────────────────────────────────────────────────────
  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const task = tasks.find((t) => t.id === event.active.id);
      setActiveTask(task ?? null);
    },
    [tasks]
  );

  const handleDragOver = useCallback(
    (event: DragOverEvent) => {
      const { over } = event;
      if (!over) { setOverColumn(null); return; }
      const overId = String(over.id);
      // over.id could be a column droppable id or a task id
      if ((ALL_COLUMNS as string[]).includes(overId)) {
        setOverColumn(overId as Column);
      } else {
        const overTask = tasks.find((t) => t.id === overId);
        if (overTask) setOverColumn(overTask.columnId);
      }
    },
    [tasks]
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      setActiveTask(null);
      setOverColumn(null);

      if (!over) return;

      const draggedTask = tasks.find((t) => t.id === active.id);
      if (!draggedTask) return;

      const overId = String(over.id);
      let targetColumn: Column;
      let targetPosition: number;

      if ((ALL_COLUMNS as string[]).includes(overId)) {
        // Dropped directly on a column (empty area)
        targetColumn = overId as Column;
        const colPositions = tasksByColumn[targetColumn]
          .filter((t) => t.id !== draggedTask.id)
          .map((t) => t.position);
        targetPosition = positionAtEnd(colPositions);
      } else {
        // Dropped on another task
        const overTask = tasks.find((t) => t.id === overId);
        if (!overTask) return;
        targetColumn = overTask.columnId;

        // Compute sorted column tasks (excluding dragged) and find insertion index
        const colTasks = tasksByColumn[targetColumn]
          .filter((t) => t.id !== draggedTask.id)
          .sort((a, b) => a.position - b.position);

        const overIndex = colTasks.findIndex((t) => t.id === overId);
        const insertAt = overIndex === -1 ? colTasks.length : overIndex;
        const positions = colTasks.map((t) => t.position);
        targetPosition = positionForIndex(positions, insertAt);
      }

      // No-op if nothing changed
      if (
        draggedTask.columnId === targetColumn &&
        Math.abs(draggedTask.position - targetPosition) < 0.001
      ) return;

      optimisticMoveTask(draggedTask.id, targetColumn, targetPosition);

      sendOrQueue('MOVE_TASK', {
        clientId,
        taskId: draggedTask.id,
        baseVersion: draggedTask.version,
        columnId: targetColumn,
        position: targetPosition,
      });
    },
    [clientId, tasks, tasksByColumn, optimisticMoveTask, sendOrQueue]
  );

  return (
    <div style={styles.root}>
      {/* ── Header ── */}
      <header style={styles.header}>
        <h1 style={styles.logo}>Kanban Board</h1>
        <div style={styles.headerRight}>
          <PresenceBar />
          <ConnectionStatus />
        </div>
      </header>

      {/* ── Conflict notifications ── */}
      {conflicts.length > 0 && (
        <div style={styles.conflictBanner}>
          {conflicts.map((c) => (
            <div key={c.id} style={styles.conflictItem}>
              <span style={styles.conflictIcon}>
                {c.resolution === 'MERGED' ? '⚡' : '⚠️'}
              </span>
              <span style={styles.conflictText}>
                <strong>{c.resolution === 'MERGED' ? 'Partial merge:' : 'Conflict:'}</strong>{' '}
                {c.reason}
              </span>
              <button style={styles.conflictClose} onClick={() => dismissConflict(c.id)}>
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {/* ── Board ── */}
      <ErrorBoundary context="board">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
        >
          <div style={styles.columns}>
            {ALL_COLUMNS.map((col) => (
              <ColumnComponent
                key={col}
                columnId={col}
                tasks={tasksByColumn[col]}
                presence={presence}
                onCreateTask={handleCreateTask}
                onUpdateTask={handleUpdateTask}
                onDeleteTask={handleDeleteTask}
                onPresence={handlePresence}
              />
            ))}
          </div>

          {/* Drag overlay — shows the card being dragged */}
          <DragOverlay>
            {activeTask && (
              <div style={styles.dragOverlay}>
                <div style={styles.dragOverlayTitle}>{activeTask.title}</div>
                {activeTask.description && (
                  <div style={styles.dragOverlayDesc}>{activeTask.description}</div>
                )}
              </div>
            )}
          </DragOverlay>
        </DndContext>
      </ErrorBoundary>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    minHeight: '100vh',
    background: '#f3f4f6',
    display: 'flex',
    flexDirection: 'column',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 24px',
    background: '#fff',
    borderBottom: '1px solid #e5e7eb',
    boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
  },
  logo: { margin: 0, fontSize: '20px', fontWeight: 800, color: '#6366f1' },
  headerRight: { display: 'flex', alignItems: 'center', gap: '20px' },
  columns: {
    display: 'flex',
    gap: '16px',
    padding: '20px 24px',
    flex: 1,
    overflowX: 'auto',
    alignItems: 'flex-start',
  },
  conflictBanner: {
    padding: '8px 24px',
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  conflictItem: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '8px',
    background: '#fef9c3',
    border: '1px solid #fde047',
    borderRadius: '8px',
    padding: '8px 12px',
    fontSize: '13px',
  },
  conflictIcon: { flexShrink: 0 },
  conflictText: { flex: 1, color: '#713f12' },
  conflictClose: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: '18px',
    color: '#92400e',
    lineHeight: 1,
    padding: '0 2px',
    flexShrink: 0,
  },
  dragOverlay: {
    background: '#fff',
    borderRadius: '8px',
    padding: '10px 14px',
    boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
    border: '2px solid #6366f1',
    minWidth: '200px',
    transform: 'rotate(3deg)',
  },
  dragOverlayTitle: { fontWeight: 600, fontSize: '14px', color: '#111827' },
  dragOverlayDesc: { fontSize: '12px', color: '#6b7280', marginTop: '4px' },
};
