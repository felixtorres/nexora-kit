import { readdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ToolDefinition, Logger } from '@nexora-kit/core';
import type { ToolHandler } from '@nexora-kit/core';
import { wrapWithErrorBoundary } from './error-boundary.js';
import { wrapWithTimeout, getTimeoutForTier } from './timeout.js';
import { toolExtensionSchema, TOOLS_NAMESPACE, type ToolExtension } from './tool-extension-types.js';

export interface ToolExtensionLoaderOptions {
  toolDispatcher: {
    register(def: ToolDefinition, handler: ToolHandler, meta?: { namespace?: string }): void;
    unregister(name: string): void;
    hasHandler(name: string): boolean;
  };
  toolIndex?: {
    register(tool: ToolDefinition, namespace: string): void;
    unregister(toolName: string): void;
  };
  logger?: Logger;
  defaultNamespace?: string;
  defaultSandboxTier?: 'none' | 'basic' | 'strict';
}

export interface LoadedToolExtension {
  name: string;
  filePath: string;
  namespace: string;
}

export class ToolExtensionLoader {
  private loaded = new Map<string, LoadedToolExtension>();
  private fileToTools = new Map<string, string[]>();
  private readonly dispatcher: ToolExtensionLoaderOptions['toolDispatcher'];
  private readonly toolIndex?: ToolExtensionLoaderOptions['toolIndex'];
  private readonly logger?: Logger;
  private readonly defaultNamespace: string;
  private readonly defaultSandboxTier: 'none' | 'basic' | 'strict';

  constructor(options: ToolExtensionLoaderOptions) {
    this.dispatcher = options.toolDispatcher;
    this.toolIndex = options.toolIndex;
    this.logger = options.logger;
    this.defaultNamespace = options.defaultNamespace ?? TOOLS_NAMESPACE;
    this.defaultSandboxTier = options.defaultSandboxTier ?? 'basic';
  }

  async loadDirectory(dir: string): Promise<{ loaded: LoadedToolExtension[]; errors: string[] }> {
    const loaded: LoadedToolExtension[] = [];
    const errors: string[] = [];

    let entries: string[];
    try {
      const dirEntries = await readdir(dir);
      entries = dirEntries.filter((f) => {
        const ext = extname(f);
        return ext === '.ts' || ext === '.js' || ext === '.mjs';
      });
    } catch {
      return { loaded, errors };
    }

    for (const entry of entries) {
      const filePath = resolve(dir, entry);
      try {
        const result = await this.loadFile(filePath);
        loaded.push(result);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${entry}: ${msg}`);
        this.logger?.error('tool_extension.load_error', { file: entry, err: msg });
      }
    }

    return { loaded, errors };
  }

  async loadFile(filePath: string): Promise<LoadedToolExtension> {
    // Dynamic import with cache busting for reloads
    const url = pathToFileURL(filePath).href + `?t=${Date.now()}`;
    const mod = await import(url) as { default?: unknown };

    if (!mod.default) {
      throw new Error('No default export found');
    }

    const parsed = toolExtensionSchema.safeParse(mod.default);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      throw new Error(`Invalid tool extension: ${issues}`);
    }

    const ext = mod.default as ToolExtension;
    const namespace = ext.namespace ?? this.defaultNamespace;
    const toolName = ext.name;

    // Check for duplicates
    if (this.loaded.has(toolName)) {
      const existing = this.loaded.get(toolName)!;
      throw new Error(`Tool '${toolName}' already loaded from ${existing.filePath}`);
    }
    if (this.dispatcher.hasHandler(toolName)) {
      throw new Error(`Tool '${toolName}' conflicts with an existing tool (plugin or built-in)`);
    }

    // Resolve timeout
    const tier = ext.sandbox?.tier ?? this.defaultSandboxTier;
    const timeoutMs = getTimeoutForTier(tier, ext.sandbox?.timeoutMs);

    // Wrap handler: timeout → error boundary
    const timedHandler = wrapWithTimeout(toolName, ext.handler, timeoutMs);
    const wrappedHandler = wrapWithErrorBoundary(toolName, timedHandler, {
      maxConsecutiveFailures: 5,
      onDisable: (name, errMsg) => {
        this.logger?.error('tool_extension.disabled', { tool: name, err: errMsg });
      },
    });

    // Build tool definition
    const definition: ToolDefinition = {
      name: toolName,
      description: ext.description,
      parameters: ext.parameters,
    };

    // Register
    this.dispatcher.register(definition, wrappedHandler, { namespace });
    this.toolIndex?.register(definition, namespace);

    const info: LoadedToolExtension = { name: toolName, filePath, namespace };
    this.loaded.set(toolName, info);

    const existing = this.fileToTools.get(filePath) ?? [];
    existing.push(toolName);
    this.fileToTools.set(filePath, existing);

    this.logger?.info('tool_extension.loaded', { tool: toolName, namespace, file: filePath });
    return info;
  }

  unloadFile(filePath: string): void {
    const tools = this.fileToTools.get(filePath);
    if (!tools) return;

    for (const name of tools) {
      this.dispatcher.unregister(name);
      this.toolIndex?.unregister(name);
      this.loaded.delete(name);
    }
    this.fileToTools.delete(filePath);
  }

  async reloadFile(filePath: string): Promise<LoadedToolExtension> {
    this.unloadFile(filePath);
    return this.loadFile(filePath);
  }

  unloadAll(): void {
    for (const filePath of [...this.fileToTools.keys()]) {
      this.unloadFile(filePath);
    }
  }

  list(): LoadedToolExtension[] {
    return [...this.loaded.values()];
  }
}
