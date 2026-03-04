import { describe, it, expect } from 'vitest';
import { buildSkillIndex } from './skill-index.js';
import type { SkillInfo } from './types.js';

function makeSkillInfo(name: string, description: string, namespace = 'kyvos'): SkillInfo {
  return {
    qualifiedName: `${namespace}:${name}`,
    definition: {
      name,
      description,
      invocation: 'model',
      parameters: {},
    },
    namespace,
    handler: async () => 'ok',
  };
}

describe('buildSkillIndex', () => {
  it('returns empty string for empty skills array', () => {
    expect(buildSkillIndex([], 'kyvos')).toBe('');
  });

  it('builds index with heading and skill list', () => {
    const skills = [
      makeSkillInfo('sql-queries', 'Generate SQL queries for Kyvos cubes'),
      makeSkillInfo('analyze', 'Analyze data from a Kyvos instance'),
    ];

    const result = buildSkillIndex(skills, 'kyvos');

    expect(result).toContain('## Available Skills (kyvos)');
    expect(result).toContain('- **sql-queries** — Generate SQL queries for Kyvos cubes');
    expect(result).toContain('- **analyze** — Analyze data from a Kyvos instance');
  });

  it('includes footer with get_skill_context instruction', () => {
    const skills = [makeSkillInfo('test', 'A test skill')];
    const result = buildSkillIndex(skills, 'ns');

    expect(result).toContain('call the `get_skill_context` tool with the skill name');
  });

  it('uses the correct namespace in heading', () => {
    const skills = [makeSkillInfo('greet', 'Greet someone', 'hello')];
    const result = buildSkillIndex(skills, 'hello');

    expect(result).toContain('## Available Skills (hello)');
  });

  it('handles single skill', () => {
    const skills = [makeSkillInfo('only-one', 'The only skill')];
    const result = buildSkillIndex(skills, 'ns');

    expect(result).toContain('- **only-one** — The only skill');
    expect(result.match(/^- \*\*/gm)?.length).toBe(1);
  });

  it('handles many skills', () => {
    const skills = Array.from({ length: 10 }, (_, i) =>
      makeSkillInfo(`skill-${i}`, `Description ${i}`),
    );
    const result = buildSkillIndex(skills, 'kyvos');

    expect(result.match(/^- \*\*/gm)?.length).toBe(10);
  });

  it('prepends plugin docs when provided', () => {
    const skills = [makeSkillInfo('test', 'A test skill')];
    const docs = 'Kyvos is an OLAP engine for big data.';
    const result = buildSkillIndex(skills, 'kyvos', { pluginDocs: docs });

    expect(result).toContain('## Plugin Reference (kyvos)');
    expect(result).toContain(docs);
    // Plugin docs come before skills
    const docsIdx = result.indexOf('Plugin Reference');
    const skillsIdx = result.indexOf('Available Skills');
    expect(docsIdx).toBeLessThan(skillsIdx);
  });

  it('returns plugin docs only when no skills', () => {
    const docs = 'Some reference docs.';
    const result = buildSkillIndex([], 'kyvos', { pluginDocs: docs });

    expect(result).toContain('## Plugin Reference (kyvos)');
    expect(result).toContain(docs);
    expect(result).not.toContain('Available Skills');
  });

  it('returns empty string with no skills and no docs', () => {
    expect(buildSkillIndex([], 'ns', {})).toBe('');
    expect(buildSkillIndex([], 'ns', { pluginDocs: undefined })).toBe('');
  });
});
