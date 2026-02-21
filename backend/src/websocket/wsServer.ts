/**
 * WebSocket Server — sets up the ws server attached to the HTTP server.
 * Responsibilities:
 *   - Parse the clientId / username from the URL query string.
 *   - Register presence on connect, remove on disconnect.
 *   - Delegate all message handling to messageRouter.
 */

import http from 'http';
import WebSocket, { WebSocketServer } from 'ws';
import { URL } from 'url';
import * as broadcaster from './broadcaster';
import * as presenceManager from './presenceManager';
import { handleMessage } from './messageRouter';
import { getAllTasks } from '../services/taskService';

export function attachWebSocketServer(server: http.Server): WebSocketServer {
  const wss = new WebSocketServer({ server });

  wss.on('connection', async (ws: WebSocket, req: http.IncomingMessage) => {
    // Parse clientId + username from query string: ws://host:4000?clientId=xxx&username=yyy
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    const clientId = url.searchParams.get('clientId') ?? `anon-${Date.now()}`;
    const username = url.searchParams.get('username') ?? `User-${clientId.slice(-4)}`;

    console.log(`[WS] Connected: ${clientId} (${username})`);

    broadcaster.registerConnection(clientId, ws);
    presenceManager.addUser(clientId, username);

    // Send initial board state to the newly connected client
    try {
      const tasks = await getAllTasks();
      broadcaster.sendTo(clientId, {
        type: 'INITIAL_STATE',
        payload: {
          tasks,
          presence: presenceManager.getAllUsers(),
        },
      });
    } catch (err) {
      console.error('[WS] Failed to send initial state:', err);
    }

    // Notify other clients of the new presence
    broadcaster.broadcast(
      { type: 'PRESENCE_UPDATE', payload: presenceManager.getAllUsers() },
      clientId
    );

    ws.on('message', (data: WebSocket.RawData) => {
      handleMessage(ws, clientId, data.toString()).catch((err) => {
        console.error(`[WS] Unhandled error for ${clientId}:`, err);
      });
    });

    ws.on('close', () => {
      console.log(`[WS] Disconnected: ${clientId}`);
      broadcaster.unregisterConnection(clientId);
      presenceManager.removeUser(clientId);
      // Notify remaining clients
      broadcaster.broadcastAll({
        type: 'PRESENCE_UPDATE',
        payload: presenceManager.getAllUsers(),
      });
    });

    ws.on('error', (err) => {
      console.error(`[WS] Error for ${clientId}:`, err);
    });
  });

  return wss;
}
