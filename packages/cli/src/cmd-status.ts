import type { CliCommand } from './commands.js';
import { createClientFromConfig, handleApiError, ApiError } from './api-client.js';
import { success, error, info, fmt } from './output.js';

interface HealthResponse {
  status: string;
  plugins: { total: number; enabled: number; errored: number };
  uptime: number;
}

interface MetricsResponse {
  requests_total: number;
  active_connections: number;
  avg_latency_ms: number;
  p95_latency_ms: number;
  requests_by_status: Record<string, number>;
  requests_by_method: Record<string, number>;
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(' ');
}

export const statusCommand: CliCommand = {
  name: 'status',
  description: 'Show server health, uptime, and stats',
  usage: 'nexora-kit status [--config <path>]',

  async run(args) {
    const configPath = (args.flags['config'] as string) ?? 'nexora.yaml';

    let client;
    try {
      client = await createClientFromConfig(configPath);
    } catch {
      return; // Error already printed by createClientFromConfig
    }

    // Fetch health
    let health: HealthResponse;
    try {
      health = await client.get<HealthResponse>('/health');
    } catch (err) {
      if (err instanceof ApiError) {
        error(`Server returned ${err.status}: ${err.message}`);
      } else {
        error('Cannot connect to server. Is it running? Start with: nexora-kit serve');
      }
      process.exitCode = 1;
      return;
    }

    // Fetch metrics (may not be available)
    let metrics: MetricsResponse | null = null;
    try {
      metrics = await client.get<MetricsResponse>('/metrics');
    } catch {
      // Metrics endpoint may be disabled or auth-gated — not critical
    }

    // Display
    const statusColor = health.status === 'healthy' ? fmt.green : fmt.yellow;
    console.log(fmt.bold('\nNexoraKit Server Status\n'));
    console.log(`  Status:       ${statusColor(health.status)}`);
    console.log(`  Uptime:       ${formatUptime(health.uptime)}`);
    console.log(`  Plugins:      ${health.plugins.enabled} enabled / ${health.plugins.total} total${health.plugins.errored > 0 ? fmt.red(` (${health.plugins.errored} errored)`) : ''}`);

    if (metrics) {
      console.log('');
      console.log(fmt.bold('  Requests'));
      console.log(`  Total:        ${metrics.requests_total}`);
      console.log(`  Connections:  ${metrics.active_connections}`);
      console.log(`  Avg Latency:  ${metrics.avg_latency_ms}ms`);
      console.log(`  P95 Latency:  ${metrics.p95_latency_ms}ms`);

      const statusEntries = Object.entries(metrics.requests_by_status);
      if (statusEntries.length > 0) {
        const statusStr = statusEntries.map(([code, count]) => `${code}: ${count}`).join(', ');
        console.log(`  By Status:    ${statusStr}`);
      }
    }

    console.log('');
  },
};
