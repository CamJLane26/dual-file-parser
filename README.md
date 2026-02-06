# Dual File Parser

TypeScript microservice for parsing CSV/TSV/TXT files with streaming support and REST API. Features automatic delimiter detection with manual override and handles large files (100MB-1GB).

📖 **[REST API Docs](./API.md)** | **[API Quick Reference](../API-QUICK-REFERENCE.md)** | **[Memory Management](./MEMORY.md)**

## Features

- **Multi-format support**: Parses `.csv` files and `.txt` files (both comma-separated and tab-separated)
- **Auto-detection with manual override**: Automatically detects delimiter from file content with UI dropdown to override if needed
- **Streaming parser**: Memory-efficient streaming for handling large files (100s of MB to 1+ GB)
- **Memory management**: Automatic garbage collection, batch throttling, and heap size control for large datasets
- **Dynamic schema**: Automatically creates field mappings from CSV headers
- **Batch inserts**: Configurable batch sizes with time-based flushing for efficient PostgreSQL insertion
- **Progress tracking**: Real-time progress updates via Server-Sent Events
- **Type conversion**: Converts values to string, number, boolean, date, or JSON types

## Quick Start

### Installation

```bash
npm install
```

### Running in Development Mode (No Database)

```bash
USE_DATABASE=false npm run dev
```

The server starts on `http://localhost:3001`. Open this URL in your browser to access the upload interface.

### Running with PostgreSQL

```bash
USE_DATABASE=true \
DB_HOST=localhost \
DB_PORT=5432 \
DB_NAME=csvparser \
DB_USER=postgres \
DB_PASSWORD=yourpassword \
npm run dev
```

### Production Build

```bash
npm run build
npm start
```

## How It Works

1. Upload file → 2. Auto-detect delimiter (with manual override option) → 3. Stream parse → 4. Transform to objects → 5. Batch insert (100) → 6. Progress via SSE

**UI Features:**
- File type dropdown automatically sets to detected format (CSV/TSV/TXT)
- Users can override detection before parsing if needed
- Detection info displayed after file selection

## API Endpoints

### Web UI Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | HTML upload form |
| `/health` | GET | Health check |
| `/parse` | POST | Parse CSV via SSE (for built-in web UI) |

### REST API Endpoints (for external frontends)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/parse` | POST | Upload & parse (returns job ID) |
| `/api/status/:jobId` | GET | Check parsing progress |
| `/api/result/:jobId` | GET | Get results after completion |

📖 **See [API.md](./API.md) for complete REST API documentation with code examples**

**Quick Example:**
```bash
# Upload file
curl -X POST -F "datafile=@sample.csv" http://localhost:3001/api/parse
# Returns: {"jobId": "job-123...", "status": "processing", "totalRecords": 10000}

# Check status (poll every 2s)
curl http://localhost:3001/api/status/job-123...
# Returns: {"job": {"status": "processing", "progress": 45}}

# Get results (when complete)
curl http://localhost:3001/api/result/job-123...
# Returns: {"result": {"count": 10000, "sample": [...], "format": "csv"}}
```

## Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `PORT` | 3001 | Server port |
| `USE_DATABASE` | true | Enable/disable database insertion |
| `USE_DYNAMIC_SCHEMA` | true | Auto-generate schema from headers |
| `DB_HOST` | localhost | PostgreSQL host |
| `DB_PORT` | 5432 | PostgreSQL port |
| `DB_NAME` | csvparser | Database name |
| `DB_USER` | postgres | Database user |
| `DB_PASSWORD` | (empty) | Database password |
| `DB_TABLE_NAME` | records | Target table name |
| `DB_BATCH_SIZE` | 100 | Records per batch insert |
| `BATCH_FLUSH_INTERVAL_MS` | 5000 | Time-based batch flush interval (ms) |
| `DB_POOL_MAX` | 20 | Max database connections |
| `NODE_HEAP_SIZE` | 4096 | Node.js heap size in MB (default: 4GB) |
| `STORAGE_DIR` | ./storage | Directory for temporary file storage |

## Database

Records stored as JSONB with auto-created table. Each file gets a unique `batch_id`.

## Custom Schema

By default, schema is auto-generated from CSV headers. For custom field mappings and type conversions, edit `src/config/recordSchema.ts`. Supports types: `string`, `number`, `boolean`, `date`, `json`, and nested fields.

## Project Structure

```
src/
├── config/recordSchema.ts   # Schema configuration
├── db/postgres.ts           # Database utilities
├── parsers/csvParser.ts     # CSV/TSV streaming parser
├── server.ts                # Express server
└── types/                   # TypeScript types
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server with ts-node |
| `npm run build` | Compile TypeScript to JavaScript |
| `npm start` | Run compiled production server |
| `npm test` | Run tests |
| `npm run generate-csv` | Generate large test CSV files |

## Large File Support

Handles files from 100MB to 1GB+ with constant memory usage (~200-500MB).

**Key Features:**
- Streaming parser (no full-file loading)
- Batch processing with safety limits
- Automatic garbage collection every 100K records
- Time-based batch flushing (5s)

**Heap Size Configuration:**
```bash
npm run dev                      # 4GB (up to ~500MB files)
NODE_HEAP_SIZE=8192 npm run dev  # 8GB (500MB-2GB files)
```

**Generate Test Files:**
```bash
npm run generate-csv -- 1000000   # 1M records (~100MB)
npm run generate-csv -- 10000000  # 10M records (~1GB)
```

📖 **See [MEMORY.md](./MEMORY.md) for detailed memory management documentation**

## Kubernetes Deployment

For Kubernetes/Rancher deployments with large file support:

```yaml
env:
  - name: PORT
    value: "3001"
  - name: STORAGE_DIR
    value: "/data/storage"
  - name: NODE_HEAP_SIZE
    value: "8192"  # 8GB for large files
  - name: DB_BATCH_SIZE
    value: "200"
resources:
  limits:
    memory: "12Gi"  # 1.5x heap size
    cpu: "4"
  requests:
    memory: "8Gi"
    cpu: "2"
```

## License

ISC
