# Memory Management Guide

How dual-file-parser handles large CSV/TSV files (100MB-1GB+) with constant memory (~200-500MB).

## Architecture

### 1. Streaming Parser
- Files read as Node.js streams via `csv-parse`
- Records processed one at a time (no full-file loading)
- Objects aggressively cleared after processing
- **Result:** Constant 200-500MB footprint regardless of file size

### 2. Batch Processing
```typescript
BATCH_SIZE = 100              // Records per DB insert
MAX_BATCH_SIZE = 200          // Safety limit
BATCH_FLUSH_INTERVAL_MS = 5000 // Time-based flush
```
- Batches auto-flush on size or time limit
- Cleared even on DB errors to prevent leaks

### 3. Garbage Collection
```typescript
if (recordCount % 100000 === 0) {
  global.gc();  // Manual trigger every 100K records
}
```
Enabled via `--expose-gc` flag in `package.json` scripts.

### 4. Object Cleanup
After each record is processed, nested objects/arrays are explicitly cleared to help V8 GC identify freed memory faster (similar to xml-parser's `clearElementTree()`).

## Heap Size Configuration

```bash
npm run dev                       # 4GB (up to ~500MB files)
NODE_HEAP_SIZE=8192 npm run dev   # 8GB (500MB-2GB files)
NODE_HEAP_SIZE=16384 npm run dev  # 16GB (2GB+ files)
```

**Guidelines:**
- Local: 50-70% of available RAM
- Kubernetes: Memory limit = 1.5x heap size (accounts for OS, buffers, GC spikes)

```yaml
env:
  - name: NODE_HEAP_SIZE
    value: "8192"
resources:
  limits:
    memory: "12Gi"  # 1.5x heap size
```

## Testing

**Generate Test Files:**
```bash
npm run generate-csv -- 100000    # 10MB
npm run generate-csv -- 1000000   # 100MB
npm run generate-csv -- 10000000  # 1GB
npm run generate-csv -- 1000000 tsv  # TSV format
```

**Monitor Memory:**
```bash
watch -n 1 'ps aux | grep node'  # Real-time monitoring
```

Parser logs heap usage every 100K records:
```
[Memory] Heap: 245.3MB / 512.0MB
```

## Performance

| File Size | Records | Heap | Time* | Peak Memory |
|-----------|---------|------|-------|-------------|
| 10MB | 100K | 4GB | 5-10s | 200MB |
| 100MB | 1M | 4GB | 30-60s | 300MB |
| 500MB | 5M | 8GB | 3-5min | 400MB |
| 1GB | 10M | 8GB | 6-10min | 500MB |
| 2GB | 20M | 16GB | 12-20min | 600MB |

*Varies by CPU, disk I/O, database. **Peak memory stays constant regardless of file size.**

## Troubleshooting

**Out of Memory:**
```bash
# Symptom: "JavaScript heap out of memory"
NODE_HEAP_SIZE=8192 npm run dev      # Increase heap
DB_BATCH_SIZE=50 npm run dev         # Reduce batch size
USE_DATABASE=false npm run dev       # Disable DB
```

**Slow Processing:**
- Database bottleneck: Check CPU/connection pool
- Disk I/O: Use SSD storage
- Network latency: Test with local DB
- Complex schema: Simplify or increase `DB_BATCH_SIZE`

**Memory Leak:**
```bash
node --expose-gc --inspect -r ts-node/register src/server.ts
```
Check Chrome DevTools → Memory for heap snapshots.

## Kubernetes Deployment

```yaml
env:
  - name: NODE_HEAP_SIZE
    value: "8192"
  - name: DB_BATCH_SIZE
    value: "200"
  - name: STORAGE_DIR
    value: "/data/storage"

resources:
  requests:
    memory: "6Gi"
    cpu: "2"
  limits:
    memory: "12Gi"  # 1.5x heap
    cpu: "4"

volumeMounts:
  - name: storage
    mountPath: /data/storage

livenessProbe:
  httpGet:
    path: /health
    port: 3001
  initialDelaySeconds: 30
```

## Comparison with xml-parser

Both services use identical memory management architecture. All features are equal (streaming, batching, GC, object cleanup, 1-2GB max file size).
