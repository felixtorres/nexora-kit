import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { completionCommand } from './cmd-completion.js';

// Mock heavy imports to avoid pulling in storage/admin deps
vi.mock('./cmd-serve.js', () => ({
  serveCommand: { name: 'serve', description: 'Start the gateway', usage: 'nexora-kit serve [--config <path>] [--port <port>] [--host <host>]', run: vi.fn() },
}));
vi.mock('./cmd-init.js', () => ({
  initCommand: { name: 'init', description: 'Scaffold a new NexoraKit instance', usage: 'nexora-kit init [directory] [--name <name>]', run: vi.fn() },
}));
vi.mock('./cmd-admin.js', () => ({
  adminUsageCommand: { name: 'admin:usage', description: 'View token usage', usage: 'nexora-kit admin usage [--breakdown daily|plugin]', run: vi.fn() },
  adminAuditCommand: { name: 'admin:audit', description: 'Query audit log', usage: 'nexora-kit admin audit [--actor <a>] [--since <date>]', run: vi.fn() },
  adminFeedbackCommand: { name: 'admin:feedback', description: 'View feedback summary', usage: 'nexora-kit admin feedback [--since <date>]', run: vi.fn() },
  adminCleanupCommand: { name: 'admin:cleanup', description: 'Purge old audit events', usage: 'nexora-kit admin cleanup [--older-than <days>] [--dry-run]', run: vi.fn() },
}));

describe('completion command', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    errSpy.mockRestore();
    process.exitCode = undefined;
  });

  it('generates fish completions', async () => {
    await completionCommand.run({
      positionals: [],
      flags: { shell: 'fish' },
    });

    const output = logSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
    expect(output).toContain('complete -c nexora-kit');
    expect(output).toContain('__nexora_no_subcommand');
    expect(output).toContain('-a init');
    expect(output).toContain('-a plugin');
    expect(output).toContain('-a bot');
    expect(output).toContain('-a agent');
    expect(output).toContain('# plugin subcommands');
    expect(output).toContain('-a create');
    expect(output).toContain('-l name');
  });

  it('generates bash completions', async () => {
    await completionCommand.run({
      positionals: [],
      flags: { shell: 'bash' },
    });

    const output = logSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
    expect(output).toContain('_nexora_kit');
    expect(output).toContain('complete -F _nexora_kit nexora-kit');
    expect(output).toContain('init');
    expect(output).toContain('plugin');
    expect(output).toContain('bot');
  });

  it('generates zsh completions', async () => {
    await completionCommand.run({
      positionals: [],
      flags: { shell: 'zsh' },
    });

    const output = logSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
    expect(output).toContain('#compdef nexora-kit');
    expect(output).toContain('_nexora-kit');
    expect(output).toContain("'init:");
    expect(output).toContain("'plugin:");
  });

  it('auto-detects shell from $SHELL', async () => {
    const prev = process.env['SHELL'];
    process.env['SHELL'] = '/usr/bin/fish';

    await completionCommand.run({
      positionals: [],
      flags: {},
    });

    const output = logSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
    expect(output).toContain('complete -c nexora-kit');

    if (prev !== undefined) process.env['SHELL'] = prev;
    else delete process.env['SHELL'];
  });

  it('fails on unknown shell', async () => {
    await completionCommand.run({
      positionals: [],
      flags: { shell: 'powershell' },
    });

    expect(process.exitCode).toBe(1);
  });

  it('includes all command groups', async () => {
    await completionCommand.run({
      positionals: [],
      flags: { shell: 'fish' },
    });

    const output = logSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
    // All top-level groups present
    for (const group of ['init', 'serve', 'status', 'plugin', 'config', 'bot', 'agent', 'admin', 'completion']) {
      expect(output).toContain(group);
    }
  });
});
