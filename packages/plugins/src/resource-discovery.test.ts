import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { discoverSkillResources, hasResources } from './resource-discovery.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexora-resource-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeFile(relativePath: string, content: string): void {
  const fullPath = path.join(tmpDir, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content);
}

describe('discoverSkillResources', () => {
  it('discovers files in scripts/, references/, and assets/', () => {
    writeFile('scripts/validate.sh', '#!/bin/bash');
    writeFile('scripts/check.py', 'print("ok")');
    writeFile('references/schema.md', '# Schema');
    writeFile('references/api.md', '# API');
    writeFile('assets/template.html', '<html>');

    const resources = discoverSkillResources(tmpDir);

    expect(resources.scripts).toHaveLength(2);
    expect(resources.references).toHaveLength(2);
    expect(resources.assets).toHaveLength(1);
    expect(resources.baseDir).toBe(tmpDir);

    // Paths are absolute
    expect(resources.scripts[0]).toMatch(/^\/.*check\.py$/);
    expect(resources.scripts[1]).toMatch(/^\/.*validate\.sh$/);
  });

  it('returns empty arrays when no resource directories exist', () => {
    const resources = discoverSkillResources(tmpDir);

    expect(resources.scripts).toEqual([]);
    expect(resources.references).toEqual([]);
    expect(resources.assets).toEqual([]);
    expect(resources.baseDir).toBe(tmpDir);
  });

  it('ignores subdirectories within resource directories', () => {
    writeFile('scripts/helper.sh', '#!/bin/bash');
    fs.mkdirSync(path.join(tmpDir, 'scripts', 'subdir'), { recursive: true });
    writeFile('scripts/subdir/nested.sh', '#!/bin/bash');

    const resources = discoverSkillResources(tmpDir);

    // Only top-level files, not nested ones
    expect(resources.scripts).toHaveLength(1);
    expect(resources.scripts[0]).toContain('helper.sh');
  });

  it('sorts files alphabetically', () => {
    writeFile('scripts/z-last.sh', '');
    writeFile('scripts/a-first.sh', '');
    writeFile('scripts/m-middle.sh', '');

    const resources = discoverSkillResources(tmpDir);
    const names = resources.scripts.map((p) => path.basename(p));

    expect(names).toEqual(['a-first.sh', 'm-middle.sh', 'z-last.sh']);
  });
});

describe('hasResources', () => {
  it('returns false when all arrays are empty', () => {
    expect(hasResources({ scripts: [], references: [], assets: [], baseDir: '/tmp' })).toBe(false);
  });

  it('returns true when scripts exist', () => {
    expect(hasResources({ scripts: ['/a.sh'], references: [], assets: [], baseDir: '/tmp' })).toBe(true);
  });

  it('returns true when references exist', () => {
    expect(hasResources({ scripts: [], references: ['/a.md'], assets: [], baseDir: '/tmp' })).toBe(true);
  });

  it('returns true when assets exist', () => {
    expect(hasResources({ scripts: [], references: [], assets: ['/a.png'], baseDir: '/tmp' })).toBe(true);
  });
});
