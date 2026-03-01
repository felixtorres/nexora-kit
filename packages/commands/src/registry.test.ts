import { describe, it, expect } from 'vitest';
import { CommandRegistry } from './registry.js';

describe('CommandRegistry', () => {
  it('registers and retrieves a command', () => {
    const registry = new CommandRegistry();
    registry.register('hello', { name: 'greet', description: 'Greet', args: [] });

    const entry = registry.get('hello:greet');
    expect(entry).toBeDefined();
    expect(entry!.qualifiedName).toBe('hello:greet');
    expect(entry!.namespace).toBe('hello');
  });

  it('throws on duplicate registration', () => {
    const registry = new CommandRegistry();
    registry.register('hello', { name: 'greet', description: 'Greet', args: [] });

    expect(() => registry.register('hello', { name: 'greet', description: 'Greet', args: [] })).toThrow('already registered');
  });

  it('registers a handler for a command', () => {
    const registry = new CommandRegistry();
    registry.register('hello', { name: 'greet', description: 'Greet', args: [] });

    const handler = async () => ({ content: 'hi' });
    registry.registerHandler('hello:greet', handler);

    expect(registry.get('hello:greet')!.handler).toBe(handler);
  });

  it('throws when registering handler for unknown command', () => {
    const registry = new CommandRegistry();
    expect(() => registry.registerHandler('unknown:cmd', async () => ({ content: '' }))).toThrow('not registered');
  });

  it('unregisters a command', () => {
    const registry = new CommandRegistry();
    registry.register('hello', { name: 'greet', description: 'Greet', args: [] });
    registry.unregister('hello:greet');

    expect(registry.has('hello:greet')).toBe(false);
  });

  it('unregisters all commands in a namespace', () => {
    const registry = new CommandRegistry();
    registry.register('hello', { name: 'greet', description: 'Greet', args: [] });
    registry.register('hello', { name: 'bye', description: 'Bye', args: [] });
    registry.register('sys', { name: 'status', description: 'Status', args: [] });

    registry.unregisterNamespace('hello');

    expect(registry.has('hello:greet')).toBe(false);
    expect(registry.has('hello:bye')).toBe(false);
    expect(registry.has('sys:status')).toBe(true);
  });

  it('lists all registered commands', () => {
    const registry = new CommandRegistry();
    registry.register('hello', { name: 'greet', description: 'Greet', args: [] });
    registry.register('sys', { name: 'status', description: 'Status', args: [] });

    expect(registry.list()).toHaveLength(2);
  });

  it('reports has correctly', () => {
    const registry = new CommandRegistry();
    expect(registry.has('hello:greet')).toBe(false);
    registry.register('hello', { name: 'greet', description: 'Greet', args: [] });
    expect(registry.has('hello:greet')).toBe(true);
  });
});
