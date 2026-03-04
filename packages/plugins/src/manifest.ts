import { z } from 'zod';
import { parse as parseYaml } from 'yaml';
import type { PluginManifest, Permission } from '@nexora-kit/core';

const permissionValues: Permission[] = [
  'llm:invoke', 'mcp:connect', 'storage:read', 'storage:write',
  'code:execute', 'fs:read', 'fs:write', 'network:connect',
  'env:read', 'secret:read',
];

const pluginDependencySchema = z.object({
  namespace: z.string().min(1),
  version: z.string().min(1),
});

const pluginSandboxSchema = z.object({
  tier: z.enum(['none', 'basic', 'strict']),
  limits: z.object({
    memoryMb: z.number().positive().optional(),
    timeoutMs: z.number().positive().optional(),
  }).optional(),
  allowedModules: z.array(z.string()).optional(),
});

const pluginConfigFieldSchema = z.object({
  type: z.enum(['string', 'number', 'boolean']),
  description: z.string(),
  default: z.unknown().optional(),
  required: z.boolean().optional(),
});

const pluginConfigSchema = z.object({
  schema: z.record(pluginConfigFieldSchema),
});

const pluginToolsConfigSchema = z.object({
  pinned: z.array(z.string()),
});

export const pluginManifestSchema = z.object({
  name: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+/, 'Must be a valid semver version'),
  namespace: z.string().min(1).regex(/^[a-z][a-z0-9-]*$/, 'Must be lowercase with hyphens'),
  description: z.string().optional(),
  permissions: z.array(z.enum(permissionValues as [Permission, ...Permission[]])).default([]),
  dependencies: z.array(pluginDependencySchema).default([]),
  sandbox: pluginSandboxSchema.default({ tier: 'basic' }),
  tools: pluginToolsConfigSchema.optional(),
  config: pluginConfigSchema.optional(),
  skillIndex: z.boolean().optional(),
});

export function parseManifest(yamlContent: string): PluginManifest {
  const raw = parseYaml(yamlContent);
  return pluginManifestSchema.parse(raw);
}

export function validateManifest(manifest: unknown): {
  success: boolean;
  data?: PluginManifest;
  errors?: string[];
} {
  const result = pluginManifestSchema.safeParse(manifest);
  if (result.success) {
    return { success: true, data: result.data as PluginManifest };
  }
  return {
    success: false,
    errors: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
  };
}
