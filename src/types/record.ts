/**
 * Generic record type for parsed CSV/TSV data.
 * 
 * Define your specific record types by extending or implementing this interface.
 * The schema configuration should match your record type structure.
 */

export type ParsedValue = string | number | boolean | Date | null | ParsedObject | ParsedValue[];

export interface ParsedObject {
  [key: string]: ParsedValue;
}

/**
 * Base record interface - extend this for your specific data types
 */
export interface BaseRecord {
  [key: string]: unknown;
}

/**
 * Example record type - customize based on your data structure.
 * This mirrors the structure you'd use for database insertion.
 */
export interface DataRecord extends BaseRecord {
  id?: string;
  name?: string;
  description?: string;
  category?: string;
  value?: number;
  isActive?: boolean;
  createdAt?: Date;
  metadata?: ParsedObject;
}
