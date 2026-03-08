import { describe, it, expect, beforeEach, vi } from 'vitest';
import { resolve } from 'node:path';
import { ToolExtensionLoader } from './tool-extension-loader.js';
import type { ToolDefinition } from '@nexora-kit/core';
import type { ToolHandler } from '@nexora-kit/core';

const FIXTURES_DIR = resolve(import.meta.dirname, '__fixtures__/tools');

function createMockDispatcher() {
  const tools = new Map<string, { def: ToolDefinition; handler: ToolHandler }>();
  return {
    register: vi.fn((def: ToolDefinition, handler: ToolHandler, _meta?: { namespace?: string }) => {
      tools.set(def.name, { def, handler });
    }),
    unregister: vi.fn((name: string) => {
      tools.delete(name);
    }),
    hasHandler: vi.fn((name: string) => tools.has(name)),
    tools,
  };
}

function createMockIndex() {
  const registered = new Map<string, string>();
  return {
    register: vi.fn((tool: ToolDefinition, namespace: string) => {
      registered.set(tool.name, namespace);
    }),
    unregister: vi.fn((name: string) => {
      registered.delete(name);
    }),
    registered,
  };
}

describe('ToolExtensionLoader', () => {
  let dispatcher: ReturnType<typeof createMockDispatcher>;
  let toolIndex: ReturnType<typeof createMockIndex>;
  let loader: ToolExtensionLoader;

  beforeEach(() => {
    dispatcher = createMockDispatcher();
    toolIndex = createMockIndex();
    loader = new ToolExtensionLoader({
      toolDispatcher: dispatcher,
      toolIndex,
    });
  });

  describe('loadFile', () => {
    it('loads a valid tool extension', async () => {
      const result = await loader.loadFile(resolve(FIXTURES_DIR, 'valid-tool.js'));

      expect(result.name).toBe('greet_user');
      expect(result.namespace).toBe('__tools__');
      expect(dispatcher.register).toHaveBeenCalledTimes(1);
      expect(toolIndex.register).toHaveBeenCalledTimes(1);
    });

    it('respects custom namespace', async () => {
      const result = await loader.loadFile(resolve(FIXTURES_DIR, 'custom-namespace.js'));

      expect(result.name).toBe('lookup_ticket');
      expect(result.namespace).toBe('my-team');
      expect(toolIndex.registered.get('lookup_ticket')).toBe('my-team');
    });

    it('rejects file with no default export', async () => {
      await expect(
        loader.loadFile(resolve(FIXTURES_DIR, 'no-export.js')),
      ).rejects.toThrow('No default export');
    });

    it('rejects file with invalid schema', async () => {
      await expect(
        loader.loadFile(resolve(FIXTURES_DIR, 'invalid-no-name.js')),
      ).rejects.toThrow('Invalid tool extension');
    });

    it('rejects duplicate tool names', async () => {
      await loader.loadFile(resolve(FIXTURES_DIR, 'valid-tool.js'));
      await expect(
        loader.loadFile(resolve(FIXTURES_DIR, 'valid-tool.js')),
      ).rejects.toThrow("Tool 'greet_user' already loaded");
    });

    it('rejects tools that conflict with existing handlers', async () => {
      dispatcher.hasHandler.mockReturnValueOnce(true);
      await expect(
        loader.loadFile(resolve(FIXTURES_DIR, 'valid-tool.js')),
      ).rejects.toThrow('conflicts with an existing tool');
    });
  });

  describe('loadDirectory', () => {
    it('loads valid files and reports errors for invalid ones', async () => {
      const result = await loader.loadDirectory(FIXTURES_DIR);

      // valid-tool.js + custom-namespace.js + throws-tool.js should load
      expect(result.loaded.length).toBeGreaterThanOrEqual(2);
      // invalid-no-name.js + no-export.js should error
      expect(result.errors.length).toBeGreaterThanOrEqual(1);
    });

    it('returns empty for nonexistent directory', async () => {
      const result = await loader.loadDirectory('/nonexistent/path');
      expect(result.loaded).toHaveLength(0);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('unloadFile', () => {
    it('unregisters tools from a file', async () => {
      const filePath = resolve(FIXTURES_DIR, 'valid-tool.js');
      await loader.loadFile(filePath);
      expect(dispatcher.tools.has('greet_user')).toBe(true);

      loader.unloadFile(filePath);
      expect(dispatcher.unregister).toHaveBeenCalledWith('greet_user');
      expect(toolIndex.unregister).toHaveBeenCalledWith('greet_user');
      expect(loader.list()).toHaveLength(0);
    });

    it('does nothing for unknown file', () => {
      loader.unloadFile('/unknown/file.js');
      expect(dispatcher.unregister).not.toHaveBeenCalled();
    });
  });

  describe('reloadFile', () => {
    it('unloads old and loads new', async () => {
      const filePath = resolve(FIXTURES_DIR, 'valid-tool.js');
      await loader.loadFile(filePath);

      // Reset mocks to track reload calls
      dispatcher.register.mockClear();
      dispatcher.unregister.mockClear();

      const result = await loader.reloadFile(filePath);
      expect(result.name).toBe('greet_user');
      expect(dispatcher.unregister).toHaveBeenCalledWith('greet_user');
      expect(dispatcher.register).toHaveBeenCalledTimes(1);
    });
  });

  describe('unloadAll', () => {
    it('removes all loaded tools', async () => {
      await loader.loadFile(resolve(FIXTURES_DIR, 'valid-tool.js'));
      await loader.loadFile(resolve(FIXTURES_DIR, 'custom-namespace.js'));
      expect(loader.list()).toHaveLength(2);

      loader.unloadAll();
      expect(loader.list()).toHaveLength(0);
      expect(dispatcher.unregister).toHaveBeenCalledTimes(2);
    });
  });

  describe('handler wrapping', () => {
    it('wraps handler with error boundary (disables after repeated failures)', async () => {
      await loader.loadFile(resolve(FIXTURES_DIR, 'throws-tool.js'));

      const registered = dispatcher.tools.get('always_fails');
      expect(registered).toBeDefined();

      // Error boundary rethrows individual errors but tracks consecutive failures
      for (let i = 0; i < 5; i++) {
        await expect(registered!.handler({})).rejects.toThrow('boom');
      }

      // After 5 failures, the tool is disabled — throws a different error
      await expect(registered!.handler({})).rejects.toThrow('disabled');
    });
  });

  describe('defaultNamespace override', () => {
    it('uses configured default namespace', async () => {
      const customLoader = new ToolExtensionLoader({
        toolDispatcher: dispatcher,
        toolIndex,
        defaultNamespace: 'my-org',
      });

      const result = await customLoader.loadFile(resolve(FIXTURES_DIR, 'valid-tool.js'));
      expect(result.namespace).toBe('my-org');
    });
  });
});
