import { parse, Parser } from 'csv-parse';
import { Readable } from 'stream';
import * as fs from 'fs';
import {
  FileSchema,
  ColumnSchema,
  NestedFieldSchema,
  ParseOptions,
  ParseError,
  FieldType,
} from '../types/schema';
import {
  ParsedObject,
  DetectedFormat,
  FileFormat,
  RecordCallback,
  ParserError,
} from '../types/csv';

/**
 * Detect the format of a file based on extension and content sample.
 * Supports .csv files and .txt files (which can be either comma or tab-separated).
 * The delimiter is auto-detected by analyzing the file content.
 */
export function detectFileFormat(filePath: string): DetectedFormat {
  const extension = filePath.toLowerCase().split('.').pop() || '';
  let format: FileFormat = 'csv';
  let delimiter = ',';
  let confidence = 0.5;

  // Determine initial format from extension
  if (extension === 'csv') {
    format = 'csv';
    delimiter = ',';
    confidence = 0.7; // Start with moderate confidence, content analysis will adjust
  } else if (extension === 'txt') {
    // For txt files, we need to analyze the content to determine delimiter
    format = 'txt';
    confidence = 0.5;
  }

  // Sample the file to detect delimiter (works for both .csv and .txt)
  try {
    const sample = fs.readFileSync(filePath, { encoding: 'utf-8' }).slice(0, 4096);
    const lines = sample.split('\n').slice(0, 5);

    if (lines.length > 0) {
      const firstLine = lines[0];
      const tabCount = (firstLine.match(/\t/g) || []).length;
      const commaCount = (firstLine.match(/,/g) || []).length;

      // Determine delimiter based on content analysis
      if (tabCount > 0 && tabCount >= commaCount) {
        // Tab-separated (common in .txt exports)
        delimiter = '\t';
        confidence = Math.min(0.95, 0.7 + (tabCount / 10) * 0.25);
      } else if (commaCount > 0) {
        // Comma-separated
        delimiter = ',';
        confidence = Math.min(0.95, 0.7 + (commaCount / 10) * 0.25);
      }
    }

    // Try to detect headers
    const sampleHeaders = lines[0]?.split(delimiter).map(h => h.trim().replace(/^["']|["']$/g, ''));

    return {
      format,
      delimiter,
      hasHeaders: true, // Assume headers by default
      sampleHeaders,
      confidence,
    };
  } catch (error) {
    // If we can't read the file, return defaults
    return {
      format,
      delimiter,
      hasHeaders: true,
      confidence: 0.5,
    };
  }
}

/**
 * Count the number of records in a file (excluding header)
 */
export async function countRecords(filePath: string, delimiter: string = ','): Promise<number> {
  return new Promise((resolve, reject) => {
    let count = 0;
    let isFirstLine = true;

    const parser = parse({
      delimiter,
      relax_column_count: true,
      skip_empty_lines: true,
    });

    const stream = fs.createReadStream(filePath);

    parser.on('readable', () => {
      let record;
      while ((record = parser.read()) !== null) {
        if (isFirstLine) {
          isFirstLine = false;
          continue; // Skip header
        }
        count++;
      }
    });

    parser.on('error', reject);
    parser.on('end', () => resolve(count));

    stream.pipe(parser);
  });
}

/**
 * Convert a raw string value to the specified type
 */
function convertValue(value: string, type: FieldType = 'string', defaultValue?: unknown): unknown {
  const trimmed = value.trim();

  if (trimmed === '' || trimmed === null || trimmed === undefined) {
    return defaultValue ?? null;
  }

  switch (type) {
    case 'string':
      return trimmed;

    case 'number': {
      const num = parseFloat(trimmed.replace(/,/g, ''));
      return isNaN(num) ? (defaultValue ?? null) : num;
    }

    case 'boolean': {
      const lower = trimmed.toLowerCase();
      if (['true', 'yes', '1', 'y', 't'].includes(lower)) return true;
      if (['false', 'no', '0', 'n', 'f'].includes(lower)) return false;
      return defaultValue ?? null;
    }

    case 'date': {
      const date = new Date(trimmed);
      return isNaN(date.getTime()) ? (defaultValue ?? null) : date;
    }

    case 'json': {
      try {
        return JSON.parse(trimmed);
      } catch {
        return defaultValue ?? null;
      }
    }

    default:
      return trimmed;
  }
}

/**
 * Transform a raw row array into a typed object based on schema
 */
function transformRow(
  row: string[],
  headerMap: Map<string, number>,
  schema: FileSchema
): { record: ParsedObject; errors: ParserError[] } {
  const record: ParsedObject = {};
  const errors: ParserError[] = [];

  // Process flat columns
  for (const column of schema.columns) {
    const index = headerMap.get(column.columnName.toLowerCase());

    if (index === undefined) {
      if (column.required) {
        errors.push({
          line: 0, // Will be set by caller
          column: column.columnName,
          message: `Required column "${column.columnName}" not found`,
          recoverable: true,
        });
      }
      if (column.defaultValue !== undefined) {
        record[column.fieldName] = column.defaultValue as string | number | boolean | Date | null | ParsedObject;
      }
      continue;
    }

    const rawValue = row[index] || '';
    let value = convertValue(rawValue, column.type, column.defaultValue);

    // Apply custom transform if provided
    if (column.transform && value !== null) {
      try {
        value = column.transform(value);
      } catch (err) {
        errors.push({
          line: 0,
          column: column.columnName,
          message: `Transform error: ${err instanceof Error ? err.message : 'Unknown error'}`,
          rawValue,
          recoverable: true,
        });
      }
    }

    if (value !== null) {
      record[column.fieldName] = value as string | number | boolean | Date | ParsedObject;
    }
  }

  // Process nested fields
  if (schema.nestedFields) {
    for (const nested of schema.nestedFields) {
      const nestedObj: ParsedObject = {};
      let hasValue = false;

      for (const column of nested.columns) {
        const index = headerMap.get(column.columnName.toLowerCase());

        if (index === undefined) {
          if (column.defaultValue !== undefined) {
            nestedObj[column.fieldName] = column.defaultValue as string | number | boolean | Date | null | ParsedObject;
            hasValue = true;
          }
          continue;
        }

        const rawValue = row[index] || '';
        let value = convertValue(rawValue, column.type, column.defaultValue);

        if (column.transform && value !== null) {
          try {
            value = column.transform(value);
          } catch (err) {
            errors.push({
              line: 0,
              column: column.columnName,
              message: `Transform error in nested field: ${err instanceof Error ? err.message : 'Unknown error'}`,
              rawValue,
              recoverable: true,
            });
          }
        }

        if (value !== null) {
          nestedObj[column.fieldName] = value as string | number | boolean | Date | ParsedObject;
          hasValue = true;
        }
      }

      if (hasValue) {
        record[nested.fieldName] = nestedObj;
      }
    }
  }

  return { record, errors };
}

/**
 * Parse CSV/TSV file stream with memory-efficient streaming for large files (100MB-1GB+).
 * Processes records one at a time with constant memory footprint.
 */
export function parseCSVStream(
  stream: Readable,
  schema: FileSchema,
  onRecord: RecordCallback,
  options: ParseOptions = {}
): Promise<void> {
  return new Promise((resolve, reject) => {
    const delimiter = options.delimiter || ',';
    const quote = options.quote || '"';
    const escape = options.escape || '"';
    const skipEmptyLines = options.skipEmptyLines !== false;
    const trim = options.trim !== false;
    const maxRecords = options.maxRecords;

    const parser = parse({
      delimiter,
      quote,
      escape,
      skip_empty_lines: skipEmptyLines,
      trim,
      relax_column_count: true,
      relax_quotes: true,
    });

    let headerMap: Map<string, number> | null = null;
    let lineNumber = 0;
    let recordCount = 0;
    let stopped = false;
    let processing = false;

    const processRows = async () => {
      if (processing) return; // Prevent concurrent handler invocations
      processing = true;

      try {
        let row: string[];
        while ((row = parser.read()) !== null) {
          if (stopped) return;

          lineNumber++;

          // First row is headers (if schema says so)
          if (schema.hasHeaders !== false && headerMap === null) {
            headerMap = new Map();
            row.forEach((header, index) => {
              headerMap!.set(header.toLowerCase().trim(), index);
            });
            continue;
          }

          // If no headers in file, use custom headers or column indices
          if (headerMap === null) {
            headerMap = new Map();
            if (schema.customHeaders) {
              schema.customHeaders.forEach((header, index) => {
                headerMap!.set(header.toLowerCase(), index);
              });
            } else {
              // Use column indices as headers
              row.forEach((_, index) => {
                headerMap!.set(index.toString(), index);
              });
            }
          }

          // Check max records
          if (maxRecords && recordCount >= maxRecords) {
            stopped = true;
            parser.end();
            return;
          }

          // Transform the row
          const { record, errors } = transformRow(row, headerMap, schema);

          // Set line numbers on errors
          errors.forEach(e => (e.line = lineNumber));

          // Skip empty records
          if (Object.keys(record).length === 0) {
            continue;
          }

          recordCount++;

          try {
            await onRecord(record, lineNumber);
          } catch (err) {
            // If callback throws, we continue parsing but log the error
            console.error(`[Parse] Error processing record at line ${lineNumber}:`, err);
          }
        }
      } finally {
        processing = false;
      }
    };

    parser.on('readable', processRows);

    stream.on('error', (err: Error) => {
      parser.emit('error', err);
    });

    parser.on('error', (err: Error) => {
      reject(err);
    });

    parser.on('end', () => {
      resolve();
    });

    stream.pipe(parser);
  });
}

/**
 * Parse entire CSV/TSV file into an array (use for small files only)
 */
export async function parseCSV(
  stream: Readable,
  schema: FileSchema,
  options: ParseOptions = {}
): Promise<{ records: ParsedObject[]; errors: ParserError[] }> {
  const records: ParsedObject[] = [];
  const allErrors: ParserError[] = [];

  await parseCSVStream(
    stream,
    schema,
    (record, lineNumber) => {
      records.push(record);
    },
    options
  );

  return { records, errors: allErrors };
}

/**
 * Create parser options based on detected file format
 */
export function createParseOptions(detected: DetectedFormat): ParseOptions {
  return {
    delimiter: detected.delimiter,
    skipEmptyLines: true,
    trim: true,
  };
}
