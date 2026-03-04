import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { configGetCommand, configSetCommand, configValidateCommand, configShowCommand } from './cmd-config.js';

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

describe('config validate command', () => {
  let tempDir: string;
  let configPath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'nexora-config-val-'));
    configPath = join(tempDir, 'nexora.yaml');
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
    process.exitCode = undefined;
  });

  it('passes on a valid config', async () => {
    await writeFile(configPath, `
name: test-app
port: 3000
auth:
  type: api-key
  keys:
    - key: dev-key-123
      userId: dev
      teamId: default
      role: admin
storage:
  path: ./data/nexora.db
`, 'utf-8');

    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await configValidateCommand.run({
      positionals: [],
      flags: { config: configPath },
    });

    expect(process.exitCode).toBeUndefined();
    const output = spy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
    expect(output).toContain('valid');
    spy.mockRestore();
    errSpy.mockRestore();
  });

  it('reports missing required fields', async () => {
    await writeFile(configPath, `
name: test-app
`, 'utf-8');

    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await configValidateCommand.run({
      positionals: [],
      flags: { config: configPath },
    });

    expect(process.exitCode).toBe(1);
    spy.mockRestore();
    errSpy.mockRestore();
  });

  it('reports invalid port', async () => {
    await writeFile(configPath, `
port: 99999
auth:
  type: api-key
  keys:
    - key: test
      role: admin
`, 'utf-8');

    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await configValidateCommand.run({
      positionals: [],
      flags: { config: configPath },
    });

    expect(process.exitCode).toBe(1);
    spy.mockRestore();
    errSpy.mockRestore();
  });

  it('warns about unresolved env vars', async () => {
    await writeFile(configPath, `
port: 3000
auth:
  type: api-key
  keys:
    - key: \${NEXORA_API_KEY}
      role: admin
`, 'utf-8');

    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await configValidateCommand.run({
      positionals: [],
      flags: { config: configPath },
    });

    const output = spy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
    expect(output).toContain('NEXORA_API_KEY');
    spy.mockRestore();
    errSpy.mockRestore();
  });

  it('fails on missing config file', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await configValidateCommand.run({
      positionals: [],
      flags: { config: join(tempDir, 'nope.yaml') },
    });

    expect(process.exitCode).toBe(1);
    errSpy.mockRestore();
  });
});

describe('config show command', () => {
  let tempDir: string;
  let configPath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'nexora-config-show-'));
    configPath = join(tempDir, 'nexora.yaml');
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
    process.exitCode = undefined;
  });

  it('displays resolved config', async () => {
    await writeFile(configPath, `
name: test-app
port: 3000
auth:
  type: api-key
  keys:
    - key: secret-key-value
      userId: dev
      role: admin
`, 'utf-8');

    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await configShowCommand.run({
      positionals: [],
      flags: { config: configPath },
    });

    const output = spy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
    expect(output).toContain('test-app');
    // Secret should be masked
    expect(output).toContain('secr****');
    expect(output).not.toContain('secret-key-value');
    spy.mockRestore();
  });

  it('resolves env vars', async () => {
    process.env['TEST_PORT'] = '4000';
    await writeFile(configPath, `
name: test-app
port: \${TEST_PORT}
auth:
  type: api-key
  keys:
    - key: test-key
      role: admin
`, 'utf-8');

    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await configShowCommand.run({
      positionals: [],
      flags: { config: configPath },
    });

    const output = spy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
    expect(output).toContain('4000');
    spy.mockRestore();
    delete process.env['TEST_PORT'];
  });
});
