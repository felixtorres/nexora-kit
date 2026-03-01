import { describe, it, expect } from 'vitest';
import { SkillRegistry } from './registry.js';
import type { SkillDefinition } from './types.js';

function makeSkillDef(overrides: Partial<SkillDefinition> = {}): SkillDefinition {
  return {
    name: 'test',
    description: 'A test skill',
    invocation: 'model',
    parameters: {},
    ...overrides,
  };
}

const noopHandler = async () => 'ok';

describe('SkillRegistry', () => {
  it('registers and retrieves a skill', () => {
    const registry = new SkillRegistry();
    const def = makeSkillDef();
    registry.register('ns:test', def, 'ns', noopHandler);

    const info = registry.get('ns:test');
    expect(info).toBeDefined();
    expect(info!.qualifiedName).toBe('ns:test');
    expect(info!.namespace).toBe('ns');
    expect(info!.definition.name).toBe('test');
  });

  it('throws on duplicate registration', () => {
    const registry = new SkillRegistry();
    registry.register('ns:test', makeSkillDef(), 'ns', noopHandler);

    expect(() => registry.register('ns:test', makeSkillDef(), 'ns', noopHandler)).toThrow('already registered');
  });

  it('unregisters a skill', () => {
    const registry = new SkillRegistry();
    registry.register('ns:test', makeSkillDef(), 'ns', noopHandler);
    registry.unregister('ns:test');

    expect(registry.get('ns:test')).toBeUndefined();
  });

  it('unregisters all skills in a namespace', () => {
    const registry = new SkillRegistry();
    registry.register('ns:a', makeSkillDef({ name: 'a' }), 'ns', noopHandler);
    registry.register('ns:b', makeSkillDef({ name: 'b' }), 'ns', noopHandler);
    registry.register('other:c', makeSkillDef({ name: 'c' }), 'other', noopHandler);

    registry.unregisterNamespace('ns');

    expect(registry.has('ns:a')).toBe(false);
    expect(registry.has('ns:b')).toBe(false);
    expect(registry.has('other:c')).toBe(true);
  });

  it('lists skills for model invocation', () => {
    const registry = new SkillRegistry();
    registry.register('ns:model-only', makeSkillDef({ name: 'model-only', invocation: 'model' }), 'ns', noopHandler);
    registry.register('ns:user-only', makeSkillDef({ name: 'user-only', invocation: 'user' }), 'ns', noopHandler);
    registry.register('ns:both', makeSkillDef({ name: 'both', invocation: 'both' }), 'ns', noopHandler);

    const modelSkills = registry.listForModel();
    expect(modelSkills).toHaveLength(2);
    expect(modelSkills.map((s) => s.qualifiedName).sort()).toEqual(['ns:both', 'ns:model-only']);
  });

  it('lists skills for user invocation', () => {
    const registry = new SkillRegistry();
    registry.register('ns:model-only', makeSkillDef({ name: 'model-only', invocation: 'model' }), 'ns', noopHandler);
    registry.register('ns:user-only', makeSkillDef({ name: 'user-only', invocation: 'user' }), 'ns', noopHandler);
    registry.register('ns:both', makeSkillDef({ name: 'both', invocation: 'both' }), 'ns', noopHandler);

    const userSkills = registry.listForUser();
    expect(userSkills).toHaveLength(2);
    expect(userSkills.map((s) => s.qualifiedName).sort()).toEqual(['ns:both', 'ns:user-only']);
  });

  it('lists all skills', () => {
    const registry = new SkillRegistry();
    registry.register('ns:a', makeSkillDef({ name: 'a' }), 'ns', noopHandler);
    registry.register('ns:b', makeSkillDef({ name: 'b' }), 'ns', noopHandler);

    expect(registry.list()).toHaveLength(2);
  });

  it('reports has correctly', () => {
    const registry = new SkillRegistry();
    expect(registry.has('ns:test')).toBe(false);
    registry.register('ns:test', makeSkillDef(), 'ns', noopHandler);
    expect(registry.has('ns:test')).toBe(true);
  });
});
