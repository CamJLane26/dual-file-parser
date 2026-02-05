import { FileSchema } from '../types/schema';

/**
 * Example schema configuration for parsing CSV/TSV files.
 * 
 * Customize this schema based on your actual data structure.
 * The column names should match the headers in your CSV/TSV files.
 */
export const defaultSchema: FileSchema = {
  name: 'default',
  hasHeaders: true,
  columns: [
    { columnName: 'id', fieldName: 'id', type: 'string' },
    { columnName: 'name', fieldName: 'name', type: 'string', required: true },
    { columnName: 'description', fieldName: 'description', type: 'string' },
    { columnName: 'category', fieldName: 'category', type: 'string' },
    { columnName: 'value', fieldName: 'value', type: 'number' },
    { columnName: 'price', fieldName: 'price', type: 'number' },
    { columnName: 'quantity', fieldName: 'quantity', type: 'number' },
    { columnName: 'is_active', fieldName: 'isActive', type: 'boolean', defaultValue: true },
    { columnName: 'active', fieldName: 'isActive', type: 'boolean', defaultValue: true },
    { columnName: 'created_at', fieldName: 'createdAt', type: 'date' },
    { columnName: 'created', fieldName: 'createdAt', type: 'date' },
    { columnName: 'updated_at', fieldName: 'updatedAt', type: 'date' },
    { columnName: 'updated', fieldName: 'updatedAt', type: 'date' },
    { columnName: 'email', fieldName: 'email', type: 'string' },
    { columnName: 'phone', fieldName: 'phone', type: 'string' },
    { columnName: 'address', fieldName: 'address', type: 'string' },
    { columnName: 'city', fieldName: 'city', type: 'string' },
    { columnName: 'state', fieldName: 'state', type: 'string' },
    { columnName: 'zip', fieldName: 'zip', type: 'string' },
    { columnName: 'country', fieldName: 'country', type: 'string' },
    { columnName: 'notes', fieldName: 'notes', type: 'string' },
    { columnName: 'tags', fieldName: 'tags', type: 'string' },
    { columnName: 'metadata', fieldName: 'metadata', type: 'json' },
  ],
  nestedFields: [
    {
      fieldName: 'location',
      columns: [
        { columnName: 'latitude', fieldName: 'lat', type: 'number' },
        { columnName: 'lat', fieldName: 'lat', type: 'number' },
        { columnName: 'longitude', fieldName: 'lng', type: 'number' },
        { columnName: 'lng', fieldName: 'lng', type: 'number' },
        { columnName: 'lon', fieldName: 'lng', type: 'number' },
      ],
    },
    {
      fieldName: 'contact',
      columns: [
        { columnName: 'contact_name', fieldName: 'name', type: 'string' },
        { columnName: 'contact_email', fieldName: 'email', type: 'string' },
        { columnName: 'contact_phone', fieldName: 'phone', type: 'string' },
      ],
    },
  ],
};

/**
 * Create a dynamic schema from detected headers.
 * This is useful when you don't know the structure ahead of time.
 */
export function createDynamicSchema(headers: string[]): FileSchema {
  const columns = headers.map(header => ({
    columnName: header,
    fieldName: header
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, ''),
    type: 'string' as const,
  }));

  return {
    name: 'dynamic',
    hasHeaders: true,
    columns,
  };
}

/**
 * Get schema by name or return default
 */
export function getSchemaByName(name?: string): FileSchema {
  // Add more schemas here as needed
  const schemas: Record<string, FileSchema> = {
    default: defaultSchema,
  };

  return schemas[name || 'default'] || defaultSchema;
}
