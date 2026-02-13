import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import { uploadMiddleware } from './middleware/upload';
import { parseCSVStream, detectFileFormat, countRecords, createParseOptions } from './parsers/csvParser';
import { defaultSchema, createDynamicSchema } from './config/recordSchema';
import { Readable } from 'stream';
import * as fs from 'fs';
import { getDb, upsertRecordsBatch, closeDb, ensureTableExists } from './db/postgres';
import { ParsedObject } from './types/csv';
import { queue as asyncQueue, QueueObject } from 'async';

const app = express();
const PORT = process.env.PORT || 3001;

// Configuration (optimized for large files: 100MB-1GB+)
const BATCH_SIZE = parseInt(process.env.DB_BATCH_SIZE || '100', 10);
const MAX_BATCH_SIZE = BATCH_SIZE * 2; // Safety limit
const BATCH_FLUSH_INTERVAL_MS = parseInt(process.env.BATCH_FLUSH_INTERVAL_MS || '5000', 10);

const USE_DATABASE = process.env.USE_DATABASE !== 'false'; // Default to true
const USE_DYNAMIC_SCHEMA = process.env.USE_DYNAMIC_SCHEMA !== 'false'; // Default to true
const STORAGE_DIR = process.env.STORAGE_DIR || path.join(process.cwd(), 'storage');
const STORAGE_MAX_AGE_MS = parseInt(process.env.STORAGE_MAX_AGE_MS || '3600000', 10); // 1 hour default

// Parse job interface
interface ParseJob {
  req: Request;
  res: Response | null;
  next: NextFunction;
  filePath: string;
  originalName: string;
  batchId: string;
  jobId?: string;
  isApi?: boolean;
  userDelimiter?: string;
  metadata?: Record<string, string>;
}

// Create a queue that processes 1 file at a time
const parseQueue: QueueObject<ParseJob> = asyncQueue(async (job: ParseJob) => {
  console.log(`[Queue] Starting processing (queue length: ${parseQueue.length()}, running: ${parseQueue.running()})`);
  await processParseJob(job);
  console.log(`[Queue] Finished processing (queue length: ${parseQueue.length()}, running: ${parseQueue.running()})`);
}, 1); // concurrency = 1 (one file at a time)

// Queue event handlers
parseQueue.error((err, job) => {
  console.error('[Queue] Job failed with error:', err);
});

parseQueue.drain(() => {
  console.log('[Queue] All jobs processed, queue is now empty');
});

// Store API job results temporarily (in production, use Redis)
const apiJobResults = new Map<string, any>();
const JOB_RESULT_TTL = 3600000; // Keep results for 1 hour

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

/**
 * Clean up old files in storage directory (handles orphaned files from crashes)
 */
function cleanupOldStorageFiles(): void {
  try {
    if (!fs.existsSync(STORAGE_DIR)) {
      return;
    }

    const files = fs.readdirSync(STORAGE_DIR);
    const now = Date.now();
    let cleanedCount = 0;

    for (const file of files) {
      if (!file.startsWith('data-upload-')) {
        continue; // Skip non-upload files
      }

      const filePath = path.join(STORAGE_DIR, file);
      try {
        const stats = fs.statSync(filePath);
        const age = now - stats.mtimeMs;

        if (age > STORAGE_MAX_AGE_MS) {
          fs.unlinkSync(filePath);
          cleanedCount++;
        }
      } catch (err) {
        console.error(`[Cleanup] Error processing file ${file}:`, err);
      }
    }

    if (cleanedCount > 0) {
      console.log(`[Cleanup] Removed ${cleanedCount} orphaned file(s) from storage`);
    }
  } catch (err) {
    console.error('[Cleanup] Error cleaning storage directory:', err);
  }
}

// Clean up orphaned files on startup
cleanupOldStorageFiles();

app.get('/health', (req: Request, res: Response): void => {
  res.json({
    status: 'ok',
    queue: {
      length: parseQueue.length(),
      running: parseQueue.running(),
      idle: parseQueue.idle(),
    }
  });
});

app.get('/', (req: Request, res: Response): void => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

/**
 * API: Upload and parse CSV file (returns job ID for polling)
 */
app.post('/api/parse', uploadMiddleware, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const filePath = (req as any).filePath as string;
  const originalName = (req as any).originalName as string;
  const userDelimiter = req.body?.delimiter;
  const jobId = `job-${Date.now()}-${Math.round(Math.random() * 1E9)}`;
  const batchId = `batch-${Date.now()}-${Math.round(Math.random() * 1E9)}`;

  // Extract optional uploader metadata from multipart form fields
  const metadata: Record<string, string> = {};
  if (req.body?.name) metadata.name = req.body.name;
  if (req.body?.email) metadata.email = req.body.email;
  // Pass through any extra fields prefixed with "meta_"
  for (const [key, value] of Object.entries(req.body || {})) {
    if (key.startsWith('meta_') && typeof value === 'string') {
      metadata[key.replace('meta_', '')] = value;
    }
  }

  console.log(`[API] File uploaded: ${filePath}`);
  console.log(`[API] Original filename: ${originalName}`);
  console.log(`[API] Job ID: ${jobId}`);
  if (Object.keys(metadata).length > 0) {
    console.log(`[API] Metadata: ${JSON.stringify(metadata)}`);
  }

  try {
    // Detect file format
    let detectedFormat = detectFileFormat(filePath);
    if (userDelimiter) {
      detectedFormat.delimiter = userDelimiter;
    }

    // Count records
    const totalRecordCount = await countRecords(filePath, detectedFormat.delimiter);

    // Initialize job status
    apiJobResults.set(jobId, {
      id: jobId,
      status: 'queued',
      queuePosition: parseQueue.length() + (parseQueue.running() > 0 ? 1 : 0),
      progress: 0,
      current: 0,
      total: totalRecordCount,
      format: detectedFormat.format,
      delimiter: detectedFormat.delimiter === '\t' ? 'tab' : detectedFormat.delimiter,
      metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
      createdAt: new Date().toISOString(),
    });

    // Clean up after 1 hour
    setTimeout(() => {
      apiJobResults.delete(jobId);
      console.log(`[API] Cleaned up job result: ${jobId}`);
    }, JOB_RESULT_TTL);

    // Add to queue
    parseQueue.push({
      req,
      res: null as any, // No SSE for API endpoint
      next,
      filePath,
      originalName,
      batchId,
      jobId,
      isApi: true,
      userDelimiter,
      metadata,
    } as any);

    // Return job ID immediately
    res.json({
      success: true,
      jobId,
      status: 'queued',
      queuePosition: parseQueue.length(),
      totalRecords: totalRecordCount,
      metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
      statusUrl: `/api/status/${jobId}`,
      resultUrl: `/api/result/${jobId}`,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[API] Error:', errorMessage);

    if (apiJobResults.has(jobId)) {
      apiJobResults.set(jobId, {
        ...apiJobResults.get(jobId),
        status: 'failed',
        error: errorMessage,
      });
    }

    // Clean up file
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    next(error);
  }
});

/**
 * API: Check job status
 */
app.get('/api/status/:jobId', (req: Request, res: Response): void => {
  const jobId = req.params.jobId as string;
  const job = apiJobResults.get(jobId);

  if (!job) {
    res.status(404).json({
      success: false,
      error: 'Job not found or expired',
    });
    return;
  }

  res.json({
    success: true,
    job,
  });
});

/**
 * API: Get job result (only if completed)
 */
app.get('/api/result/:jobId', (req: Request, res: Response): void => {
  const jobId = req.params.jobId as string;
  const job = apiJobResults.get(jobId);

  if (!job) {
    res.status(404).json({
      success: false,
      error: 'Job not found or expired',
    });
    return;
  }

  if (job.status !== 'completed') {
    res.status(400).json({
      success: false,
      error: `Job is ${job.status}, not completed`,
      status: job.status,
      progress: job.progress,
    });
    return;
  }

  res.json({
    success: true,
    result: job.result,
  });
});

/**
 * Process a parse job from the queue
 */
async function processParseJob(job: ParseJob): Promise<void> {
  const { req, res, next, filePath, originalName, batchId, jobId, isApi, userDelimiter, metadata } = job;
  let fileStream: Readable | undefined;

  console.log(`[Queue] Processing file: ${filePath}`);
  console.log(`[Parse] Starting parse with batch ID: ${batchId}`);

  // Helper function to update job status (for API)
  const updateJobStatus = (updates: any) => {
    if (isApi && jobId) {
      const current = apiJobResults.get(jobId) || {};
      apiJobResults.set(jobId, { ...current, ...updates, updatedAt: new Date().toISOString() });
    }
  };

  // Helper function to send progress (for SSE)
  const sendProgress = (progress: number, current: number, total: number): void => {
    if (res) {
      res.write(`data: ${JSON.stringify({ progress, current, total })}\n\n`);
    }
    if (isApi) {
      updateJobStatus({ progress, current, total, status: 'processing' });
    }
  };

  // Helper function to clean up temporary file
  const cleanupFile = () => {
    if (filePath && fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
        console.log(`[Cleanup] Deleted temporary file: ${filePath}`);
      } catch (unlinkError) {
        console.error('[Cleanup] Error deleting temp file:', unlinkError);
      }
    }
  };

  try {
    // Detect file format (CSV, TSV, or TXT) or use user preference
    let detectedFormat = detectFileFormat(filePath);

    if (userDelimiter) {
      detectedFormat.delimiter = userDelimiter;
      console.log(`[Parse] Using user-specified delimiter: ${userDelimiter === '\t' ? 'TAB' : userDelimiter}`);
    } else {
      console.log(`[Parse] Auto-detected delimiter: ${detectedFormat.delimiter === '\t' ? 'TAB' : detectedFormat.delimiter}, confidence: ${(detectedFormat.confidence * 100).toFixed(1)}%`);
    }

    // Count records for progress tracking
    const totalRecordCount = await countRecords(filePath, detectedFormat.delimiter);
    console.log(`[Upload] Found ${totalRecordCount} records in the uploaded file`);

    // Create a fresh stream for parsing
    fileStream = fs.createReadStream(filePath);
    if (!fileStream) {
      cleanupFile();
      if (res) {
        res.status(400).json({ error: 'No file stream available' });
      } else if (isApi) {
        updateJobStatus({ status: 'failed', error: 'No file stream available' });
      }
      return;
    }

    // Set up Server-Sent Events for progress updates (if not API mode)
    if (res) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
    }

    // Send initial progress with total count
    sendProgress(0, 0, totalRecordCount);
    if (isApi) {
      updateJobStatus({ status: 'processing', totalRecords: totalRecordCount });
    }

    // Ensure table exists (if database is enabled)
    if (USE_DATABASE) {
      try {
        await ensureTableExists();
      } catch (dbError) {
        console.warn('[Parse] Database connection failed, continuing without database:', dbError);
        // Continue without database for local testing
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
        if (USE_DATABASE) {
          try {
            await upsertRecordsBatch(batch, metadata);
            batch = [];
            lastBatchInsertTime = Date.now();
          } catch (dbError) {
            console.error('[Parse] Forced batch insert error:', dbError);
            // Clear batch even on error to prevent memory issues
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

      // Check if we need to flush based on time (prevent stale batches)
      const timeSinceLastInsert = Date.now() - lastBatchInsertTime;
      const shouldFlushByTime = batch.length > 0 && timeSinceLastInsert >= BATCH_FLUSH_INTERVAL_MS;

      // Upsert batch when it reaches the batch size or time limit (if database is enabled)
      if (USE_DATABASE && (batch.length >= BATCH_SIZE || shouldFlushByTime)) {
        try {
          await upsertRecordsBatch(batch, metadata);
          batch = [];
          lastBatchInsertTime = Date.now();
        } catch (dbError) {
          console.error('[Parse] Database upsert error:', dbError);
          // Always clear batch on error to prevent memory accumulation
          batch = [];
          // Continue parsing even if database upsert fails
        }
      }

      // Calculate and send progress updates
      if (totalRecordCount > 0) {
        const progressPercent = Math.min(100, Math.floor((recordCount / totalRecordCount) * 100));
        // Send progress update when percentage changes or every 1000 records
        if (progressPercent !== lastProgressSent || recordCount % 1000 === 0) {
          sendProgress(progressPercent, recordCount, totalRecordCount);
          lastProgressSent = progressPercent;
        }
      } else {
        // If we don't know the total, still send updates periodically
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

    // Upsert remaining records in batch (if database is enabled)
    if (USE_DATABASE && batch.length > 0) {
      try {
        await upsertRecordsBatch(batch, metadata);
      } catch (dbError) {
        console.error('[Parse] Database upsert error:', dbError);
      }
    }

    if (USE_DATABASE) {
      console.log(`[Parse] Successfully upserted ${recordCount.toLocaleString()} records into database`);
    } else {
      console.log(`[Parse] Parsed ${recordCount.toLocaleString()} records (database disabled)`);
    }

    // Send final progress and result
    sendProgress(100, recordCount, totalRecordCount);

    const finalResult = {
      done: true,
      count: recordCount,
      sample: sampleRecords,
      format: detectedFormat.format,
      delimiter: detectedFormat.delimiter === '\t' ? 'tab' : detectedFormat.delimiter,
      batchId: USE_DATABASE ? batchId : undefined,
      metadata: metadata && Object.keys(metadata).length > 0 ? metadata : undefined,
    };

    if (res) {
      res.write(`data: ${JSON.stringify(finalResult)}\n\n`);
      res.end();
    }

    if (isApi) {
      updateJobStatus({
        status: 'completed',
        progress: 100,
        current: recordCount,
        result: finalResult,
        completedAt: new Date().toISOString(),
      });
    }
  } catch (error) {
    // Send error via SSE before ending
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Parse] Error:', errorMessage);
    console.error('[Parse] Parsing failed - cleaning up temporary file');

    if (res) {
      res.write(`data: ${JSON.stringify({ error: errorMessage })}\n\n`);
      res.end();
    }

    if (isApi) {
      updateJobStatus({
        status: 'failed',
        error: errorMessage,
        failedAt: new Date().toISOString(),
      });
    }

    if (next) next(error);
  } finally {
    // Clean up temporary file (always executes, even on error)
    cleanupFile();
  }
}

app.post('/parse', uploadMiddleware, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const filePath = (req as any).filePath as string;
  const originalName = (req as any).originalName as string;
  const userDelimiter = req.body?.delimiter;
  const batchId = `batch-${Date.now()}-${Math.round(Math.random() * 1e9)}`;

  console.log(`[Upload] File saved to: ${filePath}`);
  console.log(`[Upload] Original filename: ${originalName}`);
  console.log(`[Queue] Current queue length: ${parseQueue.length()}`);
  console.log(`[Queue] Adding job to queue (batch ID: ${batchId})`);

  // Set up Server-Sent Events immediately
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  // Send queue position info
  const queuePosition = parseQueue.length() + (parseQueue.running() > 0 ? 1 : 0);
  if (queuePosition > 1) {
    res.write(`data: ${JSON.stringify({
      queued: true,
      position: queuePosition,
      message: `In queue. Position: ${queuePosition}. Processing will start soon...`
    })}\n\n`);
  }

  // Add job to queue
  parseQueue.push({
    req,
    res,
    next,
    filePath,
    originalName,
    batchId,
    userDelimiter,
  });
});

app.use((err: Error, req: Request, res: Response, next: NextFunction): void => {
  console.error('Error:', err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

// Handle uncaught exceptions (including heap overflow errors)
process.on('uncaughtException', async (err: Error) => {
  console.error('UNCAUGHT EXCEPTION! Shutting down...');
  console.error(err.name, err.message);
  console.error(err.stack);

  // Attempt cleanup before crash
  console.log('[Emergency] Attempting to clean up storage directory...');
  try {
    cleanupOldStorageFiles();
  } catch (cleanupErr) {
    console.error('[Emergency] Cleanup failed:', cleanupErr);
  }

  if (USE_DATABASE) {
    try {
      await closeDb();
    } catch (poolErr) {
      console.error('[Emergency] Pool close failed:', poolErr);
    }
  }
  process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', async (reason: any) => {
  console.error('UNHANDLED REJECTION! Shutting down...');
  console.error(reason);

  if (USE_DATABASE) {
    try {
      await closeDb();
    } catch (poolErr) {
      console.error('[Emergency] Pool close failed:', poolErr);
    }
  }
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, closing database pool...');
  if (USE_DATABASE) {
    await closeDb();
  }
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, closing database pool...');
  if (USE_DATABASE) {
    await closeDb();
  }
  process.exit(0);
});

app.listen(PORT, () => {
  console.log(`CSV/TSV Parser server running on port ${PORT}`);
  if (USE_DATABASE) {
    console.log(`Database mode: ENABLED (table: csv_records)`);
  } else {
    console.log(`Database mode: DISABLED (local testing mode)`);
  }
  console.log(`Dynamic schema: ${USE_DYNAMIC_SCHEMA ? 'ENABLED' : 'DISABLED'}`);
});
