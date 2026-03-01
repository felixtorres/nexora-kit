import { describe, it, expect } from 'vitest';
import { CommandParser } from './parser.js';

function createParser(): CommandParser {
  const parser = new CommandParser();
  parser.register('hello', {
    name: 'greet',
    description: 'Greet someone',
    args: [
      { name: 'name', type: 'string', required: false, default: 'World', alias: 'n', description: 'Name to greet' },
      { name: 'loud', type: 'boolean', description: 'Use uppercase' },
      { name: 'count', type: 'number', default: 1, description: 'Repeat count' },
    ],
  });
  parser.register('sys', {
    name: 'status',
    description: 'Show system status',
    args: [],
  });
  return parser;
}

describe('CommandParser', () => {
  describe('parse', () => {
    it('parses a command with named args', () => {
      const parser = createParser();
      const result = parser.parse('/hello:greet --name Felix');

      expect(result.errors).toEqual([]);
      expect(result.parsed).toEqual({
        namespace: 'hello',
        command: 'greet',
        args: { name: 'Felix', count: 1 },
      });
    });

    it('parses a command with aliases', () => {
      const parser = createParser();
      const result = parser.parse('/hello:greet -n Felix');

      expect(result.errors).toEqual([]);
      expect(result.parsed!.args.name).toBe('Felix');
    });

    it('parses boolean flags', () => {
      const parser = createParser();
      const result = parser.parse('/hello:greet --loud');

      expect(result.errors).toEqual([]);
      expect(result.parsed!.args.loud).toBe(true);
    });

    it('coerces number arguments', () => {
      const parser = createParser();
      const result = parser.parse('/hello:greet --count 5');

      expect(result.errors).toEqual([]);
      expect(result.parsed!.args.count).toBe(5);
    });

    it('applies default values', () => {
      const parser = createParser();
      const result = parser.parse('/hello:greet');

      expect(result.errors).toEqual([]);
      expect(result.parsed!.args.name).toBe('World');
      expect(result.parsed!.args.count).toBe(1);
    });

    it('parses positional arguments', () => {
      const parser = createParser();
      const result = parser.parse('/hello:greet Felix');

      expect(result.errors).toEqual([]);
      expect(result.parsed!.args.name).toBe('Felix');
    });

    it('handles quoted strings', () => {
      const parser = createParser();
      const result = parser.parse('/hello:greet --name "Felix M"');

      expect(result.errors).toEqual([]);
      expect(result.parsed!.args.name).toBe('Felix M');
    });

    it('parses command with no args definition', () => {
      const parser = createParser();
      const result = parser.parse('/sys:status');

      expect(result.errors).toEqual([]);
      expect(result.parsed).toEqual({
        namespace: 'sys',
        command: 'status',
        args: {},
      });
    });

    it('errors on missing slash', () => {
      const parser = createParser();
      const result = parser.parse('hello:greet');

      expect(result.parsed).toBeNull();
      expect(result.errors[0].message).toContain('must start with /');
    });

    it('errors on unknown command', () => {
      const parser = createParser();
      const result = parser.parse('/hello:unknown');

      expect(result.parsed).toBeNull();
      expect(result.errors[0].message).toContain('Unknown command');
    });

    it('errors on missing namespace separator', () => {
      const parser = createParser();
      const result = parser.parse('/greet');

      expect(result.parsed).toBeNull();
      expect(result.errors[0].message).toContain('expected /namespace:command');
    });

    it('errors on required missing arguments', () => {
      const parser = new CommandParser();
      parser.register('test', {
        name: 'run',
        description: 'Run test',
        args: [{ name: 'file', type: 'string', required: true }],
      });

      const result = parser.parse('/test:run');
      expect(result.parsed).toBeNull();
      expect(result.errors[0].message).toContain('Missing required');
    });

    it('validates enum values', () => {
      const parser = new CommandParser();
      parser.register('test', {
        name: 'run',
        description: 'Run test',
        args: [{ name: 'mode', type: 'string', enum: ['fast', 'slow'] }],
      });

      const result = parser.parse('/test:run --mode invalid');
      expect(result.parsed).toBeNull();
      expect(result.errors[0].message).toContain('Must be one of');
    });
  });

  describe('generateHelp', () => {
    it('lists all registered commands', () => {
      const parser = createParser();
      const help = parser.generateHelp();

      expect(help).toContain('/hello:greet');
      expect(help).toContain('/sys:status');
      expect(help).toContain('Greet someone');
    });

    it('returns message when no commands registered', () => {
      const parser = new CommandParser();
      expect(parser.generateHelp()).toBe('No commands available.');
    });
  });

  describe('generateCommandHelp', () => {
    it('generates detailed help for a command', () => {
      const parser = createParser();
      const help = parser.generateCommandHelp('hello:greet');

      expect(help).toContain('/hello:greet');
      expect(help).toContain('--name');
      expect(help).toContain('(-n)');
      expect(help).toContain('default: World');
    });

    it('returns null for unknown command', () => {
      const parser = createParser();
      expect(parser.generateCommandHelp('unknown:cmd')).toBeNull();
    });

    it('shows "No arguments" for commands with no args', () => {
      const parser = createParser();
      const help = parser.generateCommandHelp('sys:status');
      expect(help).toContain('No arguments');
    });
  });

  describe('has', () => {
    it('returns true for registered commands', () => {
      const parser = createParser();
      expect(parser.has('hello:greet')).toBe(true);
    });

    it('returns false for unregistered commands', () => {
      const parser = createParser();
      expect(parser.has('hello:unknown')).toBe(false);
    });
  });
});
