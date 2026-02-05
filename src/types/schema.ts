/**
 * Schema definitions for CSV/TSV parsing.
 * 
 * The schema defines how columns in CSV/TSV files map to object fields,
 * including type conversions and nested object structures.
 */

export type FieldType = 'string' | 'number' | 'boolean' | 'date' | 'json';

export interface ColumnSchema {
  /** The name of the column in the CSV/TSV header */
  columnName: string;
  /** The name of the field in the resulting object */
  fieldName: string;
  /** The type to convert the value to (default: 'string') */
  type?: FieldType;
  /** Whether this field is required (default: false) */
  required?: boolean;
  /** Default value if the field is empty or missing */
  defaultValue?: unknown;
  /** Custom transform function (applied after type conversion) */
  transform?: (value: unknown) => unknown;
}

export interface NestedFieldSchema {
  /** The name of the nested object field */
  fieldName: string;
  /** Column schemas for fields within the nested object */
  columns: ColumnSchema[];
}

export interface FileSchema {
  /** Name identifier for this schema */
  name: string;
  /** Column definitions for flat fields */
  columns: ColumnSchema[];
  /** Optional nested object definitions */
  nestedFields?: NestedFieldSchema[];
  /** Whether the first row contains headers (default: true) */
  hasHeaders?: boolean;
  /** Custom column names if headers are not in the file */
  customHeaders?: string[];
}

export interface ParseOptions {
  /** Delimiter character (auto-detected if not specified) */
  delimiter?: ',' | '\t' | string;
  /** Quote character for enclosed fields (default: '"') */
  quote?: string;
  /** Escape character (default: '"') */
  escape?: string;
  /** Skip empty lines (default: true) */
  skipEmptyLines?: boolean;
  /** Trim whitespace from values (default: true) */
  trim?: boolean;
  /** Maximum number of records to parse (default: unlimited) */
  maxRecords?: number;
}

export interface ParsedResult<T = Record<string, unknown>> {
  records: T[];
  totalCount: number;
  errors: ParseError[];
}

export interface ParseError {
  line: number;
  column?: string;
  message: string;
  rawValue?: string;
}
