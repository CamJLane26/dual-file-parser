/**
 * CSV/TSV specific types for parsing operations.
 */

import { ParsedObject, ParsedValue } from './record';

export type FileFormat = 'csv' | 'txt';

export interface DetectedFormat {
  format: FileFormat;
  delimiter: string;
  hasHeaders: boolean;
  sampleHeaders?: string[];
  confidence: number;
}

export interface ParserState {
  currentLine: number;
  recordCount: number;
  errors: ParserError[];
  isComplete: boolean;
}

export interface ParserError {
  line: number;
  column?: string;
  message: string;
  rawValue?: string;
  recoverable: boolean;
}

export interface StreamParseResult {
  record: ParsedObject;
  lineNumber: number;
  rawRow: string[];
}

export interface BatchResult {
  recordCount: number;
  errors: ParserError[];
  batchId: string;
}

/**
 * Callback for streaming parse operations
 */
export type RecordCallback = (record: ParsedObject, lineNumber: number) => void | Promise<void>;

/**
 * Progress callback for tracking parse progress
 */
export type ProgressCallback = (current: number, total: number, percentage: number) => void;

/**
 * Error callback for handling parse errors
 */
export type ErrorCallback = (error: ParserError) => void;

export { ParsedObject, ParsedValue };
