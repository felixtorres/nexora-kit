import { describe, it, expect } from 'vitest';
import { CommandDispatcher } from './dispatcher.js';
import { CommandRegistry } from './registry.js';

function createDispatcher(): { dispatcher: CommandDispatcher; registry: CommandRegistry } {
  const registry = new CommandRegistry();
  registry.register('hello', {
    name: 'greet',
    description: 'Greet someone',
    args: [
      { name: 'name', type: 'string', default: 'World' },
    ],
  });
  registry.registerHandler('hello:greet', async (ctx) => ({
    content: `Hello, ${ctx.args.name}!`,
  }));

  const dispatcher = new CommandDispatcher(registry);
  dispatcher.syncFromRegistry();
  return { dispatcher, registry };
}

describe('CommandDispatcher', () => {
  describe('isCommand', () => {
    it('returns true for registered commands', () => {
      const { dispatcher } = createDispatcher();
      expect(dispatcher.isCommand('/hello:greet')).toBe(true);
    });

    it('returns true for commands with args', () => {
      const { dispatcher } = createDispatcher();
      expect(dispatcher.isCommand('/hello:greet --name Felix')).toBe(true);
    });

    it('returns false for non-slash input', () => {
      const { dispatcher } = createDispatcher();
      expect(dispatcher.isCommand('hello:greet')).toBe(false);
    });

    it('returns false for unknown commands', () => {
      const { dispatcher } = createDispatcher();
      expect(dispatcher.isCommand('/hello:unknown')).toBe(false);
    });

    it('returns false for input without namespace', () => {
      const { dispatcher } = createDispatcher();
      expect(dispatcher.isCommand('/greet')).toBe(false);
    });
  });

  describe('dispatch', () => {
    it('dispatches a command and returns result', async () => {
      const { dispatcher } = createDispatcher();
      const result = await dispatcher.dispatch('/hello:greet --name Felix');

      expect(result.content).toBe('Hello, Felix!');
      expect(result.isError).toBeUndefined();
    });

    it('applies default args', async () => {
      const { dispatcher } = createDispatcher();
      const result = await dispatcher.dispatch('/hello:greet');

      expect(result.content).toBe('Hello, World!');
    });

    it('returns error for unparseable input', async () => {
      const { dispatcher } = createDispatcher();
      const result = await dispatcher.dispatch('not a command');

      expect(result.isError).toBe(true);
    });

    it('returns error for command without handler', async () => {
      const registry = new CommandRegistry();
      registry.register('test', { name: 'nohandler', description: 'No handler', args: [] });
      const dispatcher = new CommandDispatcher(registry);
      dispatcher.syncFromRegistry();

      const result = await dispatcher.dispatch('/test:nohandler');
      expect(result.isError).toBe(true);
      expect(result.content).toContain('No handler');
    });

    it('catches handler errors', async () => {
      const registry = new CommandRegistry();
      registry.register('test', { name: 'fail', description: 'Fail', args: [] });
      registry.registerHandler('test:fail', async () => {
        throw new Error('boom');
      });
      const dispatcher = new CommandDispatcher(registry);
      dispatcher.syncFromRegistry();

      const result = await dispatcher.dispatch('/test:fail');
      expect(result.isError).toBe(true);
      expect(result.content).toContain('boom');
    });

    it('passes session to handler context', async () => {
      const registry = new CommandRegistry();
      registry.register('test', { name: 'who', description: 'Who', args: [] });
      registry.registerHandler('test:who', async (ctx) => ({
        content: `User: ${ctx.session?.userId ?? 'unknown'}`,
      }));
      const dispatcher = new CommandDispatcher(registry);
      dispatcher.syncFromRegistry();

      const result = await dispatcher.dispatch('/test:who', { id: 's1', userId: 'felix', teamId: 't1' });
      expect(result.content).toBe('User: felix');
    });
  });

  describe('help', () => {
    it('generates general help', () => {
      const { dispatcher } = createDispatcher();
      const help = dispatcher.generateHelp();
      expect(help).toContain('/hello:greet');
    });

    it('generates command-specific help', () => {
      const { dispatcher } = createDispatcher();
      const help = dispatcher.generateCommandHelp('hello:greet');
      expect(help).toContain('--name');
    });
  });
});
