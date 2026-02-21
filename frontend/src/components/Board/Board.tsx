/**
 * Board — root drag-and-drop container.
 *
 * Multi-column DnD pattern (dnd-kit):
 *  - onDragStart: snapshot current task groups into `dragItems` local state
 *  - onDragOver:  update `dragItems` to move the active task to the hovered
 *                 column immediately → smooth cross-column visual feedback
 *  - onDragEnd:   read final position from `dragItems`, send MOVE_TASK to
 *                 server, clear `dragItems` (Zustand store takes over again)
 *
 * Real-time sync:
 *  - TASK_CREATED from other users is now added via fixed confirmTaskCreated
 *  - TASK_UPDATED / TASK_MOVED / TASK_DELETED propagate to all clients
 */

import React, { useCallback, useState, useMemo } from 'react';
import {
  DndContext,
  DragStartEvent,
  DragOverEvent,
  DragEndEvent,
  closestCorners,
  PointerSensor,
  useSensor,
  useSensors,
  DragOverlay,
  UniqueIdentifier,
} from '@dnd-kit/core';
import { arrayMove } from '@dnd-kit/sortable';
import { v4 as uuidv4 } from 'uuid';
import { useBoardStore } from '../../store/boardStore';
import { useWebSocket } from '../../hooks/useWebSocket';
import { useOfflineQueue } from '../../hooks/useOfflineQueue';
import { ColumnComponent } from '../Column/Column';
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

  // ── Drag state ────────────────────────────────────────────────────────────
  // `dragItems`: local snapshot of tasks-per-column updated on every onDragOver
  // so cross-column moves are reflected visually before dragEnd.
  const [activeId, setActiveId] = useState<UniqueIdentifier | null>(null);
  const [dragItems, setDragItems] = useState<Record<Column, Task[]> | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } })
  );

  // ── Stable task groups from Zustand (used when not dragging) ─────────────
  const storeGroups = useMemo<Record<Column, Task[]>>(() => {
    const groups = {} as Record<Column, Task[]>;
    for (const col of ALL_COLUMNS) {
      groups[col] = tasks
        .filter((t) => t.columnId === col)
        .sort((a, b) => a.position - b.position);
    }
    return groups;
  }, [tasks]);

  // During drag use the local snapshot; otherwise use the store
  const displayGroups = dragItems ?? storeGroups;

  const activeTask = useMemo(
    () => tasks.find((t) => t.id === activeId),
    [tasks, activeId]
  );

  // ── Task CRUD handlers ────────────────────────────────────────────────────
  const handleCreateTask = useCallback(
    (columnId: Column) => {
      const tempId = `temp-${uuidv4()}`;
      const colPositions = storeGroups[columnId].map((t) => t.position);
      const position = positionAtEnd(colPositions);
      optimisticCreateTask(tempId, columnId, position);
      sendOrQueue('CREATE_TASK', {
        clientId, tempId, title: 'New Task', description: '', columnId, position,
      });
    },
    [clientId, storeGroups, optimisticCreateTask, sendOrQueue]
  );

  const handleUpdateTask = useCallback(
    (taskId: string, changes: { title?: string; description?: string }) => {
      const task = tasks.find((t) => t.id === taskId);
      if (!task) return;
      optimisticUpdateTask(taskId, changes);
      sendOrQueue('UPDATE_TASK', { clientId, taskId, baseVersion: task.version, changes });
    },
    [clientId, tasks, optimisticUpdateTask, sendOrQueue]
  );

  const handleDeleteTask = useCallback(
    (taskId: string) => {
      const task = tasks.find((t) => t.id === taskId);
      if (!task) return;
      optimisticDeleteTask(taskId);
      sendOrQueue('DELETE_TASK', { clientId, taskId, baseVersion: task.version });
    },
    [clientId, tasks, optimisticDeleteTask, sendOrQueue]
  );

  const handlePresence = useCallback(
    (viewingTask?: string, editingTask?: string) => {
      const username = useBoardStore.getState().username;
      send('PRESENCE_UPDATE', { clientId, username, viewingTask, editingTask });
    },
    [clientId, send]
  );

  // ── DnD: start ────────────────────────────────────────────────────────────
  const handleDragStart = useCallback(
    ({ active }: DragStartEvent) => {
      setActiveId(active.id);
      setDragItems({
        todo: [...storeGroups.todo],
        inprogress: [...storeGroups.inprogress],
        done: [...storeGroups.done],
      });
    },
    [storeGroups]
  );

  // ── DnD: over (visual feedback) ───────────────────────────────────────────
  const handleDragOver = useCallback(
    ({ active, over }: DragOverEvent) => {
      if (!over || !dragItems) return;

      const activeIdStr = String(active.id);
      const overIdStr = String(over.id);

      // Source column
      const sourceCol = (ALL_COLUMNS).find((col) =>
        dragItems[col].some((t) => t.id === activeIdStr)
      );
      if (!sourceCol) return;

      // Target column: column droppable or the column containing the hovered task
      const targetCol = (ALL_COLUMNS as string[]).includes(overIdStr)
        ? (overIdStr as Column)
        : (ALL_COLUMNS).find((col) => dragItems[col].some((t) => t.id === overIdStr));

      if (!targetCol) return;

      if (sourceCol === targetCol) {
        // Same-column reorder — dnd-kit SortableContext handles visual transforms automatically
        const colTasks = dragItems[sourceCol];
        const oldIdx = colTasks.findIndex((t) => t.id === activeIdStr);
        const newIdx = colTasks.findIndex((t) => t.id === overIdStr);
        if (oldIdx < 0 || newIdx < 0 || oldIdx === newIdx) return;
        setDragItems({
          ...dragItems,
          [sourceCol]: arrayMove(colTasks, oldIdx, newIdx),
        });
        return;
      }

      // Cross-column move
      const movedTask = dragItems[sourceCol].find((t) => t.id === activeIdStr)!;
      const newSource = dragItems[sourceCol].filter((t) => t.id !== activeIdStr);
      const newTarget = [...dragItems[targetCol]];
      const overIdx = newTarget.findIndex((t) => t.id === overIdStr);
      if (overIdx >= 0) {
        newTarget.splice(overIdx, 0, { ...movedTask, columnId: targetCol });
      } else {
        newTarget.push({ ...movedTask, columnId: targetCol });
      }

      setDragItems({ ...dragItems, [sourceCol]: newSource, [targetCol]: newTarget });
    },
    [dragItems]
  );

  // ── DnD: end (commit) ─────────────────────────────────────────────────────
  const handleDragEnd = useCallback(
    ({ active }: DragEndEvent) => {
      const activeIdStr = String(active.id);
      const originalTask = tasks.find((t) => t.id === activeIdStr);

      if (!dragItems || !originalTask) {
        setActiveId(null);
        setDragItems(null);
        return;
      }

      // Final column where the task landed
      const finalCol = (ALL_COLUMNS).find((col) =>
        dragItems[col].some((t) => t.id === activeIdStr)
      );

      if (!finalCol) {
        setActiveId(null);
        setDragItems(null);
        return;
      }

      const finalColTasks = dragItems[finalCol];
      const insertIndex = finalColTasks.findIndex((t) => t.id === activeIdStr);

      // Positions of the OTHER tasks in the final column (from original store, not dragItems,
      // to avoid using the already-moved optimistic values)
      const othersPositions = storeGroups[finalCol]
        .filter((t) => t.id !== activeIdStr)
        .map((t) => t.position);

      // Clamp insertIndex to valid range for othersPositions
      const posIdx = Math.max(0, Math.min(insertIndex, othersPositions.length));
      const newPosition = positionForIndex(othersPositions, posIdx);

      // No-op if nothing changed
      const sameColumn = finalCol === originalTask.columnId;
      const samePosition = Math.abs(newPosition - originalTask.position) < 0.001;
      if (sameColumn && samePosition) {
        setActiveId(null);
        setDragItems(null);
        return;
      }

      optimisticMoveTask(activeIdStr, finalCol, newPosition);
      sendOrQueue('MOVE_TASK', {
        clientId,
        taskId: activeIdStr,
        baseVersion: originalTask.version,
        columnId: finalCol,
        position: newPosition,
      });

      setActiveId(null);
      setDragItems(null);
    },
    [activeId, dragItems, tasks, storeGroups, clientId, optimisticMoveTask, sendOrQueue]
  );

  const handleDragCancel = useCallback(() => {
    setActiveId(null);
    setDragItems(null);
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div style={styles.root}>
      <header style={styles.header}>
        <h1 style={styles.logo}>Kanban Board</h1>
        <div style={styles.headerRight}>
          <PresenceBar />
          <ConnectionStatus />
        </div>
      </header>

      {conflicts.length > 0 && (
        <div style={styles.conflictBanner}>
          {conflicts.map((c) => (
            <div key={c.id} style={styles.conflictItem}>
              <span>{c.resolution === 'MERGED' ? '⚡' : '⚠️'}</span>
              <span style={styles.conflictText}>
                <strong>{c.resolution === 'MERGED' ? 'Partial merge:' : 'Conflict:'}</strong>{' '}
                {c.reason}
              </span>
              <button style={styles.conflictClose} onClick={() => dismissConflict(c.id)}>×</button>
            </div>
          ))}
        </div>
      )}

      <ErrorBoundary context="board">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
        >
          <div style={styles.columns}>
            {ALL_COLUMNS.map((col) => (
              <ColumnComponent
                key={col}
                columnId={col}
                tasks={displayGroups[col]}
                presence={presence}
                isActiveDropTarget={
                  activeId !== null &&
                  dragItems !== null &&
                  dragItems[col].some((t) => t.id === activeId) &&
                  storeGroups[col].every((t) => t.id !== activeId)
                }
                onCreateTask={handleCreateTask}
                onUpdateTask={handleUpdateTask}
                onDeleteTask={handleDeleteTask}
                onPresence={handlePresence}
              />
            ))}
          </div>

          <DragOverlay dropAnimation={{ duration: 150, easing: 'ease' }}>
            {activeTask ? (
              <div style={styles.dragOverlay}>
                <div style={styles.dragOverlayTitle}>{activeTask.title}</div>
                {activeTask.description && (
                  <div style={styles.dragOverlayDesc}>{activeTask.description}</div>
                )}
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      </ErrorBoundary>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  root: { minHeight: '100vh', background: '#f3f4f6', display: 'flex', flexDirection: 'column' },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '12px 24px', background: '#fff',
    borderBottom: '1px solid #e5e7eb', boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
  },
  logo: { margin: 0, fontSize: '20px', fontWeight: 800, color: '#6366f1' },
  headerRight: { display: 'flex', alignItems: 'center', gap: '20px' },
  columns: {
    display: 'flex', gap: '16px', padding: '20px 24px',
    flex: 1, overflowX: 'auto', alignItems: 'flex-start',
  },
  conflictBanner: { padding: '8px 24px', display: 'flex', flexDirection: 'column', gap: '6px' },
  conflictItem: {
    display: 'flex', alignItems: 'flex-start', gap: '8px',
    background: '#fef9c3', border: '1px solid #fde047',
    borderRadius: '8px', padding: '8px 12px', fontSize: '13px',
  },
  conflictText: { flex: 1, color: '#713f12' },
  conflictClose: {
    background: 'none', border: 'none', cursor: 'pointer',
    fontSize: '18px', color: '#92400e', lineHeight: 1, padding: '0 2px',
  },
  dragOverlay: {
    background: '#fff', borderRadius: '8px', padding: '10px 14px',
    boxShadow: '0 10px 30px rgba(0,0,0,0.18)', border: '2px solid #6366f1',
    minWidth: '220px', transform: 'rotate(2deg)', cursor: 'grabbing',
  },
  dragOverlayTitle: { fontWeight: 600, fontSize: '14px', color: '#111827' },
  dragOverlayDesc: { fontSize: '12px', color: '#6b7280', marginTop: '4px' },
};
