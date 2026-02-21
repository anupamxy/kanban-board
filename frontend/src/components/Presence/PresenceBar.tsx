import React from 'react';
import { useBoardStore } from '../../store/boardStore';

export function PresenceBar() {
  const { presence, clientId } = useBoardStore();
  const others = presence.filter((u) => u.clientId !== clientId);
  const me = presence.find((u) => u.clientId === clientId);

  if (presence.length === 0) return null;

  return (
    <div style={styles.bar}>
      {/* Own avatar */}
      {me && (
        <Avatar user={me} label={`${me.username} (you)`} />
      )}
      {/* Other users */}
      {others.map((u) => (
        <Avatar key={u.clientId} user={u} label={u.username} />
      ))}
      <span style={styles.count}>
        {presence.length} {presence.length === 1 ? 'user' : 'users'} online
      </span>
    </div>
  );
}

function Avatar({ user, label }: { user: { username: string; color: string; editingTask?: string }; label: string }) {
  const initials = user.username.slice(0, 2).toUpperCase();
  return (
    <div
      title={`${label}${user.editingTask ? ' (editing)' : ''}`}
      style={{
        ...styles.avatar,
        background: user.color,
        outline: user.editingTask ? `2px solid ${user.color}` : 'none',
        outlineOffset: 2,
      }}
    >
      {initials}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  bar: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  avatar: {
    width: 30,
    height: 30,
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#fff',
    fontWeight: 700,
    fontSize: '11px',
    cursor: 'default',
    userSelect: 'none',
  },
  count: {
    fontSize: '12px',
    color: '#6b7280',
    marginLeft: '4px',
  },
};
