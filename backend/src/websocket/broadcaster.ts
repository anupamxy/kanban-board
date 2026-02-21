/**
 * Broadcaster — sends ServerMessages to connected WebSocket clients.
 * Decoupled from business logic so handlers can broadcast without knowing
 * about the raw WebSocket infrastructure.
 */

import WebSocket from 'ws';
import { ServerMessage } from '../types';

/** Registry of all open connections, keyed by clientId */
const connections = new Map<string, WebSocket>();

export function registerConnection(clientId: string, ws: WebSocket): void {
  connections.set(clientId, ws);
}

export function unregisterConnection(clientId: string): void {
  connections.delete(clientId);
}

export function getConnection(clientId: string): WebSocket | undefined {
  return connections.get(clientId);
}

export function getAllConnections(): Map<string, WebSocket> {
  return connections;
}

/** Send a message to a single client */
export function sendTo(clientId: string, message: ServerMessage): void {
  const ws = connections.get(clientId);
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

/** Broadcast to all clients, optionally skipping one (e.g. the sender) */
export function broadcast(message: ServerMessage, skipClientId?: string): void {
  const payload = JSON.stringify(message);
  for (const [clientId, ws] of connections) {
    if (clientId === skipClientId) continue;
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(payload);
    }
  }
}

/** Broadcast to all clients including the sender */
export function broadcastAll(message: ServerMessage): void {
  broadcast(message, undefined);
}

export function connectionCount(): number {
  return connections.size;
}
