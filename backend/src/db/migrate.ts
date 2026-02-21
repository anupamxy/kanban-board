import fs from 'fs';
import path from 'path';
import { pool } from './index';
import dotenv from 'dotenv';

dotenv.config();

async function migrate(): Promise<void> {
  const migrationDir = path.join(__dirname, 'migrations');
  const files = fs.readdirSync(migrationDir).sort();

  console.log('[migrate] Running migrations...');

  for (const file of files) {
    if (!file.endsWith('.sql')) continue;
    const sql = fs.readFileSync(path.join(migrationDir, file), 'utf8');
    console.log(`[migrate] Running ${file}`);
    await pool.query(sql);
  }

  console.log('[migrate] Done.');
  await pool.end();
}

migrate().catch((err) => {
  console.error('[migrate] FAILED:', err);
  process.exit(1);
});
