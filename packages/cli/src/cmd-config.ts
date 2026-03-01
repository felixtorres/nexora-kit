import { readFile, writeFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { CliCommand } from './commands.js';
import { success, error, info, fmt } from './output.js';

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
