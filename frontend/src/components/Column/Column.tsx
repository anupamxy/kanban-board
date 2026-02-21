import React from 'react';
import {
  SortableContext,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { useDroppable } from '@dnd-kit/core';
import { Column as ColumnType, Task, PresenceUser, COLUMN_LABELS } from '../../types';
import { TaskCard } from '../TaskCard/TaskCard';
import { ErrorBoundary } from '../ErrorBoundary/ErrorBoundary';

interface Props {
  columnId: ColumnType;
  tasks: Task[];
  presence: PresenceUser[];
  isActiveDropTarget: boolean;
  onCreateTask: (columnId: ColumnType) => void;
  onUpdateTask: (taskId: string, changes: { title?: string; description?: string }) => void;
  onDeleteTask: (taskId: string) => void;
  onPresence: (viewingTask?: string, editingTask?: string) => void;
}

const COLUMN_COLORS: Record<ColumnType, { header: string; bg: string; badge: string; dropBg: string }> = {
  todo:       { header: '#6366f1', bg: '#f5f5ff', badge: '#e0e7ff', dropBg: '#ede9fe' },
  inprogress: { header: '#f59e0b', bg: '#fffbeb', badge: '#fef3c7', dropBg: '#fef3c7' },
  done:       { header: '#22c55e', bg: '#f0fdf4', badge: '#dcfce7', dropBg: '#d1fae5' },
};

export function ColumnComponent({
  columnId,
  tasks,
  presence,
  isActiveDropTarget,
  onCreateTask,
  onUpdateTask,
  onDeleteTask,
  onPresence,
}: Props) {
  const { setNodeRef, isOver } = useDroppable({ id: columnId });
  const colors = COLUMN_COLORS[columnId];
  const sorted = [...tasks].sort((a, b) => a.position - b.position);

  const bgColor = isOver || isActiveDropTarget ? colors.dropBg : colors.bg;
  const borderStyle = isOver || isActiveDropTarget
    ? `2px solid ${colors.header}`
    : '2px solid transparent';

  return (
    <div
      ref={setNodeRef}
      style={{ ...styles.column, background: bgColor, border: borderStyle }}
    >
      {/* Header */}
      <div style={{ ...styles.header, borderBottom: `3px solid ${colors.header}` }}>
        <span style={styles.title}>{COLUMN_LABELS[columnId]}</span>
        <span style={{ ...styles.badge, background: colors.badge, color: colors.header }}>
          {tasks.length}
        </span>
      </div>

      {/* Task list */}
      <div style={styles.taskList}>
        <ErrorBoundary context={`column-${columnId}`}>
          <SortableContext
            items={sorted.map((t) => t.id)}
            strategy={verticalListSortingStrategy}
          >
            {sorted.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                presence={presence}
                onUpdate={onUpdateTask}
                onDelete={onDeleteTask}
                onPresence={onPresence}
              />
            ))}
          </SortableContext>
        </ErrorBoundary>

        {sorted.length === 0 && (
          <div style={styles.empty}>Drop tasks here</div>
        )}
      </div>

      {/* Add task button */}
      <button
        style={{ ...styles.addBtn, borderColor: colors.header, color: colors.header }}
        onClick={() => onCreateTask(columnId)}
      >
        + Add task
      </button>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  column: {
    flex: '1 1 0',
    minWidth: 280,
    maxWidth: 380,
    borderRadius: '12px',
    padding: '12px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    transition: 'background 0.15s, border-color 0.15s',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: '10px',
    marginBottom: '4px',
  },
  title: { fontWeight: 700, fontSize: '15px', color: '#111827' },
  badge: {
    borderRadius: '999px',
    padding: '2px 8px',
    fontSize: '12px',
    fontWeight: 600,
  },
  taskList: {
    flex: 1,
    minHeight: '120px',
    overflowY: 'auto',
  },
  empty: {
    textAlign: 'center',
    color: '#d1d5db',
    fontSize: '13px',
    padding: '32px 0',
    userSelect: 'none',
  },
  addBtn: {
    width: '100%',
    padding: '8px',
    background: 'transparent',
    borderRadius: '8px',
    border: '1.5px dashed',
    cursor: 'pointer',
    fontWeight: 500,
    fontSize: '13px',
    transition: 'background 0.15s',
  },
};
