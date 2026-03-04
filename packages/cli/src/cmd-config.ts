import { readFile, writeFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { CliCommand } from './commands.js';
import { success, error, warn, info, fmt } from './output.js';

export const configGetCommand: CliCommand = {
  name: 'config:get',
  description: 'Get a configuration value',
  usage: 'nexora-kit config get <key> [--config <path>]',

  async run(args) {
    const key = args.positionals[0];
    if (!key) {
      error('Key is required: nexora-kit config get <key>');
      process.exitCode = 1;
      return;
    }

    const config = await loadConfig(args.flags['config'] as string);
    if (!config) return;

    const value = getNestedValue(config, key);
    if (value === undefined) {
      error(`Key "${key}" not found`);
      process.exitCode = 1;
      return;
    }

    if (typeof value === 'object') {
      console.log(stringifyYaml(value).trim());
    } else {
      console.log(String(value));
    }
  },
};

export const configSetCommand: CliCommand = {
  name: 'config:set',
  description: 'Set a configuration value',
  usage: 'nexora-kit config set <key> <value> [--config <path>]',

  async run(args) {
    const key = args.positionals[0];
    const value = args.positionals[1];
    if (!key || value === undefined) {
      error('Key and value required: nexora-kit config set <key> <value>');
      process.exitCode = 1;
      return;
    }

    const configPath = resolve((args.flags['config'] as string) ?? 'nexora.yaml');
    const config = await loadConfig(args.flags['config'] as string);
    if (!config) return;

    // Coerce value
    const coerced = coerceValue(value);

    // Set nested value
    setNestedValue(config, key, coerced);

    // Write back
    await writeFile(configPath, stringifyYaml(config), 'utf-8');
    success(`Set ${fmt.bold(key)} = ${JSON.stringify(coerced)}`);
  },
};

async function loadConfig(configFlag?: string): Promise<Record<string, unknown> | null> {
  const configPath = resolve(configFlag ?? 'nexora.yaml');
  try {
    await access(configPath);
  } catch {
    error(`Config file not found: ${configPath}`);
    process.exitCode = 1;
    return null;
  }

  const raw = await readFile(configPath, 'utf-8');
  return parseYaml(raw) as Record<string, unknown>;
}

function getNestedValue(obj: Record<string, unknown>, key: string): unknown {
  const parts = key.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function setNestedValue(obj: Record<string, unknown>, key: string, value: unknown): void {
  const parts = key.split('.');
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!(part in current) || typeof current[part] !== 'object') {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]] = value;
}

function coerceValue(value: string): unknown {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null') return null;
  const num = Number(value);
  if (!Number.isNaN(num) && value.trim() !== '') return num;
  return value;
}

/** Resolve ${ENV_VAR} placeholders, returning the result and any missing vars. */
function interpolateEnvVars(raw: string): { result: string; missing: string[] } {
  const missing: string[] = [];
  const result = raw.replace(/\$\{([^}]+)\}/g, (_, name) => {
    const value = process.env[name];
    if (value === undefined) missing.push(name);
    return value ?? `\${${name}}`;
  });
  return { result, missing };
}

const REQUIRED_FIELDS = ['port', 'auth'] as const;
const VALID_AUTH_TYPES = ['api-key', 'jwt', 'composite'] as const;
const VALID_STRATEGIES = ['single', 'orchestrate', 'route'] as const;

export const configValidateCommand: CliCommand = {
  name: 'config:validate',
  description: 'Validate configuration file',
  usage: 'nexora-kit config validate [--config <path>]',

  async run(args) {
    const configPath = resolve((args.flags['config'] as string) ?? 'nexora.yaml');
    const issues: string[] = [];

    try {
      await access(configPath);
    } catch {
      error(`Config file not found: ${configPath}`);
      process.exitCode = 1;
      return;
    }

    const raw = await readFile(configPath, 'utf-8');

    // Check env var resolution
    const { result: interpolated, missing } = interpolateEnvVars(raw);
    if (missing.length > 0) {
      for (const v of missing) {
        warn(`Environment variable not set: ${v}`);
      }
    }

    let config: Record<string, unknown>;
    try {
      config = parseYaml(interpolated) as Record<string, unknown>;
    } catch (err) {
      error(`YAML parse error: ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
      return;
    }

    if (!config || typeof config !== 'object') {
      issues.push('Config must be a YAML object');
    } else {
      // Required fields
      for (const field of REQUIRED_FIELDS) {
        if (!(field in config)) {
          issues.push(`Missing required field: ${field}`);
        }
      }

      // Port validation
      if ('port' in config) {
        const port = Number(config.port);
        if (!Number.isInteger(port) || port < 1 || port > 65535) {
          issues.push(`Invalid port: ${config.port} (must be 1-65535)`);
        }
      }

      // Auth validation
      const auth = config.auth as Record<string, unknown> | undefined;
      if (auth) {
        if (auth.type && !VALID_AUTH_TYPES.includes(auth.type as typeof VALID_AUTH_TYPES[number])) {
          issues.push(`Invalid auth.type: ${auth.type} (expected: ${VALID_AUTH_TYPES.join(', ')})`);
        }
        const keys = auth.keys as Array<Record<string, unknown>> | undefined;
        if (auth.type === 'api-key' && (!keys || keys.length === 0)) {
          issues.push('auth.type is api-key but no auth.keys defined');
        }
        if (keys) {
          for (let i = 0; i < keys.length; i++) {
            if (!keys[i].key) issues.push(`auth.keys[${i}] missing "key" field`);
            if (!keys[i].role) issues.push(`auth.keys[${i}] missing "role" field`);
          }
        }
      }

      // LLM validation
      const llm = config.llm as Record<string, unknown> | undefined;
      if (llm) {
        if (!llm.provider) issues.push('llm.provider is required when llm block is present');
      }

      // Storage validation
      const storage = config.storage as Record<string, unknown> | undefined;
      if (storage && !storage.path && !storage.host) {
        issues.push('storage must have either "path" (SQLite) or "host" (PostgreSQL)');
      }
    }

    // Report results
    console.log('');
    if (missing.length > 0) {
      warn(`${missing.length} unresolved environment variable(s)`);
    }

    if (issues.length === 0) {
      success(fmt.bold('Configuration is valid'));
    } else {
      for (const issue of issues) {
        error(issue);
      }
      error(fmt.bold(`${issues.length} issue(s) found`));
      process.exitCode = 1;
    }
  },
};

export const configShowCommand: CliCommand = {
  name: 'config:show',
  description: 'Show effective configuration with env vars resolved',
  usage: 'nexora-kit config show [--config <path>]',

  async run(args) {
    const configPath = resolve((args.flags['config'] as string) ?? 'nexora.yaml');

    try {
      await access(configPath);
    } catch {
      error(`Config file not found: ${configPath}`);
      process.exitCode = 1;
      return;
    }

    const raw = await readFile(configPath, 'utf-8');
    const { result: interpolated, missing } = interpolateEnvVars(raw);

    if (missing.length > 0) {
      warn(`${missing.length} environment variable(s) not set: ${missing.join(', ')}`);
      console.log('');
    }

    let config: Record<string, unknown>;
    try {
      config = parseYaml(interpolated) as Record<string, unknown>;
    } catch (err) {
      error(`YAML parse error: ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
      return;
    }

    // Mask sensitive values
    const masked = maskSecrets(structuredClone(config));

    console.log(fmt.bold(`\nEffective Configuration (${configPath})\n`));
    console.log(stringifyYaml(masked).trim());
  },
};

function maskSecrets(obj: Record<string, unknown>): Record<string, unknown> {
  const sensitiveKeys = ['key', 'apiKey', 'secret', 'jwtSecret', 'password', 'wso2ClientSecret'];
  for (const [k, v] of Object.entries(obj)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      maskSecrets(v as Record<string, unknown>);
    } else if (Array.isArray(v)) {
      for (const item of v) {
        if (item && typeof item === 'object') maskSecrets(item as Record<string, unknown>);
      }
    } else if (typeof v === 'string' && sensitiveKeys.includes(k) && v.length > 0) {
      obj[k] = v.slice(0, 4) + '****';
    }
  }
  return obj;
}
