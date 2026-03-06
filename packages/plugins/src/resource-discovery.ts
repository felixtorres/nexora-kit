import * as fs from 'node:fs';
import * as path from 'node:path';
import type { SkillResources } from '@nexora-kit/core';

/**
 * Discover bundled resources (scripts/, references/, assets/) within a skill directory.
 * Returns absolute paths for all discovered files.
 */
export function discoverSkillResources(skillDir: string): SkillResources {
  return {
    scripts: listFiles(path.join(skillDir, 'scripts')),
    references: listFiles(path.join(skillDir, 'references')),
    assets: listFiles(path.join(skillDir, 'assets')),
    baseDir: skillDir,
  };
}

function listFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => path.join(dir, entry.name))
      .sort();
  } catch {
    return [];
  }
}

/**
 * Check if a skill directory has any bundled resources beyond SKILL.md.
 */
export function hasResources(resources: SkillResources): boolean {
  return resources.scripts.length > 0
    || resources.references.length > 0
    || resources.assets.length > 0;
}
