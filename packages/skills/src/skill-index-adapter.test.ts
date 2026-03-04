import { describe, it, expect } from 'vitest';
import { SkillRegistry } from './registry.js';
import { SkillIndexAdapter } from './skill-index-adapter.js';
import type { SkillDefinition } from './types.js';

const noopHandler = async () => 'ok';

function makeSkillDef(name: string, description: string): SkillDefinition {
  return {
    name,
    description,
    invocation: 'model',
    parameters: {},
    prompt: `Full prompt for ${name}`,
  };
}

describe('SkillIndexAdapter', () => {
  it('builds index from registry for a namespace', () => {
    const registry = new SkillRegistry();
    registry.register('kyvos:sql', makeSkillDef('sql', 'Run SQL'), 'kyvos', noopHandler);
    registry.register('kyvos:analyze', makeSkillDef('analyze', 'Analyze data'), 'kyvos', noopHandler);

    const adapter = new SkillIndexAdapter(registry);
    const index = adapter.buildIndex('kyvos');

    expect(index).toContain('## Available Skills (kyvos)');
    expect(index).toContain('**sql**');
    expect(index).toContain('**analyze**');
  });

  it('returns empty string for namespace with no skills', () => {
    const registry = new SkillRegistry();
    const adapter = new SkillIndexAdapter(registry);

    expect(adapter.buildIndex('empty')).toBe('');
  });

  it('includes plugin docs when set', () => {
    const registry = new SkillRegistry();
    registry.register('kyvos:sql', makeSkillDef('sql', 'Run SQL'), 'kyvos', noopHandler);

    const adapter = new SkillIndexAdapter(registry);
    adapter.setPluginDocs('kyvos', 'Kyvos is an OLAP engine.');

    const index = adapter.buildIndex('kyvos');
    expect(index).toContain('## Plugin Reference (kyvos)');
    expect(index).toContain('Kyvos is an OLAP engine.');
  });

  it('returns empty string when namespace is disabled', () => {
    const registry = new SkillRegistry();
    registry.register('kyvos:sql', makeSkillDef('sql', 'Run SQL'), 'kyvos', noopHandler);

    const adapter = new SkillIndexAdapter(registry);
    adapter.disableForNamespace('kyvos');

    expect(adapter.buildIndex('kyvos')).toBe('');
  });
});
