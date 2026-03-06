import { resolve } from 'node:path';
import { readFile, access } from 'node:fs/promises';
import { parse as parseYaml } from 'yaml';
import type { CliCommand } from './commands.js';
import { success, error, info, warn, fmt, table } from './output.js';
import { StorageDatabase, initSchema, SqliteUsageEventStore } from '@nexora-kit/storage';
import { UsageAnalytics } from '@nexora-kit/admin';
import { createClientFromConfig, handleApiError } from './api-client.js';

export const adminUsageCommand: CliCommand = {
  name: 'admin:usage',
  description: 'View token usage and request stats',
  usage:
    'nexora-kit admin usage [--breakdown daily|plugin] [--plugin <name>] [--since <date>] [--config <path>]',

  async run(args) {
    const configPath = resolve((args.flags['config'] as string) ?? 'nexora.yaml');

    try {
      await access(configPath);
    } catch {
      error(`Config file not found: ${configPath}`);
      error(`Run 'nexora-kit init' to create one.`);
      process.exitCode = 1;
      return;
    }

    const raw = await readFile(configPath, 'utf-8');
    const config = parseYaml(raw) as Record<string, unknown>;
    const instanceDir = resolve(configPath, '..');
    const storagePath = (config.storage as Record<string, string>)?.path ?? './data/nexora.db';
    const dbPath = resolve(instanceDir, storagePath);

    try {
      await access(dbPath);
    } catch {
      error(`Database not found: ${dbPath}`);
      error(`Start the server first with 'nexora-kit serve'.`);
      process.exitCode = 1;
      return;
    }

    const storage = new StorageDatabase({ path: dbPath });
    initSchema(storage.db);
    const usageEventStore = new SqliteUsageEventStore(storage.db);
    const analytics = new UsageAnalytics(usageEventStore);

    const breakdown = (args.flags['breakdown'] as string) ?? 'plugin';
    const filter: Record<string, string> = {};
    if (args.flags['plugin']) filter.pluginName = args.flags['plugin'] as string;
    if (args.flags['since']) filter.since = args.flags['since'] as string;

    if (breakdown === 'daily') {
      const data = await analytics.dailyBreakdown(filter);
      if (data.length === 0) {
        info('No usage data found.');
        storage.close();
        return;
      }

      console.log(fmt.bold('\nDaily Usage Breakdown\n'));
      table(
        ['Date', 'Plugin', 'Input Tokens', 'Output Tokens', 'Requests'],
        data.map((d) => [
          d.date,
          d.pluginName,
          String(d.inputTokens),
          String(d.outputTokens),
          String(d.requestCount),
        ]),
      );
    } else {
      const data = await analytics.summarizeByPlugin(filter);
      if (data.length === 0) {
        info('No usage data found.');
        storage.close();
        return;
      }

      console.log(fmt.bold('\nUsage by Plugin\n'));
      table(
        ['Plugin', 'Total Tokens', 'Input', 'Output', 'Requests', 'Avg Latency'],
        data.map((d) => [
          d.pluginName,
          String(d.totalTokens),
          String(d.totalInputTokens),
          String(d.totalOutputTokens),
          String(d.requestCount),
          d.avgLatencyMs != null ? `${d.avgLatencyMs}ms` : '-',
        ]),
      );

      const total = data.reduce((sum, d) => sum + d.totalTokens, 0);
      console.log(`\n  Total: ${fmt.bold(String(total))} tokens`);
    }

    storage.close();
  },
};

// --- admin audit (online) ---

interface AuditEvent {
  id: number;
  actor: string;
  action: string;
  target: string;
  details: Record<string, unknown>;
  result: string;
  createdAt: string;
}

function adminConfigPath(args: { flags: Record<string, string | boolean> }): string {
  return (args.flags['config'] as string) ?? 'nexora.yaml';
}

export const adminAuditCommand: CliCommand = {
  name: 'admin:audit',
  description: 'Query the audit log',
  usage:
    'nexora-kit admin audit [--actor <a>] [--action <a>] [--target <t>] [--since <date>] [--limit <n>]',

  async run(args) {
    const query: Record<string, string> = {};
    if (args.flags['actor']) query.actor = args.flags['actor'] as string;
    if (args.flags['action']) query.action = args.flags['action'] as string;
    if (args.flags['target']) query.target = args.flags['target'] as string;
    if (args.flags['since']) query.since = args.flags['since'] as string;
    if (args.flags['limit']) query.limit = args.flags['limit'] as string;

    try {
      const client = await createClientFromConfig(adminConfigPath(args));
      const result = await client.get<{ events: AuditEvent[]; count: number }>(
        '/admin/audit-log',
        query,
      );

      if (result.events.length === 0) {
        info('No audit events found.');
        return;
      }

      console.log(fmt.bold(`\nAudit Log (${result.count} events)\n`));
      table(
        ['Time', 'Actor', 'Action', 'Target', 'Result'],
        result.events.map((e) => [
          e.createdAt.slice(0, 19).replace('T', ' '),
          e.actor,
          e.action,
          e.target,
          e.result === 'success' ? fmt.green(e.result) : fmt.red(e.result),
        ]),
      );
    } catch (err) {
      handleApiError(err);
    }
  },
};

// --- admin feedback (online) ---

interface FeedbackSummary {
  totalCount: number;
  positiveCount: number;
  negativeCount: number;
  positiveRate: number;
  byPlugin: { pluginNamespace: string; positive: number; negative: number }[];
  byModel: { model: string; positive: number; negative: number }[];
  topTags: { tag: string; count: number }[];
}

export const adminFeedbackCommand: CliCommand = {
  name: 'admin:feedback',
  description: 'View feedback summary',
  usage: 'nexora-kit admin feedback [--since <date>] [--model <m>] [--plugin <ns>]',

  async run(args) {
    const query: Record<string, string> = {};
    if (args.flags['since']) query.from = args.flags['since'] as string;
    if (args.flags['model']) query.model = args.flags['model'] as string;
    if (args.flags['plugin']) query.pluginNamespace = args.flags['plugin'] as string;

    try {
      const client = await createClientFromConfig(adminConfigPath(args));
      const summary = await client.get<FeedbackSummary>('/admin/feedback/summary', query);

      if (summary.totalCount === 0) {
        info('No feedback collected yet.');
        return;
      }

      console.log(fmt.bold('\nFeedback Summary\n'));
      console.log(`  Total:     ${summary.totalCount}`);
      console.log(
        `  Positive:  ${fmt.green(String(summary.positiveCount))} (${(summary.positiveRate * 100).toFixed(1)}%)`,
      );
      console.log(`  Negative:  ${fmt.red(String(summary.negativeCount))}`);

      if (summary.byPlugin.length > 0) {
        console.log(fmt.bold('\n  By Plugin'));
        table(
          ['Plugin', 'Positive', 'Negative'],
          summary.byPlugin.map((p) => [p.pluginNamespace, String(p.positive), String(p.negative)]),
        );
      }

      if (summary.byModel.length > 0) {
        console.log(fmt.bold('\n  By Model'));
        table(
          ['Model', 'Positive', 'Negative'],
          summary.byModel.map((m) => [m.model, String(m.positive), String(m.negative)]),
        );
      }

      if (summary.topTags.length > 0) {
        console.log(fmt.bold('\n  Top Tags'));
        for (const t of summary.topTags.slice(0, 10)) {
          console.log(`    ${t.tag}: ${t.count}`);
        }
      }

      console.log('');
    } catch (err) {
      handleApiError(err);
    }
  },
};

// --- admin cleanup (online) ---

export const adminCleanupCommand: CliCommand = {
  name: 'admin:cleanup',
  description: 'Purge old audit events',
  usage: 'nexora-kit admin cleanup [--older-than <days>] [--dry-run]',

  async run(args) {
    const olderThan = Number(args.flags['older-than'] ?? 90);
    const dryRun = args.flags['dry-run'] === true;

    if (Number.isNaN(olderThan) || olderThan < 1) {
      error('--older-than must be a positive number of days');
      process.exitCode = 1;
      return;
    }

    try {
      const client = await createClientFromConfig(adminConfigPath(args));

      if (dryRun) {
        // Query to see what would be affected
        const result = await client.get<{ events: AuditEvent[]; count: number }>(
          '/admin/audit-log',
          {
            limit: '1',
          },
        );
        info(`Dry run: audit log has ${result.count} total events.`);
        info(`Would purge events older than ${olderThan} days.`);
        return;
      }

      await client.post('/admin/audit-log/purge', { olderThanDays: olderThan });
      success(`Audit log purged (events older than ${olderThan} days removed).`);
    } catch (err) {
      handleApiError(err);
    }
  },
};
