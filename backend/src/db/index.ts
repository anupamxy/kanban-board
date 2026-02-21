import { Pool, PoolClient } from 'pg';

// DATABASE_URL may be set lazily (by embedded-postgres startup in index.ts)
// so we use a lazy pool getter instead of initialising at module load time.
let _pool: Pool | null = null;

export function getPool(): Pool {
  if (_pool) return _pool;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set — embedded PostgreSQL may still be starting');
  _pool = new Pool({
    connectionString: url,
    max: 20,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
  _pool.on('error', (err) => {
    console.error('[DB] Unexpected pool error:', err);
  });
  return _pool;
}

// Convenience proxy so existing code can still write `pool.query(...)`.
// The proxy forwards every property access to getPool().
export const pool = new Proxy({} as Pool, {
  get(_target, prop) {
    return (getPool() as unknown as Record<string | symbol, unknown>)[prop];
  },
});

/** Run a callback inside a transaction; rolls back on any error */
export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function testConnection(): Promise<void> {
  const client = await getPool().connect();
  try {
    await client.query('SELECT 1');
    console.log('[DB] Connection OK');
  } finally {
    client.release();
  }
}
