import { describe, it, expect } from 'vitest';
import { SkillActivationManager, type ActiveSkill } from './skill-activation.js';

function makeSkill(overrides: Partial<ActiveSkill> = {}): ActiveSkill {
  return {
    name: 'test-skill',
    qualifiedName: 'ns:test-skill',
    instructions: 'Do something useful.',
    context: 'inline',
    ...overrides,
  };
}

describe('SkillActivationManager', () => {
  it('activates and retrieves skill instructions', () => {
    const mgr = new SkillActivationManager();

    mgr.activate('conv-1', makeSkill({ instructions: 'Review code carefully.' }));

    const instructions = mgr.getActiveInstructions('conv-1');
    expect(instructions).toContain('Review code carefully.');
    expect(instructions).toContain('Active Skill: test-skill');
  });

  it('returns undefined when no skills are active', () => {
    const mgr = new SkillActivationManager();
    expect(mgr.getActiveInstructions('conv-1')).toBeUndefined();
  });

  it('supports multiple active skills', () => {
    const mgr = new SkillActivationManager();

    mgr.activate('conv-1', makeSkill({ name: 'skill-a', qualifiedName: 'ns:skill-a', instructions: 'Do A.' }));
    mgr.activate('conv-1', makeSkill({ name: 'skill-b', qualifiedName: 'ns:skill-b', instructions: 'Do B.' }));

    const instructions = mgr.getActiveInstructions('conv-1')!;
    expect(instructions).toContain('Do A.');
    expect(instructions).toContain('Do B.');
  });

  it('replaces skill with same qualified name', () => {
    const mgr = new SkillActivationManager();

    mgr.activate('conv-1', makeSkill({ instructions: 'Version 1' }));
    mgr.activate('conv-1', makeSkill({ instructions: 'Version 2' }));

    const instructions = mgr.getActiveInstructions('conv-1')!;
    expect(instructions).not.toContain('Version 1');
    expect(instructions).toContain('Version 2');
  });

  it('deactivates a specific skill', () => {
    const mgr = new SkillActivationManager();

    mgr.activate('conv-1', makeSkill({ qualifiedName: 'ns:a', instructions: 'Instructions for skill alpha.' }));
    mgr.activate('conv-1', makeSkill({ qualifiedName: 'ns:b', instructions: 'Instructions for skill beta.' }));
    mgr.deactivate('conv-1', 'ns:a');

    const instructions = mgr.getActiveInstructions('conv-1')!;
    expect(instructions).not.toContain('skill alpha');
    expect(instructions).toContain('skill beta');
  });

  it('deactivateAll clears all skills for a conversation', () => {
    const mgr = new SkillActivationManager();

    mgr.activate('conv-1', makeSkill({ qualifiedName: 'ns:a' }));
    mgr.activate('conv-1', makeSkill({ qualifiedName: 'ns:b' }));
    mgr.deactivateAll('conv-1');

    expect(mgr.getActiveInstructions('conv-1')).toBeUndefined();
    expect(mgr.hasActive('conv-1')).toBe(false);
  });

  it('isolates skills between conversations', () => {
    const mgr = new SkillActivationManager();

    mgr.activate('conv-1', makeSkill({ instructions: 'For conv 1' }));
    mgr.activate('conv-2', makeSkill({ instructions: 'For conv 2' }));

    expect(mgr.getActiveInstructions('conv-1')).toContain('For conv 1');
    expect(mgr.getActiveInstructions('conv-1')).not.toContain('For conv 2');
  });

  it('excludes fork-mode skills from inline instructions', () => {
    const mgr = new SkillActivationManager();

    mgr.activate('conv-1', makeSkill({ name: 'inline', qualifiedName: 'ns:inline', context: 'inline', instructions: 'Inline instructions' }));
    mgr.activate('conv-1', makeSkill({ name: 'forked', qualifiedName: 'ns:forked', context: 'fork', instructions: 'Fork instructions' }));

    const instructions = mgr.getActiveInstructions('conv-1')!;
    expect(instructions).toContain('Inline instructions');
    expect(instructions).not.toContain('Fork instructions');
  });

  it('returns tool intersection from active skills', () => {
    const mgr = new SkillActivationManager();

    mgr.activate('conv-1', makeSkill({
      qualifiedName: 'ns:a',
      allowedTools: ['Read', 'Grep', 'Glob'],
    }));
    mgr.activate('conv-1', makeSkill({
      qualifiedName: 'ns:b',
      allowedTools: ['Read', 'Glob', 'WebFetch'],
    }));

    const allowed = mgr.getAllowedTools('conv-1')!;
    expect(allowed.sort()).toEqual(['Glob', 'Read']);
  });

  it('returns undefined when no skills restrict tools', () => {
    const mgr = new SkillActivationManager();
    mgr.activate('conv-1', makeSkill());

    expect(mgr.getAllowedTools('conv-1')).toBeUndefined();
  });

  it('hasActive returns correct state', () => {
    const mgr = new SkillActivationManager();

    expect(mgr.hasActive('conv-1')).toBe(false);
    mgr.activate('conv-1', makeSkill());
    expect(mgr.hasActive('conv-1')).toBe(true);
    mgr.deactivateAll('conv-1');
    expect(mgr.hasActive('conv-1')).toBe(false);
  });

  it('getActive returns all skills including fork mode', () => {
    const mgr = new SkillActivationManager();

    mgr.activate('conv-1', makeSkill({ qualifiedName: 'ns:inline', context: 'inline' }));
    mgr.activate('conv-1', makeSkill({ qualifiedName: 'ns:fork', context: 'fork' }));

    expect(mgr.getActive('conv-1')).toHaveLength(2);
  });
});
