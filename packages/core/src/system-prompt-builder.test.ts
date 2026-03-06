import { describe, it, expect } from 'vitest';
import { SystemPromptBuilder } from './system-prompt-builder.js';

describe('SystemPromptBuilder', () => {
  it('builds prompt from all components', () => {
    const builder = new SystemPromptBuilder();
    const prompt = builder.build({
      workspacePrefix: 'Workspace context',
      basePrompt: 'You are helpful.',
      commandPrompt: 'Run this command.',
      artifactSuffix: '## Artifacts\n- doc v1',
      skillIndexSuffix: '## Skills\n- greet',
      workingMemoryNotes: ['note one', 'note two'],
    });

    expect(prompt).toContain('Workspace context');
    expect(prompt).toContain('You are helpful.');
    expect(prompt).toContain('Run this command.');
    expect(prompt).toContain('## Artifacts');
    expect(prompt).toContain('## Skills');
    expect(prompt).toContain('## Working Memory');
    expect(prompt).toContain('1. note one');
    expect(prompt).toContain('2. note two');
  });

  it('omits empty sections', () => {
    const builder = new SystemPromptBuilder();
    const prompt = builder.build({
      basePrompt: 'You are helpful.',
    });

    expect(prompt).toBe('You are helpful.');
    expect(prompt).not.toContain('Working Memory');
  });

  it('omits working memory when notes array is empty', () => {
    const builder = new SystemPromptBuilder();
    const prompt = builder.build({
      basePrompt: 'Base',
      workingMemoryNotes: [],
    });

    expect(prompt).not.toContain('Working Memory');
  });

  it('buildTurnReminders returns reminder near limit', () => {
    const builder = new SystemPromptBuilder();

    expect(builder.buildTurnReminders(1, 10)).toEqual([]);
    expect(builder.buildTurnReminders(6, 10)).toEqual([]); // 4 remaining, no reminder
    expect(builder.buildTurnReminders(7, 10)).toHaveLength(1); // 3 remaining
    expect(builder.buildTurnReminders(8, 10)).toHaveLength(1); // 2 remaining
    expect(builder.buildTurnReminders(9, 10)).toHaveLength(1); // 1 remaining
    expect(builder.buildTurnReminders(10, 10)).toEqual([]); // 0 remaining, no reminder
  });

  it('turn reminder contains remaining count', () => {
    const builder = new SystemPromptBuilder();
    const reminders = builder.buildTurnReminders(8, 10);

    expect(reminders[0]).toContain('2 turn(s) remaining');
    expect(reminders[0]).toContain('Turn 8/10');
  });
});
