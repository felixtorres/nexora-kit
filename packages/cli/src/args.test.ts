import { describe, it, expect } from 'vitest';
import { parseArgs } from './args.js';

describe('parseArgs', () => {
  it('parses positional arguments', () => {
    const result = parseArgs(['init', 'my-project']);
    expect(result.positionals).toEqual(['init', 'my-project']);
    expect(result.flags).toEqual({});
  });

  it('parses long flags with values', () => {
    const result = parseArgs(['serve', '--port', '3000', '--host', 'localhost']);
    expect(result.positionals).toEqual(['serve']);
    expect(result.flags).toEqual({ port: '3000', host: 'localhost' });
  });

  it('parses --flag=value syntax', () => {
    const result = parseArgs(['--port=3000', '--name=my-app']);
    expect(result.flags).toEqual({ port: '3000', name: 'my-app' });
  });

  it('parses boolean flags', () => {
    const result = parseArgs(['--help', '--verbose'], { booleans: ['help', 'verbose'] });
    expect(result.flags).toEqual({ help: true, verbose: true });
  });

  it('parses --no-* flags as false', () => {
    const result = parseArgs(['--no-color', '--no-cache']);
    expect(result.flags).toEqual({ color: false, cache: false });
  });

  it('parses short aliases', () => {
    const result = parseArgs(['-p', '3000', '-h'], {
      aliases: { p: 'port', h: 'help' },
      booleans: ['help'],
    });
    expect(result.flags).toEqual({ port: '3000', help: true });
  });

  it('treats -- as end of flags', () => {
    const result = parseArgs(['--verbose', '--', '--not-a-flag', 'positional'], {
      booleans: ['verbose'],
    });
    expect(result.flags).toEqual({ verbose: true });
    expect(result.positionals).toEqual(['--not-a-flag', 'positional']);
  });

  it('handles mixed positionals and flags', () => {
    const result = parseArgs(['plugin', 'init', '--name', 'test', 'extra'], {});
    expect(result.positionals).toEqual(['plugin', 'init', 'extra']);
    expect(result.flags).toEqual({ name: 'test' });
  });

  it('treats flag followed by another flag as boolean', () => {
    const result = parseArgs(['--verbose', '--port', '3000']);
    expect(result.flags).toEqual({ verbose: true, port: '3000' });
  });

  it('handles empty argv', () => {
    const result = parseArgs([]);
    expect(result.positionals).toEqual([]);
    expect(result.flags).toEqual({});
  });
});
