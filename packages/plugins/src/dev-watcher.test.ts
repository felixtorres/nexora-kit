import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { PluginDevWatcher } from './dev-watcher.js';
import { PluginLifecycleManager } from './lifecycle.js';
import { loadPlugin } from './loader.js';
import type { ToolDispatcher } from '@nexora-kit/core';
import type { PermissionGate } from '@nexora-kit/sandbox';
import { ConfigResolver } from '@nexora-kit/config';

let tmpDir: string;

function createTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'nexora-watcher-'));
}

function writePluginYaml(dir: string, namespace: string, version = '1.0.0'): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'plugin.yaml'),
    `name: Test Plugin\nversion: "${version}"\nnamespace: ${namespace}\npermissions:\n  - llm:invoke\n`,
  );
}

function createLifecycle(): PluginLifecycleManager {
  const mockDispatcher = {
    register: vi.fn(),
    unregister: vi.fn(),
    listTools: () => [],
    hasHandler: () => false,
  } as unknown as ToolDispatcher;

  const mockGate = {
    grant: vi.fn(),
    clearAll: vi.fn(),
    check: () => true,
  } as unknown as PermissionGate;

  return new PluginLifecycleManager({
    permissionGate: mockGate,
    configResolver: new ConfigResolver(),
    toolDispatcher: mockDispatcher,
  });
}

describe('PluginDevWatcher', () => {
  beforeEach(() => {
    tmpDir = createTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('tracks watched namespaces', () => {
    const lifecycle = createLifecycle();
    const pluginDir = path.join(tmpDir, 'my-plugin');
    writePluginYaml(pluginDir, 'my-plugin');

    const watcher = new PluginDevWatcher(lifecycle);
    watcher.watch('my-plugin', pluginDir);

    expect(watcher.watchedNamespaces).toContain('my-plugin');

    watcher.stop();
  });

  it('throws when watching same namespace twice', () => {
    const lifecycle = createLifecycle();
    const pluginDir = path.join(tmpDir, 'my-plugin');
    writePluginYaml(pluginDir, 'my-plugin');

    const watcher = new PluginDevWatcher(lifecycle);
    watcher.watch('my-plugin', pluginDir);

    expect(() => watcher.watch('my-plugin', pluginDir)).toThrow('Already watching');

    watcher.stop();
  });

  it('unwatches a namespace', () => {
    const lifecycle = createLifecycle();
    const pluginDir = path.join(tmpDir, 'my-plugin');
    writePluginYaml(pluginDir, 'my-plugin');

    const watcher = new PluginDevWatcher(lifecycle);
    watcher.watch('my-plugin', pluginDir);
    watcher.unwatch('my-plugin');

    expect(watcher.watchedNamespaces).toHaveLength(0);
  });

  it('stop closes all watchers', () => {
    const lifecycle = createLifecycle();
    const dir1 = path.join(tmpDir, 'plugin-a');
    const dir2 = path.join(tmpDir, 'plugin-b');
    writePluginYaml(dir1, 'plugin-a');
    writePluginYaml(dir2, 'plugin-b');

    const watcher = new PluginDevWatcher(lifecycle);
    watcher.watch('plugin-a', dir1);
    watcher.watch('plugin-b', dir2);
    expect(watcher.watchedNamespaces).toHaveLength(2);

    watcher.stop();
    expect(watcher.watchedNamespaces).toHaveLength(0);
  });

  it('registers plugin dir with lifecycle on watch', async () => {
    const lifecycle = createLifecycle();
    const pluginDir = path.join(tmpDir, 'my-plugin');
    writePluginYaml(pluginDir, 'my-plugin');

    // Install the plugin first so reload can uninstall it
    const result = loadPlugin(pluginDir);
    lifecycle.install(result.plugin);

    const watcher = new PluginDevWatcher(lifecycle);
    watcher.watch('my-plugin', pluginDir);

    // Verify lifecycle knows the dir (reload won't throw "no dir")
    await expect(lifecycle.reload('my-plugin')).resolves.toBeDefined();

    watcher.stop();
  });

  it('stops via AbortSignal', () => {
    const lifecycle = createLifecycle();
    const pluginDir = path.join(tmpDir, 'my-plugin');
    writePluginYaml(pluginDir, 'my-plugin');

    const controller = new AbortController();
    const watcher = new PluginDevWatcher(lifecycle, { signal: controller.signal });
    watcher.watch('my-plugin', pluginDir);

    expect(watcher.watchedNamespaces).toHaveLength(1);
    controller.abort();
    expect(watcher.watchedNamespaces).toHaveLength(0);
  });

  it('debounces rapid file changes', async () => {
    const lifecycle = createLifecycle();
    const pluginDir = path.join(tmpDir, 'my-plugin');
    writePluginYaml(pluginDir, 'my-plugin');

    // Install plugin first
    const result = loadPlugin(pluginDir);
    lifecycle.install(result.plugin);

    const reloads: string[] = [];
    const watcher = new PluginDevWatcher(lifecycle, {
      debounceMs: 50,
      onReload: (ns) => reloads.push(ns),
    });
    watcher.watch('my-plugin', pluginDir);

    // Trigger rapid changes
    fs.writeFileSync(path.join(pluginDir, 'plugin.yaml'),
      `name: Test Plugin\nversion: "1.0.1"\nnamespace: my-plugin\npermissions:\n  - llm:invoke\n`);
    fs.writeFileSync(path.join(pluginDir, 'plugin.yaml'),
      `name: Test Plugin\nversion: "1.0.2"\nnamespace: my-plugin\npermissions:\n  - llm:invoke\n`);

    // Wait for debounce
    await new Promise((r) => setTimeout(r, 200));

    // Should have coalesced to 1 reload
    expect(reloads.length).toBeLessThanOrEqual(2);
    expect(reloads.length).toBeGreaterThanOrEqual(1);

    watcher.stop();
  });
});

describe('PluginLifecycleManager.reload', () => {
  beforeEach(() => {
    tmpDir = createTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('throws when no dir registered', async () => {
    const lifecycle = createLifecycle();
    await expect(lifecycle.reload('unknown')).rejects.toThrow('No plugin directory');
  });

  it('reloads a plugin from disk', async () => {
    const lifecycle = createLifecycle();
    const pluginDir = path.join(tmpDir, 'my-plugin');
    writePluginYaml(pluginDir, 'my-plugin', '1.0.0');

    const result = loadPlugin(pluginDir);
    lifecycle.install(result.plugin);
    lifecycle.registerPluginDir('my-plugin', pluginDir);

    // Update manifest on disk
    writePluginYaml(pluginDir, 'my-plugin', '2.0.0');

    const reloaded = await lifecycle.reload('my-plugin');
    expect(reloaded.plugin.manifest.version).toBe('2.0.0');
    expect(lifecycle.getPlugin('my-plugin')?.manifest.version).toBe('2.0.0');
  });

  it('re-enables plugin if it was enabled before reload', async () => {
    const lifecycle = createLifecycle();
    const pluginDir = path.join(tmpDir, 'my-plugin');
    writePluginYaml(pluginDir, 'my-plugin');

    const result = loadPlugin(pluginDir);
    lifecycle.install(result.plugin);
    lifecycle.registerPluginDir('my-plugin', pluginDir);
    await lifecycle.enable('my-plugin');

    expect(lifecycle.getPlugin('my-plugin')?.state).toBe('enabled');

    const reloaded = await lifecycle.reload('my-plugin');
    expect(reloaded.plugin.state !== 'errored').toBe(true);
    expect(lifecycle.getPlugin('my-plugin')?.state).toBe('enabled');
  });

  it('does not re-enable plugin if it was disabled before reload', async () => {
    const lifecycle = createLifecycle();
    const pluginDir = path.join(tmpDir, 'my-plugin');
    writePluginYaml(pluginDir, 'my-plugin');

    const result = loadPlugin(pluginDir);
    lifecycle.install(result.plugin);
    lifecycle.registerPluginDir('my-plugin', pluginDir);

    // Don't enable — just installed state
    const reloaded = await lifecycle.reload('my-plugin');
    expect(lifecycle.getPlugin('my-plugin')?.state).toBe('installed');
  });
});
