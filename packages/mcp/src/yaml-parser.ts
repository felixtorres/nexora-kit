import { parse as parseYaml } from 'yaml';
import { mcpConfigSchema, type McpServerConfig } from './types.js';

const TEMPLATE_PATTERN = /\{\{(\s*config\.([a-zA-Z0-9_.]+)\s*)\}\}/g;

export interface TemplateResolver {
  get(key: string): string | undefined;
}

export function resolveTemplates(
  configs: McpServerConfig[],
  resolver?: TemplateResolver,
): McpServerConfig[] {
  if (!resolver) return configs;

  const resolveString = (value: string): string =>
    value.replace(TEMPLATE_PATTERN, (_match, _full, key: string) => {
      const resolved = resolver.get(key);
      if (resolved === undefined) {
        throw new Error(`Unresolved template variable: config.${key}`);
      }
      return resolved;
    });

  const resolveRecord = (record: Record<string, string>): Record<string, string> => {
    const result: Record<string, string> = {};
    for (const [k, v] of Object.entries(record)) {
      result[k] = resolveString(v);
    }
    return result;
  };

  return configs.map((config) => ({
    ...config,
    command: config.command ? resolveString(config.command) : undefined,
    args: config.args?.map(resolveString),
    env: config.env ? resolveRecord(config.env) : undefined,
    url: config.url ? resolveString(config.url) : undefined,
    headers: config.headers ? resolveRecord(config.headers) : undefined,
  }));
}

export function parseMcpYaml(
  content: string,
  resolver?: TemplateResolver,
): McpServerConfig[] {
  const raw = parseYaml(content);

  // If a resolver is provided, resolve templates in raw YAML before Zod validation
  // so template strings like "{{config.url}}" pass URL validation
  if (resolver) {
    resolveRawTemplates(raw, resolver);
  }

  const parsed = mcpConfigSchema.parse(raw);
  return parsed.servers;
}

function resolveRawTemplates(obj: unknown, resolver: TemplateResolver): void {
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      if (typeof obj[i] === 'string') {
        obj[i] = resolveStringTemplates(obj[i], resolver);
      } else {
        resolveRawTemplates(obj[i], resolver);
      }
    }
  } else if (obj && typeof obj === 'object') {
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'string') {
        (obj as Record<string, unknown>)[key] = resolveStringTemplates(value, resolver);
      } else {
        resolveRawTemplates(value, resolver);
      }
    }
  }
}

function resolveStringTemplates(value: string, resolver: TemplateResolver): string {
  return value.replace(TEMPLATE_PATTERN, (_match, _full, key: string) => {
    const resolved = resolver.get(key);
    if (resolved === undefined) {
      throw new Error(`Unresolved template variable: config.${key}`);
    }
    return resolved;
  });
}
