import * as fs from 'node:fs';
import * as path from 'node:path';
import type { PluginManifest, ToolDefinition, Permission } from '@nexora-kit/core';
import type { SkillDefinition } from '@nexora-kit/skills';
import type { CommandDefinition } from '@nexora-kit/commands';
import type { McpServerConfig, McpTransportType } from '@nexora-kit/mcp';
import { parseMdSkill } from '@nexora-kit/skills';
import { parseMdCommand } from '@nexora-kit/commands';
import { qualifyName } from './namespace.js';
import { discoverSkillResources } from './resource-discovery.js';
import type { LoadResult } from './loader.js';

interface ClaudePluginJson {
  name: string;
  version?: string;
  description?: string;
  author?: string | { name: string; email?: string; url?: string };
  homepage?: string;
  repository?: string;
  license?: string;
  keywords?: string[];
  skills?: string;
  commands?: string[];
  agents?: string;
  hooks?: string;
  mcpServers?: string | ClaudeMcpServerMap;
  lspServers?: string;
  settings?: Record<string, unknown>;
}

type ClaudeMcpServerMap = Record<
  string,
  {
    type?: string;
    url?: string;
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    headers?: Record<string, string>;
  }
>;

interface ClaudeMcpJson {
  mcpServers?: ClaudeMcpServerMap;
}

function resolveTransportType(type?: string): McpTransportType {
  if (type === 'stdio') return 'stdio';
  if (type === 'http') return 'http';
  return 'sse';
}

/**
 * Expand ${VAR} and ${VAR:default} references using process.env, then
 * replace ${CLAUDE_PLUGIN_ROOT} with the plugin directory path.
 *
 * Expansion order:
 *   1. ${VAR:default} — use process.env[VAR] if set, otherwise "default"
 *   2. ${VAR}         — use process.env[VAR] if set, otherwise leave as-is
 *   3. ${CLAUDE_PLUGIN_ROOT} — replaced with pluginDir (treated as a named var above)
 */
function substituteValue(value: string, pluginDir: string): string {
  return value.replace(/\$\{([^}]+)\}/g, (_match, inner: string) => {
    const colonIdx = inner.indexOf(':');
    if (colonIdx !== -1) {
      const varName = inner.slice(0, colonIdx);
      const fallback = inner.slice(colonIdx + 1);
      if (varName === 'CLAUDE_PLUGIN_ROOT') return pluginDir;
      return process.env[varName] ?? fallback;
    }
    if (inner === 'CLAUDE_PLUGIN_ROOT') return pluginDir;
    return process.env[inner] ?? _match;
  });
}

function substituteMcpConfig(servers: ClaudeMcpServerMap, pluginDir: string): ClaudeMcpServerMap {
  const result: ClaudeMcpServerMap = {};
  for (const [name, config] of Object.entries(servers)) {
    result[name] = {
      ...config,
      url: config.url ? substituteValue(config.url, pluginDir) : config.url,
      command: config.command ? substituteValue(config.command, pluginDir) : config.command,
      args: config.args?.map((a) => substituteValue(a, pluginDir)),
      env: config.env
        ? Object.fromEntries(
            Object.entries(config.env).map(([k, v]) => [k, substituteValue(v, pluginDir)]),
          )
        : config.env,
      headers: config.headers
        ? Object.fromEntries(
            Object.entries(config.headers).map(([k, v]) => [k, substituteValue(v, pluginDir)]),
          )
        : config.headers,
    };
  }
  return result;
}

function parseMcpServers(servers: ClaudeMcpServerMap, pluginDir: string): McpServerConfig[] {
  const substituted = substituteMcpConfig(servers, pluginDir);
  const configs: McpServerConfig[] = [];
  for (const [name, config] of Object.entries(substituted)) {
    configs.push({
      name,
      transport: resolveTransportType(config.type),
      url: config.url,
      command: config.command,
      args: config.args,
      env: config.env,
      headers: config.headers,
    });
  }
  return configs;
}

export function isClaudePlugin(dir: string): boolean {
  return fs.existsSync(path.join(dir, '.claude-plugin', 'plugin.json'));
}

export function isMcpPlugin(dir: string): boolean {
  return fs.existsSync(path.join(dir, '.mcp.json'));
}

export function loadMcpPlugin(pluginDir: string): LoadResult {
  const errors: string[] = [];

  const mcpJsonPath = path.join(pluginDir, '.mcp.json');
  let mcpJson: ClaudeMcpJson;
  try {
    mcpJson = JSON.parse(fs.readFileSync(mcpJsonPath, 'utf-8'));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      plugin: {
        manifest: {
          name: '',
          version: '0.0.0',
          namespace: '',
          permissions: [],
          dependencies: [],
          sandbox: { tier: 'basic' },
        },
        state: 'errored',
        tools: [],
        error: `Invalid .mcp.json: ${msg}`,
      },
      errors: [`Invalid .mcp.json: ${msg}`],
      skillDefinitions: new Map(),
      commandDefinitions: new Map(),
      mcpServerConfigs: [],
    };
  }

  // Derive name/version/description from package.json if available
  let name = path.basename(pluginDir);
  let version = '0.0.0';
  let description: string | undefined;
  const pkgPath = path.join(pluginDir, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as {
        name?: string;
        version?: string;
        description?: string;
      };
      if (pkg.name) name = pkg.name.replace(/^@[^/]+\//, ''); // strip npm scope
      if (pkg.version) version = pkg.version;
      if (pkg.description) description = pkg.description;
    } catch {
      /* ignore, use defaults */
    }
  }

  const namespace = name.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const manifest: PluginManifest = {
    name,
    version,
    namespace,
    description,
    permissions: ['mcp:connect', 'network:connect'] as Permission[],
    dependencies: [],
    sandbox: { tier: 'basic' },
    format: 'mcp',
  };

  const mcpServerConfigs = mcpJson.mcpServers ? parseMcpServers(mcpJson.mcpServers, pluginDir) : [];

  if (mcpServerConfigs.length === 0) {
    errors.push('No MCP servers defined in .mcp.json');
  }

  return {
    plugin: {
      manifest,
      state: errors.length > 0 ? 'errored' : 'installed',
      tools: [], // MCP tools are discovered at runtime when the server starts
      error: errors.length > 0 ? errors.join('; ') : undefined,
    },
    errors,
    skillDefinitions: new Map(),
    commandDefinitions: new Map(),
    mcpServerConfigs,
  };
}

export function loadClaudePlugin(pluginDir: string): LoadResult {
  const errors: string[] = [];

  // 1. Read .claude-plugin/plugin.json
  const pluginJsonPath = path.join(pluginDir, '.claude-plugin', 'plugin.json');
  if (!fs.existsSync(pluginJsonPath)) {
    return {
      plugin: {
        manifest: {
          name: '',
          version: '0.0.0',
          namespace: '',
          permissions: [],
          dependencies: [],
          sandbox: { tier: 'basic' },
        },
        state: 'errored',
        tools: [],
        error: `No .claude-plugin/plugin.json found in ${pluginDir}`,
      },
      errors: [`No .claude-plugin/plugin.json found in ${pluginDir}`],
      skillDefinitions: new Map(),
      commandDefinitions: new Map(),
      mcpServerConfigs: [],
    };
  }

  let pluginJson: ClaudePluginJson;
  try {
    pluginJson = JSON.parse(fs.readFileSync(pluginJsonPath, 'utf-8'));
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      plugin: {
        manifest: {
          name: '',
          version: '0.0.0',
          namespace: '',
          permissions: [],
          dependencies: [],
          sandbox: { tier: 'basic' },
        },
        state: 'errored',
        tools: [],
        error: `Invalid plugin.json: ${msg}`,
      },
      errors: [`Invalid plugin.json: ${msg}`],
      skillDefinitions: new Map(),
      commandDefinitions: new Map(),
      mcpServerConfigs: [],
    };
  }

  const namespace = pluginJson.name.toLowerCase().replace(/[^a-z0-9-]/g, '-');

  // Infer permissions from plugin contents
  const permissions: Permission[] = [];

  // 2. Read MCP servers from .mcp.json and/or inline mcpServers in plugin.json
  const mcpServerConfigs: McpServerConfig[] = [];
  const mcpJsonPath = path.join(pluginDir, '.mcp.json');
  if (fs.existsSync(mcpJsonPath)) {
    try {
      const mcpJson: ClaudeMcpJson = JSON.parse(fs.readFileSync(mcpJsonPath, 'utf-8'));
      if (mcpJson.mcpServers) {
        mcpServerConfigs.push(...parseMcpServers(mcpJson.mcpServers, pluginDir));
      }
    } catch {
      errors.push('Failed to parse .mcp.json');
    }
  }

  // Inline mcpServers from plugin.json (object form, not a path string)
  if (pluginJson.mcpServers && typeof pluginJson.mcpServers === 'object') {
    mcpServerConfigs.push(
      ...parseMcpServers(pluginJson.mcpServers as ClaudeMcpServerMap, pluginDir),
    );
  }

  if (mcpServerConfigs.length > 0) {
    permissions.push('mcp:connect' as Permission, 'network:connect' as Permission);
  }

  const manifest: PluginManifest = {
    name: pluginJson.name,
    version: pluginJson.version ?? '0.0.0',
    namespace,
    description: pluginJson.description,
    permissions,
    dependencies: [],
    sandbox: { tier: 'basic' },
    format: 'claude',
    author: pluginJson.author,
    homepage: pluginJson.homepage,
    repository: pluginJson.repository,
    license: pluginJson.license,
    keywords: pluginJson.keywords,
  };

  // 3. Scan commands/*.md
  const commandDefinitions = new Map<string, CommandDefinition>();
  const commandsDir = path.join(pluginDir, 'commands');
  if (fs.existsSync(commandsDir)) {
    const files = fs.readdirSync(commandsDir).filter((f) => f.endsWith('.md'));
    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(commandsDir, file), 'utf-8');
        const cmdDef = parseMdCommand(content, file);
        const qualifiedName = qualifyName(namespace, cmdDef.name);
        commandDefinitions.set(qualifiedName, cmdDef);
      } catch {
        errors.push(`Failed to parse command: ${file}`);
      }
    }
  }

  // 4. Scan skills/*/SKILL.md
  const tools: ToolDefinition[] = [];
  const skillDefinitions = new Map<string, SkillDefinition>();
  const skillsBaseDir =
    typeof pluginJson.skills === 'string'
      ? path.join(pluginDir, pluginJson.skills)
      : path.join(pluginDir, 'skills');
  if (fs.existsSync(skillsBaseDir)) {
    const skillDirs = fs
      .readdirSync(skillsBaseDir, { withFileTypes: true })
      .filter((d) => d.isDirectory());

    for (const skillDir of skillDirs) {
      const skillDirPath = path.join(skillsBaseDir, skillDir.name);
      const skillMdPath = path.join(skillDirPath, 'SKILL.md');
      if (!fs.existsSync(skillMdPath)) continue;

      try {
        const content = fs.readFileSync(skillMdPath, 'utf-8');
        const skillDef = parseMdSkill(content);

        // Discover bundled resources (scripts/, references/, assets/)
        const resources = discoverSkillResources(skillDirPath);
        skillDef.resources = resources;

        const qualifiedName = qualifyName(namespace, skillDef.name);
        skillDefinitions.set(qualifiedName, skillDef);

        // Add llm:invoke permission if we have skills
        if (!permissions.includes('llm:invoke' as Permission)) {
          permissions.push('llm:invoke' as Permission);
        }

        // Convert to ToolDefinition
        const properties: Record<string, import('@nexora-kit/core').ToolParameterProperty> = {};
        const required: string[] = [];
        for (const [paramName, paramDef] of Object.entries(skillDef.parameters)) {
          properties[paramName] = {
            type: paramDef.type,
            description: paramDef.description,
            enum: paramDef.enum,
            default: paramDef.default,
          };
          if (paramDef.required) {
            required.push(paramName);
          }
        }

        tools.push({
          name: qualifiedName,
          description: skillDef.description,
          parameters: {
            type: 'object',
            properties,
            ...(required.length > 0 ? { required } : {}),
          },
        });
      } catch {
        errors.push(`Failed to parse skill: ${skillDir.name}`);
      }
    }
  }

  // Load plugin docs (CONNECTORS.md preferred, fallback to README.md)
  let pluginDocs: string | undefined;
  const connectorsPath = path.join(pluginDir, 'CONNECTORS.md');
  const readmePath = path.join(pluginDir, 'README.md');
  if (fs.existsSync(connectorsPath)) {
    pluginDocs = fs.readFileSync(connectorsPath, 'utf-8').trim() || undefined;
  } else if (fs.existsSync(readmePath)) {
    pluginDocs = fs.readFileSync(readmePath, 'utf-8').trim() || undefined;
  }

  return {
    plugin: {
      manifest,
      state: errors.length > 0 ? 'errored' : 'installed',
      tools,
      error: errors.length > 0 ? errors.join('; ') : undefined,
    },
    errors,
    skillDefinitions,
    commandDefinitions,
    mcpServerConfigs,
    pluginDocs,
  };
}
