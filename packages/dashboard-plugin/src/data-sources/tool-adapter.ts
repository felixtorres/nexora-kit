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
    if (!this.config.schemaTool && !this.config.schemaListTool) {
      throw new Error(
        `Data source '${this.id}' has no schemaTool or schemaListTool configured — schema introspection is not available`,
      );
    }

    // Two-step introspection: schemaListTool (list tables) → schemaTool (columns per table)
    if (this.config.schemaListTool) {
      return this.introspectTwoStep();
    }

    // Single-step: schemaTool returns complete schema
    return this.introspectSingleStep();
  }

  /**
   * Two-step: call schemaListTool to get table names, then schemaTool per table for columns.
   */
  private async introspectTwoStep(): Promise<DataSourceSchema> {
    // Step 1: list tables/models
    const listRaw = await this.dispatcher.invoke(
      this.config.schemaListTool!,
      {},
      this.namespace,
    );
    const listText = typeof listRaw === 'string' ? listRaw : listRaw.content;
    let listParsed: unknown;
    try {
      listParsed = JSON.parse(listText);
    } catch {
      throw new Error(
        `Schema list tool '${this.config.schemaListTool}' returned invalid JSON: ${listText.slice(0, 200)}`,
      );
    }

    // Extract table names from the response (array of strings, or array of {name, table_name, ...})
    const tableEntries = Array.isArray(listParsed) ? listParsed : [];
    const tableNames: { name: string; folder?: string }[] = tableEntries.map(
      (entry: unknown) => {
        if (typeof entry === 'string') return { name: entry };
        if (entry && typeof entry === 'object') {
          const obj = entry as Record<string, unknown>;
          return {
            name: (obj.table_name ?? obj.name ?? '') as string,
            folder: (obj.folder ?? obj.folder_name) as string | undefined,
          };
        }
        return { name: String(entry) };
      },
    );

    // If no schemaTool configured, return tables without columns
    if (!this.config.schemaTool) {
      return {
        tables: tableNames.map(({ name }) => ({ name, columns: [] })),
      };
    }

    // Step 2: get columns per table (parallel, best-effort)
    const tables = await Promise.all(
      tableNames.map(async ({ name, folder }) => {
        try {
          const params: Record<string, unknown> = { table_name: name };
          if (folder) params.folder_name = folder;
          const colRaw = await this.dispatcher.invoke(
            this.config.schemaTool!,
            params,
            this.namespace,
          );
          const colText = typeof colRaw === 'string' ? colRaw : colRaw.content;
          const colParsed = JSON.parse(colText);
          const columns = Array.isArray(colParsed)
            ? colParsed.map((c: Record<string, unknown>) => ({
                name: (c.column_name ?? c.name ?? '') as string,
                type: (c.data_type ?? c.type ?? 'unknown') as string,
                nullable: (c.nullable ?? true) as boolean,
              }))
            : [];
          return { name, columns } as DataSourceSchema['tables'][number];
        } catch {
          // Best-effort: return table with no columns if introspection fails
          return { name, columns: [] } as DataSourceSchema['tables'][number];
        }
      }),
    );

    return { tables };
  }

  /**
   * Single-step: schemaTool returns the complete schema (all tables + columns).
   */
  private async introspectSingleStep(): Promise<DataSourceSchema> {
    const raw = await this.dispatcher.invoke(
      this.config.schemaTool!,
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
