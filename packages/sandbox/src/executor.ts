import { Worker } from 'node:worker_threads';
import { ResourceLimiter, type ExecutionMetrics, type ResourceLimits, DEFAULT_LIMITS } from './resource-limiter.js';
import { PermissionGate } from './permissions.js';

export interface CodeExecRequest {
  code: string;
  language: 'typescript' | 'javascript';
  globals?: Record<string, unknown>;
  allowedModules?: string[];
  limits?: Partial<ResourceLimits>;
  pluginNamespace: string;
}

export interface CodeExecResult {
  output: unknown;
  stderr?: string;
  meta: ExecutionMetrics;
}

export interface AuditEntry {
  timestamp: Date;
  pluginNamespace: string;
  operation: string;
  durationMs: number;
  success: boolean;
  error?: string;
}

/**
 * Executes plugin code in a Node.js Worker thread with resource limits.
 *
 * **Security limitation:** The `allowedModules` option only intercepts `require()` calls.
 * Dynamic `import()` expressions can bypass this restriction because they are handled by
 * the V8 module loader, not by the `require` override. This is a known limitation of
 * in-process worker-thread isolation. For full module restriction, use OS-level sandboxing
 * (e.g., containers, seccomp, or Node's experimental `--experimental-permission` flag).
 */
export class CodeExecutor {
  private readonly permissionGate: PermissionGate;
  private readonly resourceLimiter: ResourceLimiter;
  private readonly auditLog: AuditEntry[] = [];
  private sandboxWarningEmitted = false;

  constructor(permissionGate: PermissionGate, resourceLimiter?: ResourceLimiter) {
    this.permissionGate = permissionGate;
    this.resourceLimiter = resourceLimiter ?? new ResourceLimiter();
  }

  isEnabled(pluginNamespace: string): boolean {
    const result = this.permissionGate.check(pluginNamespace, {
      type: 'code',
      action: 'execute',
      language: 'javascript',
    });
    return result.allowed;
  }

  async execute(request: CodeExecRequest): Promise<CodeExecResult> {
    // Check permissions
    const permCheck = this.permissionGate.check(request.pluginNamespace, {
      type: 'code',
      action: 'execute',
      language: request.language,
    });

    if (!permCheck.allowed) {
      this.logAudit(request.pluginNamespace, 'code:execute', 0, false, permCheck.reason);
      throw new Error(`Permission denied: ${permCheck.reason}`);
    }

    // Warn if allowedModules is set — import() can bypass require() interception
    if (request.allowedModules && !this.sandboxWarningEmitted) {
      this.sandboxWarningEmitted = true;
      const major = parseInt(process.versions.node.split('.')[0], 10);
      if (major < 20) {
        console.warn(
          '[nexora-kit/sandbox] allowedModules is set but dynamic import() can bypass require() interception. ' +
          'Consider upgrading to Node 20+ and using --experimental-permission for stronger isolation.',
        );
      }
    }

    // Acquire execution slot
    const slot = this.resourceLimiter.acquire();
    if (!slot) {
      const reason = 'Max concurrent executions reached';
      this.logAudit(request.pluginNamespace, 'code:execute', 0, false, reason);
      throw new Error(reason);
    }

    const limits = { ...DEFAULT_LIMITS, ...request.limits };
    const startTime = Date.now();

    try {
      const result = await this.executeInWorker(request, limits);
      const durationMs = Date.now() - startTime;
      this.logAudit(request.pluginNamespace, 'code:execute', durationMs, true);
      return result;
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const message = error instanceof Error ? error.message : String(error);
      this.logAudit(request.pluginNamespace, 'code:execute', durationMs, false, message);
      throw error;
    } finally {
      slot.release();
    }
  }

  getAuditLog(): readonly AuditEntry[] {
    return this.auditLog;
  }

  private executeInWorker(request: CodeExecRequest, limits: ResourceLimits): Promise<CodeExecResult> {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();

      // Wrap user code to capture return value
      const wrappedCode = `
        const { parentPort, workerData } = require('worker_threads');

        // Inject globals
        const globals = workerData.globals || {};
        for (const [key, value] of Object.entries(globals)) {
          globalThis[key] = value;
        }

        // Module allowlist enforcement
        const originalRequire = require;
        const allowedModules = workerData.allowedModules;
        if (allowedModules !== null) {
          const allowed = new Set(allowedModules);
          globalThis.require = (id) => {
            if (!allowed.has(id)) {
              throw new Error('Module not allowed: ' + id);
            }
            return originalRequire(id);
          };
        }

        (async () => {
          try {
            const result = await (async () => { ${request.code} })();
            parentPort.postMessage({ type: 'result', output: result });
          } catch (error) {
            parentPort.postMessage({ type: 'error', message: error.message, stack: error.stack });
          }
        })();
      `;

      const worker = new Worker(wrappedCode, {
        eval: true,
        workerData: {
          globals: request.globals ?? {},
          allowedModules: request.allowedModules ?? null,
        },
        resourceLimits: {
          maxOldGenerationSizeMb: Math.ceil(limits.memoryBytes / (1024 * 1024)),
          maxYoungGenerationSizeMb: Math.ceil(limits.memoryBytes / (1024 * 1024 * 4)),
        },
      });

      const timeout = setTimeout(() => {
        worker.terminate();
        const durationMs = Date.now() - startTime;
        resolve({
          output: null,
          stderr: 'Execution timed out',
          meta: {
            durationMs,
            memoryUsedBytes: 0,
            outputSizeBytes: 0,
            timedOut: true,
          },
        });
      }, limits.cpuTimeMs);

      worker.on('message', (msg: { type: string; output?: unknown; message?: string }) => {
        clearTimeout(timeout);
        const durationMs = Date.now() - startTime;

        if (msg.type === 'result') {
          const outputStr = JSON.stringify(msg.output ?? null);
          const outputSizeBytes = Buffer.byteLength(outputStr, 'utf8');

          if (outputSizeBytes > limits.outputBytes) {
            resolve({
              output: null,
              stderr: `Output size ${outputSizeBytes} exceeds limit ${limits.outputBytes}`,
              meta: { durationMs, memoryUsedBytes: 0, outputSizeBytes, timedOut: false },
            });
          } else {
            resolve({
              output: msg.output,
              meta: { durationMs, memoryUsedBytes: 0, outputSizeBytes, timedOut: false },
            });
          }
        } else {
          resolve({
            output: null,
            stderr: msg.message ?? 'Unknown error',
            meta: { durationMs, memoryUsedBytes: 0, outputSizeBytes: 0, timedOut: false },
          });
        }
      });

      worker.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });

      worker.on('exit', (code) => {
        clearTimeout(timeout);
        if (code !== 0) {
          const durationMs = Date.now() - startTime;
          resolve({
            output: null,
            stderr: `Worker exited with code ${code}`,
            meta: { durationMs, memoryUsedBytes: 0, outputSizeBytes: 0, timedOut: false },
          });
        }
      });
    });
  }

  private logAudit(
    pluginNamespace: string,
    operation: string,
    durationMs: number,
    success: boolean,
    error?: string,
  ): void {
    this.auditLog.push({
      timestamp: new Date(),
      pluginNamespace,
      operation,
      durationMs,
      success,
      error,
    });
  }
}
