import React, { useState, useCallback } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Task, PresenceUser } from '../../types';
import { TaskEditor } from './TaskEditor';

interface Props {
  task: Task;
  presence: PresenceUser[];
  onUpdate: (taskId: string, changes: { title?: string; description?: string }) => void;
  onDelete: (taskId: string) => void;
  onPresence: (viewingTask?: string, editingTask?: string) => void;
}

export function TaskCard({ task, presence, onUpdate, onDelete, onPresence }: Props) {
  const [editing, setEditing] = useState(false);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id, disabled: editing });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : task.isOptimistic ? 0.75 : 1,
  };

  // Who is editing / viewing this card?
  const editingUsers = presence.filter((u) => u.editingTask === task.id);
  const viewingUsers = presence.filter(
    (u) => u.viewingTask === task.id && !u.editingTask
  );

  const handleStartEdit = useCallback(() => {
    setEditing(true);
    onPresence(task.id, task.id);
  }, [task.id, onPresence]);

  const handleSave = useCallback(
    (title: string, description: string) => {
      onUpdate(task.id, { title, description });
      setEditing(false);
      onPresence(task.id, undefined);
    },
    [task.id, onUpdate, onPresence]
  );

  const handleCancel = useCallback(() => {
    setEditing(false);
    onPresence(task.id, undefined);
  }, [task.id, onPresence]);

  return (
    <div ref={setNodeRef} style={style}>
      <div
        style={{
          ...styles.card,
          borderLeft: task.isOptimistic ? '3px solid #f59e0b' : '3px solid transparent',
        }}
      >
        {/* Drag handle */}
        {!editing && (
          <div
            {...attributes}
            {...listeners}
            style={styles.dragHandle}
            title="Drag to move"
          >
            ⠿
          </div>
        )}

        {/* Editing indicator */}
        {editingUsers.length > 0 && (
          <div style={styles.editingBadge}>
            {editingUsers.map((u) => (
              <span
                key={u.clientId}
                style={{ ...styles.avatarDot, background: u.color }}
                title={`${u.username} is editing`}
              />
            ))}
            <span style={{ fontSize: 11, color: '#6b7280' }}>editing</span>
          </div>
        )}

        {editing ? (
          <TaskEditor
            task={task}
            onSave={handleSave}
            onCancel={handleCancel}
          />
        ) : (
          <div style={styles.content} onDoubleClick={handleStartEdit}>
            <div style={styles.title}>{task.title || 'Untitled'}</div>
            {task.description && (
              <div style={styles.description}>{task.description}</div>
            )}
            <div style={styles.footer}>
              <div style={styles.viewingAvatars}>
                {viewingUsers.map((u) => (
                  <span
                    key={u.clientId}
                    style={{ ...styles.avatarDot, background: u.color }}
                    title={`${u.username} is viewing`}
                  />
                ))}
              </div>
              <div style={styles.actions}>
                <button style={styles.editBtn} onClick={handleStartEdit} title="Edit task">
                  ✎
                </button>
                <button
                  style={styles.deleteBtn}
                  onClick={() => onDelete(task.id)}
                  title="Delete task"
                >
                  ×
                </button>
              </div>
            </div>
          </div>
        )}

        {task.isOptimistic && (
          <div style={styles.syncBadge} title="Syncing…">⟳</div>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  card: {
    background: '#fff',
    borderRadius: '8px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
    padding: '10px 12px',
    position: 'relative',
    cursor: 'default',
    transition: 'box-shadow 0.15s',
    marginBottom: '8px',
  },
  dragHandle: {
    position: 'absolute',
    top: '8px',
    right: '8px',
    cursor: 'grab',
    color: '#d1d5db',
    fontSize: '16px',
    lineHeight: 1,
    userSelect: 'none',
    touchAction: 'none',
  },
  content: { paddingRight: '20px' },
  title: { fontWeight: 600, fontSize: '14px', color: '#111827', marginBottom: '4px' },
  description: {
    fontSize: '12px',
    color: '#6b7280',
    marginBottom: '8px',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  },
  footer: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: '6px',
  },
  viewingAvatars: { display: 'flex', gap: '3px' },
  actions: { display: 'flex', gap: '4px' },
  editBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: '15px',
    color: '#6b7280',
    padding: '2px 4px',
    borderRadius: '4px',
  },
  deleteBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: '18px',
    color: '#ef4444',
    padding: '2px 4px',
    borderRadius: '4px',
    lineHeight: 1,
  },
  editingBadge: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    marginBottom: '6px',
  },
  avatarDot: {
    display: 'inline-block',
    width: 8,
    height: 8,
    borderRadius: '50%',
  },
  syncBadge: {
    position: 'absolute',
    bottom: '6px',
    right: '8px',
    fontSize: '11px',
    color: '#f59e0b',
    animation: 'spin 1s linear infinite',
  },
};
