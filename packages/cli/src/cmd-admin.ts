import { resolve } from 'node:path';
import { readFile, access } from 'node:fs/promises';
import { parse as parseYaml } from 'yaml';
import type { CliCommand } from './commands.js';
import { success, error, info, fmt, table } from './output.js';
import {
  StorageDatabase, initSchema,
  SqliteUsageEventStore,
} from '@nexora-kit/storage';
import { UsageAnalytics } from '@nexora-kit/admin';

export const adminUsageCommand: CliCommand = {
  name: 'admin:usage',
  description: 'View token usage and request stats',
  usage: 'nexora-kit admin usage [--breakdown daily|plugin] [--plugin <name>] [--since <date>] [--config <path>]',

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
      const data = analytics.dailyBreakdown(filter);
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
      const data = analytics.summarizeByPlugin(filter);
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
