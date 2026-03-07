import { readFile } from 'node:fs/promises';
import { parse as parseYaml } from 'yaml';
import type { EvalConfig, EvalTarget, RegressionThresholds } from './types.js';

interface RawEvalConfig {
  target?: {
    type?: 'config' | 'url';
    configPath?: string;
    url?: string;
    apiKey?: string;
    adminApiKey?: string;
  };
  scenarios?: string[];
  tags?: string[];
  repeat?: number;
  concurrency?: number;
  baselineDir?: string;
  regression?: Partial<RegressionThresholds>;
  output?: 'console' | 'json' | 'both';
}

interface CliOverrides {
  config?: string;
  scenario?: string;
  tags?: string;
  target?: string;
  apiKey?: string;
  repeat?: string;
  updateBaseline?: boolean;
  ci?: boolean;
  output?: string;
}

const DEFAULT_REGRESSION: RegressionThresholds = {
  maxTokenIncrease: 0.15,
  maxLatencyIncrease: 0.25,
  maxPassRateDecrease: 0.05,
};

export async function loadEvalConfig(configPath: string, overrides: CliOverrides): Promise<EvalConfig> {
  let raw: RawEvalConfig = {};

  try {
    const content = await readFile(configPath, 'utf-8');
    const interpolated = content.replace(/\$\{([^}]+)\}/g, (_, name) => {
      return process.env[name] ?? '';
    });
    raw = parseYaml(interpolated) as RawEvalConfig ?? {};
  } catch {
    // No config file — use defaults + CLI overrides
  }

  // Resolve target
  let target: EvalTarget;
  if (overrides.target) {
    target = {
      type: 'url',
      url: overrides.target,
      apiKey: overrides.apiKey ?? 'dev-key',
    };
  } else if (raw.target?.type === 'url' && raw.target.url) {
    target = {
      type: 'url',
      url: raw.target.url,
      apiKey: raw.target.apiKey ?? 'dev-key',
      adminApiKey: raw.target.adminApiKey,
    };
  } else {
    target = {
      type: 'config',
      configPath: raw.target?.configPath ?? 'nexora.yaml',
    };
  }

  // Resolve scenarios
  let scenarios = raw.scenarios ?? [];
  if (overrides.scenario) {
    scenarios = [overrides.scenario];
  }

  // Resolve tags
  let tags = raw.tags;
  if (overrides.tags) {
    tags = overrides.tags.split(',').map((t) => t.trim());
  }

  return {
    target,
    scenarios,
    tags,
    repeat: overrides.repeat ? Number(overrides.repeat) : (raw.repeat ?? 1),
    concurrency: raw.concurrency ?? 1,
    baselineDir: raw.baselineDir ?? './eval-baselines',
    regression: {
      ...DEFAULT_REGRESSION,
      ...raw.regression,
    },
    output: (overrides.output as EvalConfig['output']) ?? raw.output ?? 'console',
    updateBaseline: overrides.updateBaseline ?? false,
    ci: overrides.ci ?? false,
  };
}
