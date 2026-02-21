/**
 * Message Router — dispatches incoming WebSocket messages to the correct handler.
 * Business logic lives in services; handlers only orchestrate and broadcast.
 */

import WebSocket from 'ws';
import { ClientMessage, Column } from '../types';
import * as taskService from '../services/taskService';
import * as presenceManager from './presenceManager';
import * as broadcaster from './broadcaster';
import { getAllTasks } from '../services/taskService';
import { rebalanceColumn } from '../services/orderingService';

export async function handleMessage(
  ws: WebSocket,
  clientId: string,
  raw: string
): Promise<void> {
  let message: ClientMessage;
  try {
    message = JSON.parse(raw) as ClientMessage;
  } catch {
    broadcaster.sendTo(clientId, {
      type: 'ERROR',
      payload: { code: 'INVALID_JSON', message: 'Message must be valid JSON' },
    });
    return;
  }

  try {
    switch (message.type) {
      case 'SYNC_REQUEST':
        await handleSyncRequest(clientId);
        break;

      case 'CREATE_TASK':
        await handleCreateTask(clientId, message.payload);
        break;

      case 'UPDATE_TASK':
        await handleUpdateTask(clientId, message.payload);
        break;

      case 'MOVE_TASK':
        await handleMoveTask(clientId, message.payload);
        break;

      case 'DELETE_TASK':
        await handleDeleteTask(clientId, message.payload);
        break;

      case 'PRESENCE_UPDATE':
        await handlePresenceUpdate(clientId, message.payload);
        break;

      case 'REPLAY_QUEUE':
        await handleReplayQueue(clientId, message.payload);
        break;

      default:
        broadcaster.sendTo(clientId, {
          type: 'ERROR',
          payload: {
            code: 'UNKNOWN_MESSAGE_TYPE',
            message: `Unknown message type: ${(message as { type: string }).type}`,
          },
        });
    }
  } catch (err) {
    console.error(`[messageRouter] Error handling ${message.type}:`, err);
    broadcaster.sendTo(clientId, {
      type: 'ERROR',
      payload: {
        code: 'INTERNAL_ERROR',
        message: err instanceof Error ? err.message : 'Internal server error',
      },
    });
  }
}

async function handleSyncRequest(clientId: string): Promise<void> {
  const tasks = await getAllTasks();
  broadcaster.sendTo(clientId, {
    type: 'INITIAL_STATE',
    payload: {
      tasks,
      presence: presenceManager.getAllUsers(),
    },
  });
}

async function handleCreateTask(
  clientId: string,
  payload: Parameters<typeof taskService.createTask>[0]
): Promise<void> {
  const task = await taskService.createTask(payload);
  broadcaster.broadcastAll({
    type: 'TASK_CREATED',
    payload: { task, tempId: payload.tempId },
  });
}

async function handleUpdateTask(
  clientId: string,
  payload: Parameters<typeof taskService.updateTask>[0]
): Promise<void> {
  const { task, conflict } = await taskService.updateTask(payload);

  if (conflict?.resolution === 'REJECTED') {
    // Fully rejected — notify only the sender, broadcast authoritative state to all
    broadcaster.sendTo(clientId, { type: 'CONFLICT_RESOLVED', payload: conflict });
    broadcaster.broadcast({ type: 'TASK_UPDATED', payload: task });
    return;
  }

  if (conflict?.resolution === 'MERGED') {
    // Partial merge — notify sender of what was rejected, broadcast the merged state
    broadcaster.sendTo(clientId, { type: 'CONFLICT_RESOLVED', payload: conflict });
  }

  broadcaster.broadcastAll({ type: 'TASK_UPDATED', payload: task });
}

async function handleMoveTask(
  clientId: string,
  payload: Parameters<typeof taskService.moveTask>[0]
): Promise<void> {
  const { task, conflict, needsRebalance } = await taskService.moveTask(payload);

  if (conflict?.resolution === 'REJECTED') {
    broadcaster.sendTo(clientId, { type: 'CONFLICT_RESOLVED', payload: conflict });
    broadcaster.broadcast({ type: 'TASK_MOVED', payload: task });
    return;
  }

  if (conflict?.resolution === 'MERGED') {
    broadcaster.sendTo(clientId, { type: 'CONFLICT_RESOLVED', payload: conflict });
  }

  broadcaster.broadcastAll({ type: 'TASK_MOVED', payload: task });

  // If fractional gap is too small, rebalance and notify all clients
  if (needsRebalance) {
    const updatedTasks = await rebalanceColumn(task.columnId as Column);
    broadcaster.broadcastAll({
      type: 'REBALANCED',
      payload: { columnId: task.columnId as Column, tasks: updatedTasks },
    });
  }
}

async function handleDeleteTask(
  clientId: string,
  payload: Parameters<typeof taskService.deleteTask>[0]
): Promise<void> {
  const { deleted, task } = await taskService.deleteTask(payload);
  if (!deleted) {
    broadcaster.sendTo(clientId, {
      type: 'ERROR',
      payload: { code: 'NOT_FOUND', message: `Task ${payload.taskId} not found`, taskId: payload.taskId },
    });
    return;
  }
  broadcaster.broadcastAll({ type: 'TASK_DELETED', payload: { taskId: payload.taskId } });
}

async function handlePresenceUpdate(
  clientId: string,
  payload: { clientId: string; username: string; viewingTask?: string; editingTask?: string }
): Promise<void> {
  presenceManager.updateUser(clientId, {
    viewingTask: payload.viewingTask,
    editingTask: payload.editingTask,
    username: payload.username,
  });
  broadcaster.broadcastAll({
    type: 'PRESENCE_UPDATE',
    payload: presenceManager.getAllUsers(),
  });
}

async function handleReplayQueue(
  clientId: string,
  payload: { clientId: string; operations: Array<{ type: string; payload: unknown; enqueuedAt: string }> }
): Promise<void> {
  console.log(`[messageRouter] Replaying ${payload.operations.length} queued ops for ${clientId}`);

  for (const op of payload.operations) {
    // Re-route each operation through the normal handlers
    // baseVersion conflicts will be resolved naturally
    const msg = JSON.stringify({ type: op.type, payload: op.payload });
    await handleMessage(
      broadcaster.getConnection(clientId) as WebSocket,
      clientId,
      msg
    );
  }
}
