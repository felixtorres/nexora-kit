/**
 * REST API data adapter.
 * Fetches data from pre-configured HTTP endpoints.
 * Uses Node's built-in fetch (Node 20+).
 */

import type {
  DataAdapter,
  TabularResult,
  DataSourceSchema,
  TableSchema,
  ColumnInfo,
  ColumnType,
  RestConfig,
  RestEndpoint,
  QueryConstraints,
} from './types.js';

function inferType(value: unknown): ColumnType {
  if (value === null || value === undefined) return 'unknown';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'string') {
    if (/^\d{4}-\d{2}-\d{2}/.test(value)) return 'date';
  }
  return 'string';
}

function navigatePath(obj: unknown, path: string): unknown {
  const parts = path.split('.');
  let current = obj;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function substituteParams(template: string, params: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const val = params[key];
    return val !== undefined ? String(val) : '';
  });
}

export class RestAdapter implements DataAdapter {
  readonly id: string;
  readonly type = 'built-in' as const;
  private readonly config: RestConfig;
  private readonly constraints: QueryConstraints;
  private schemaCache: DataSourceSchema | null = null;

  constructor(id: string, config: RestConfig, constraints: QueryConstraints) {
    this.id = id;
    this.config = config;
    this.constraints = constraints;
  }

  async introspectSchema(): Promise<DataSourceSchema> {
    if (this.schemaCache) return this.schemaCache;

    const tables: TableSchema[] = [];
    for (const endpoint of this.config.endpoints) {
      const columns = endpoint.columns
        ? endpoint.columns.map((c) => ({
            name: c.key,
            type: c.type,
            nullable: true,
          }))
        : await this.inferColumnsFromResponse(endpoint);

      tables.push({ name: endpoint.name, columns });
    }

    this.schemaCache = { tables };
    return this.schemaCache;
  }

  async execute(query: string, params?: Record<string, unknown>): Promise<TabularResult> {
    const endpointName = this.parseEndpointName(query);
    const endpoint = this.config.endpoints.find((e) => e.name === endpointName);
    if (!endpoint) {
      throw new Error(`REST endpoint '${endpointName}' not found. Available: ${this.config.endpoints.map((e) => e.name).join(', ')}`);
    }

    const rows = await this.fetchEndpoint(endpoint, params ?? {});
    const limited = rows.slice(0, this.constraints.maxRows);
    const columns = this.deriveColumns(endpoint, limited);

    return {
      columns,
      rows: limited,
      rowCount: limited.length,
      truncated: rows.length > this.constraints.maxRows,
    };
  }

  async getSampleData(table: string, limit = 5): Promise<TabularResult> {
    const result = await this.execute(table);
    return {
      ...result,
      rows: result.rows.slice(0, limit),
      rowCount: Math.min(result.rowCount, limit),
      truncated: result.rowCount > limit,
    };
  }

  async close(): Promise<void> {
    // No-op — REST adapters don't hold connections
  }

  private async fetchEndpoint(
    endpoint: RestEndpoint,
    params: Record<string, unknown>,
  ): Promise<Record<string, unknown>[]> {
    const url = this.config.baseUrl + substituteParams(endpoint.path, params);
    const method = endpoint.method ?? 'GET';
    const headers: Record<string, string> = {
      'Accept': 'application/json',
      ...this.config.defaultHeaders,
    };

    // Auth
    if (this.config.auth) {
      const { type: authType, token, header } = this.config.auth;
      if (authType === 'bearer') {
        headers['Authorization'] = `Bearer ${token}`;
      } else if (authType === 'api-key') {
        headers[header ?? 'X-API-Key'] = token;
      }
    }

    const init: RequestInit = {
      method,
      headers,
      signal: AbortSignal.timeout(this.constraints.timeoutMs),
    };

    if (method === 'POST' && endpoint.body) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(
        substituteParams(JSON.stringify(endpoint.body), params),
      );
      // Re-parse since we stringified params
      try {
        init.body = JSON.stringify(JSON.parse(substituteParams(JSON.stringify(endpoint.body), params)));
      } catch {
        init.body = JSON.stringify(endpoint.body);
      }
    }

    const response = await fetch(url, init);
    if (!response.ok) {
      throw new Error(`REST endpoint '${endpoint.name}' returned ${response.status}: ${response.statusText}`);
    }

    const json = await response.json();
    let data = endpoint.resultPath ? navigatePath(json, endpoint.resultPath) : json;

    if (!Array.isArray(data)) {
      // Wrap single object in array
      if (data && typeof data === 'object') {
        data = [data];
      } else {
        throw new Error(`REST endpoint '${endpoint.name}' did not return an array or object`);
      }
    }

    return data as Record<string, unknown>[];
  }

  private deriveColumns(endpoint: RestEndpoint, rows: Record<string, unknown>[]): ColumnInfo[] {
    if (endpoint.columns) {
      return endpoint.columns;
    }
    if (rows.length === 0) return [];

    const firstRow = rows[0];
    return Object.keys(firstRow).map((key) => ({
      key,
      label: key,
      type: inferType(firstRow[key]),
    }));
  }

  private parseEndpointName(query: string): string {
    // Accept: "FROM endpoint_name", "SELECT * FROM endpoint_name", or just "endpoint_name"
    const fromMatch = query.match(/\bFROM\s+["']?(\w+)["']?/i);
    if (fromMatch) return fromMatch[1];
    return query.trim().split(/\s/)[0];
  }

  private async inferColumnsFromResponse(endpoint: RestEndpoint) {
    try {
      const rows = await this.fetchEndpoint(endpoint, {});
      if (rows.length === 0) return [];
      const first = rows[0];
      return Object.keys(first).map((key) => ({
        name: key,
        type: String(inferType(first[key])),
        nullable: true,
      }));
    } catch {
      return [];
    }
  }
}
