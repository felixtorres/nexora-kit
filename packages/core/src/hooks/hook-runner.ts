import { spawn } from 'node:child_process';
import type { HookEventPayload, HookResult } from './hook-events.js';
import type { RegisteredHook } from './hook-registry.js';

/**
 * Execute a hook by spawning its command as a child process.
 *
 * Protocol (matches Claude Code):
 * - Input: JSON on stdin (HookEventPayload)
 * - Exit 0: Allow action. stdout may contain injected context.
 * - Exit 2: Block action. stderr contains the reason.
 * - Other exit: Allow action, log stderr.
 */
export async function runHook(
  hook: RegisteredHook,
  payload: HookEventPayload,
  timeoutMs = 5000,
): Promise<HookResult> {
  return new Promise((resolve) => {
    const child = spawn(hook.config.command, hook.config.args ?? [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: timeoutMs,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
    child.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

    child.on('error', (err) => {
      // Process spawn failed — allow but log
      resolve({ verdict: 'allow', reason: `Hook error: ${err.message}` });
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve({
          verdict: 'allow',
          injectedContext: stdout.trim() || undefined,
        });
      } else if (code === 2) {
        resolve({
          verdict: 'block',
          reason: stderr.trim() || 'Blocked by hook',
        });
      } else {
        // Non-zero, non-2: allow but log the error
        resolve({
          verdict: 'allow',
          reason: stderr.trim() || undefined,
        });
      }
    });

    // Send payload on stdin — ignore EPIPE if process exits before reading
    child.stdin.on('error', () => { /* ignore EPIPE */ });
    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}

/**
 * Run all hooks for an event and aggregate results.
 * If ANY hook blocks, the action is blocked.
 */
export async function runHooks(
  hooks: RegisteredHook[],
  payload: HookEventPayload,
  timeoutMs = 5000,
): Promise<HookResult> {
  if (hooks.length === 0) {
    return { verdict: 'allow' };
  }

  const results = await Promise.all(
    hooks.map((hook) => runHook(hook, payload, timeoutMs)),
  );

  // If any hook blocks, the action is blocked
  const blocked = results.find((r) => r.verdict === 'block');
  if (blocked) {
    return blocked;
  }

  // Collect injected context from all allowing hooks
  const injected = results
    .filter((r) => r.injectedContext)
    .map((r) => r.injectedContext!)
    .join('\n');

  return {
    verdict: 'allow',
    injectedContext: injected || undefined,
  };
}
