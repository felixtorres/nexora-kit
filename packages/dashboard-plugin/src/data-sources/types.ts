/**
 * Data source types for the dashboard plugin.
 *
 * DataAdapter is the unified interface that all downstream code operates on —
 * agnostic to whether data comes from a built-in SQL connection or a tool-backed adapter.
 */

// --- Data Adapter Interface (unified) ---

export interface DataAdapter {
  readonly id: string;
  readonly type: 'built-in' | 'tool';
  introspectSchema(): Promise<DataSourceSchema>;
  execute(query: string, params?: Record<string, unknown>): Promise<TabularResult>;
  getSampleData(table: string, limit?: number): Promise<TabularResult>;
  close(): Promise<void>;
}

export interface TabularResult {
  columns: ColumnInfo[];
  rows: Record<string, unknown>[];
  rowCount: number;
  truncated: boolean;
}

export interface ColumnInfo {
  key: string;
  label: string;
  type: ColumnType;
}

export type ColumnType = 'string' | 'number' | 'boolean' | 'date' | 'unknown';

// --- Data Source Schema ---

export interface DataSourceSchema {
  tables: TableSchema[];
  dialect?: string;
}

export interface TableSchema {
  name: string;
  columns: ColumnSchema[];
  rowCountEstimate?: number;
}

export interface ColumnSchema {
  name: string;
  type: string;
  nullable: boolean;
  isPrimaryKey?: boolean;
  stats?: ColumnStats;
}

export interface ColumnStats {
  distinctCount?: number;
  min?: unknown;
  max?: unknown;
  sampleValues?: unknown[];
}

// --- Data Source Configuration ---

export interface DataSourceConfig {
  id: string;
  name: string;
  type: DataSourceType;
  config: SqlConfig | ToolConfig | CsvConfig | RestConfig;
  constraints: QueryConstraints;
}

export type DataSourceType = 'sql' | 'tool' | 'csv' | 'rest';

export interface SqlConfig {
  type: 'sql';
  dialect: SqlDialect;
  connectionString: string;
  readOnly?: boolean;
}

export type SqlDialect = 'postgresql' | 'mysql' | 'sqlite';

export interface ToolConfig {
  type: 'tool';
  queryTool: string;
  schemaTool?: string;
  resultFormat: string;
}

export interface CsvConfig {
  type: 'csv';
  content: string;
  tableName?: string;
}

export interface RestConfig {
  type: 'rest';
  baseUrl: string;
  auth?: { type: 'bearer' | 'api-key'; token: string; header?: string };
  endpoints: RestEndpoint[];
  defaultHeaders?: Record<string, string>;
}

export interface RestEndpoint {
  name: string;
  path: string;
  method?: 'GET' | 'POST';
  body?: Record<string, unknown>;
  resultPath?: string;
  columns?: ColumnInfo[];
}

export interface QueryConstraints {
  maxRows: number;
  timeoutMs: number;
  allowedTables?: string[];
  blockedColumns?: string[];
}

export const DEFAULT_CONSTRAINTS: QueryConstraints = {
  maxRows: 10_000,
  timeoutMs: 30_000,
};
