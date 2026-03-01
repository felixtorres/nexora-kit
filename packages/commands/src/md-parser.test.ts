import { describe, it, expect } from 'vitest';
import { parseMdCommand } from './md-parser.js';

describe('parseMdCommand', () => {
  it('parses command with all fields', () => {
    const content = `---
description: Search the database
argument-hint: search query
---
You are a database search assistant.
Search for: {{input}}`;

    const cmd = parseMdCommand(content, 'search.md');
    expect(cmd.name).toBe('search');
    expect(cmd.description).toBe('Search the database');
    expect(cmd.args).toHaveLength(1);
    expect(cmd.args[0]).toEqual({
      name: 'input',
      type: 'string',
      required: false,
      description: 'search query',
    });
    expect(cmd.prompt).toBe('You are a database search assistant.\nSearch for: {{input}}');
  });

  it('parses command without argument-hint', () => {
    const content = `---
description: Show help information
---
Display the help menu for the user.`;

    const cmd = parseMdCommand(content, 'help.md');
    expect(cmd.name).toBe('help');
    expect(cmd.description).toBe('Show help information');
    expect(cmd.args).toEqual([]);
    expect(cmd.prompt).toBe('Display the help menu for the user.');
  });

  it('parses command with no body', () => {
    const content = `---
description: Reset the session
argument-hint: optional reason
---
`;

    const cmd = parseMdCommand(content, 'reset.md');
    expect(cmd.name).toBe('reset');
    expect(cmd.description).toBe('Reset the session');
    expect(cmd.args).toHaveLength(1);
    expect(cmd.prompt).toBeUndefined();
  });

  it('strips .md from filename to get name', () => {
    const content = `---
description: Test command
---
Body text.`;

    const cmd = parseMdCommand(content, 'my-command.md');
    expect(cmd.name).toBe('my-command');
  });

  it('throws on missing frontmatter', () => {
    const content = 'Just some text without frontmatter.';
    expect(() => parseMdCommand(content, 'bad.md')).toThrow(
      'Markdown command must have YAML frontmatter delimited by ---',
    );
  });

  it('throws on missing description', () => {
    const content = `---
argument-hint: some hint
---
Body.`;

    expect(() => parseMdCommand(content, 'no-desc.md')).toThrow();
  });
});
