import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { join } from 'node:path';
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
});
