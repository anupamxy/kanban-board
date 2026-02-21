/**
 * Board — root drag-and-drop container.
 *
 * Key fix: drag callbacks (onDragOver / onDragEnd) read from a ref
 * (dragStateRef) instead of closed-over state values.  React state is
 * updated asynchronously so closures over `dragItems` become stale the
 * moment the first setDragItems() call is made.  The ref is updated
 * synchronously, so every event handler always sees the latest data.
 */

import React, { useCallback, useState, useMemo, useRef, useEffect } from 'react';
import {
  DndContext,
  DragStartEvent,
  DragOverEvent,
  DragEndEvent,
  closestCorners,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  DragOverlay,
  UniqueIdentifier,
} from '@dnd-kit/core';
import { arrayMove, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
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

// Shape kept in ref so callbacks always see fresh values without re-creating
interface DragState {
  dragItems: Record<Column, Task[]> | null;
  storeGroups: Record<Column, Task[]>;
  tasks: Task[];
}

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
  const [activeId, setActiveId] = useState<UniqueIdentifier | null>(null);
  // `dragItems` state drives rendering; ref drives logic (no stale closures)
  const [dragItems, setDragItems] = useState<Record<Column, Task[]> | null>(null);

  const dragStateRef = useRef<DragState>({
    dragItems: null,
    storeGroups: { todo: [], inprogress: [], done: [] },
    tasks: [],
  });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  // ── Stable task groups from Zustand ───────────────────────────────────────
  const storeGroups = useMemo<Record<Column, Task[]>>(() => {
    const groups = {} as Record<Column, Task[]>;
    for (const col of ALL_COLUMNS) {
      groups[col] = tasks
        .filter((t) => t.columnId === col)
        .sort((a, b) => a.position - b.position);
    }
    return groups;
  }, [tasks]);

  // Keep ref in sync with the latest rendered values (runs after every render)
  useEffect(() => {
    dragStateRef.current.storeGroups = storeGroups;
    dragStateRef.current.tasks = tasks;
  });

  // Helper: update both state (for rendering) and ref (for event handlers)
  const applyDragItems = useCallback((v: Record<Column, Task[]> | null) => {
    dragStateRef.current.dragItems = v;
    setDragItems(v);
  }, []);

  // During drag show local snapshot; outside drag show store
  const displayGroups = dragItems ?? storeGroups;

  const activeTask = useMemo(
    () => tasks.find((t) => t.id === activeId),
    [tasks, activeId]
  );

  // ── Task CRUD handlers ────────────────────────────────────────────────────
  const handleCreateTask = useCallback(
    (columnId: Column) => {
      const tempId = `temp-${uuidv4()}`;
      const colPositions = dragStateRef.current.storeGroups[columnId].map((t) => t.position);
      const position = positionAtEnd(colPositions);
      optimisticCreateTask(tempId, columnId, position);
      sendOrQueue('CREATE_TASK', {
        clientId, tempId, title: 'New Task', description: '', columnId, position,
      });
    },
    [clientId, optimisticCreateTask, sendOrQueue]
  );

  const handleUpdateTask = useCallback(
    (taskId: string, changes: { title?: string; description?: string }) => {
      const task = dragStateRef.current.tasks.find((t) => t.id === taskId);
      if (!task) return;
      optimisticUpdateTask(taskId, changes);
      sendOrQueue('UPDATE_TASK', { clientId, taskId, baseVersion: task.version, changes });
    },
    [clientId, optimisticUpdateTask, sendOrQueue]
  );

  const handleDeleteTask = useCallback(
    (taskId: string) => {
      const task = dragStateRef.current.tasks.find((t) => t.id === taskId);
      if (!task) return;
      optimisticDeleteTask(taskId);
      sendOrQueue('DELETE_TASK', { clientId, taskId, baseVersion: task.version });
    },
    [clientId, optimisticDeleteTask, sendOrQueue]
  );

  const handlePresence = useCallback(
    (viewingTask?: string, editingTask?: string) => {
      const username = useBoardStore.getState().username;
      send('PRESENCE_UPDATE', { clientId, username, viewingTask, editingTask });
    },
    [clientId, send]
  );

  // ── DnD: start ────────────────────────────────────────────────────────────
  const handleDragStart = useCallback(({ active }: DragStartEvent) => {
    const { storeGroups: sg } = dragStateRef.current;
    const snapshot: Record<Column, Task[]> = {
      todo:       [...sg.todo],
      inprogress: [...sg.inprogress],
      done:       [...sg.done],
    };
    setActiveId(active.id);
    applyDragItems(snapshot);
  }, [applyDragItems]);

  // ── DnD: over (visual feedback — uses ref to avoid stale closure) ─────────
  const handleDragOver = useCallback(({ active, over }: DragOverEvent) => {
    const current = dragStateRef.current.dragItems;
    if (!over || !current) return;

    const activeIdStr = String(active.id);
    const overIdStr   = String(over.id);

    // Find the column that currently holds the dragged task
    const sourceCol = ALL_COLUMNS.find((col) =>
      current[col].some((t) => t.id === activeIdStr)
    );
    if (!sourceCol) return;

    // Target is either a column droppable (id === column name) or the column
    // that contains the task being hovered over
    const targetCol: Column | undefined = (ALL_COLUMNS as string[]).includes(overIdStr)
      ? (overIdStr as Column)
      : ALL_COLUMNS.find((col) => current[col].some((t) => t.id === overIdStr));

    if (!targetCol) return;

    if (sourceCol === targetCol) {
      // Same-column reorder
      const colTasks = current[sourceCol];
      const oldIdx = colTasks.findIndex((t) => t.id === activeIdStr);
      const newIdx = colTasks.findIndex((t) => t.id === overIdStr);
      if (oldIdx < 0 || newIdx < 0 || oldIdx === newIdx) return;
      applyDragItems({ ...current, [sourceCol]: arrayMove(colTasks, oldIdx, newIdx) });
      return;
    }

    // Cross-column move
    const movedTask = current[sourceCol].find((t) => t.id === activeIdStr)!;
    const newSource = current[sourceCol].filter((t) => t.id !== activeIdStr);
    const newTarget = [...current[targetCol]];
    const overIdx = newTarget.findIndex((t) => t.id === overIdStr);
    if (overIdx >= 0) {
      newTarget.splice(overIdx, 0, { ...movedTask, columnId: targetCol });
    } else {
      newTarget.push({ ...movedTask, columnId: targetCol });
    }

    applyDragItems({ ...current, [sourceCol]: newSource, [targetCol]: newTarget });
  }, [applyDragItems]);

  // ── DnD: end (commit) — uses ref for all mutable values ──────────────────
  const handleDragEnd = useCallback(({ active }: DragEndEvent) => {
    const { dragItems: di, storeGroups: sg, tasks: ts } = dragStateRef.current;

    const activeIdStr  = String(active.id);
    const originalTask = ts.find((t) => t.id === activeIdStr);

    if (!di || !originalTask) {
      setActiveId(null);
      applyDragItems(null);
      return;
    }

    // Column where the task ended up after all onDragOver moves
    const finalCol = ALL_COLUMNS.find((col) =>
      di[col].some((t) => t.id === activeIdStr)
    );

    if (!finalCol) {
      setActiveId(null);
      applyDragItems(null);
      return;
    }

    const finalColTasks = di[finalCol];
    const insertIndex   = finalColTasks.findIndex((t) => t.id === activeIdStr);

    // Compute new fractional position from original store positions
    // (avoids using already-mutated optimistic values)
    const othersPositions = sg[finalCol]
      .filter((t) => t.id !== activeIdStr)
      .map((t) => t.position);

    const posIdx      = Math.max(0, Math.min(insertIndex, othersPositions.length));
    const newPosition = positionForIndex(othersPositions, posIdx);

    // No-op if nothing actually changed
    const sameColumn   = finalCol === originalTask.columnId;
    const samePosition = Math.abs(newPosition - originalTask.position) < 0.001;
    if (sameColumn && samePosition) {
      setActiveId(null);
      applyDragItems(null);
      return;
    }

    optimisticMoveTask(activeIdStr, finalCol, newPosition);
    sendOrQueue('MOVE_TASK', {
      clientId,
      taskId:      activeIdStr,
      baseVersion: originalTask.version,
      columnId:    finalCol,
      position:    newPosition,
    });

    setActiveId(null);
    applyDragItems(null);
  }, [clientId, optimisticMoveTask, sendOrQueue, applyDragItems]);

  const handleDragCancel = useCallback(() => {
    setActiveId(null);
    applyDragItems(null);
  }, [applyDragItems]);

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
                  dragItems[col].some((t) => t.id === String(activeId)) &&
                  storeGroups[col].every((t) => t.id !== String(activeId))
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
