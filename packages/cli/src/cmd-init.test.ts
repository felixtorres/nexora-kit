import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initCommand } from './cmd-init.js';

describe('init command', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'nexora-init-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('scaffolds a new instance directory', async () => {
    const instanceDir = join(tempDir, 'test-instance');

    await initCommand.run({
      positionals: [instanceDir],
      flags: { name: 'test-app' },
    });

    // Check nexora.yaml was created
    const config = await readFile(join(instanceDir, 'nexora.yaml'), 'utf-8');
    expect(config).toContain('name: test-app');
    expect(config).toContain('port: 3000');

    // Check directories
    await access(join(instanceDir, 'plugins'));
    await access(join(instanceDir, 'data'));

    // Check .gitignore
    const gitignore = await readFile(join(instanceDir, '.gitignore'), 'utf-8');
    expect(gitignore).toContain('data/');
  });

  it('refuses to overwrite existing instance', async () => {
    const instanceDir = join(tempDir, 'existing');
    // First init
    await initCommand.run({ positionals: [instanceDir], flags: {} });

    // Reset exitCode
    process.exitCode = undefined;

    // Second init should fail
    await initCommand.run({ positionals: [instanceDir], flags: {} });
    expect(process.exitCode).toBe(1);
    process.exitCode = undefined;
  });

  it('uses default name if not specified', async () => {
    const instanceDir = join(tempDir, 'default-name');
    await initCommand.run({ positionals: [instanceDir], flags: {} });

    const config = await readFile(join(instanceDir, 'nexora.yaml'), 'utf-8');
    expect(config).toContain('name: my-instance');
  });
});
