/**
 * Embedded PostgreSQL — downloads + starts a real PostgreSQL server
 * automatically when DATABASE_URL is not provided.
 * Binaries are cached in node_modules/embedded-postgres after first download.
 */

import path from 'path';

const EMBEDDED_PORT = 5432;
const EMBEDDED_USER = 'kanban';
const EMBEDDED_PASSWORD = 'kanban_secret';
const EMBEDDED_DB = 'kanban_db';

export const EMBEDDED_DATABASE_URL =
  `postgres://${EMBEDDED_USER}:${EMBEDDED_PASSWORD}@localhost:${EMBEDDED_PORT}/${EMBEDDED_DB}`;

export async function startEmbeddedPostgres(): Promise<void> {
  // Dynamic require so the import only happens when needed
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const EmbeddedPostgres = require('embedded-postgres').default as new (opts: object) => {
    initialise(): Promise<void>;
    start(): Promise<void>;
    createDatabase(name: string): Promise<void>;
    stop(): Promise<void>;
  };

  const dataDir = path.join(process.cwd(), '.pg-data');

  console.log('[embedded-pg] Starting embedded PostgreSQL (first run downloads ~100 MB)…');

  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: EMBEDDED_USER,
    password: EMBEDDED_PASSWORD,
    port: EMBEDDED_PORT,
    persistent: true,        // keep data directory between restarts
  });

  await pg.initialise();
  await pg.start();

  // Create the database if it doesn't exist yet
  try {
    await pg.createDatabase(EMBEDDED_DB);
  } catch {
    // Already exists — that's fine
  }

  console.log(`[embedded-pg] Running on port ${EMBEDDED_PORT} (data: ${dataDir})`);

  // Stop cleanly on process exit
  const stop = async () => {
    console.log('[embedded-pg] Stopping…');
    await pg.stop();
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
