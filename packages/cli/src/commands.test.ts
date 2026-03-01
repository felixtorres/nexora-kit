import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CommandRouter, type CliCommand } from './commands.js';

function makeCommand(name: string, run = vi.fn()): CliCommand {
  return {
    name,
    description: `${name} command`,
    usage: `test ${name}`,
    run,
  };
}

describe('CommandRouter', () => {
  let router: CommandRouter;

  beforeEach(() => {
    router = new CommandRouter();
  });

  it('registers and retrieves commands', () => {
    const cmd = makeCommand('init');
    router.register(cmd);
    expect(router.get('init')).toBe(cmd);
  });

  it('lists all commands', () => {
    router.register(makeCommand('init'));
    router.register(makeCommand('serve'));
    expect(router.list()).toHaveLength(2);
  });

  it('routes to the correct command', async () => {
    const run = vi.fn();
    router.register(makeCommand('init', run));
    await router.route({ positionals: ['init'], flags: {} });
    expect(run).toHaveBeenCalledWith({ positionals: [], flags: {} });
  });

  it('routes compound commands (plugin:init)', async () => {
    const run = vi.fn();
    router.register(makeCommand('plugin:init', run));
    await router.route({ positionals: ['plugin', 'init', 'my-plugin'], flags: {} });
    expect(run).toHaveBeenCalledWith({ positionals: ['my-plugin'], flags: {} });
  });

  it('falls back to parent command if compound not found', async () => {
    const run = vi.fn();
    router.register(makeCommand('plugin', run));
    await router.route({ positionals: ['plugin', 'unknown'], flags: {} });
    expect(run).toHaveBeenCalledWith({ positionals: ['unknown'], flags: {} });
  });

  it('prints help when no command given', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    router.register(makeCommand('init'));
    await router.route({ positionals: [], flags: {} });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('prints help with --help flag', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    router.register(makeCommand('init'));
    await router.route({ positionals: ['init'], flags: { help: true } });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('prints version with --version flag', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await router.route({ positionals: [], flags: { version: true } });
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('nexora-kit'));
    spy.mockRestore();
  });

  it('handles unknown commands gracefully', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await router.route({ positionals: ['foobar'], flags: {} });
    expect(process.exitCode).toBe(1);
    spy.mockRestore();
    process.exitCode = undefined;
  });
});
