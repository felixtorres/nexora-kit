import { describe, it, expect } from 'vitest';
import { parseMdSkill } from './md-parser.js';

describe('parseMdSkill', () => {
  it('parses markdown with frontmatter and body', () => {
    const md = `---
name: summarize
description: Summarize text
invocation: model
parameters:
  text:
    type: string
    description: Text to summarize
---
Please summarize the following text concisely:

{{text}}`;

    const skill = parseMdSkill(md);

    expect(skill.name).toBe('summarize');
    expect(skill.description).toBe('Summarize text');
    expect(skill.invocation).toBe('model');
    expect(skill.parameters.text.type).toBe('string');
    expect(skill.prompt).toContain('{{text}}');
  });

  it('defaults invocation to model', () => {
    const md = `---
name: test
description: A test
---
Some prompt`;

    const skill = parseMdSkill(md);
    expect(skill.invocation).toBe('model');
  });

  it('sets prompt to undefined when body is empty', () => {
    const md = `---
name: empty
description: No body
---
`;
    const skill = parseMdSkill(md);
    expect(skill.prompt).toBeUndefined();
  });

  it('throws without frontmatter', () => {
    expect(() => parseMdSkill('Just some text')).toThrow('YAML frontmatter');
  });

  it('throws on missing name', () => {
    const md = `---
description: No name
---
body`;
    expect(() => parseMdSkill(md)).toThrow();
  });

  it('parses parameters with defaults', () => {
    const md = `---
name: greet
description: Greet
parameters:
  lang:
    type: string
    default: en
---
Hello in {{lang}}`;

    const skill = parseMdSkill(md);
    expect(skill.parameters.lang.default).toBe('en');
  });
});
