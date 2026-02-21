/**
 * Integration tests for conflict scenarios.
 *
 * These tests run against a real PostgreSQL database.
 * Set DATABASE_URL in the environment before running.
 *
 * Run: DATABASE_URL=postgres://... npm run test:integration
 */

import { pool } from '../../src/db';
import { createTask, updateTask, moveTask, deleteTask } from '../../src/services/taskService';
import { rebalanceColumn } from '../../src/services/orderingService';

// Skip if no DB available (CI without DB)
const SKIP = !process.env.DATABASE_URL;

async function resetDb() {
  await pool.query(`DELETE FROM tasks`);
}

beforeAll(async () => {
  if (SKIP) return;
  // Run migrations inline
  const fs = await import('fs');
  const path = await import('path');
  const migrationDir = path.join(__dirname, '../../src/db/migrations');
  const files = fs.readdirSync(migrationDir).sort();
  for (const file of files) {
    if (!file.endsWith('.sql')) continue;
    const sql = fs.readFileSync(path.join(migrationDir, file), 'utf8');
    await pool.query(sql);
  }
});

afterAll(async () => {
  if (SKIP) return;
  await pool.end();
});

beforeEach(async () => {
  if (SKIP) return;
  await resetDb();
});

const skipIf = (condition: boolean) => condition ? test.skip : test;

// ── Scenario 1: Concurrent move + edit ─────────────────────────────────────
describe('Scenario 1: Concurrent move + edit', () => {
  skipIf(SKIP)('User A moves task, User B edits title — both changes preserved', async () => {
    // Create initial task
    const task = await createTask({
      clientId: 'client-setup',
      tempId: 'temp-1',
      title: 'Original Title',
      description: 'Original Desc',
      columnId: 'todo',
      position: 65536,
    });

    expect(task.version).toBe(1);
    const baseVersion = task.version;

    // User A moves the task to 'inprogress' (arrives first)
    const { task: afterMove } = await moveTask({
      clientId: 'client-A',
      taskId: task.id,
      baseVersion,
      columnId: 'inprogress',
      position: 65536,
    });

    expect(afterMove.columnId).toBe('inprogress');
    expect(afterMove.version).toBe(2);

    // User B edits the title — based on the original version (before the move)
    // In real life this happens concurrently, but since the move arrived first,
    // User B is operating on baseVersion=1 while server is at version=2.
    const { task: afterEdit, conflict } = await updateTask({
      clientId: 'client-B',
      taskId: task.id,
      baseVersion, // still 1
      changes: { title: "User B's Title" },
    });

    // title_version should still be 1 (only the move changed column/position)
    // So User B's title edit should be accepted (no conflict on title)
    expect(conflict).toBeNull(); // clean merge — different fields
    expect(afterEdit.title).toBe("User B's Title");
    expect(afterEdit.columnId).toBe('inprogress'); // move preserved
    expect(afterEdit.version).toBe(3);
  });
});

// ── Scenario 2: Concurrent move + move ─────────────────────────────────────
describe('Scenario 2: Concurrent move + move', () => {
  skipIf(SKIP)('User A moves to inprogress first — User B move to done is rejected', async () => {
    const task = await createTask({
      clientId: 'client-setup',
      tempId: 'temp-2',
      title: 'Task',
      description: '',
      columnId: 'todo',
      position: 65536,
    });

    const baseVersion = task.version;

    // User A moves to 'inprogress' (arrives first at server)
    const { task: afterMoveA } = await moveTask({
      clientId: 'client-A',
      taskId: task.id,
      baseVersion,
      columnId: 'inprogress',
      position: 65536,
    });

    expect(afterMoveA.columnId).toBe('inprogress');

    // User B moves to 'done' — based on original version (concurrent with A)
    const { task: finalTask, conflict } = await moveTask({
      clientId: 'client-B',
      taskId: task.id,
      baseVersion, // still v1
      columnId: 'done',
      position: 65536,
    });

    // column_version was incremented by User A's move → conflict → rejected
    expect(conflict).not.toBeNull();
    expect(conflict!.resolution).toBe('REJECTED');
    expect(conflict!.rejectedFields).toContain('columnId');
    // Final state should be User A's move (inprogress), not User B's (done)
    expect(finalTask.columnId).toBe('inprogress');
  });
});

// ── Scenario 3: Concurrent reorder + add ───────────────────────────────────
describe('Scenario 3: Concurrent reorder + new task', () => {
  skipIf(SKIP)(
    'User A reorders, User B adds — both operations succeed independently',
    async () => {
      // Create two tasks in 'todo'
      const taskA = await createTask({
        clientId: 'setup',
        tempId: 'ta',
        title: 'Task A',
        description: '',
        columnId: 'todo',
        position: 65536,
      });
      const taskB = await createTask({
        clientId: 'setup',
        tempId: 'tb',
        title: 'Task B',
        description: '',
        columnId: 'todo',
        position: 131072,
      });

      // User A reorders: moves taskB to position 32768 (before taskA)
      const { task: reorderedB } = await moveTask({
        clientId: 'client-A',
        taskId: taskB.id,
        baseVersion: taskB.version,
        columnId: 'todo',
        position: 32768,
      });

      // User B adds a new task at position 196608 (end of column)
      const newTask = await createTask({
        clientId: 'client-B',
        tempId: 'tc',
        title: 'New Task by B',
        description: '',
        columnId: 'todo',
        position: 196608,
      });

      expect(reorderedB.position).toBe(32768);
      expect(newTask.position).toBe(196608);

      // Verify final ordering is consistent: taskB < taskA < newTask
      const { rows } = await pool.query(
        `SELECT title, position FROM tasks WHERE column_id = 'todo' ORDER BY position`
      );
      expect(rows[0].title).toBe('Task B');
      expect(rows[1].title).toBe('Task A');
      expect(rows[2].title).toBe('New Task by B');
    }
  );
});

// ── Scenario 4: Rebalancing ─────────────────────────────────────────────────
describe('Scenario 4: Column rebalancing', () => {
  skipIf(SKIP)('Rebalance assigns evenly-spaced positions', async () => {
    // Create tasks with tight positions
    await pool.query(
      `INSERT INTO tasks (title, column_id, position) VALUES ('T1','todo',1.0),('T2','todo',1.3),('T3','todo',1.6)`
    );

    const rebalanced = await rebalanceColumn('todo');
    expect(rebalanced).toHaveLength(3);

    // Positions should now be evenly spaced (65536 apart)
    expect(rebalanced[0].position).toBe(65536);
    expect(rebalanced[1].position).toBe(131072);
    expect(rebalanced[2].position).toBe(196608);
  });
});

// ── Scenario 5: Delete idempotency ─────────────────────────────────────────
describe('Scenario 5: Delete always wins', () => {
  skipIf(SKIP)('Deleting a task succeeds regardless of concurrent edits', async () => {
    const task = await createTask({
      clientId: 'setup',
      tempId: 'td',
      title: 'Task to delete',
      description: '',
      columnId: 'todo',
      position: 65536,
    });

    // Concurrent edit (doesn't block delete)
    await updateTask({
      clientId: 'client-A',
      taskId: task.id,
      baseVersion: task.version,
      changes: { title: 'Edited before delete' },
    });

    // Delete
    const { deleted } = await deleteTask({
      clientId: 'client-B',
      taskId: task.id,
      baseVersion: task.version,
    });

    expect(deleted).toBe(true);

    // Task should be gone
    const { rows } = await pool.query(`SELECT id FROM tasks WHERE id = $1`, [task.id]);
    expect(rows).toHaveLength(0);
  });
});

// ── Scenario 6: Partial merge (same-field + different-field conflict) ────────
describe('Scenario 6: Partial merge', () => {
  skipIf(SKIP)(
    'User A edits title, User B edits both title+description — title rejected, description applied',
    async () => {
      const task = await createTask({
        clientId: 'setup',
        tempId: 'te',
        title: 'Task',
        description: 'Original',
        columnId: 'todo',
        position: 65536,
      });

      const baseVersion = task.version;

      // User A edits only the title (arrives first)
      const { task: afterA } = await updateTask({
        clientId: 'client-A',
        taskId: task.id,
        baseVersion,
        changes: { title: "User A's Title" },
      });

      expect(afterA.title).toBe("User A's Title");
      expect(afterA.titleVersion).toBe(afterA.version);

      // User B edits both title and description (based on original version)
      const { task: afterB, conflict } = await updateTask({
        clientId: 'client-B',
        taskId: task.id,
        baseVersion, // v1
        changes: { title: "User B's Title", description: "User B's Desc" },
      });

      // title conflicted (User A already changed it) → rejected
      // description not conflicted → applied
      expect(conflict).not.toBeNull();
      expect(conflict!.resolution).toBe('MERGED');
      expect(conflict!.mergedFields).toContain('description');
      expect(conflict!.rejectedFields).toContain('title');
      expect(afterB.title).toBe("User A's Title"); // A's title preserved
      expect(afterB.description).toBe("User B's Desc"); // B's description applied
    }
  );
});
