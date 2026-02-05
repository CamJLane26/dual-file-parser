import { Pool, PoolClient } from 'pg';
import { ParsedObject } from '../types/csv';

let pool: Pool | null = null;

/**
 * Initialize PostgreSQL connection pool
 */
export function initializePool(): Pool {
  if (pool) {
    return pool;
  }

  pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME || 'csvparser',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    max: parseInt(process.env.DB_POOL_MAX || '20', 10),
    idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT || '30000', 10),
    connectionTimeoutMillis: parseInt(process.env.DB_CONNECTION_TIMEOUT || '2000', 10),
  });

  pool.on('error', (err: Error) => {
    console.error('Unexpected error on idle client', err);
  });

  return pool;
}

/**
 * Get the connection pool
 */
export function getPool(): Pool {
  if (!pool) {
    return initializePool();
  }
  return pool;
}

/**
 * Close the connection pool (for graceful shutdown)
 */
export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

/**
 * Insert a batch of records into the database
 * Uses a transaction to ensure all-or-nothing insertion
 */
export async function insertRecordsBatch(
  client: PoolClient,
  records: ParsedObject[],
  tableName: string = 'records',
  batchId?: string
): Promise<number> {
  if (records.length === 0) {
    return 0;
  }

  // Build the INSERT query with parameterized values
  const values: unknown[] = [];
  const placeholders: string[] = [];
  let paramIndex = 1;

  for (const record of records) {
    const recordJson = JSON.stringify(record);
    placeholders.push(`($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2})`);
    values.push(batchId || null, recordJson, new Date());
    paramIndex += 3;
  }

  const query = `
    INSERT INTO ${tableName} (batch_id, data, created_at)
    VALUES ${placeholders.join(', ')}
  `;

  const result = await client.query(query, values);
  return result.rowCount || 0;
}

/**
 * Create the records table if it doesn't exist
 */
export async function ensureTableExists(
  client: PoolClient,
  tableName: string = 'records'
): Promise<void> {
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS ${tableName} (
      id SERIAL PRIMARY KEY,
      batch_id VARCHAR(255),
      data JSONB NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `;

  await client.query(createTableQuery);

  // Create indexes if they don't exist
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_${tableName}_batch_id ON ${tableName}(batch_id)
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_${tableName}_created_at ON ${tableName}(created_at)
  `);
}

/**
 * Get a client from the pool and ensure table exists
 */
export async function getClient(tableName: string = 'records'): Promise<PoolClient> {
  const pool = getPool();
  const client = await pool.connect();

  try {
    await ensureTableExists(client, tableName);
  } catch (error) {
    client.release();
    throw error;
  }

  return client;
}

/**
 * Query records by batch ID
 */
export async function getRecordsByBatchId(
  client: PoolClient,
  batchId: string,
  tableName: string = 'records',
  limit: number = 100,
  offset: number = 0
): Promise<ParsedObject[]> {
  const query = `
    SELECT data FROM ${tableName}
    WHERE batch_id = $1
    ORDER BY id
    LIMIT $2 OFFSET $3
  `;

  const result = await client.query(query, [batchId, limit, offset]);
  return result.rows.map(row => row.data);
}

/**
 * Count records by batch ID
 */
export async function countRecordsByBatchId(
  client: PoolClient,
  batchId: string,
  tableName: string = 'records'
): Promise<number> {
  const query = `
    SELECT COUNT(*) as count FROM ${tableName}
    WHERE batch_id = $1
  `;

  const result = await client.query(query, [batchId]);
  return parseInt(result.rows[0].count, 10);
}
