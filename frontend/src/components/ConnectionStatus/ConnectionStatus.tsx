import React from 'react';
import { useBoardStore } from '../../store/boardStore';

const CONFIG = {
  connected:    { label: 'Live',         color: '#22c55e', dot: '#16a34a' },
  connecting:   { label: 'Connecting…',  color: '#f59e0b', dot: '#d97706' },
  reconnecting: { label: 'Reconnecting…',color: '#f59e0b', dot: '#d97706' },
  disconnected: { label: 'Offline',      color: '#ef4444', dot: '#dc2626' },
};

export function ConnectionStatus() {
  const { connectionStatus, offlineQueue } = useBoardStore();
  const cfg = CONFIG[connectionStatus];

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px' }}>
      <span
        style={{
          display: 'inline-block',
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: cfg.dot,
          boxShadow: connectionStatus === 'connected' ? `0 0 0 3px ${cfg.color}33` : 'none',
          animation: connectionStatus === 'connected' ? 'pulse 2s infinite' : 'none',
        }}
      />
      <span style={{ color: cfg.color, fontWeight: 500 }}>{cfg.label}</span>
      {offlineQueue.length > 0 && (
        <span
          style={{
            background: '#f59e0b',
            color: '#fff',
            borderRadius: '999px',
            padding: '1px 7px',
            fontSize: '11px',
            fontWeight: 600,
          }}
        >
          {offlineQueue.length} queued
        </span>
      )}
    </div>
  );
}
