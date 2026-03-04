import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pluginInitCommand, pluginValidateCommand, pluginAddCommand } from './cmd-plugin.js';

describe('plugin init command', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'nexora-plugin-init-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('scaffolds a new plugin directory', async () => {
    const pluginDir = join(tempDir, 'my-plugin');

    await pluginInitCommand.run({
      positionals: ['my-plugin'],
      flags: { dir: pluginDir },
    });

    // Check manifest
    const manifest = await readFile(join(pluginDir, 'plugin.yaml'), 'utf-8');
    expect(manifest).toContain('name: my-plugin');
    expect(manifest).toContain('namespace: my-plugin');

    // Check skill exists
    await access(join(pluginDir, 'skills', 'hello.yaml'));

    // Check test file exists
    await access(join(pluginDir, 'tests', 'plugin.test.ts'));

    // Check commands directory exists
    await access(join(pluginDir, 'commands'));
  });

  it('refuses if directory already exists', async () => {
    const pluginDir = join(tempDir, 'existing');
    await mkdir(pluginDir);

    await pluginInitCommand.run({
      positionals: ['test'],
      flags: { dir: pluginDir },
    });
    expect(process.exitCode).toBe(1);
    process.exitCode = undefined;
  });

  it('sanitizes namespace from name', async () => {
    const pluginDir = join(tempDir, 'My Plugin');

    await pluginInitCommand.run({
      positionals: ['My Plugin!'],
      flags: { dir: pluginDir },
    });

    const manifest = await readFile(join(pluginDir, 'plugin.yaml'), 'utf-8');
    expect(manifest).toContain('namespace: my-plugin-');
  });
});

describe('plugin validate command', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'nexora-plugin-validate-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
    process.exitCode = undefined;
  });

  it('validates a well-formed plugin', async () => {
    const pluginDir = join(tempDir, 'good-plugin');
    await mkdir(join(pluginDir, 'skills'), { recursive: true });

    await writeFile(join(pluginDir, 'plugin.yaml'), `
name: good-plugin
version: 1.0.0
namespace: good-plugin
permissions:
  - llm:invoke
sandbox:
  tier: basic
`, 'utf-8');

    await writeFile(join(pluginDir, 'skills', 'test.yaml'), `
name: test
description: Test skill
invocation: model
input_schema:
  type: object
  properties:
    input:
      type: string
prompt: "Hello {{input}}"
`, 'utf-8');

    await pluginValidateCommand.run({
      positionals: [pluginDir],
      flags: {},
    });

    expect(process.exitCode).toBeUndefined();
  });

  it('reports errors for invalid manifest', async () => {
    const pluginDir = join(tempDir, 'bad-plugin');
    await mkdir(pluginDir, { recursive: true });

    await writeFile(join(pluginDir, 'plugin.yaml'), `
name: bad
`, 'utf-8');

    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await pluginValidateCommand.run({
      positionals: [pluginDir],
      flags: {},
    });

    expect(process.exitCode).toBe(1);
    spy.mockRestore();
  });

  it('warns about elevated permissions', async () => {
    const pluginDir = join(tempDir, 'dangerous-plugin');
    await mkdir(join(pluginDir, 'skills'), { recursive: true });

    await writeFile(join(pluginDir, 'plugin.yaml'), `
name: dangerous
version: 1.0.0
namespace: dangerous
permissions:
  - code:execute
  - fs:write
  - secret:read
sandbox:
  tier: basic
`, 'utf-8');

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await pluginValidateCommand.run({
      positionals: [pluginDir],
      flags: {},
    });

    const warnCalls = logSpy.mock.calls.flat().join('\n');
    expect(warnCalls).toContain('elevated permissions');
    logSpy.mockRestore();
  });

  it('fails if no plugin.yaml found', async () => {
    const pluginDir = join(tempDir, 'empty');
    await mkdir(pluginDir, { recursive: true });

    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await pluginValidateCommand.run({
      positionals: [pluginDir],
      flags: {},
    });

    expect(process.exitCode).toBe(1);
    spy.mockRestore();
  });
});

describe('plugin add command', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'nexora-plugin-add-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
    process.exitCode = undefined;
  });

  it('installs a valid plugin to plugins directory', async () => {
    // Create a source plugin
    const srcDir = join(tempDir, 'source');
    await mkdir(join(srcDir, 'skills'), { recursive: true });
    await writeFile(join(srcDir, 'plugin.yaml'), `
name: test-plugin
version: 1.0.0
namespace: test-plugin
permissions: []
sandbox:
  tier: basic
`, 'utf-8');

    const pluginsDir = join(tempDir, 'plugins');

    await pluginAddCommand.run({
      positionals: [srcDir],
      flags: { 'plugins-dir': pluginsDir },
    });

    // Verify it was copied
    await access(join(pluginsDir, 'test-plugin', 'plugin.yaml'));
  });

  it('fails with no source argument', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await pluginAddCommand.run({ positionals: [], flags: {} });
    expect(process.exitCode).toBe(1);
    spy.mockRestore();
  });

  it('downloads and installs a plugin from a GitHub URL', async () => {
    // Build a valid plugin ZIP in memory
    const { zipSync } = await import('fflate');
    const pluginYaml = `name: url-plugin\nversion: 1.0.0\nnamespace: url-plugin\npermissions: []\nsandbox:\n  tier: basic\n`;
    const zipData = zipSync({ 'url-plugin/plugin.yaml': Buffer.from(pluginYaml) });

    // Stub global fetch to return the ZIP
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      arrayBuffer: async () => zipData.buffer,
    } as unknown as Response);

    const pluginsDir = join(tempDir, 'plugins');
    await pluginAddCommand.run({
      positionals: ['https://github.com/ki-kyvos/kyvos-plugins'],
      flags: { 'plugins-dir': pluginsDir },
    });

    // Verify it fetched the GitHub archive ZIP URL
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://github.com/ki-kyvos/kyvos-plugins/archive/refs/heads/main.zip',
      expect.anything(),
    );
    await access(join(pluginsDir, 'url-plugin', 'plugin.yaml'));
    fetchSpy.mockRestore();
  });

  it('downloads a plugin from a generic .zip URL', async () => {
    const { zipSync } = await import('fflate');
    const pluginYaml = `name: zip-plugin\nversion: 1.0.0\nnamespace: zip-plugin\npermissions: []\nsandbox:\n  tier: basic\n`;
    const zipData = zipSync({ 'plugin.yaml': Buffer.from(pluginYaml) });

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      arrayBuffer: async () => zipData.buffer,
    } as unknown as Response);

    const pluginsDir = join(tempDir, 'plugins');
    await pluginAddCommand.run({
      positionals: ['https://example.com/plugin.zip'],
      flags: { 'plugins-dir': pluginsDir },
    });

    expect(fetchSpy).toHaveBeenCalledWith('https://example.com/plugin.zip', expect.anything());
    await access(join(pluginsDir, 'zip-plugin', 'plugin.yaml'));
    fetchSpy.mockRestore();
  });

  it('reports error when URL download fails', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      arrayBuffer: async () => new ArrayBuffer(0),
    } as unknown as Response);

    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await pluginAddCommand.run({
      positionals: ['https://github.com/nobody/no-such-plugin'],
      flags: { 'plugins-dir': join(tempDir, 'plugins') },
    });

    expect(process.exitCode).toBe(1);
    fetchSpy.mockRestore();
    spy.mockRestore();
  });

  it('installs an MCP-native plugin (GitHub ZIP with .mcp.json)', async () => {
    const { zipSync } = await import('fflate');
    const mcpJson = JSON.stringify({
      mcpServers: { kyvos: { type: 'stdio', command: 'node', args: ['dist/index.js'] } },
    });
    const pkgJson = JSON.stringify({ name: '@ki-kyvos/kyvos-plugins', version: '2.1.0' });
    const zipData = zipSync({
      'kyvos-plugins/.mcp.json': Buffer.from(mcpJson),
      'kyvos-plugins/package.json': Buffer.from(pkgJson),
    });

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      arrayBuffer: async () => zipData.buffer,
    } as unknown as Response);

    const pluginsDir = join(tempDir, 'plugins');
    await pluginAddCommand.run({
      positionals: ['https://github.com/ki-kyvos/kyvos-plugins'],
      flags: { 'plugins-dir': pluginsDir },
    });

    expect(process.exitCode).toBeUndefined();
    await access(join(pluginsDir, 'kyvos-plugins', '.mcp.json'));
    fetchSpy.mockRestore();
  });

  it('installs plugin from a plugin repository (plugins in subdirectory)', async () => {
    // Mirrors ki-kyvos/kyvos-plugins: root has no plugin format, actual plugin at plugins/kyvos/
    const { zipSync } = await import('fflate');
    const pluginJson = JSON.stringify({ name: 'kyvos', version: '1.0.0', description: 'Kyvos MCP' });
    const mcpJson = JSON.stringify({
      mcpServers: { kyvos: { type: 'sse', url: 'https://mcp.kyvos.ai/sse' } },
    });
    const zipData = zipSync({
      // root-level marketplace metadata — NOT a plugin
      'kyvos-plugins-main/.claude-plugin/marketplace.json': Buffer.from('{}'),
      'kyvos-plugins-main/README.md': Buffer.from('# Kyvos Plugins'),
      // actual plugin in subdirectory
      'kyvos-plugins-main/plugins/kyvos/.claude-plugin/plugin.json': Buffer.from(pluginJson),
      'kyvos-plugins-main/plugins/kyvos/.mcp.json': Buffer.from(mcpJson),
    });

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      arrayBuffer: async () => zipData.buffer,
    } as unknown as Response);

    const pluginsDir = join(tempDir, 'plugins');
    await pluginAddCommand.run({
      positionals: ['https://github.com/ki-kyvos/kyvos-plugins'],
      flags: { 'plugins-dir': pluginsDir },
    });

    expect(process.exitCode).toBeUndefined();
    await access(join(pluginsDir, 'kyvos', '.claude-plugin', 'plugin.json'));
    fetchSpy.mockRestore();
  });

  it('rejects ZIP entries with path traversal (Zip Slip)', async () => {
    // Create a ZIP with a ../../../evil.txt entry using fflate
    const { zipSync } = await import('fflate');
    const malicious = zipSync({
      '../../../evil.txt': new Uint8Array([0x41, 0x42]),
    });
    const zipPath = join(tempDir, 'malicious.zip');
    await writeFile(zipPath, malicious);

    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await pluginAddCommand.run({
      positionals: [zipPath],
      flags: { 'plugins-dir': join(tempDir, 'plugins') },
    });

    expect(process.exitCode).toBe(1);
    // Evil file should not exist outside the target directory
    const evilPath = resolve(tempDir, '..', '..', '..', 'evil.txt');
    await expect(access(evilPath)).rejects.toThrow();
    spy.mockRestore();
  });
});
