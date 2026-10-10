import dotenv from 'dotenv';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { databaseConfigured, pool } from './client.js';

dotenv.config();

if (!databaseConfigured || !pool) {
  throw new Error('Set DATABASE_URL before running database migrations.');
}

const directory = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');
const files = (await readdir(directory))
  .filter((file) => /^\d{3,}_.*\.sql$/.test(file))
  .sort();

const client = await pool.connect();
try {
  await client.query('SELECT pg_advisory_lock(74103821)');
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(120) PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  for (const file of files) {
    const applied = await client.query('SELECT 1 FROM schema_migrations WHERE version = $1', [file]);
    if (applied.rowCount) {
      console.log(`Skipping already-applied migration ${file}`);
      continue;
    }

    const sql = await readFile(path.join(directory, file), 'utf8');
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log(`Applied migration ${file}`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }
} finally {
  await client.query('SELECT pg_advisory_unlock(74103821)');
  client.release();
  await pool.end();
}
