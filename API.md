# Dual File Parser API Documentation

REST API endpoints for integrating with external frontends.

## Base URL

- Development: `http://localhost:3001`
- Production: `https://your-domain.com`

## Endpoints

### 1. Upload & Parse (Async)

Upload a CSV/TSV/TXT file and get a job ID for tracking progress.

**Endpoint:** `POST /api/parse`

**Content-Type:** `multipart/form-data`

**Parameters:**
- `datafile` (file, required): CSV/TSV/TXT file to parse
- `delimiter` (string, optional): Force delimiter (',' or '\t'). If omitted, auto-detects from content.

**Response:**
```json
{
  "success": true,
  "jobId": "job-1707123456789-123456789",
  "status": "processing",
  "totalRecords": 10000,
  "statusUrl": "/api/status/job-1707123456789-123456789",
  "resultUrl": "/api/result/job-1707123456789-123456789"
}
```

**Example:**
```bash
# Auto-detect delimiter
curl -X POST \
  -F "datafile=@sample.csv" \
  http://localhost:3001/api/parse

# Force tab delimiter
curl -X POST \
  -F "datafile=@sample.txt" \
  -F "delimiter=%09" \
  http://localhost:3001/api/parse
```

```javascript
// JavaScript/Fetch
const formData = new FormData();
formData.append('datafile', fileInput.files[0]);
// Optional: force delimiter
// formData.append('delimiter', '\t'); // for tab-separated

const response = await fetch('http://localhost:3001/api/parse', {
  method: 'POST',
  body: formData
});

const data = await response.json();
console.log('Job ID:', data.jobId);
console.log('Total records:', data.totalRecords);
```

---

### 2. Check Job Status

Poll this endpoint to track parsing progress.

**Endpoint:** `GET /api/status/:jobId`

**Response (Processing):**
```json
{
  "success": true,
  "job": {
    "id": "job-1707123456789-123456789",
    "status": "processing",
    "progress": 45,
    "current": 4500,
    "total": 10000,
    "format": "csv",
    "delimiter": ",",
    "createdAt": "2024-02-05T10:30:00.000Z",
    "updatedAt": "2024-02-05T10:30:15.000Z"
  }
}
```

**Response (Completed):**
```json
{
  "success": true,
  "job": {
    "id": "job-1707123456789-123456789",
    "status": "completed",
    "progress": 100,
    "current": 10000,
    "total": 10000,
    "format": "csv",
    "delimiter": ",",
    "createdAt": "2024-02-05T10:30:00.000Z",
    "completedAt": "2024-02-05T10:32:00.000Z"
  }
}
```

**Response (Failed):**
```json
{
  "success": true,
  "job": {
    "id": "job-1707123456789-123456789",
    "status": "failed",
    "error": "Invalid CSV format",
    "createdAt": "2024-02-05T10:30:00.000Z",
    "failedAt": "2024-02-05T10:30:05.000Z"
  }
}
```

**Response (Not Found):**
```json
{
  "success": false,
  "error": "Job not found or expired"
}
```

**Example:**
```bash
curl http://localhost:3001/api/status/job-1707123456789-123456789
```

---

### 3. Get Results

Retrieve parsed data after job completion.

**Endpoint:** `GET /api/result/:jobId`

**Response (Success):**
```json
{
  "success": true,
  "result": {
    "count": 10000,
    "sample": [
      {
        "id": "1",
        "name": "Product A",
        "price": 29.99,
        "active": true
      }
    ],
    "format": "csv",
    "delimiter": ",",
    "batchId": "batch-1707123456789-123456789"
  }
}
```

**Response (Not Completed):**
```json
{
  "success": false,
  "error": "Job is processing, not completed",
  "status": "processing",
  "progress": 45
}
```

**Response (Not Found):**
```json
{
  "success": false,
  "error": "Job not found or expired"
}
```

---

### 4. Health Check

Check server status.

**Endpoint:** `GET /health`

**Response:**
```json
{
  "status": "ok"
}
```

---

## Complete Frontend Integration Example

```javascript
class CSVParserClient {
  constructor(baseUrl = 'http://localhost:3001') {
    this.baseUrl = baseUrl;
  }

  async uploadAndParse(file, delimiter = null) {
    const formData = new FormData();
    formData.append('datafile', file);
    
    // Optional: force delimiter
    if (delimiter) {
      formData.append('delimiter', delimiter);
    }

    const response = await fetch(`${this.baseUrl}/api/parse`, {
      method: 'POST',
      body: formData
    });

    const data = await response.json();
    
    if (!data.success) {
      throw new Error('Upload failed');
    }

    return {
      jobId: data.jobId,
      totalRecords: data.totalRecords
    };
  }

  async pollUntilComplete(jobId, onProgress) {
    while (true) {
      const response = await fetch(`${this.baseUrl}/api/status/${jobId}`);
      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error);
      }

      const job = data.job;

      // Call progress callback
      if (onProgress) {
        onProgress(job);
      }

      // Check status
      if (job.status === 'completed') {
        return this.getResult(jobId);
      } else if (job.status === 'failed') {
        throw new Error(job.error);
      }

      // Wait 2 seconds before next poll
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  async getResult(jobId) {
    const response = await fetch(`${this.baseUrl}/api/result/${jobId}`);
    const data = await response.json();

    if (!data.success) {
      throw new Error(data.error);
    }

    return data.result;
  }

  async parseFile(file, onProgress, delimiter = null) {
    const { jobId, totalRecords } = await this.uploadAndParse(file, delimiter);
    console.log(`Parsing ${totalRecords} records...`);
    return await this.pollUntilComplete(jobId, onProgress);
  }
}

// Usage
const client = new CSVParserClient();

const fileInput = document.getElementById('file-input');
const file = fileInput.files[0];

try {
  const result = await client.parseFile(file, (job) => {
    console.log(`Status: ${job.status}`);
    console.log(`Progress: ${job.progress}%`);
    console.log(`Records: ${job.current}/${job.total}`);
    console.log(`Format: ${job.format} (delimiter: ${job.delimiter})`);
  });

  console.log('Parsing complete!');
  console.log('Total records:', result.count);
  console.log('Format:', result.format);
  console.log('Sample data:', result.sample);
  console.log('Batch ID:', result.batchId);
} catch (error) {
  console.error('Parsing failed:', error);
}
```

---

## React Integration Example

```jsx
import { useState } from 'react';

function CSVUploader() {
  const [jobId, setJobId] = useState(null);
  const [status, setStatus] = useState(null);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [delimiter, setDelimiter] = useState('auto');

  const uploadFile = async (file) => {
    const formData = new FormData();
    formData.append('datafile', file);
    
    if (delimiter !== 'auto') {
      formData.append('delimiter', delimiter === 'comma' ? ',' : '\t');
    }

    try {
      const response = await fetch('http://localhost:3001/api/parse', {
        method: 'POST',
        body: formData
      });
      const data = await response.json();
      
      if (data.success) {
        setJobId(data.jobId);
        pollStatus(data.jobId);
      }
    } catch (err) {
      setError(err.message);
    }
  };

  const pollStatus = async (id) => {
    const response = await fetch(`http://localhost:3001/api/status/${id}`);
    const data = await response.json();

    if (data.success) {
      const job = data.job;
      setStatus(job.status);
      setProgress(job.progress);

      if (job.status === 'completed') {
        fetchResult(id);
      } else if (job.status === 'failed') {
        setError(job.error);
      } else {
        setTimeout(() => pollStatus(id), 2000);
      }
    }
  };

  const fetchResult = async (id) => {
    const response = await fetch(`http://localhost:3001/api/result/${id}`);
    const data = await response.json();

    if (data.success) {
      setResult(data.result);
    }
  };

  return (
    <div>
      <select value={delimiter} onChange={(e) => setDelimiter(e.target.value)}>
        <option value="auto">Auto-detect</option>
        <option value="comma">CSV (Comma)</option>
        <option value="tab">TSV (Tab)</option>
      </select>
      
      <input type="file" onChange={(e) => uploadFile(e.target.files[0])} />
      
      {status && <div>Status: {status}</div>}
      {progress > 0 && <div>Progress: {progress}%</div>}
      
      {result && (
        <div>
          <h3>Results</h3>
          <p>Total records: {result.count}</p>
          <p>Format: {result.format} (delimiter: {result.delimiter})</p>
          <pre>{JSON.stringify(result.sample, null, 2)}</pre>
        </div>
      )}
      
      {error && <div>Error: {error}</div>}
    </div>
  );
}
```

---

## Delimiter Options

### Auto-Detection (Default)
Don't send `delimiter` parameter - the parser analyzes file content:
```javascript
formData.append('datafile', file);
// No delimiter parameter = auto-detect
```

### Force Comma-Separated
```javascript
formData.append('datafile', file);
formData.append('delimiter', ',');
```

### Force Tab-Separated
```javascript
formData.append('datafile', file);
formData.append('delimiter', '\t');
```

---

## Important Notes

1. **Job Expiration**: Results are kept for 1 hour after completion
2. **File Size**: Maximum 1GB
3. **Polling**: Poll `/api/status/:jobId` every 1-2 seconds for progress
4. **Auto-Detection**: Works for most CSV/TSV files, but can be overridden
5. **CORS**: Configure CORS if frontend is on different domain
6. **Database**: If database is disabled (`USE_DATABASE=false`), parsing still works but no data is stored

---

## Error Handling

All endpoints return JSON with `success` field:
- `success: true` - Operation succeeded
- `success: false` - Operation failed, check `error` field

Common HTTP status codes:
- `200` - Success
- `400` - Bad request (job not completed, invalid parameters)
- `404` - Job not found or expired
- `500` - Server error

---

## Comparison with SSE Endpoint

This service also has a `/parse` endpoint (non-API) that uses Server-Sent Events for real-time progress. Choose based on your needs:

| Feature | `/api/parse` (REST) | `/parse` (SSE) |
|---------|---------------------|----------------|
| Integration | Simple polling | Event stream |
| Progress | Poll every 2s | Real-time push |
| Frontend | Any HTTP client | EventSource API |
| Use Case | External apps | Built-in web UI |

For most external integrations, the REST API (`/api/parse`) is recommended for simplicity.
