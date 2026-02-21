# Design Document — Real-Time Kanban Board

## 1. Conflict Resolution Strategy

### Core Insight: Field-Level Version Tracking

Every task row in PostgreSQL carries **per-field version numbers** alongside a global version:

```sql
title            TEXT,   title_version    INTEGER,
description      TEXT,   description_version INTEGER,
column_id        TEXT,   column_version   INTEGER,
position         FLOAT8, position_version INTEGER,
version          INTEGER  -- global, incremented on every write
```

When a write is committed at global version `V`, it updates `field_version` to `V` only for the fields it touched. This creates a causal record of *which write changed which field*.

### Resolution Algorithm

Every client mutation carries a `baseVersion` — the global task version the client last observed. On arrival at the server:

```
for each field F in incoming_changes:
  if current.F_version <= baseVersion:
    → no conflict on F → apply the change
  else:
    → F was modified after client's last sync → conflict on F → server state wins (LWW)
```

This gives us **field-level merge with last-write-wins fallback** — much finer than row-level LWW without the full complexity of CRDTs.

### The Three Required Scenarios

#### Scenario 1: Concurrent Move + Edit

- **Move** touches `{column_id, position}` → increments `column_version`, `position_version`.
- **Edit** touches `{title, description}` → increments `title_version`, `description_version`.
- These are **disjoint field sets** → no conflict detected → **both changes are applied**.

Example timeline:
```
v1: initial state
v2: User A moves task (column_version=2, position_version=2)
   User B's edit arrives with baseVersion=1:
     title_version (=1) <= baseVersion (1) → APPLY User B's title
   → Result v3: task in new column WITH User B's title
```

#### Scenario 2: Concurrent Move + Move

- Both moves touch `{column_id, position}`.
- The **first move** committed increments `column_version` above the second writer's `baseVersion`.
- The second move is **fully rejected** (LWW — server state wins).
- The losing client receives a `CONFLICT_RESOLVED { resolution: 'REJECTED' }` message containing the authoritative task state so it can update its UI immediately.

Why LWW here? The alternatives — e.g., letting the "last" move always win — require more complex state like vector clocks. For a task board, "first write wins" is semantically correct: whoever actually committed their move first *intended* it more recently in wall-clock time relative to the server.

#### Scenario 3: Concurrent Reorder + Add

Because we use **fractional indexing** (see §2), each task's `position` is an independent float. Reordering task A only changes A's position; it does not renumber other tasks. A concurrent add just picks a valid position in the same column. The two operations **never touch the same task row** → no conflict by definition.

If positions get too close (gap < 0.5), the server atomically rebalances the entire column in a single transaction and broadcasts a `REBALANCED` event with updated positions for all clients to apply.

### Client Conflict Handling

- **Optimistic UI**: the client applies all mutations locally before the server confirms.
- On `CONFLICT_RESOLVED` (REJECTED or MERGED): the client reconciles to the authoritative server state and shows a notification banner.
- Notifications are dismissible and auto-expire after 10 seconds in production.

---

## 2. Task Ordering Algorithm — Fractional Indexing

### Problem

Naïve integer ordering requires renumbering O(n) rows on every insert/reorder.

### Solution: Floating-Point Fractional Indexing

Each task has a `position FLOAT8` (64-bit double, ~15 significant digits).

- **Initial positions**: multiples of 65,536 (e.g., 65536, 131072, 196608…)
- **Insert between A and B**: `newPos = (A.position + B.position) / 2`
- **Insert at end**: `newPos = max(position) + 65,536`
- **No other rows are updated** — O(1) per move

### Rebalancing (Amortized O(1))

After 52 binary splits from a gap of 65,536, positions converge and precision is exhausted. When the server detects a gap < 0.5 after a move, it rebalances the affected column in a single atomic transaction: tasks are reassigned positions 65,536 · i for i = 1, 2, … This is O(n) but happens at most O(log n) times per task in the entire lifetime of the column — making it O(1) amortized.

---

## 3. WebSocket Architecture

```
wsServer.ts          — Lifecycle: connect, disconnect, error
    ↓
messageRouter.ts     — Switch on message.type → handler function
    ↓ (handlers are plain async functions, not class methods)
taskService.ts       — DB operations (always within transactions)
conflictResolver.ts  — Pure functional conflict analysis
orderingService.ts   — Fractional indexing + rebalance
    ↑
broadcaster.ts       — Sends ServerMessages to specific clients or all
presenceManager.ts   — In-memory user presence map
```

Key constraint: **`messageRouter` never imports from `wsServer`** — the router only calls `broadcaster`. This makes handlers unit-testable without a live WebSocket server.

---

## 4. Atomicity Guarantee

All database writes use `BEGIN / COMMIT / ROLLBACK` transactions via `withTransaction()`. The conflict analysis and the write happen inside the same transaction with a `SELECT … FOR UPDATE` row lock, preventing TOCTOU races between two concurrent conflict checks on the same task.

---

## 5. Offline Support

1. When the WebSocket closes, the client sets `connectionStatus = 'reconnecting'` and enters read-only mode (a visual indicator is shown; mutations are queued in memory).
2. Each attempted mutation is stored in `offlineQueue: QueuedOperation[]` in the Zustand store.
3. On reconnect, the client sends a single `REPLAY_QUEUE` message containing all queued operations.
4. The server replays them through the normal handler pipeline. Conflicts from stale `baseVersion` values are resolved identically to online conflicts — the client receives `CONFLICT_RESOLVED` events for each rejected operation.
5. The queue survives tab navigation (stored in the Zustand in-memory store for the tab lifetime). For cross-tab/refresh persistence, IndexedDB could be added with no protocol changes.

---

## 6. Trade-offs and Future Work

| Decision | Trade-off |
|---|---|
| LWW on same-field conflict | Simple and deterministic. Could use intent-based merge (e.g., text OT for descriptions) for richer UX. |
| In-memory presence | Fast. Lost on server restart; could persist to Redis for multi-instance deployments. |
| Float64 positions | 52 bits of mantissa gives ~4.5 × 10¹⁵ distinct values — enough for any realistic board. For safety, rebalance at gap < 0.5. |
| Single backend instance | No cross-instance WS broadcast. For horizontal scaling, replace `broadcaster.ts` with a Redis Pub/Sub fan-out. |
| No auth | Simple clientId from query string. Production would use JWT + RBAC. |
