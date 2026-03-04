import type { CliCommand } from './commands.js';
import { createClientFromConfig, handleApiError } from './api-client.js';
import { success, error, info, fmt, table } from './output.js';

interface BotRecord {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  pluginNamespaces: string[];
  model: string;
  temperature?: number;
  maxTurns?: number;
  workspaceId?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

function configPath(args: { flags: Record<string, string | boolean> }): string {
  return (args.flags['config'] as string) ?? 'nexora.yaml';
}

export const botCreateCommand: CliCommand = {
  name: 'bot:create',
  description: 'Create a new bot',
  usage: 'nexora-kit bot create --name <n> --model <m> --system-prompt <s> [--plugins <ns,...>] [--temperature <t>] [--max-turns <n>]',

  async run(args) {
    const name = args.flags['name'] as string;
    const model = args.flags['model'] as string;
    const systemPrompt = args.flags['system-prompt'] as string;

    if (!name || !model || !systemPrompt) {
      error('Required: --name, --model, --system-prompt');
      console.log(`\n  Usage: ${this.usage}`);
      process.exitCode = 1;
      return;
    }

    const body: Record<string, unknown> = { name, model, systemPrompt };

    const description = args.flags['description'] as string | undefined;
    if (description) body.description = description;

    const plugins = args.flags['plugins'] as string | undefined;
    if (plugins) body.pluginNamespaces = plugins.split(',').map((s) => s.trim());

    const temperature = args.flags['temperature'] as string | undefined;
    if (temperature) body.temperature = Number(temperature);

    const maxTurns = args.flags['max-turns'] as string | undefined;
    if (maxTurns) body.maxTurns = Number(maxTurns);

    const workspaceId = args.flags['workspace-id'] as string | undefined;
    if (workspaceId) body.workspaceId = workspaceId;

    try {
      const client = await createClientFromConfig(configPath(args));
      const result = await client.post<{ bot: BotRecord }>('/admin/bots', body);
      success(`Bot created: ${fmt.bold(result.bot.name)} (${result.bot.id})`);
    } catch (err) {
      handleApiError(err);
    }
  },
};

export const botListCommand: CliCommand = {
  name: 'bot:list',
  description: 'List all bots',
  usage: 'nexora-kit bot list [--config <path>]',

  async run(args) {
    try {
      const client = await createClientFromConfig(configPath(args));
      const result = await client.get<{ bots: BotRecord[] }>('/admin/bots');

      if (result.bots.length === 0) {
        info('No bots found. Create one with: nexora-kit bot create');
        return;
      }

      console.log(fmt.bold('\nBots\n'));
      table(
        ['ID', 'Name', 'Model', 'Plugins', 'Created'],
        result.bots.map((b) => [
          b.id.slice(0, 8),
          b.name,
          b.model,
          b.pluginNamespaces.length ? b.pluginNamespaces.join(', ') : '-',
          b.createdAt.slice(0, 10),
        ]),
      );
    } catch (err) {
      handleApiError(err);
    }
  },
};

export const botGetCommand: CliCommand = {
  name: 'bot:get',
  description: 'Show bot details',
  usage: 'nexora-kit bot get <id>',

  async run(args) {
    const id = args.positionals[0];
    if (!id) {
      error('Usage: nexora-kit bot get <id>');
      process.exitCode = 1;
      return;
    }

    try {
      const client = await createClientFromConfig(configPath(args));
      const result = await client.get<{ bot: BotRecord }>(`/admin/bots/${id}`);
      const b = result.bot;

      console.log(fmt.bold('\nBot Details\n'));
      console.log(`  ID:            ${b.id}`);
      console.log(`  Name:          ${b.name}`);
      console.log(`  Model:         ${b.model}`);
      console.log(`  Description:   ${b.description || '-'}`);
      console.log(`  Plugins:       ${b.pluginNamespaces.length ? b.pluginNamespaces.join(', ') : '-'}`);
      if (b.temperature != null) console.log(`  Temperature:   ${b.temperature}`);
      if (b.maxTurns != null) console.log(`  Max Turns:     ${b.maxTurns}`);
      if (b.workspaceId) console.log(`  Workspace:     ${b.workspaceId}`);
      console.log(`  Created:       ${b.createdAt}`);
      console.log(`  Updated:       ${b.updatedAt}`);
      console.log(`\n  System Prompt:\n${fmt.dim(b.systemPrompt.split('\n').map((l) => '    ' + l).join('\n'))}`);
    } catch (err) {
      handleApiError(err);
    }
  },
};

export const botUpdateCommand: CliCommand = {
  name: 'bot:update',
  description: 'Update a bot',
  usage: 'nexora-kit bot update <id> [--name <n>] [--model <m>] [--system-prompt <s>] [--plugins <ns,...>]',

  async run(args) {
    const id = args.positionals[0];
    if (!id) {
      error('Usage: nexora-kit bot update <id> [--name <n>] [--model <m>] ...');
      process.exitCode = 1;
      return;
    }

    const body: Record<string, unknown> = {};
    if (args.flags['name']) body.name = args.flags['name'] as string;
    if (args.flags['model']) body.model = args.flags['model'] as string;
    if (args.flags['system-prompt']) body.systemPrompt = args.flags['system-prompt'] as string;
    if (args.flags['description']) body.description = args.flags['description'] as string;
    if (args.flags['plugins']) body.pluginNamespaces = (args.flags['plugins'] as string).split(',').map((s) => s.trim());
    if (args.flags['temperature']) body.temperature = Number(args.flags['temperature'] as string);
    if (args.flags['max-turns']) body.maxTurns = Number(args.flags['max-turns'] as string);
    if (args.flags['workspace-id']) body.workspaceId = args.flags['workspace-id'] as string;

    if (Object.keys(body).length === 0) {
      error('No update flags provided. Use --name, --model, --system-prompt, etc.');
      process.exitCode = 1;
      return;
    }

    try {
      const client = await createClientFromConfig(configPath(args));
      const result = await client.patch<{ bot: BotRecord }>(`/admin/bots/${id}`, body);
      success(`Bot updated: ${fmt.bold(result.bot.name)} (${result.bot.id})`);
    } catch (err) {
      handleApiError(err);
    }
  },
};

export const botDeleteCommand: CliCommand = {
  name: 'bot:delete',
  description: 'Delete a bot',
  usage: 'nexora-kit bot delete <id>',

  async run(args) {
    const id = args.positionals[0];
    if (!id) {
      error('Usage: nexora-kit bot delete <id>');
      process.exitCode = 1;
      return;
    }

    try {
      const client = await createClientFromConfig(configPath(args));
      await client.delete(`/admin/bots/${id}`);
      success(`Bot deleted: ${id}`);
    } catch (err) {
      handleApiError(err);
    }
  },
};
