#!/usr/bin/env node

import { loadEvalConfig } from './config.js';
import { runEval } from './runner.js';

interface ParsedArgs {
  flags: Record<string, string | boolean>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const flags: Record<string, string | boolean> = {};
  const booleans = new Set(['update-baseline', 'ci', 'help']);

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];

    if (arg === '--') break;

    if (arg.startsWith('--no-')) {
      flags[arg.slice(5)] = false;
      i++;
      continue;
    }

    if (arg.startsWith('--')) {
      const eqIdx = arg.indexOf('=');
      if (eqIdx !== -1) {
        flags[arg.slice(2, eqIdx)] = arg.slice(eqIdx + 1);
      } else {
        const name = arg.slice(2);
        if (booleans.has(name) || i + 1 >= argv.length || argv[i + 1].startsWith('-')) {
          flags[name] = true;
        } else {
          flags[name] = argv[i + 1];
          i++;
        }
      }
      i++;
      continue;
    }

    if (arg.startsWith('-') && arg.length === 2) {
      const aliases: Record<string, string> = {
        c: 'config',
        s: 'scenario',
        t: 'tags',
        r: 'repeat',
        o: 'output',
      };
      const name = aliases[arg[1]] ?? arg[1];
      if (booleans.has(name) || i + 1 >= argv.length || argv[i + 1].startsWith('-')) {
        flags[name] = true;
      } else {
        flags[name] = argv[i + 1];
        i++;
      }
      i++;
      continue;
    }

    i++;
  }

  return { flags };
}

function printUsage(): void {
  console.log(`
Usage: nexora-eval [options]

Options:
  --config, -c <path>    Eval config YAML (default: eval.yaml)
  --scenario, -s <path>  Single scenario file
  --tags, -t <tags>      Comma-separated tag filter
  --target <url>         Connect to running server
  --api-key <key>        API key for external server
  --repeat, -r <n>       Repetitions per case (default: 1)
  --update-baseline      Save results as new baseline
  --ci                   Exit 1 on regression/failure
  --output, -o <mode>    Output: console|json|both (default: console)
  --help                 Show this help
`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.flags['help']) {
    printUsage();
    return;
  }

  const configPath = (args.flags['config'] as string) ?? 'eval.yaml';

  const config = await loadEvalConfig(configPath, {
    config: args.flags['config'] as string | undefined,
    scenario: args.flags['scenario'] as string | undefined,
    tags: args.flags['tags'] as string | undefined,
    target: args.flags['target'] as string | undefined,
    apiKey: args.flags['api-key'] as string | undefined,
    repeat: args.flags['repeat'] as string | undefined,
    updateBaseline: args.flags['update-baseline'] as boolean | undefined,
    ci: args.flags['ci'] as boolean | undefined,
    output: args.flags['output'] as string | undefined,
  });

  const run = await runEval(config);

  // CI mode: exit 1 on failures or regressions
  if (config.ci) {
    const hasFailures = run.scenarios.some((s) => s.aggregate.passRate < 1);
    const hasRegressions = run.regressions.some((r) => r.regressed);
    const hasNewFailures = run.newFailures.length > 0;
    if (hasFailures || hasRegressions || hasNewFailures) {
      process.exit(1);
    }
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('Eval failed:', err);
  process.exit(1);
});
