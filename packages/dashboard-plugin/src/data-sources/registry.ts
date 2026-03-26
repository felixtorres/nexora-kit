/**
 * DataSourceRegistry — manages data source configurations and resolves adapters.
 *
 * Resolves the correct DataAdapter implementation based on config type.
 * All downstream code operates on DataAdapter — agnostic to source type.
 */

import type { ToolDispatcher } from '@nexora-kit/core';
import type {
  DataAdapter,
  DataSourceConfig,
  DataSourceSchema,
  TabularResult,
  QueryConstraints,
  SqlConfig,
  ToolConfig,
  CsvConfig,
  RestConfig,
} from './types.js';
import { DEFAULT_CONSTRAINTS } from './types.js';
import { SqlAdapter } from './sql-adapter.js';
import { ToolBackedAdapter } from './tool-adapter.js';
import { CsvAdapter } from './csv-adapter.js';
import { RestAdapter } from './rest-adapter.js';

export class DataSourceRegistry {
  private adapters = new Map<string, DataAdapter>();
  private configs = new Map<string, DataSourceConfig>();
  private dispatcher?: ToolDispatcher;
  private toolNamespace: string;

  constructor(dispatcher?: ToolDispatcher, toolNamespace = 'dashboard') {
    this.dispatcher = dispatcher;
    this.toolNamespace = toolNamespace;
  }

  async register(config: DataSourceConfig): Promise<void> {
    if (this.adapters.has(config.id)) {
      throw new Error(`Data source '${config.id}' is already registered`);
    }

    const constraints: QueryConstraints = {
      ...DEFAULT_CONSTRAINTS,
      ...config.constraints,
    };

    let adapter: DataAdapter;

    switch (config.config.type) {
      case 'sql':
        adapter = new SqlAdapter(config.id, config.config as SqlConfig, constraints);
        break;
      case 'tool': {
        if (!this.dispatcher) {
          throw new Error(
            'Cannot register tool-backed data source: no ToolDispatcher was provided to the registry',
          );
        }
        adapter = new ToolBackedAdapter(
          config.id,
          config.config as ToolConfig,
          this.dispatcher,
          this.toolNamespace,
        );
        break;
      }
      case 'csv': {
        const csvConfig = config.config as CsvConfig;
        adapter = new CsvAdapter(config.id, csvConfig.content, constraints, csvConfig.tableName);
        break;
      }
      case 'rest':
        adapter = new RestAdapter(config.id, config.config as RestConfig, constraints);
        break;
      default:
        throw new Error(`Unsupported data source type: ${(config.config as { type: string }).type}`);
    }

    // Validate connection by introspecting schema
    // Skip for tool-backed sources that have no schemaTool (validation would throw)
    if (config.config.type !== 'tool' || (config.config as ToolConfig).schemaTool) {
      await adapter.introspectSchema();
    }

    this.adapters.set(config.id, adapter);
    this.configs.set(config.id, config);
  }

  get(id: string): DataAdapter {
    const adapter = this.adapters.get(id);
    if (!adapter) {
      throw new Error(`Data source '${id}' not found`);
    }
    return adapter;
  }

  getConfig(id: string): DataSourceConfig {
    const config = this.configs.get(id);
    if (!config) {
      throw new Error(`Data source config '${id}' not found`);
    }
    return config;
  }

  list(): DataSourceConfig[] {
    return [...this.configs.values()];
  }

  has(id: string): boolean {
    return this.adapters.has(id);
  }

  async getSchema(id: string): Promise<DataSourceSchema> {
    return this.get(id).introspectSchema();
  }

  async getSampleData(id: string, table: string, limit?: number): Promise<TabularResult> {
    return this.get(id).getSampleData(table, limit);
  }

  async execute(id: string, query: string, params?: Record<string, unknown>): Promise<TabularResult> {
    return this.get(id).execute(query, params);
  }

  async closeAll(): Promise<void> {
    const closePromises = [...this.adapters.values()].map((a) => a.close());
    await Promise.all(closePromises);
    this.adapters.clear();
    this.configs.clear();
  }
}
