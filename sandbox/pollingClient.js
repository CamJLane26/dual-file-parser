/**
 * Dual File Parser - Frontend Polling Client
 * 
 * Drop this into any frontend to upload CSV/TSV/TXT files and track progress.
 * Works with the /api/* endpoints on the dual-file-parser service.
 * 
 * Usage:
 *   const client = new CSVParserClient('http://localhost:3001');
 *   const result = await client.parseFile(file, (job) => {
 *     console.log(`${job.progress}% - ${job.current}/${job.total}`);
 *   });
 * 
 *   // Force a delimiter instead of auto-detect:
 *   const result = await client.parseFile(file, onProgress, { delimiter: '\t' });
 * 
 *   // Pass uploader metadata (name, email, or any custom meta_ fields):
 *   const result = await client.parseFile(file, onProgress, {
 *     name: 'Jane Doe',
 *     email: 'jane@example.com',
 *     meta_department: 'Engineering',
 *   });
 */

class CSVParserClient {
  constructor(baseUrl = 'http://localhost:3001') {
    this.baseUrl = baseUrl;
    this.pollInterval = 2000; // ms between status checks
  }

  /**
   * Upload a CSV/TSV/TXT file and return the job ID + total records
   * @param {File} file
   * @param {object} options
   * @param {string} [options.delimiter] - ',' or '\t'. Omit for auto-detect.
   * @param {string} [options.name]      - Uploader's name (stored with records).
   * @param {string} [options.email]     - Uploader's email (stored with records).
   * Additional fields prefixed with meta_ are also passed through.
   */
  async upload(file, options = {}) {
    const formData = new FormData();
    formData.append('datafile', file);

    // Append all options as form fields
    for (const [key, value] of Object.entries(options)) {
      if (value != null) formData.append(key, value);
    }

    const res = await fetch(`${this.baseUrl}/api/parse`, {
      method: 'POST',
      body: formData,
    });

    if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
    const data = await res.json();
    if (!data.success) throw new Error('Upload rejected');

    return { jobId: data.jobId, totalRecords: data.totalRecords, metadata: data.metadata };
  }

  /**
   * Poll job status until complete or failed
   * @param {string} jobId
   * @param {function} onProgress - Called with job object on each poll
   * @returns {object} Final job object with batchId
   */
  async poll(jobId, onProgress) {
    while (true) {
      const res = await fetch(`${this.baseUrl}/api/status/${jobId}`);
      const data = await res.json();

      if (!data.success) throw new Error(data.error);

      const job = data.job;
      if (onProgress) onProgress(job);

      if (job.status === 'completed') return job;
      if (job.status === 'failed') throw new Error(job.error);

      await new Promise((r) => setTimeout(r, this.pollInterval));
    }
  }

  /**
   * Upload file, poll until complete, return final job
   * @param {File} file
   * @param {function} onProgress
   * @param {object} options - { delimiter, name, email, meta_* }
   */
  async parseFile(file, onProgress, options = {}) {
    const { jobId } = await this.upload(file, options);
    return await this.poll(jobId, onProgress);
  }
}

// ---------------------------------------------------------------------------
// Example: Vanilla JS with a progress bar + metadata
// ---------------------------------------------------------------------------
//
// <input type="file" id="file" accept=".csv,.txt" />
// <select id="delimiter">
//   <option value="">Auto-detect</option>
//   <option value=",">CSV (Comma)</option>
//   <option value="&#9;">TSV (Tab)</option>
// </select>
// <input type="text" id="name" placeholder="Your name" />
// <input type="email" id="email" placeholder="Your email" />
// <button id="upload">Upload</button>
// <div id="bar" style="width:0%; height:20px; background:#3498db;"></div>
// <p id="label"></p>
//
// <script src="pollingClient.js"></script>
// <script>
//   const client = new CSVParserClient('http://localhost:3001');
//
//   document.getElementById('upload').onclick = async () => {
//     const file = document.getElementById('file').files[0];
//     if (!file) return;
//
//     try {
//       const job = await client.parseFile(file, (j) => {
//         document.getElementById('bar').style.width = j.progress + '%';
//         document.getElementById('label').textContent =
//           `${j.status} — ${j.current ?? 0} / ${j.total ?? '?'} records (${j.progress}%)`;
//       }, {
//         delimiter: document.getElementById('delimiter').value || undefined,
//         name:      document.getElementById('name').value || undefined,
//         email:     document.getElementById('email').value || undefined,
//       });
//
//       document.getElementById('label').textContent =
//         `Done! Batch ID: ${job.result?.batchId ?? job.id}`;
//     } catch (err) {
//       document.getElementById('label').textContent = 'Error: ' + err.message;
//     }
//   };
// </script>
// ---------------------------------------------------------------------------

// Export for module environments (Node, bundlers)
if (typeof module !== 'undefined') {
  module.exports = { CSVParserClient };
}
