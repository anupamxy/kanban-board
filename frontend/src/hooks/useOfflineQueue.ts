/**
 * useOfflineQueue — enqueues operations when offline, provides a send wrapper
 * that automatically queues or sends depending on connection state.
 */

import { useCallback } from 'react';
import { useBoardStore } from '../store/boardStore';
import { QueuedOperation } from '../types';

type SendFn = (type: string, payload: Record<string, unknown>) => boolean;

export function useOfflineQueue(send: SendFn) {
  const { connectionStatus, enqueueOperation } = useBoardStore();

  const sendOrQueue = useCallback(
    (
      type: QueuedOperation['type'],
      payload: Record<string, unknown>
    ): boolean => {
      if (connectionStatus === 'connected') {
        return send(type, payload);
      }
      // Offline — queue for later replay
      enqueueOperation({
        type,
        payload,
        enqueuedAt: new Date().toISOString(),
      });
      console.log(`[offline] Queued ${type} for later replay`);
      return false;
    },
    [connectionStatus, send, enqueueOperation]
  );

  return { sendOrQueue, isOnline: connectionStatus === 'connected' };
}
