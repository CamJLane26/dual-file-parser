import pgPromise from 'pg-promise';
import { ParsedObject } from '../types/csv';

const pgp = pgPromise();

// Column set for batch upserts using pgp.helpers
const recordColumns = new pgp.helpers.ColumnSet(
  [
    'name',
    'uuid',
    { name: 'data', cast: 'jsonb' },
    { name: 'metadata', cast: 'jsonb', def: null },
    { name: 'created_at', def: 'NOW()', mod: ':raw' },
  ],
  { table: { table: 'csv_records', schema: 'public' } }
);

let db: pgPromise.IDatabase<{}> | null = null;

/**
 * Get the pg-promise database instance (lazy-initialized)
 */
export function getDb(): pgPromise.IDatabase<{}> {
  if (db) return db;

  db = pgp({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME || 'xmlparser',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    max: parseInt(process.env.DB_POOL_MAX || '5', 10),
  });

  return db;
}

/**
 * Close the database connection (for graceful shutdown)
 */
export async function closeDb(): Promise<void> {
  if (db) {
    pgp.end();
    db = null;
  }
}

/**
 * Ensure the csv_records table exists (idempotent)
 */
export async function ensureTableExists(): Promise<void> {
  const database = getDb();
  await database.none(`
    CREATE TABLE IF NOT EXISTS public.csv_records (
      id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      name TEXT NOT NULL,
      uuid TEXT NOT NULL,
      data JSONB NOT NULL,
      metadata JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT csv_records_uuid_unique UNIQUE (uuid)
    )
  `);
}

/**
 * Upsert a batch of parsed CSV/TSV records using pgp.helpers.
 * On uuid conflict, updates name, data, metadata, and created_at.
 */
export async function upsertRecordsBatch(
  records: ParsedObject[],
  metadata?: Record<string, string>
): Promise<number> {
  if (records.length === 0) return 0;

  const database = getDb();
  const delayMs = parseInt(process.env.DB_INSERT_DELAY_MS || '0', 10);

  const metadataJson = metadata && Object.keys(metadata).length > 0
    ? JSON.stringify(metadata)
    : null;

  // Build rows for the column set
  const rows = records.map((record) => ({
    name: (record.name as string) || (record.first_name as string) || '',
    uuid: (record.uuid as string) || '',
    data: JSON.stringify(record),
    metadata: metadataJson,
  }));

  // Log each record being upserted
  for (const row of rows) {
    console.log(`[DB] Upserting record: name="${row.name}", uuid="${row.uuid}"`);
  }

  const insert = pgp.helpers.insert(rows, recordColumns);
  const onConflict =
    ' ON CONFLICT (uuid) DO UPDATE SET ' +
    'name = EXCLUDED.name, ' +
    'data = EXCLUDED.data, ' +
    'metadata = EXCLUDED.metadata, ' +
    'created_at = EXCLUDED.created_at';

  const query = insert + onConflict;
  const result = await database.result(query);

  console.log(`[DB] Upserted ${result.rowCount} row(s)`);

  // Optional throttle for debugging (set DB_INSERT_DELAY_MS env var)
  if (delayMs > 0) {
    await new Promise((r) => setTimeout(r, delayMs));
  }

  return result.rowCount;
}
