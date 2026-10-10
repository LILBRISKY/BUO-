import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL;
const databaseConfigured = Boolean(databaseUrl);

export const pool = databaseConfigured
  ? new Pool({
      connectionString: databaseUrl,
      ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : undefined,
      max: Number(process.env.DATABASE_POOL_SIZE || 10),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    })
  : null;

export const query = (text, values) => {
  if (!pool) {
    throw new Error('PostgreSQL is not configured. Set DATABASE_URL in the backend environment.');
  }
  return pool.query(text, values);
};

export const withTransaction = async (run) => {
  if (!pool) {
    throw new Error('PostgreSQL is not configured. Set DATABASE_URL in the backend environment.');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await run(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

export { databaseConfigured };
