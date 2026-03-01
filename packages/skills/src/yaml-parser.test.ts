import { describe, it, expect } from 'vitest';
import { parseYamlSkill } from './yaml-parser.js';

describe('parseYamlSkill', () => {
  it('parses a complete YAML skill', () => {
    const yaml = `
name: greet
description: Greet the user with a friendly message
invocation: model
parameters:
  userName:
    type: string
    description: The user's name
prompt: |
  Generate a warm greeting for {{userName}}.
`;
    const skill = parseYamlSkill(yaml);

    expect(skill.name).toBe('greet');
    expect(skill.description).toBe('Greet the user with a friendly message');
    expect(skill.invocation).toBe('model');
    expect(skill.parameters.userName.type).toBe('string');
    expect(skill.prompt).toContain('{{userName}}');
  });

  it('defaults invocation to model', () => {
    const yaml = `
name: test
description: A test skill
`;
    const skill = parseYamlSkill(yaml);
    expect(skill.invocation).toBe('model');
  });

  it('defaults parameters to empty object', () => {
    const yaml = `
name: simple
description: No params
`;
    const skill = parseYamlSkill(yaml);
    expect(skill.parameters).toEqual({});
  });

  it('parses parameters with enums', () => {
    const yaml = `
name: style
description: Style text
parameters:
  format:
    type: string
    enum:
      - bold
      - italic
      - code
`;
    const skill = parseYamlSkill(yaml);
    expect(skill.parameters.format.enum).toEqual(['bold', 'italic', 'code']);
  });

  it('throws on missing name', () => {
    expect(() => parseYamlSkill('description: No name')).toThrow();
  });

  it('throws on missing description', () => {
    expect(() => parseYamlSkill('name: no-desc')).toThrow();
  });

  it('rejects invalid invocation value', () => {
    const yaml = `
name: bad
description: Bad invocation
invocation: invalid
`;
    expect(() => parseYamlSkill(yaml)).toThrow();
  });
});
