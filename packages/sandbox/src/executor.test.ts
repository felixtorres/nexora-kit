import { describe, it, expect, beforeEach } from 'vitest';
import { CodeExecutor } from './executor.js';
import { PermissionGate } from './permissions.js';
import { ResourceLimiter } from './resource-limiter.js';

describe('CodeExecutor', () => {
  let executor: CodeExecutor;
  let gate: PermissionGate;

  beforeEach(() => {
    gate = new PermissionGate();
    executor = new CodeExecutor(gate, new ResourceLimiter(3));
  });

  it('denies execution without code:execute permission', async () => {
    await expect(
      executor.execute({
        code: 'return 42;',
        language: 'javascript',
        pluginNamespace: 'test-plugin',
      }),
    ).rejects.toThrow('Permission denied');
  });

  it('checks if code mode is enabled', () => {
    expect(executor.isEnabled('test-plugin')).toBe(false);
    gate.grant('test-plugin', 'code:execute');
    expect(executor.isEnabled('test-plugin')).toBe(true);
  });

  it('executes simple JavaScript code', async () => {
    gate.grant('test-plugin', 'code:execute');
    const result = await executor.execute({
      code: 'return 2 + 2;',
      language: 'javascript',
      pluginNamespace: 'test-plugin',
    });
    expect(result.output).toBe(4);
    expect(result.meta.timedOut).toBe(false);
  });

  it('executes code with globals', async () => {
    gate.grant('test-plugin', 'code:execute');
    const result = await executor.execute({
      code: 'return greeting + " " + name;',
      language: 'javascript',
      pluginNamespace: 'test-plugin',
      globals: { greeting: 'Hello', name: 'World' },
    });
    expect(result.output).toBe('Hello World');
  });

  it('captures errors from code execution', async () => {
    gate.grant('test-plugin', 'code:execute');
    const result = await executor.execute({
      code: 'throw new Error("boom");',
      language: 'javascript',
      pluginNamespace: 'test-plugin',
    });
    expect(result.stderr).toContain('boom');
  });

  it('times out on long-running code', async () => {
    gate.grant('test-plugin', 'code:execute');
    const result = await executor.execute({
      code: 'while(true) {}',
      language: 'javascript',
      pluginNamespace: 'test-plugin',
      limits: { cpuTimeMs: 500 },
    });
    expect(result.meta.timedOut).toBe(true);
    expect(result.stderr).toContain('timed out');
  }, 10_000);

  it('blocks disallowed module imports', async () => {
    gate.grant('test-plugin', 'code:execute');
    const result = await executor.execute({
      code: 'const fs = require("fs"); return fs.existsSync("/");',
      language: 'javascript',
      pluginNamespace: 'test-plugin',
      allowedModules: ['lodash'],
    });
    expect(result.stderr).toContain('not allowed');
  });

  it('blocks all module imports when allowedModules is empty', async () => {
    gate.grant('test-plugin', 'code:execute');
    const result = await executor.execute({
      code: 'const path = require("path"); return path.sep;',
      language: 'javascript',
      pluginNamespace: 'test-plugin',
      allowedModules: [],
    });
    expect(result.stderr).toContain('not allowed');
  });

  it('allows all modules when allowedModules is not specified', async () => {
    gate.grant('test-plugin', 'code:execute');
    const result = await executor.execute({
      code: 'const path = require("path"); return path.sep;',
      language: 'javascript',
      pluginNamespace: 'test-plugin',
    });
    expect(result.output).toBeDefined();
    expect(result.stderr).toBeUndefined();
  });

  it('logs audit entries', async () => {
    gate.grant('test-plugin', 'code:execute');
    await executor.execute({
      code: 'return "ok";',
      language: 'javascript',
      pluginNamespace: 'test-plugin',
    });

    const log = executor.getAuditLog();
    expect(log).toHaveLength(1);
    expect(log[0].success).toBe(true);
    expect(log[0].pluginNamespace).toBe('test-plugin');
    expect(log[0].operation).toBe('code:execute');
  });

  it('logs audit on permission denial', async () => {
    try {
      await executor.execute({
        code: 'return 42;',
        language: 'javascript',
        pluginNamespace: 'denied-plugin',
      });
    } catch {
      // expected
    }

    const log = executor.getAuditLog();
    expect(log).toHaveLength(1);
    expect(log[0].success).toBe(false);
    expect(log[0].pluginNamespace).toBe('denied-plugin');
  });

  it('denies when concurrency limit reached', async () => {
    gate.grant('test-plugin', 'code:execute');
    const limiter = new ResourceLimiter(0); // no slots available
    const exec = new CodeExecutor(gate, limiter);

    await expect(
      exec.execute({
        code: 'return 42;',
        language: 'javascript',
        pluginNamespace: 'test-plugin',
      }),
    ).rejects.toThrow('concurrent');
  });
});
