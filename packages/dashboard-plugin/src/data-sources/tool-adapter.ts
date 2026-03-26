/**
 * ToolBackedAdapter — DataAdapter backed by tool invocations.
 *
 * Delegates data operations to external tools via ToolDispatcher.invoke().
 * Result parsing is handled by the ResultParserRegistry based on the
 * configured resultFormat.
 */

import type { ToolDispatcher } from '@nexora-kit/core';
import type {
  DataAdapter,
  DataSourceSchema,
  TabularResult,
  ToolConfig,
} from './types.js';
import { parseToolResult } from './result-parsers.js';

export class ToolBackedAdapter implements DataAdapter {
  readonly id: string;
  readonly type = 'tool' as const;
  private readonly config: ToolConfig;
  private readonly dispatcher: ToolDispatcher;
  private readonly namespace: string;

  constructor(
    id: string,
    config: ToolConfig,
    dispatcher: ToolDispatcher,
    namespace: string,
  ) {
    this.id = id;
    this.config = config;
    this.dispatcher = dispatcher;
    this.namespace = namespace;
  }

  async introspectSchema(): Promise<DataSourceSchema> {
    if (!this.config.schemaTool) {
      throw new Error(
        `Data source '${this.id}' has no schemaTool configured — schema introspection is not available`,
      );
    }

    const raw = await this.dispatcher.invoke(
      this.config.schemaTool,
      {},
      this.namespace,
    );

    const text = typeof raw === 'string' ? raw : raw.content;

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(
        `Schema tool '${this.config.schemaTool}' returned invalid JSON: ${text.slice(0, 200)}`,
      );
    }

    // Accept either { tables: [...] } or a raw array of tables
    if (Array.isArray(parsed)) {
      return { tables: parsed as DataSourceSchema['tables'] };
    }

    const obj = parsed as Record<string, unknown>;
    if (Array.isArray(obj.tables)) {
      return {
        tables: obj.tables as DataSourceSchema['tables'],
        dialect: typeof obj.dialect === 'string' ? obj.dialect : undefined,
      };
    }

    throw new Error(
      `Schema tool '${this.config.schemaTool}' returned an unrecognised format — expected { tables: [...] } or [...]`,
    );
  }

  async execute(
    query: string,
    params?: Record<string, unknown>,
  ): Promise<TabularResult> {
    const raw = await this.dispatcher.invoke(
      this.config.queryTool,
      { query, params },
      this.namespace,
    );

    return parseToolResult(raw, this.config.resultFormat);
  }

  async getSampleData(table: string, limit = 5): Promise<TabularResult> {
    // Best-effort: send a conventional SQL-style query to the tool.
    // The tool is free to interpret it however makes sense.
    const query = `SELECT * FROM "${table}" LIMIT ${limit}`;
    return this.execute(query);
  }

  async close(): Promise<void> {
    // Tool adapters don't own connections — nothing to close.
  }
}
