import type { McpServerHandle } from './server-handle.js';
import type { McpHealthReport, McpServerEvent, McpServerEventType } from './types.js';

export interface HealthMonitorConfig {
  intervalMs: number;
  maxRestartAttempts: number;
}

const DEFAULT_HEALTH_CONFIG: HealthMonitorConfig = {
  intervalMs: 30_000,
  maxRestartAttempts: 3,
};

export type HealthEventListener = (event: McpServerEvent) => void;

export class HealthMonitor {
  private handles: McpServerHandle[] = [];
  private restartCounts = new Map<string, number>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private listeners: HealthEventListener[] = [];
  private readonly config: HealthMonitorConfig;

  constructor(config?: Partial<HealthMonitorConfig>) {
    this.config = { ...DEFAULT_HEALTH_CONFIG, ...config };
  }

  addHandle(handle: McpServerHandle): void {
    this.handles.push(handle);
  }

  removeHandle(serverName: string): void {
    this.handles = this.handles.filter((h) => h.config.name !== serverName);
    this.restartCounts.delete(serverName);
  }

  onEvent(listener: HealthEventListener): void {
    this.listeners.push(listener);
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.checkAll();
    }, this.config.intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async checkNow(): Promise<McpHealthReport[]> {
    return this.checkAll();
  }

  getReport(): McpHealthReport[] {
    return this.handles.map((h) => h.getHealth());
  }

  private async checkAll(): Promise<McpHealthReport[]> {
    const reports: McpHealthReport[] = [];

    for (const handle of this.handles) {
      const prevStatus = handle.getStatus();
      const alive = await handle.ping();
      const report = handle.getHealth();
      reports.push(report);

      if (report.status !== prevStatus) {
        this.emit({
          type: statusToEventType(report.status),
          serverName: handle.config.name,
          namespace: handle.namespace,
          timestamp: new Date(),
        });
      }

      if (!alive && handle.getStatus() === 'unhealthy') {
        await this.tryRestart(handle);
      }
    }

    return reports;
  }

  private async tryRestart(handle: McpServerHandle): Promise<void> {
    const key = handle.config.name;
    const attempts = this.restartCounts.get(key) ?? 0;

    if (attempts >= this.config.maxRestartAttempts) {
      return;
    }

    this.restartCounts.set(key, attempts + 1);
    this.emit({
      type: 'server:restarting',
      serverName: handle.config.name,
      namespace: handle.namespace,
      timestamp: new Date(),
    });

    try {
      await handle.stop();
      await handle.start();
      this.restartCounts.set(key, 0);
      this.emit({
        type: 'server:healthy',
        serverName: handle.config.name,
        namespace: handle.namespace,
        timestamp: new Date(),
      });
    } catch (error) {
      this.emit({
        type: 'server:error',
        serverName: handle.config.name,
        namespace: handle.namespace,
        timestamp: new Date(),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private emit(event: McpServerEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}

function statusToEventType(status: string): McpServerEventType {
  switch (status) {
    case 'healthy': return 'server:healthy';
    case 'degraded': return 'server:degraded';
    case 'unhealthy': return 'server:unhealthy';
    case 'stopped': return 'server:stopped';
    default: return 'server:error';
  }
}
