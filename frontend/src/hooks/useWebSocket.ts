/**
 * useWebSocket — manages the WebSocket connection lifecycle.
 *
 * Features:
 * - Auto-connect on mount
 * - Exponential-backoff reconnect on disconnect
 * - Replay offline queue on reconnect
 * - Dispatch incoming messages to the Zustand store
 */

import { useEffect, useRef, useCallback } from 'react';
import { useBoardStore } from '../store/boardStore';
import { ServerMessage, QueuedOperation } from '../types';

const WS_URL = import.meta.env.VITE_WS_URL || `ws://${window.location.hostname}:4000`;

const MAX_RECONNECT_DELAY = 30_000;
const INITIAL_RECONNECT_DELAY = 1_000;

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectDelayRef = useRef(INITIAL_RECONNECT_DELAY);
  const mountedRef = useRef(true);

  const store = useBoardStore();
  const {
    clientId,
    username,
    setConnectionStatus,
    setInitialState,
    confirmTaskCreated,
    confirmTaskUpdated,
    confirmTaskMoved,
    applyServerTask,
    applyTaskDeleted,
    applyRebalanced,
    applyPresenceUpdate,
    applyConflict,
    offlineQueue,
    clearQueue,
  } = store;

  const sendRaw = useCallback((message: object) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
      return true;
    }
    return false;
  }, []);

  // Exposed send — queues when offline
  const send = useCallback(
    (type: string, payload: Record<string, unknown>): boolean => {
      return sendRaw({ type, payload: { ...payload, clientId } });
    },
    [sendRaw, clientId]
  );

  const connect = useCallback(() => {
    if (!mountedRef.current) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    setConnectionStatus('connecting');

    const url = `${WS_URL}?clientId=${encodeURIComponent(clientId)}&username=${encodeURIComponent(username)}`;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      if (!mountedRef.current) return;
      console.log('[WS] Connected');
      setConnectionStatus('connected');
      reconnectDelayRef.current = INITIAL_RECONNECT_DELAY;

      // Replay any offline queue
      const queue = useBoardStore.getState().offlineQueue;
      if (queue.length > 0) {
        console.log(`[WS] Replaying ${queue.length} queued operations`);
        ws.send(
          JSON.stringify({
            type: 'REPLAY_QUEUE',
            payload: { clientId, operations: queue },
          })
        );
        clearQueue();
      }
    };

    ws.onmessage = (event: MessageEvent) => {
      if (!mountedRef.current) return;
      let msg: ServerMessage;
      try {
        msg = JSON.parse(event.data as string) as ServerMessage;
      } catch {
        console.error('[WS] Invalid JSON from server');
        return;
      }
      handleServerMessage(msg);
    };

    ws.onclose = () => {
      if (!mountedRef.current) return;
      console.log('[WS] Disconnected — scheduling reconnect');
      setConnectionStatus('reconnecting');
      scheduleReconnect();
    };

    ws.onerror = (err) => {
      console.error('[WS] Error:', err);
      ws.close();
    };
  }, [clientId, username, setConnectionStatus, clearQueue]);

  function scheduleReconnect() {
    if (!mountedRef.current) return;
    const delay = reconnectDelayRef.current;
    reconnectDelayRef.current = Math.min(delay * 2, MAX_RECONNECT_DELAY);
    reconnectTimerRef.current = setTimeout(() => {
      if (mountedRef.current) connect();
    }, delay);
  }

  function handleServerMessage(msg: ServerMessage) {
    switch (msg.type) {
      case 'INITIAL_STATE':
        setInitialState(msg.payload.tasks, msg.payload.presence);
        break;

      case 'TASK_CREATED':
        confirmTaskCreated(msg.payload.task, msg.payload.tempId);
        break;

      case 'TASK_UPDATED':
        confirmTaskUpdated(msg.payload);
        break;

      case 'TASK_MOVED':
        confirmTaskMoved(msg.payload);
        break;

      case 'TASK_DELETED':
        applyTaskDeleted(msg.payload.taskId);
        break;

      case 'CONFLICT_RESOLVED':
        applyConflict(msg.payload);
        break;

      case 'REBALANCED':
        applyRebalanced(msg.payload.columnId, msg.payload.tasks);
        break;

      case 'PRESENCE_UPDATE':
        applyPresenceUpdate(msg.payload);
        break;

      case 'ERROR':
        console.error('[WS] Server error:', msg.payload);
        break;
    }
  }

  useEffect(() => {
    mountedRef.current = true;
    connect();
    return () => {
      mountedRef.current = false;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      wsRef.current?.close();
    };
  }, [connect]);

  return { send, connectionStatus: store.connectionStatus };
}
