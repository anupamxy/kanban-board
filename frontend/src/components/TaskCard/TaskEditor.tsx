import React, { useState, useRef, useEffect } from 'react';
import { Task } from '../../types';

interface Props {
  task: Task;
  onSave: (title: string, description: string) => void;
  onCancel: () => void;
}

export function TaskEditor({ task, onSave, onCancel }: Props) {
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    titleRef.current?.focus();
    titleRef.current?.select();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onCancel();
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleSave();
  };

  const handleSave = () => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) return;
    onSave(trimmedTitle, description.trim());
  };

  return (
    <div style={styles.editor} onKeyDown={handleKeyDown}>
      <input
        ref={titleRef}
        style={styles.titleInput}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Task title"
        maxLength={200}
      />
      <textarea
        style={styles.descInput}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Description (optional)"
        rows={3}
        maxLength={2000}
      />
      <div style={styles.actions}>
        <button style={styles.saveBtn} onClick={handleSave} disabled={!title.trim()}>
          Save
        </button>
        <button style={styles.cancelBtn} onClick={onCancel}>
          Cancel
        </button>
      </div>
      <div style={styles.hint}>Ctrl+Enter to save · Esc to cancel</div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  editor: { display: 'flex', flexDirection: 'column', gap: '8px' },
  titleInput: {
    padding: '6px 8px',
    border: '1.5px solid #6366f1',
    borderRadius: '6px',
    fontSize: '14px',
    fontWeight: 600,
    outline: 'none',
    width: '100%',
  },
  descInput: {
    padding: '6px 8px',
    border: '1.5px solid #e5e7eb',
    borderRadius: '6px',
    fontSize: '13px',
    resize: 'vertical',
    outline: 'none',
    fontFamily: 'inherit',
    width: '100%',
  },
  actions: { display: 'flex', gap: '8px' },
  saveBtn: {
    padding: '5px 14px',
    background: '#6366f1',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontWeight: 600,
    fontSize: '13px',
  },
  cancelBtn: {
    padding: '5px 14px',
    background: 'none',
    color: '#6b7280',
    border: '1px solid #e5e7eb',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '13px',
  },
  hint: { fontSize: '11px', color: '#9ca3af' },
};
