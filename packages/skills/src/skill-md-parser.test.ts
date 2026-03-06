import { describe, it, expect } from 'vitest';
import { parseClaudeSkillMd, isClaudeFrontmatter } from './skill-md-parser.js';

describe('isClaudeFrontmatter', () => {
  it('returns true for allowed-tools field', () => {
    expect(isClaudeFrontmatter({ name: 'x', description: 'y', 'allowed-tools': 'Read, Grep' })).toBe(true);
  });

  it('returns true for context field', () => {
    expect(isClaudeFrontmatter({ name: 'x', description: 'y', context: 'fork' })).toBe(true);
  });

  it('returns true for disable-model-invocation field', () => {
    expect(isClaudeFrontmatter({ name: 'x', description: 'y', 'disable-model-invocation': true })).toBe(true);
  });

  it('returns false for plain NexoraKit frontmatter', () => {
    expect(isClaudeFrontmatter({ name: 'x', description: 'y', invocation: 'model' })).toBe(false);
  });

  it('returns false for empty object', () => {
    expect(isClaudeFrontmatter({})).toBe(false);
  });
});

describe('parseClaudeSkillMd', () => {
  it('parses a minimal Claude SKILL.md', () => {
    const content = `---
name: review-code
description: Review code for issues
---
Review the code and suggest improvements.

Focus on correctness, performance, and readability.`;

    const skill = parseClaudeSkillMd(content);

    expect(skill.name).toBe('review-code');
    expect(skill.description).toBe('Review code for issues');
    expect(skill.executionMode).toBe('behavioral');
    expect(skill.body).toContain('Review the code');
    expect(skill.body).toContain('readability.');
    expect(skill.prompt).toBeUndefined();
    expect(skill.context).toBe('inline');
    expect(skill.invocation).toBe('both');
  });

  it('parses all Claude frontmatter fields', () => {
    const content = `---
name: deep-research
description: Research a topic thoroughly
argument-hint: "[topic] [depth]"
disable-model-invocation: false
user-invocable: true
allowed-tools: "Read, Grep, Glob, WebFetch"
model: sonnet
context: fork
agent: Explore
---
Research the topic in depth.`;

    const skill = parseClaudeSkillMd(content);

    expect(skill.argumentHint).toBe('[topic] [depth]');
    expect(skill.disableModelInvocation).toBe(false);
    expect(skill.userInvocable).toBe(true);
    expect(skill.allowedTools).toEqual(['Read', 'Grep', 'Glob', 'WebFetch']);
    expect(skill.modelOverride).toBe('sonnet');
    expect(skill.context).toBe('fork');
    expect(skill.agentType).toBe('Explore');
  });

  it('maps user-invocable: false to invocation: model', () => {
    const content = `---
name: background
description: Background knowledge
user-invocable: false
---
Internal instructions.`;

    const skill = parseClaudeSkillMd(content);
    expect(skill.invocation).toBe('model');
  });

  it('maps disable-model-invocation: true to invocation: user', () => {
    const content = `---
name: manual-only
description: Only manual invocation
disable-model-invocation: true
---
Manual skill.`;

    const skill = parseClaudeSkillMd(content);
    expect(skill.invocation).toBe('user');
  });

  it('handles empty body', () => {
    const content = `---
name: no-body
description: Skill with no body
---
`;

    const skill = parseClaudeSkillMd(content);
    expect(skill.body).toBeUndefined();
  });

  it('parses hooks in frontmatter', () => {
    const content = `---
name: safe-skill
description: Skill with hooks
hooks:
  PreToolUse:
    - command: /usr/bin/validate
      args: ["--strict"]
  PostToolUse:
    - command: /usr/bin/format
---
Instructions.`;

    const skill = parseClaudeSkillMd(content);

    expect(skill.hooks).toBeDefined();
    expect(skill.hooks!.PreToolUse).toHaveLength(1);
    expect(skill.hooks!.PreToolUse![0].command).toBe('/usr/bin/validate');
    expect(skill.hooks!.PreToolUse![0].args).toEqual(['--strict']);
    expect(skill.hooks!.PostToolUse).toHaveLength(1);
  });

  it('parses allowed-tools with various spacing', () => {
    const content = `---
name: spaces
description: Test spacing
allowed-tools: " Read , Grep,Glob , WebFetch"
---
Body.`;

    const skill = parseClaudeSkillMd(content);
    expect(skill.allowedTools).toEqual(['Read', 'Grep', 'Glob', 'WebFetch']);
  });

  it('supports NexoraKit parameters extension', () => {
    const content = `---
name: hybrid
description: Claude skill with NexoraKit params
allowed-tools: "Read"
parameters:
  topic:
    type: string
    description: Research topic
    required: true
---
Research $ARGUMENTS about {{topic}}.`;

    const skill = parseClaudeSkillMd(content);
    expect(skill.executionMode).toBe('behavioral');
    expect(skill.parameters.topic.type).toBe('string');
    expect(skill.parameters.topic.required).toBe(true);
  });

  it('throws without frontmatter', () => {
    expect(() => parseClaudeSkillMd('No frontmatter')).toThrow('SKILL.md must have YAML frontmatter');
  });

  it('throws on missing name', () => {
    const content = `---
description: No name
---
Body.`;
    expect(() => parseClaudeSkillMd(content)).toThrow();
  });

  it('throws on missing description', () => {
    const content = `---
name: no-desc
---
Body.`;
    expect(() => parseClaudeSkillMd(content)).toThrow();
  });
});

describe('parseMdSkill auto-detection', () => {
  // This tests the routing in md-parser.ts
  it('routes Claude-format to behavioral parser via parseMdSkill', async () => {
    const { parseMdSkill } = await import('./md-parser.js');

    const content = `---
name: claude-skill
description: A Claude skill
allowed-tools: "Read, Grep"
context: fork
---
Do research.`;

    const skill = parseMdSkill(content);
    expect(skill.executionMode).toBe('behavioral');
    expect(skill.allowedTools).toEqual(['Read', 'Grep']);
    expect(skill.body).toBe('Do research.');
    expect(skill.prompt).toBeUndefined();
  });

  it('routes NexoraKit-format to prompt parser via parseMdSkill', async () => {
    const { parseMdSkill } = await import('./md-parser.js');

    const content = `---
name: nexora-skill
description: A NexoraKit skill
parameters:
  name:
    type: string
---
Hello {{name}}.`;

    const skill = parseMdSkill(content);
    expect(skill.executionMode).toBe('prompt');
    expect(skill.prompt).toBe('Hello {{name}}.');
    expect(skill.body).toBeUndefined();
  });
});
