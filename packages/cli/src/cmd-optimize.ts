import type { CliCommand } from './commands.js';
import { success, error, info, warn, fmt, table } from './output.js';
import { createClientFromConfig, handleApiError } from './api-client.js';

function configPath(args: { flags: Record<string, string | boolean> }): string {
  return (args.flags['config'] as string) ?? 'nexora.yaml';
}

interface OptimizedPrompt {
  id: string;
  componentType: string;
  componentName: string;
  botId: string | null;
  score: number;
  scoreImprovement: number;
  optimizedForModel: string;
  status: string;
  createdAt: string;
  approvedBy: string | null;
}

// --- optimize skill <name> ---

export const optimizeSkillCommand: CliCommand = {
  name: 'optimize:skill',
  description: 'Optimize a skill prompt using GEPA',
  usage: 'nexora-kit optimize skill <name> [--bot <slug>] [--force]',

  async run(args) {
    const name = args.positionals[0];
    if (!name) {
      error('Usage: nexora-kit optimize skill <name>');
      process.exitCode = 1;
      return;
    }

    try {
      const client = await createClientFromConfig(configPath(args));
      const result = await client.post<{ status: string; message?: string; traceCount?: number }>(
        '/admin/optimize',
        {
          componentType: 'skill',
          componentName: name,
          botId: args.flags['bot'] as string | undefined,
          force: args.flags['force'] === true,
        },
      );

      if (result.status === 'not_ready') {
        warn(result.message ?? 'Not enough training data.');
        info('Use --force to override the minimum trace requirement.');
      } else {
        success(`Optimization started for skill "${name}" (${result.traceCount} traces)`);
        info('Check results: nexora-kit optimize list');
      }
    } catch (err) {
      handleApiError(err);
    }
  },
};

// --- optimize tool <name> ---

export const optimizeToolCommand: CliCommand = {
  name: 'optimize:tool',
  description: 'Optimize a tool description using GEPA',
  usage: 'nexora-kit optimize tool <name> [--force]',

  async run(args) {
    const name = args.positionals[0];
    if (!name) {
      error('Usage: nexora-kit optimize tool <name>');
      process.exitCode = 1;
      return;
    }

    try {
      const client = await createClientFromConfig(configPath(args));
      const result = await client.post<{ status: string; message?: string }>('/admin/optimize', {
        componentType: 'tool_description',
        componentName: name,
        force: args.flags['force'] === true,
      });

      if (result.status === 'not_ready') {
        warn(result.message ?? 'Not enough training data.');
      } else {
        success(`Optimization started for tool "${name}"`);
      }
    } catch (err) {
      handleApiError(err);
    }
  },
};

// --- optimize bot <slug> ---

export const optimizeBotCommand: CliCommand = {
  name: 'optimize:bot',
  description: 'Optimize a bot system prompt using GEPA',
  usage: 'nexora-kit optimize bot <slug> [--force]',

  async run(args) {
    const slug = args.positionals[0];
    if (!slug) {
      error('Usage: nexora-kit optimize bot <slug>');
      process.exitCode = 1;
      return;
    }

    try {
      const client = await createClientFromConfig(configPath(args));
      const result = await client.post<{ status: string; message?: string }>('/admin/optimize', {
        componentType: 'system_prompt',
        componentName: slug,
        botId: slug,
        force: args.flags['force'] === true,
      });

      if (result.status === 'not_ready') {
        warn(result.message ?? 'Not enough training data.');
      } else {
        success(`Optimization started for bot "${slug}"`);
      }
    } catch (err) {
      handleApiError(err);
    }
  },
};

// --- optimize list ---

export const optimizeListCommand: CliCommand = {
  name: 'optimize:list',
  description: 'List optimization candidates',
  usage:
    'nexora-kit optimize list [--status candidate|approved|active|unvalidated|rolled_back] [--type skill|tool_description|system_prompt|compaction]',

  async run(args) {
    const query: Record<string, string> = {};
    if (args.flags['status']) query.status = args.flags['status'] as string;
    if (args.flags['type']) query.componentType = args.flags['type'] as string;
    if (args.flags['bot']) query.botId = args.flags['bot'] as string;
    if (args.flags['limit']) query.limit = args.flags['limit'] as string;

    try {
      const client = await createClientFromConfig(configPath(args));
      const result = await client.get<{ candidates: OptimizedPrompt[]; count: number }>(
        '/admin/optimize/candidates',
        query,
      );

      if (result.candidates.length === 0) {
        info('No optimization candidates found.');
        return;
      }

      console.log(fmt.bold(`\nOptimization Candidates (${result.count})\n`));
      table(
        ['ID', 'Type', 'Component', 'Bot', 'Score', 'Improvement', 'Model', 'Status', 'Created'],
        result.candidates.map((c) => [
          c.id.slice(0, 8),
          c.componentType,
          c.componentName,
          c.botId ?? '-',
          c.score.toFixed(2),
          `+${(c.scoreImprovement * 100).toFixed(1)}%`,
          c.optimizedForModel,
          c.status === 'active'
            ? fmt.green(c.status)
            : c.status === 'rolled_back'
              ? fmt.red(c.status)
              : c.status,
          c.createdAt.slice(0, 10),
        ]),
      );
    } catch (err) {
      handleApiError(err);
    }
  },
};

// --- optimize approve <id> ---

export const optimizeApproveCommand: CliCommand = {
  name: 'optimize:approve',
  description: 'Approve and deploy an optimized prompt',
  usage: 'nexora-kit optimize approve <id>',

  async run(args) {
    const id = args.positionals[0];
    if (!id) {
      error('Usage: nexora-kit optimize approve <id>');
      process.exitCode = 1;
      return;
    }

    try {
      const client = await createClientFromConfig(configPath(args));
      await client.post(`/admin/optimize/candidates/${id}/approve`, {});
      success(`Prompt ${id} approved and deployed.`);
    } catch (err) {
      handleApiError(err);
    }
  },
};

// --- optimize rollback <id> ---

export const optimizeRollbackCommand: CliCommand = {
  name: 'optimize:rollback',
  description: 'Roll back an optimized prompt to original',
  usage: 'nexora-kit optimize rollback <id>',

  async run(args) {
    const id = args.positionals[0];
    if (!id) {
      error('Usage: nexora-kit optimize rollback <id>');
      process.exitCode = 1;
      return;
    }

    try {
      const client = await createClientFromConfig(configPath(args));
      await client.post(`/admin/optimize/candidates/${id}/rollback`, {});
      success(`Prompt ${id} rolled back.`);
    } catch (err) {
      handleApiError(err);
    }
  },
};

// --- optimize status ---

export const optimizeStatusCommand: CliCommand = {
  name: 'optimize:status',
  description: 'Show optimization overview and Pareto frontier',
  usage: 'nexora-kit optimize status',

  async run(args) {
    try {
      const client = await createClientFromConfig(configPath(args));

      // Get all candidates grouped by status
      const [active, candidates, unvalidated] = await Promise.all([
        client.get<{ candidates: OptimizedPrompt[]; count: number }>('/admin/optimize/candidates', {
          status: 'active',
        }),
        client.get<{ candidates: OptimizedPrompt[]; count: number }>('/admin/optimize/candidates', {
          status: 'candidate',
        }),
        client.get<{ candidates: OptimizedPrompt[]; count: number }>('/admin/optimize/candidates', {
          status: 'unvalidated',
        }),
      ]);

      console.log(fmt.bold('\nOptimization Status\n'));
      console.log(`  Active prompts:       ${fmt.green(String(active.count))}`);
      console.log(`  Pending candidates:   ${candidates.count}`);
      console.log(`  Unvalidated:          ${unvalidated.count > 0 ? fmt.red(String(unvalidated.count)) : '0'}`);

      if (active.candidates.length > 0) {
        console.log(fmt.bold('\n  Active Optimized Prompts'));
        table(
          ['Component', 'Type', 'Bot', 'Score', 'Improvement', 'Model'],
          active.candidates.map((c) => [
            c.componentName,
            c.componentType,
            c.botId ?? '-',
            c.score.toFixed(2),
            `+${(c.scoreImprovement * 100).toFixed(1)}%`,
            c.optimizedForModel,
          ]),
        );
      }

      if (unvalidated.candidates.length > 0) {
        console.log(fmt.bold(fmt.red('\n  Unvalidated (provider changed)')));
        table(
          ['Component', 'Type', 'Original Model'],
          unvalidated.candidates.map((c) => [c.componentName, c.componentType, c.optimizedForModel]),
        );
        warn('Run optimization again to re-validate these prompts for the current provider.');
      }

      console.log('');
    } catch (err) {
      handleApiError(err);
    }
  },
};
