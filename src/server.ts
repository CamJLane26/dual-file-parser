import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import { uploadMiddleware } from './middleware/upload';
import { parseCSVStream, detectFileFormat, countRecords, createParseOptions } from './parsers/csvParser';
import { defaultSchema, createDynamicSchema } from './config/recordSchema';
import { Readable } from 'stream';
import * as fs from 'fs';
import { getClient, insertRecordsBatch, closePool } from './db/postgres';
import { ParsedObject } from './types/csv';

const app = express();
const PORT = process.env.PORT || 3001;

// Configuration (optimized for large files: 100MB-1GB+)
const BATCH_SIZE = parseInt(process.env.DB_BATCH_SIZE || '100', 10);
const MAX_BATCH_SIZE = BATCH_SIZE * 2; // Safety limit
const BATCH_FLUSH_INTERVAL_MS = parseInt(process.env.BATCH_FLUSH_INTERVAL_MS || '5000', 10);

const USE_DATABASE = process.env.USE_DATABASE !== 'false'; // Default to true
const TABLE_NAME = process.env.DB_TABLE_NAME || 'records';
const USE_DYNAMIC_SCHEMA = process.env.USE_DYNAMIC_SCHEMA !== 'false'; // Default to true

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (req: Request, res: Response): void => {
  res.json({ status: 'ok' });
});

app.get('/', (req: Request, res: Response): void => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.post('/parse', uploadMiddleware, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const filePath = (req as any).filePath as string;
  const originalName = (req as any).originalName as string;
  let fileStream: Readable | undefined;
  let dbClient: any = null;
  const batchId = `batch-${Date.now()}-${Math.round(Math.random() * 1e9)}`;

  console.log(`[Upload] File saved to: ${filePath}`);
  console.log(`[Upload] Original filename: ${originalName}`);
  console.log(`[Parse] Starting parse with batch ID: ${batchId}`);

  try {
    // Detect file format (CSV, TSV, or TXT)
    const detectedFormat = detectFileFormat(filePath);
    console.log(`[Parse] Detected format: ${detectedFormat.format}, delimiter: ${detectedFormat.delimiter === '\t' ? 'TAB' : detectedFormat.delimiter}, confidence: ${(detectedFormat.confidence * 100).toFixed(1)}%`);

    // Count records for progress tracking
    const totalRecordCount = await countRecords(filePath, detectedFormat.delimiter);
    console.log(`[Upload] Found ${totalRecordCount} records in the uploaded file`);

    // Create a fresh stream for parsing
    fileStream = fs.createReadStream(filePath);
    if (!fileStream) {
      res.status(400).json({ error: 'No file stream available' });
      return;
    }

    // Set up Server-Sent Events for progress updates
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering

    const sendProgress = (progress: number, current: number, total: number): void => {
      res.write(`data: ${JSON.stringify({ progress, current, total })}\n\n`);
    };

    // Send initial progress with total count
    sendProgress(0, 0, totalRecordCount);

    // Get database client and start transaction (if database is enabled)
    if (USE_DATABASE) {
      try {
        dbClient = await getClient(TABLE_NAME);
        await dbClient.query('BEGIN');
      } catch (dbError) {
        console.warn('[Parse] Database connection failed, continuing without database:', dbError);
      }
    }

    // Determine which schema to use
    let schema = defaultSchema;
    if (USE_DYNAMIC_SCHEMA && detectedFormat.sampleHeaders) {
      schema = createDynamicSchema(detectedFormat.sampleHeaders);
      console.log(`[Parse] Using dynamic schema with ${schema.columns.length} columns`);
    } else {
      console.log(`[Parse] Using default schema`);
    }

    let recordCount = 0;
    const sampleRecords: ParsedObject[] = [];
    let batch: ParsedObject[] = [];
    let lastProgressSent = -1;
    let lastBatchInsertTime = Date.now();

    // Create parse options from detected format
    const parseOptions = createParseOptions(detectedFormat);

    await parseCSVStream(fileStream, schema, async (record) => {
      recordCount++;

      // Safety check: prevent batch from growing too large
      if (batch.length >= MAX_BATCH_SIZE) {
        console.warn(`[Parse] Batch size exceeded ${MAX_BATCH_SIZE}, forcing insert to prevent memory issues`);
        if (USE_DATABASE && dbClient) {
          try {
            await insertRecordsBatch(dbClient, batch, TABLE_NAME, batchId);
            batch = [];
            lastBatchInsertTime = Date.now();
          } catch (dbError) {
            console.error('[Parse] Forced batch insert error:', dbError);
            batch = [];
          }
        } else {
          batch = [];
        }
      }

      batch.push(record);

      // Collect sample records
      if (sampleRecords.length < 20) {
        const recordCopy = JSON.parse(JSON.stringify(record));
        sampleRecords.push(recordCopy);
      }

      // Check if we need to flush based on time
      const timeSinceLastInsert = Date.now() - lastBatchInsertTime;
      const shouldFlushByTime = batch.length > 0 && timeSinceLastInsert >= BATCH_FLUSH_INTERVAL_MS;

      // Insert batch when it reaches the batch size or time limit
      if (USE_DATABASE && dbClient && (batch.length >= BATCH_SIZE || shouldFlushByTime)) {
        try {
          await insertRecordsBatch(dbClient, batch, TABLE_NAME, batchId);
          batch = [];
          lastBatchInsertTime = Date.now();
        } catch (dbError) {
          console.error('[Parse] Database insert error:', dbError);
          batch = [];
        }
      }

      // Calculate and send progress updates
      if (totalRecordCount > 0) {
        const progressPercent = Math.min(100, Math.floor((recordCount / totalRecordCount) * 100));
        if (progressPercent !== lastProgressSent || recordCount % 1000 === 0) {
          sendProgress(progressPercent, recordCount, totalRecordCount);
          lastProgressSent = progressPercent;
        }
      } else {
        if (recordCount % 1000 === 0) {
          sendProgress(0, recordCount, 0);
        }
      }

      // Trigger manual GC every 100K records (--expose-gc flag in package.json)
      if (recordCount % 100000 === 0) {
        console.log(`[Parse] Processed ${recordCount.toLocaleString()} records...`);
        if (global.gc) {
          global.gc();
          const memUsage = process.memoryUsage();
          console.log(`[Memory] Heap: ${(memUsage.heapUsed / 1024 / 1024).toFixed(1)}MB / ${(memUsage.heapTotal / 1024 / 1024).toFixed(1)}MB`);
        }
      }
    }, parseOptions);

    // Insert remaining records in batch
    if (USE_DATABASE && dbClient && batch.length > 0) {
      try {
        await insertRecordsBatch(dbClient, batch, TABLE_NAME, batchId);
      } catch (dbError) {
        console.error('[Parse] Database insert error:', dbError);
      }
    }

    // Commit transaction
    if (USE_DATABASE && dbClient) {
      try {
        await dbClient.query('COMMIT');
        console.log(`[Parse] Successfully inserted ${recordCount.toLocaleString()} records into database`);
      } catch (dbError) {
        console.error('[Parse] Database commit error:', dbError);
        try {
          await dbClient.query('ROLLBACK');
        } catch (rollbackError) {
          console.error('[Parse] Error during rollback:', rollbackError);
        }
      }
    } else {
      console.log(`[Parse] Parsed ${recordCount.toLocaleString()} records (database disabled)`);
    }

    // Send final progress and result
    sendProgress(100, recordCount, totalRecordCount);
    res.write(`data: ${JSON.stringify({
      done: true,
      count: recordCount,
      sample: sampleRecords,
      format: detectedFormat.format,
      delimiter: detectedFormat.delimiter === '\t' ? 'tab' : detectedFormat.delimiter,
      batchId: USE_DATABASE ? batchId : undefined,
    })}\n\n`);
    res.end();
  } catch (error) {
    // Rollback transaction on error
    if (USE_DATABASE && dbClient) {
      try {
        await dbClient.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('[Parse] Error during rollback:', rollbackError);
      }
    }

    // Send error via SSE before ending
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Parse] Error:', errorMessage);
    res.write(`data: ${JSON.stringify({ error: errorMessage })}\n\n`);
    res.end();
    next(error);
  } finally {
    // Release database client
    if (dbClient) {
      dbClient.release();
    }

    // Clean up temporary file
    if (filePath && fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (unlinkError) {
        console.error('[Parse] Error deleting temp file:', unlinkError);
      }
    }
  }
});

app.use((err: Error, req: Request, res: Response, next: NextFunction): void => {
  console.error('Error:', err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, closing database pool...');
  if (USE_DATABASE) {
    await closePool();
  }
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, closing database pool...');
  if (USE_DATABASE) {
    await closePool();
  }
  process.exit(0);
});

app.listen(PORT, () => {
  console.log(`CSV/TSV Parser server running on port ${PORT}`);
  if (USE_DATABASE) {
    console.log(`Database mode: ENABLED (table: ${TABLE_NAME})`);
  } else {
    console.log(`Database mode: DISABLED (local testing mode)`);
  }
  console.log(`Dynamic schema: ${USE_DYNAMIC_SCHEMA ? 'ENABLED' : 'DISABLED'}`);
});
