import { describe, it, expect } from 'vitest';
import { defineSkill } from './define-skill.js';

describe('defineSkill', () => {
  it('creates a skill definition with defaults', () => {
    const skill = defineSkill({
      name: 'greet',
      description: 'Greet someone',
      handler: async () => ({ output: 'hello' }),
    });

    expect(skill.name).toBe('greet');
    expect(skill.description).toBe('Greet someone');
    expect(skill.invocation).toBe('model');
    expect(skill.parameters).toEqual({});
    expect(skill.handler).toBeDefined();
  });

  it('respects explicit invocation type', () => {
    const skill = defineSkill({
      name: 'search',
      description: 'Search something',
      invocation: 'user',
      handler: async () => ({ output: 'results' }),
    });

    expect(skill.invocation).toBe('user');
  });

  it('includes parameters when provided', () => {
    const skill = defineSkill({
      name: 'calc',
      description: 'Calculate',
      parameters: {
        x: { type: 'number', description: 'First operand' },
        y: { type: 'number', description: 'Second operand' },
      },
      handler: async () => ({ output: '42' }),
    });

    expect(Object.keys(skill.parameters)).toEqual(['x', 'y']);
    expect(skill.parameters.x.type).toBe('number');
  });

  it('throws on empty name', () => {
    expect(() =>
      defineSkill({ name: '', description: 'Test', handler: async () => ({ output: '' }) }),
    ).toThrow('Skill name is required');
  });

  it('throws on empty description', () => {
    expect(() =>
      defineSkill({ name: 'test', description: '', handler: async () => ({ output: '' }) }),
    ).toThrow('Skill description is required');
  });

  it('throws if name contains colon', () => {
    expect(() =>
      defineSkill({ name: 'ns:test', description: 'Test', handler: async () => ({ output: '' }) }),
    ).toThrow('must not contain namespace separator');
  });
});
