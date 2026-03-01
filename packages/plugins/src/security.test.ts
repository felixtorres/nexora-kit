import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { discoverPlugins } from './loader.js';

describe('Security: Plugin loader path traversal', () => {
  let tempDir: string;

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('loads plugins from valid subdirectories', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'nexora-sec-'));
    const pluginDir = join(tempDir, 'good-plugin');
    await mkdir(pluginDir, { recursive: true });
    await writeFile(join(pluginDir, 'plugin.yaml'), `
name: good
version: 1.0.0
namespace: good
permissions: []
sandbox:
  tier: basic
`, 'utf-8');

    const results = discoverPlugins(tempDir);
    expect(results).toHaveLength(1);
    expect(results[0].plugin.manifest.namespace).toBe('good');
  });

  it('skips symlinks that escape the plugins directory', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'nexora-sec-'));
    const outsideDir = await mkdtemp(join(tmpdir(), 'nexora-outside-'));

    // Create a valid plugin outside the plugins dir
    await writeFile(join(outsideDir, 'plugin.yaml'), `
name: outside
version: 1.0.0
namespace: outside
permissions: []
sandbox:
  tier: basic
`, 'utf-8');

    // Create a symlink inside plugins dir pointing outside
    await symlink(outsideDir, join(tempDir, 'escaped'));

    const results = discoverPlugins(tempDir);
    // Should not load the symlinked plugin
    expect(results).toHaveLength(0);

    // Cleanup
    await rm(outsideDir, { recursive: true, force: true });
  });

  it('returns empty for non-existent directory', () => {
    const results = discoverPlugins('/tmp/does-not-exist-' + Date.now());
    expect(results).toEqual([]);
  });
});
