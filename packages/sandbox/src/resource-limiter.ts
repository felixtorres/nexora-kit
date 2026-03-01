export interface ResourceLimits {
  cpuTimeMs: number;
  memoryBytes: number;
  outputBytes: number;
  networkAccess: boolean;
  fsAccess: 'none' | 'read-only' | 'temp-only';
}

export const DEFAULT_LIMITS: ResourceLimits = {
  cpuTimeMs: 30_000,
  memoryBytes: 256 * 1024 * 1024, // 256MB
  outputBytes: 1024 * 1024, // 1MB
  networkAccess: false,
  fsAccess: 'none',
};

export interface ExecutionMetrics {
  durationMs: number;
  memoryUsedBytes: number;
  outputSizeBytes: number;
  timedOut: boolean;
}

export class ResourceLimiter {
  private activeExecutions = 0;
  private readonly maxConcurrent: number;

  constructor(maxConcurrent = 5) {
    this.maxConcurrent = maxConcurrent;
  }

  canExecute(): boolean {
    return this.activeExecutions < this.maxConcurrent;
  }

  acquire(): { release: () => void } | null {
    if (!this.canExecute()) return null;
    this.activeExecutions++;
    return {
      release: () => {
        this.activeExecutions = Math.max(0, this.activeExecutions - 1);
      },
    };
  }

  get active(): number {
    return this.activeExecutions;
  }

  get capacity(): number {
    return this.maxConcurrent;
  }
}
