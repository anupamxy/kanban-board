import 'dotenv/config';
import http from 'http';
import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';

const PORT = parseInt(process.env.PORT ?? '4000', 10);
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN ?? 'http://localhost:5173';

async function runMigrations(): Promise<void> {
  const { pool } = await import('./db');
  const migrationDir = path.join(__dirname, 'db', 'migrations');
  if (!fs.existsSync(migrationDir)) return;
  const files = fs.readdirSync(migrationDir).sort();
  for (const file of files) {
    if (!file.endsWith('.sql')) continue;
    const sql = fs.readFileSync(path.join(migrationDir, file), 'utf8');
    await pool.query(sql);
  }
  console.log('[startup] Migrations applied');
}

async function main(): Promise<void> {
  // ── If no DATABASE_URL, auto-start embedded PostgreSQL ───────────────────
  if (!process.env.DATABASE_URL) {
    const { startEmbeddedPostgres, EMBEDDED_DATABASE_URL } = await import('./db/embeddedPostgres');
    await startEmbeddedPostgres();
    process.env.DATABASE_URL = EMBEDDED_DATABASE_URL;
    console.log('[startup] Using embedded PostgreSQL');
  } else {
    console.log('[startup] Using external PostgreSQL');
  }

  // ── Verify DB connectivity and run migrations ────────────────────────────
  const { testConnection, pool } = await import('./db');
  await testConnection();
  await runMigrations();

  const app = express();

  app.use(cors({
    origin: CLIENT_ORIGIN,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  }));
  app.use(express.json());

  const taskRoutes = (await import('./routes/tasks')).default;
  app.use('/api', taskRoutes);

  const server = http.createServer(app);

  const { attachWebSocketServer } = await import('./websocket/wsServer');
  attachWebSocketServer(server);

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[server] Listening on http://localhost:${PORT}`);
    console.log(`[server] WebSocket: ws://localhost:${PORT}`);
    console.log(`[server] Allowed origin: ${CLIENT_ORIGIN}`);
  });

  const shutdown = async () => {
    console.log('[server] Shutting down…');
    server.close();
    await pool.end();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error('[startup] Fatal error:', err);
  process.exit(1);
});
