/**
 * Presence Manager — tracks connected users and their current activity.
 */

import { PresenceUser } from '../types';

const COLORS = [
  '#F87171', '#FB923C', '#FBBF24', '#A3E635',
  '#34D399', '#22D3EE', '#818CF8', '#E879F9',
];

let colorIndex = 0;

function nextColor(): string {
  const color = COLORS[colorIndex % COLORS.length];
  colorIndex++;
  return color;
}

const presenceMap = new Map<string, PresenceUser>();

export function addUser(clientId: string, username: string): PresenceUser {
  const user: PresenceUser = {
    clientId,
    username,
    color: nextColor(),
    connectedAt: new Date().toISOString(),
  };
  presenceMap.set(clientId, user);
  return user;
}

export function removeUser(clientId: string): void {
  presenceMap.delete(clientId);
}

export function updateUser(
  clientId: string,
  update: Partial<Pick<PresenceUser, 'viewingTask' | 'editingTask' | 'username'>>
): PresenceUser | null {
  const user = presenceMap.get(clientId);
  if (!user) return null;
  const updated = { ...user, ...update };
  presenceMap.set(clientId, updated);
  return updated;
}

export function getAllUsers(): PresenceUser[] {
  return Array.from(presenceMap.values());
}

export function hasUser(clientId: string): boolean {
  return presenceMap.has(clientId);
}
