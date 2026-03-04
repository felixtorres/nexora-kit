import type { CliCommand } from './commands.js';
import { createClientFromConfig, handleApiError } from './api-client.js';
import { success, error, info, fmt, table } from './output.js';

interface AgentRecord {
  id: string;
  slug: string;
  name: string;
  description: string;
  orchestrationStrategy: 'single' | 'orchestrate' | 'route';
  orchestratorModel?: string;
  botId?: string;
  fallbackBotId?: string;
  appearance: Record<string, unknown>;
  endUserAuth: Record<string, unknown>;
  rateLimits: Record<string, unknown>;
  features: Record<string, unknown>;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

interface BindingRecord {
  id: string;
  agentId: string;
  botId: string;
  priority: number;
  description: string;
  keywords: string[];
  createdAt: string;
  updatedAt: string;
}

function configPath(args: { flags: Record<string, string | boolean> }): string {
  return (args.flags['config'] as string) ?? 'nexora.yaml';
}

export const agentCreateCommand: CliCommand = {
  name: 'agent:create',
  description: 'Create a new agent',
  usage: 'nexora-kit agent create --slug <s> --name <n> [--bot <id>] [--strategy single|route|orchestrate]',

  async run(args) {
    const slug = args.flags['slug'] as string;
    const name = args.flags['name'] as string;

    if (!slug || !name) {
      error('Required: --slug, --name');
      console.log(`\n  Usage: ${this.usage}`);
      process.exitCode = 1;
      return;
    }

    const body: Record<string, unknown> = { slug, name };

    if (args.flags['bot']) body.botId = args.flags['bot'] as string;
    if (args.flags['strategy']) body.orchestrationStrategy = args.flags['strategy'] as string;
    if (args.flags['description']) body.description = args.flags['description'] as string;
    if (args.flags['orchestrator-model']) body.orchestratorModel = args.flags['orchestrator-model'] as string;
    if (args.flags['fallback-bot']) body.fallbackBotId = args.flags['fallback-bot'] as string;
    if (args.flags['welcome-message']) body.appearance = { welcomeMessage: args.flags['welcome-message'] as string };

    const authMode = args.flags['auth-mode'] as string | undefined;
    if (authMode) body.endUserAuth = { mode: authMode };

    const msgLimit = args.flags['rate-limit-messages'] as string | undefined;
    const convLimit = args.flags['rate-limit-conversations'] as string | undefined;
    if (msgLimit || convLimit) {
      const limits: Record<string, number> = {};
      if (msgLimit) limits.messagesPerMinute = Number(msgLimit);
      if (convLimit) limits.conversationsPerDay = Number(convLimit);
      body.rateLimits = limits;
    }

    try {
      const client = await createClientFromConfig(configPath(args));
      const result = await client.post<{ agent: AgentRecord }>('/admin/agents', body);
      success(`Agent created: ${fmt.bold(result.agent.name)} (slug: ${result.agent.slug}, id: ${result.agent.id})`);
      if (result.agent.botId) {
        info(`Primary bot: ${result.agent.botId}`);
      } else {
        info('No bot assigned. Use: nexora-kit agent bind <id> --bots <bot-id>');
      }
    } catch (err) {
      handleApiError(err);
    }
  },
};

export const agentListCommand: CliCommand = {
  name: 'agent:list',
  description: 'List all agents',
  usage: 'nexora-kit agent list [--config <path>]',

  async run(args) {
    try {
      const client = await createClientFromConfig(configPath(args));
      const result = await client.get<{ agents: AgentRecord[] }>('/admin/agents');

      if (result.agents.length === 0) {
        info('No agents found. Create one with: nexora-kit agent create');
        return;
      }

      console.log(fmt.bold('\nAgents\n'));
      table(
        ['ID', 'Slug', 'Name', 'Strategy', 'Enabled', 'Created'],
        result.agents.map((a) => [
          a.id.slice(0, 8),
          a.slug,
          a.name,
          a.orchestrationStrategy,
          a.enabled ? fmt.green('yes') : fmt.red('no'),
          a.createdAt.slice(0, 10),
        ]),
      );
    } catch (err) {
      handleApiError(err);
    }
  },
};

export const agentGetCommand: CliCommand = {
  name: 'agent:get',
  description: 'Show agent details',
  usage: 'nexora-kit agent get <id>',

  async run(args) {
    const id = args.positionals[0];
    if (!id) {
      error('Usage: nexora-kit agent get <id>');
      process.exitCode = 1;
      return;
    }

    try {
      const client = await createClientFromConfig(configPath(args));
      const result = await client.get<{ agent: AgentRecord; bindings: BindingRecord[] }>(`/admin/agents/${id}`);
      const a = result.agent;

      console.log(fmt.bold('\nAgent Details\n'));
      console.log(`  ID:            ${a.id}`);
      console.log(`  Slug:          ${a.slug}`);
      console.log(`  Name:          ${a.name}`);
      console.log(`  Description:   ${a.description || '-'}`);
      console.log(`  Strategy:      ${a.orchestrationStrategy}`);
      console.log(`  Enabled:       ${a.enabled ? fmt.green('yes') : fmt.red('no')}`);
      if (a.botId) console.log(`  Primary Bot:   ${a.botId}`);
      if (a.fallbackBotId) console.log(`  Fallback Bot:  ${a.fallbackBotId}`);
      if (a.orchestratorModel) console.log(`  Orch. Model:   ${a.orchestratorModel}`);

      const auth = a.endUserAuth as { mode?: string } | undefined;
      console.log(`  End-User Auth: ${auth?.mode ?? 'anonymous'}`);

      const limits = a.rateLimits as { messagesPerMinute?: number; conversationsPerDay?: number } | undefined;
      if (limits?.messagesPerMinute) console.log(`  Rate Limit:    ${limits.messagesPerMinute} msg/min`);
      if (limits?.conversationsPerDay) console.log(`  Rate Limit:    ${limits.conversationsPerDay} conv/day`);

      const features = a.features as Record<string, boolean> | undefined;
      if (features && Object.keys(features).length > 0) {
        const enabled = Object.entries(features).filter(([, v]) => v).map(([k]) => k);
        console.log(`  Features:      ${enabled.length ? enabled.join(', ') : '-'}`);
      }

      console.log(`  Created:       ${a.createdAt}`);
      console.log(`  Updated:       ${a.updatedAt}`);

      if (result.bindings && result.bindings.length > 0) {
        console.log(fmt.bold('\n  Bot Bindings\n'));
        table(
          ['Bot ID', 'Priority', 'Description', 'Keywords'],
          result.bindings.map((b) => [
            b.botId.slice(0, 8),
            String(b.priority ?? 0),
            b.description || '-',
            b.keywords?.length ? b.keywords.join(', ') : '-',
          ]),
        );
      }
    } catch (err) {
      handleApiError(err);
    }
  },
};

export const agentUpdateCommand: CliCommand = {
  name: 'agent:update',
  description: 'Update an agent',
  usage: 'nexora-kit agent update <id> [--name <n>] [--slug <s>] [--strategy <s>] [--enabled true|false]',

  async run(args) {
    const id = args.positionals[0];
    if (!id) {
      error('Usage: nexora-kit agent update <id> [--name <n>] ...');
      process.exitCode = 1;
      return;
    }

    const body: Record<string, unknown> = {};
    if (args.flags['name']) body.name = args.flags['name'] as string;
    if (args.flags['slug']) body.slug = args.flags['slug'] as string;
    if (args.flags['description']) body.description = args.flags['description'] as string;
    if (args.flags['strategy']) body.orchestrationStrategy = args.flags['strategy'] as string;
    if (args.flags['bot']) body.botId = args.flags['bot'] as string;
    if (args.flags['fallback-bot']) body.fallbackBotId = args.flags['fallback-bot'] as string;
    if (args.flags['orchestrator-model']) body.orchestratorModel = args.flags['orchestrator-model'] as string;

    if (args.flags['enabled'] !== undefined) {
      body.enabled = args.flags['enabled'] === true || args.flags['enabled'] === 'true';
    }

    const authMode = args.flags['auth-mode'] as string | undefined;
    if (authMode) body.endUserAuth = { mode: authMode };

    if (Object.keys(body).length === 0) {
      error('No update flags provided. Use --name, --slug, --strategy, --enabled, etc.');
      process.exitCode = 1;
      return;
    }

    try {
      const client = await createClientFromConfig(configPath(args));
      const result = await client.patch<{ agent: AgentRecord }>(`/admin/agents/${id}`, body);
      success(`Agent updated: ${fmt.bold(result.agent.name)} (${result.agent.slug})`);
    } catch (err) {
      handleApiError(err);
    }
  },
};

export const agentDeleteCommand: CliCommand = {
  name: 'agent:delete',
  description: 'Delete an agent',
  usage: 'nexora-kit agent delete <id>',

  async run(args) {
    const id = args.positionals[0];
    if (!id) {
      error('Usage: nexora-kit agent delete <id>');
      process.exitCode = 1;
      return;
    }

    try {
      const client = await createClientFromConfig(configPath(args));
      await client.delete(`/admin/agents/${id}`);
      success(`Agent deleted: ${id}`);
    } catch (err) {
      handleApiError(err);
    }
  },
};

export const agentBindCommand: CliCommand = {
  name: 'agent:bind',
  description: 'Set bot bindings for an agent',
  usage: 'nexora-kit agent bind <id> --bots <id1>,<id2>,... [--keywords <kw1:kw2,...>]',

  async run(args) {
    const id = args.positionals[0];
    const botsArg = args.flags['bots'] as string;

    if (!id || !botsArg) {
      error('Required: <id> and --bots');
      console.log(`\n  Usage: ${this.usage}`);
      console.log('  --keywords format: comma-separated groups, colon-separated within group');
      console.log('  Example: --bots bot1,bot2 --keywords "billing,payments:tech,code"');
      process.exitCode = 1;
      return;
    }

    const botIds = botsArg.split(',').map((s) => s.trim());
    const keywordsArg = args.flags['keywords'] as string | undefined;
    const keywordGroups = keywordsArg ? keywordsArg.split(':').map((g) => g.split(',').map((k) => k.trim())) : [];

    const bindings = botIds.map((botId, i) => ({
      botId,
      priority: botIds.length - i,
      keywords: keywordGroups[i] ?? [],
    }));

    try {
      const client = await createClientFromConfig(configPath(args));
      const result = await client.put<{ bindings: BindingRecord[] }>(`/admin/agents/${id}/bindings`, { bindings });
      success(`Bindings updated: ${result.bindings.length} bot(s) bound to agent ${id}`);

      if (result.bindings.length > 0) {
        table(
          ['Bot ID', 'Priority', 'Keywords'],
          result.bindings.map((b) => [
            b.botId.slice(0, 8),
            String(b.priority ?? 0),
            b.keywords?.length ? b.keywords.join(', ') : '-',
          ]),
        );
      }
    } catch (err) {
      handleApiError(err);
    }
  },
};
