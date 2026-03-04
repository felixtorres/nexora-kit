import { describe, it, expect } from 'vitest';
import { parseYamlCommand } from './yaml-parser.js';

describe('parseYamlCommand', () => {
  it('parses a complete command definition', () => {
    const yaml = `
name: hello
description: Say hello
args:
  - name: name
    type: string
    required: false
    default: World
    description: Name to greet
`;
    const cmd = parseYamlCommand(yaml);

    expect(cmd.name).toBe('hello');
    expect(cmd.description).toBe('Say hello');
    expect(cmd.args).toHaveLength(1);
    expect(cmd.args[0].name).toBe('name');
    expect(cmd.args[0].type).toBe('string');
    expect(cmd.args[0].default).toBe('World');
  });

  it('defaults args to empty array', () => {
    const yaml = `
name: status
description: Show status
`;
    const cmd = parseYamlCommand(yaml);
    expect(cmd.args).toEqual([]);
  });

  it('parses multiple args with different types', () => {
    const yaml = `
name: config
description: Configure settings
args:
  - name: key
    type: string
    required: true
  - name: count
    type: number
    default: 10
  - name: verbose
    type: boolean
`;
    const cmd = parseYamlCommand(yaml);
    expect(cmd.args).toHaveLength(3);
    expect(cmd.args[0].type).toBe('string');
    expect(cmd.args[0].required).toBe(true);
    expect(cmd.args[1].type).toBe('number');
    expect(cmd.args[1].default).toBe(10);
    expect(cmd.args[2].type).toBe('boolean');
  });

  it('parses args with aliases', () => {
    const yaml = `
name: test
description: Run tests
args:
  - name: filter
    type: string
    alias: f
`;
    const cmd = parseYamlCommand(yaml);
    expect(cmd.args[0].alias).toBe('f');
  });

  it('throws on missing name', () => {
    expect(() => parseYamlCommand('description: No name')).toThrow();
  });

  it('throws on missing description', () => {
    expect(() => parseYamlCommand('name: no-desc')).toThrow();
  });

  it('parses prompt field', () => {
    const yaml = `
name: greet
description: Greet someone
prompt: "Hello, {{name}}!"
args:
  - name: name
    type: string
`;
    const cmd = parseYamlCommand(yaml);
    expect(cmd.prompt).toBe('Hello, {{name}}!');
  });

  it('prompt is undefined when not specified', () => {
    const yaml = `
name: status
description: Show status
`;
    const cmd = parseYamlCommand(yaml);
    expect(cmd.prompt).toBeUndefined();
  });
});
