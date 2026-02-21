/**
 * Unit tests for the conflict resolution logic.
 */

import { analyseConflict, buildResolutionReason } from '../../src/services/conflictResolver';
import { Task } from '../../src/types';

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    title: 'Original Title',
    description: 'Original description',
    columnId: 'todo',
    position: 65536,
    version: 5,
    titleVersion: 3,
    descriptionVersion: 2,
    columnVersion: 4,
    positionVersion: 4,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('analyseConflict — no conflict', () => {
  test('clean edit: title/desc changes when no one else touched them', () => {
    const current = makeTask({ version: 5, titleVersion: 3, descriptionVersion: 2 });
    const analysis = analyseConflict(current, 5, { title: 'New Title', description: 'New Desc' });

    expect(analysis.hasConflict).toBe(false);
    expect(analysis.fullyRejected).toBe(false);
    expect(analysis.mergedFields).toEqual(expect.arrayContaining(['title', 'description']));
    expect(analysis.rejectedFields).toHaveLength(0);
    expect(analysis.mergedChanges.title).toBe('New Title');
  });

  test('clean move: column/position changes when no one else moved it', () => {
    const current = makeTask({ version: 5, columnVersion: 3, positionVersion: 3 });
    // Client saw version 4, server is at 5 but column/pos unchanged since 3
    const analysis = analyseConflict(current, 4, { columnId: 'done', position: 200000 });

    expect(analysis.hasConflict).toBe(false);
    expect(analysis.mergedChanges.columnId).toBe('done');
    expect(analysis.mergedChanges.position).toBe(200000);
  });
});

describe('analyseConflict — concurrent move + edit (must merge)', () => {
  test('User A moves (column+position), User B edits title — different fields → merge', () => {
    // Server state: version 6, column was moved at version 6, title still at version 3
    const current = makeTask({
      version: 6,
      columnId: 'inprogress',
      columnVersion: 6,
      positionVersion: 6,
      titleVersion: 3,
      descriptionVersion: 2,
    });

    // User B's edit is based on version 5 (before the move)
    const analysis = analyseConflict(current, 5, { title: "User B's Title" });

    // title_version (3) <= baseVersion (5) → no conflict on title → apply
    expect(analysis.hasConflict).toBe(false);
    expect(analysis.mergedChanges.title).toBe("User B's Title");
    expect(analysis.mergedFields).toContain('title');
    expect(analysis.rejectedFields).toHaveLength(0);
  });
});

describe('analyseConflict — concurrent move + move (LWW)', () => {
  test('Both users move the task — second writer is rejected', () => {
    // Server state: User A already moved the task to 'done' (version 6)
    const current = makeTask({
      version: 6,
      columnId: 'done',
      columnVersion: 6,
      positionVersion: 6,
    });

    // User B's move is based on version 5 (before User A's move)
    const analysis = analyseConflict(current, 5, { columnId: 'inprogress', position: 100000 });

    // column_version (6) > baseVersion (5) → conflict on column → rejected
    // position_version (6) > baseVersion (5) → conflict on position → rejected
    expect(analysis.hasConflict).toBe(true);
    expect(analysis.fullyRejected).toBe(true);
    expect(analysis.rejectedFields).toContain('columnId');
    expect(analysis.rejectedFields).toContain('position');
    expect(analysis.mergedFields).toHaveLength(0);
  });
});

describe('analyseConflict — concurrent edit + edit (same field, LWW)', () => {
  test('Both users edit title — second writer loses on title, wins on description', () => {
    // Server state: User A already updated title at version 6
    const current = makeTask({
      version: 6,
      titleVersion: 6,      // title was changed at v6
      descriptionVersion: 3, // description last changed at v3
    });

    // User B sends: update both title and description, based on version 5
    const analysis = analyseConflict(current, 5, {
      title: "User B's title",
      description: "User B's description",
    });

    // title_version (6) > baseVersion (5) → rejected
    // description_version (3) <= baseVersion (5) → merged
    expect(analysis.hasConflict).toBe(true);
    expect(analysis.fullyRejected).toBe(false); // partial merge
    expect(analysis.mergedFields).toContain('description');
    expect(analysis.rejectedFields).toContain('title');
    expect(analysis.mergedChanges.description).toBe("User B's description");
    expect(analysis.mergedChanges.title).toBeUndefined();
  });
});

describe('analyseConflict — fully rejected', () => {
  test('all fields have conflicts → fullyRejected', () => {
    const current = makeTask({
      version: 10,
      titleVersion: 8,
      descriptionVersion: 9,
    });

    const analysis = analyseConflict(current, 5, {
      title: 'new',
      description: 'new desc',
    });

    expect(analysis.fullyRejected).toBe(true);
    expect(analysis.mergedFields).toHaveLength(0);
    expect(analysis.rejectedFields).toHaveLength(2);
  });
});

describe('buildResolutionReason', () => {
  test('clean merge produces appropriate message', () => {
    const current = makeTask({ titleVersion: 2 });
    const analysis = analyseConflict(current, 5, { title: 'new' });
    const reason = buildResolutionReason(analysis);
    expect(reason).toContain('No conflict');
  });

  test('full rejection produces LWW message', () => {
    const current = makeTask({ titleVersion: 9, version: 10 });
    const analysis = analyseConflict(current, 5, { title: 'new' });
    const reason = buildResolutionReason(analysis);
    expect(reason).toContain('last-write-wins');
  });

  test('partial merge produces merge message', () => {
    const current = makeTask({ titleVersion: 9, descriptionVersion: 2, version: 10 });
    const analysis = analyseConflict(current, 5, { title: 'new', description: 'new' });
    const reason = buildResolutionReason(analysis);
    expect(reason).toContain('Partial merge');
  });
});
