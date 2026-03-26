/**
 * Built-in SQL data adapter.
 * Manages database connections, schema introspection, and query execution.
 * Currently supports PostgreSQL. MySQL and SQLite adapters follow the same interface.
 */

import pg from 'pg';
import type {
  DataAdapter,
  TabularResult,
  DataSourceSchema,
  TableSchema,
  ColumnSchema,
  ColumnStats,
  ColumnInfo,
  ColumnType,
  SqlConfig,
  QueryConstraints,
} from './types.js';

const PG_TYPE_MAP: Record<string, ColumnType> = {
  int2: 'number', int4: 'number', int8: 'number',
  float4: 'number', float8: 'number', numeric: 'number',
  bool: 'boolean',
  date: 'date', timestamp: 'date', timestamptz: 'date',
  text: 'string', varchar: 'string', char: 'string', bpchar: 'string',
  uuid: 'string', json: 'string', jsonb: 'string',
};

function mapPgType(pgType: string): ColumnType {
  return PG_TYPE_MAP[pgType] ?? 'unknown';
}

export class SqlAdapter implements DataAdapter {
  readonly id: string;
  readonly type = 'built-in' as const;
  private pool: pg.Pool;
  private schemaCache: DataSourceSchema | null = null;
  private schemaCacheTime = 0;
  private readonly schemaCacheTtlMs = 5 * 60 * 1000; // 5 minutes
  private readonly constraints: QueryConstraints;

  constructor(id: string, config: SqlConfig, constraints: QueryConstraints) {
    this.id = id;
    this.constraints = constraints;

    if (config.dialect !== 'postgresql') {
      throw new Error(`Unsupported SQL dialect: ${config.dialect}. Only PostgreSQL is supported in Phase 1.`);
    }

    this.pool = new pg.Pool({
      connectionString: config.connectionString,
      max: 5,
      idleTimeoutMillis: 30_000,
    });
  }

  async introspectSchema(): Promise<DataSourceSchema> {
    if (this.schemaCache && Date.now() - this.schemaCacheTime < this.schemaCacheTtlMs) {
      return this.schemaCache;
    }

    const client = await this.pool.connect();
    try {
      // Get all tables in public schema
      const tablesResult = await client.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
         ORDER BY table_name`,
      );

      const tables: TableSchema[] = [];
      for (const row of tablesResult.rows) {
        const tableName = row.table_name;

        // Filter by allowedTables if set
        if (this.constraints.allowedTables && !this.constraints.allowedTables.includes(tableName)) {
          continue;
        }

        // Get columns
        const columnsResult = await client.query<{
          column_name: string;
          udt_name: string;
          is_nullable: string;
        }>(
          `SELECT column_name, udt_name, is_nullable
           FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = $1
           ORDER BY ordinal_position`,
          [tableName],
        );

        // Get primary key columns
        const pkResult = await client.query<{ column_name: string }>(
          `SELECT a.attname AS column_name
           FROM pg_index i
           JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
           WHERE i.indrelid = $1::regclass AND i.indisprimary`,
          [tableName],
        );
        const pkColumns = new Set(pkResult.rows.map((r) => r.column_name));

        const columns: ColumnSchema[] = [];
        for (const col of columnsResult.rows) {
          // Filter blocked columns
          if (this.constraints.blockedColumns?.includes(col.column_name)) {
            continue;
          }

          columns.push({
            name: col.column_name,
            type: col.udt_name,
            nullable: col.is_nullable === 'YES',
            isPrimaryKey: pkColumns.has(col.column_name),
          });
        }

        // Get row count estimate
        const countResult = await client.query<{ estimate: string }>(
          `SELECT reltuples::bigint AS estimate
           FROM pg_class WHERE relname = $1`,
          [tableName],
        );
        const rowCountEstimate = countResult.rows[0]
          ? parseInt(countResult.rows[0].estimate, 10)
          : undefined;

        tables.push({ name: tableName, columns, rowCountEstimate });
      }

      this.schemaCache = { tables, dialect: 'postgresql' };
      this.schemaCacheTime = Date.now();
      return this.schemaCache;
    } finally {
      client.release();
    }
  }

  async getSampleData(table: string, limit = 5): Promise<TabularResult> {
    this.validateTableAccess(table);

    const schema = await this.introspectSchema();
    const tableSchema = schema.tables.find((t) => t.name === table);
    if (!tableSchema) {
      throw new Error(`Table '${table}' not found`);
    }

    // Only select non-blocked columns
    const columnNames = tableSchema.columns.map((c) => `"${c.name}"`).join(', ');
    const result = await this.pool.query(
      `SELECT ${columnNames} FROM "${table}" LIMIT $1`,
      [limit],
    );

    return {
      columns: tableSchema.columns.map((c) => ({
        key: c.name,
        label: c.name,
        type: mapPgType(c.type),
      })),
      rows: result.rows,
      rowCount: result.rows.length,
      truncated: false,
    };
  }

  async getColumnStats(table: string): Promise<Map<string, ColumnStats>> {
    this.validateTableAccess(table);

    const schema = await this.introspectSchema();
    const tableSchema = schema.tables.find((t) => t.name === table);
    if (!tableSchema) {
      throw new Error(`Table '${table}' not found`);
    }

    const stats = new Map<string, ColumnStats>();
    const client = await this.pool.connect();
    try {
      for (const col of tableSchema.columns) {
        const colName = `"${col.name}"`;
        const pgType = mapPgType(col.type);

        const statResult = await client.query(
          `SELECT
             COUNT(DISTINCT ${colName}) AS distinct_count,
             MIN(${colName}::text) AS min_val,
             MAX(${colName}::text) AS max_val
           FROM "${table}"`,
        );
        const row = statResult.rows[0];

        const stat: ColumnStats = {
          distinctCount: parseInt(row.distinct_count, 10),
        };

        if (pgType === 'number' || pgType === 'date') {
          stat.min = row.min_val;
          stat.max = row.max_val;
        }

        // Sample values for categorical columns (low cardinality)
        if (stat.distinctCount !== undefined && stat.distinctCount <= 50 && pgType === 'string') {
          const sampleResult = await client.query(
            `SELECT DISTINCT ${colName} AS val FROM "${table}"
             WHERE ${colName} IS NOT NULL
             ORDER BY ${colName} LIMIT 10`,
          );
          stat.sampleValues = sampleResult.rows.map((r) => r.val);
        }

        stats.set(col.name, stat);
      }
    } finally {
      client.release();
    }

    return stats;
  }

  async execute(query: string, params?: Record<string, unknown>): Promise<TabularResult> {
    // Wrap query with row limit safety net
    const limitedQuery = `SELECT * FROM (${query}) AS __q LIMIT $1`;
    const maxRows = this.constraints.maxRows;

    const client = await this.pool.connect();
    try {
      // Set statement timeout
      await client.query(`SET statement_timeout = ${this.constraints.timeoutMs}`);

      // Set read-only transaction
      await client.query('SET TRANSACTION READ ONLY');

      // Execute with parameterized values
      const paramValues = params ? Object.values(params) : [];
      const result = await client.query(limitedQuery, [maxRows, ...paramValues]);

      const columns: ColumnInfo[] = result.fields.map((f) => ({
        key: f.name,
        label: f.name,
        type: mapPgType(f.dataTypeID?.toString() ?? '') ?? 'unknown',
      }));

      return {
        columns,
        rows: result.rows,
        rowCount: result.rows.length,
        truncated: result.rows.length >= maxRows,
      };
    } finally {
      // Reset statement timeout
      await client.query('RESET statement_timeout').catch(() => {});
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  private validateTableAccess(table: string): void {
    if (this.constraints.allowedTables && !this.constraints.allowedTables.includes(table)) {
      throw new Error(`Access denied: table '${table}' is not in the allowed tables list`);
    }
  }
}
