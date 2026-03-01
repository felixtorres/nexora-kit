/**
 * Lightweight request metrics collector for the Gateway.
 * Tracks uptime, request counts, latencies, and active connections.
 * Exposes data via /v1/metrics endpoint (no external deps).
 */

export interface MetricsSnapshot {
  uptime_seconds: number;
  requests_total: number;
  requests_by_status: Record<string, number>;
  requests_by_method: Record<string, number>;
  active_connections: number;
  avg_latency_ms: number;
  p95_latency_ms: number;
  plugins_enabled: number;
  plugins_total: number;
}

export class MetricsCollector {
  private readonly startTime = Date.now();
  private requestsTotal = 0;
  private readonly statusCounts = new Map<number, number>();
  private readonly methodCounts = new Map<string, number>();
  private activeConnections = 0;
  private readonly latencies: number[] = [];
  private readonly maxLatencyBuffer = 1000;

  private pluginsEnabled = 0;
  private pluginsTotal = 0;

  recordRequest(method: string, status: number, latencyMs: number): void {
    this.requestsTotal++;
    this.statusCounts.set(status, (this.statusCounts.get(status) ?? 0) + 1);
    this.methodCounts.set(method, (this.methodCounts.get(method) ?? 0) + 1);

    this.latencies.push(latencyMs);
    if (this.latencies.length > this.maxLatencyBuffer) {
      this.latencies.shift();
    }
  }

  connectionOpened(): void {
    this.activeConnections++;
  }

  connectionClosed(): void {
    this.activeConnections = Math.max(0, this.activeConnections - 1);
  }

  updatePluginCounts(enabled: number, total: number): void {
    this.pluginsEnabled = enabled;
    this.pluginsTotal = total;
  }

  snapshot(): MetricsSnapshot {
    const statusObj: Record<string, number> = {};
    for (const [code, count] of this.statusCounts) {
      statusObj[String(code)] = count;
    }

    const methodObj: Record<string, number> = {};
    for (const [method, count] of this.methodCounts) {
      methodObj[method] = count;
    }

    const sortedLatencies = [...this.latencies].sort((a, b) => a - b);
    const avgLatency = sortedLatencies.length > 0
      ? Math.round(sortedLatencies.reduce((a, b) => a + b, 0) / sortedLatencies.length)
      : 0;
    const p95Index = Math.floor(sortedLatencies.length * 0.95);
    const p95Latency = sortedLatencies[p95Index] ?? 0;

    return {
      uptime_seconds: Math.floor((Date.now() - this.startTime) / 1000),
      requests_total: this.requestsTotal,
      requests_by_status: statusObj,
      requests_by_method: methodObj,
      active_connections: this.activeConnections,
      avg_latency_ms: avgLatency,
      p95_latency_ms: p95Latency,
      plugins_enabled: this.pluginsEnabled,
      plugins_total: this.pluginsTotal,
    };
  }

  reset(): void {
    this.requestsTotal = 0;
    this.statusCounts.clear();
    this.methodCounts.clear();
    this.latencies.length = 0;
  }
}
