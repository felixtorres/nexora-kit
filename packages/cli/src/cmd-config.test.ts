import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { configGetCommand, configSetCommand } from './cmd-config.js';

describe('config get command', () => {
  let tempDir: string;
  let configPath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'nexora-config-'));
    configPath = join(tempDir, 'nexora.yaml');
    await writeFile(configPath, `
name: test-app
port: 3000
auth:
  type: api-key
  keys:
    - key: dev-key
      userId: dev
`, 'utf-8');
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
    process.exitCode = undefined;
  });

  it('gets a top-level value', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await configGetCommand.run({
      positionals: ['name'],
      flags: { config: configPath },
    });
    expect(spy).toHaveBeenCalledWith('test-app');
    spy.mockRestore();
  });

  it('gets a nested value', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await configGetCommand.run({
      positionals: ['auth.type'],
      flags: { config: configPath },
    });
    expect(spy).toHaveBeenCalledWith('api-key');
    spy.mockRestore();
  });

  it('gets a numeric value', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await configGetCommand.run({
      positionals: ['port'],
      flags: { config: configPath },
    });
    expect(spy).toHaveBeenCalledWith('3000');
    spy.mockRestore();
  });

  it('reports missing key', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await configGetCommand.run({
      positionals: ['nonexistent'],
      flags: { config: configPath },
    });
    expect(process.exitCode).toBe(1);
    spy.mockRestore();
  });

  it('fails without key argument', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await configGetCommand.run({
      positionals: [],
      flags: { config: configPath },
    });
    expect(process.exitCode).toBe(1);
    spy.mockRestore();
  });
});

describe('config set command', () => {
  let tempDir: string;
  let configPath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'nexora-config-set-'));
    configPath = join(tempDir, 'nexora.yaml');
    await writeFile(configPath, `
name: test-app
port: 3000
`, 'utf-8');
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
    process.exitCode = undefined;
  });

  it('sets a top-level value', async () => {
    await configSetCommand.run({
      positionals: ['name', 'new-app'],
      flags: { config: configPath },
    });

    const content = await readFile(configPath, 'utf-8');
    expect(content).toContain('new-app');
  });

  it('sets a nested value', async () => {
    await configSetCommand.run({
      positionals: ['auth.type', 'jwt'],
      flags: { config: configPath },
    });

    const content = await readFile(configPath, 'utf-8');
    expect(content).toContain('jwt');
  });

  it('coerces numeric values', async () => {
    await configSetCommand.run({
      positionals: ['port', '4000'],
      flags: { config: configPath },
    });

    const content = await readFile(configPath, 'utf-8');
    expect(content).toContain('4000');
  });

  it('coerces boolean values', async () => {
    await configSetCommand.run({
      positionals: ['debug', 'true'],
      flags: { config: configPath },
    });

    const content = await readFile(configPath, 'utf-8');
    expect(content).toContain('true');
  });
});
