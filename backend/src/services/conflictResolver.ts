/**
 * Conflict Resolution — Field-Level Merge with Last-Write-Wins fallback.
 *
 * Strategy:
 * 1. A client sends `baseVersion` (the task version it last observed).
 * 2. The server compares baseVersion against each field's `_version`.
 *    - If field_version <= baseVersion → no conflict on this field → apply change.
 *    - If field_version  > baseVersion → another write already changed this field
 *      since the client's last sync → conflict on this field → server state wins (LWW).
 * 3. If ALL requested fields conflict → operation is fully rejected; client is notified.
 * 4. If SOME fields conflict and some don't → partial merge: apply non-conflicting
 *    changes; notify client which fields were merged vs rejected.
 *
 * Special case — move + edit:
 *   Move touches {columnId, position}; edit touches {title, description}.
 *   These are disjoint field sets → always mergeable.
 *
 * Special case — move + move:
 *   Both touch {columnId, position}. The first write wins (it increments
 *   column_version / position_version above the second writer's baseVersion).
 *   The losing client receives a CONFLICT_RESOLVED message with resolution='REJECTED'
 *   and the authoritative task state so it can update its UI.
 */

import { Task, TaskMutation } from '../types';

export interface ConflictAnalysis {
  mergedChanges: Partial<TaskMutation>;
  mergedFields: string[];
  rejectedFields: string[];
  hasConflict: boolean;
  fullyRejected: boolean;
}

type FieldVersionKey = 'titleVersion' | 'descriptionVersion' | 'columnVersion' | 'positionVersion';

const FIELD_VERSION_MAP: Record<keyof TaskMutation, FieldVersionKey> = {
  title: 'titleVersion',
  description: 'descriptionVersion',
  columnId: 'columnVersion',
  position: 'positionVersion',
};

/**
 * Analyse an incoming mutation against the current server task state.
 *
 * @param current  - The authoritative task row from the database.
 * @param baseVersion - The task version the client last observed.
 * @param changes  - Fields the client wants to change.
 */
export function analyseConflict(
  current: Task,
  baseVersion: number,
  changes: Partial<TaskMutation>
): ConflictAnalysis {
  const mergedChanges: Partial<TaskMutation> = {};
  const mergedFields: string[] = [];
  const rejectedFields: string[] = [];

  for (const [field, value] of Object.entries(changes) as [keyof TaskMutation, unknown][]) {
    const versionKey = FIELD_VERSION_MAP[field];
    const fieldVersion = current[versionKey] as number;

    if (fieldVersion <= baseVersion) {
      // This field was not modified after the client's last sync — safe to apply
      (mergedChanges as Record<string, unknown>)[field] = value;
      mergedFields.push(field);
    } else {
      // This field was modified after the client's last sync — conflict
      rejectedFields.push(field);
    }
  }

  return {
    mergedChanges,
    mergedFields,
    rejectedFields,
    hasConflict: rejectedFields.length > 0,
    fullyRejected: mergedFields.length === 0 && rejectedFields.length > 0,
  };
}

/**
 * Build a human-readable conflict resolution message.
 */
export function buildResolutionReason(analysis: ConflictAnalysis): string {
  if (analysis.fullyRejected) {
    return (
      `All changed fields (${analysis.rejectedFields.join(', ')}) were already ` +
      `modified by another client. Server state preserved (last-write-wins).`
    );
  }
  if (analysis.hasConflict) {
    return (
      `Partial merge: applied [${analysis.mergedFields.join(', ')}]. ` +
      `Fields [${analysis.rejectedFields.join(', ')}] conflicted — server state preserved.`
    );
  }
  return 'No conflict — changes applied cleanly.';
}
