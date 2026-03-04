import * as fs from 'node:fs';
import * as path from 'node:path';
import type { PluginManifest, ToolDefinition, Permission } from '@nexora-kit/core';
import type { SkillDefinition } from '@nexora-kit/skills';
import type { CommandDefinition } from '@nexora-kit/commands';
import type { McpServerConfig, McpTransportType } from '@nexora-kit/mcp';
import { parseMdSkill } from '@nexora-kit/skills';
import { parseMdCommand } from '@nexora-kit/commands';
import { qualifyName } from './namespace.js';
import type { LoadResult } from './loader.js';

interface ClaudePluginJson {
  name: string;
  version?: string;
  description?: string;
  author?: string;
}

interface ClaudeMcpJson {
  mcpServers?: Record<string, {
    type?: string;
    url?: string;
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    headers?: Record<string, string>;
  }>;
}

function resolveTransportType(type?: string): McpTransportType {
  if (type === 'stdio') return 'stdio';
  if (type === 'http') return 'http';
  return 'sse';
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
        manifest: { name: '', version: '0.0.0', namespace: '', permissions: [], dependencies: [], sandbox: { tier: 'basic' } },
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
        name?: string; version?: string; description?: string;
      };
      if (pkg.name) name = pkg.name.replace(/^@[^/]+\//, ''); // strip npm scope
      if (pkg.version) version = pkg.version;
      if (pkg.description) description = pkg.description;
    } catch { /* ignore, use defaults */ }
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
  };

  const mcpServerConfigs: McpServerConfig[] = [];
  if (mcpJson.mcpServers) {
    for (const [serverName, config] of Object.entries(mcpJson.mcpServers)) {
      const transport = resolveTransportType(config.type);
      mcpServerConfigs.push({
        name: serverName,
        transport,
        url: config.url,
        command: config.command,
        args: config.args,
        env: config.env,
        headers: config.headers,
      });
    }
  }

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
        manifest: { name: '', version: '0.0.0', namespace: '', permissions: [], dependencies: [], sandbox: { tier: 'basic' } },
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
        manifest: { name: '', version: '0.0.0', namespace: '', permissions: [], dependencies: [], sandbox: { tier: 'basic' } },
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
  const manifest: PluginManifest = {
    name: pluginJson.name,
    version: pluginJson.version ?? '0.0.0',
    namespace,
    description: pluginJson.description,
    permissions: ['mcp:connect', 'network:connect'] as Permission[],
    dependencies: [],
    sandbox: { tier: 'basic' },
  };

  // 2. Read .mcp.json
  const mcpServerConfigs: McpServerConfig[] = [];
  const mcpJsonPath = path.join(pluginDir, '.mcp.json');
  if (fs.existsSync(mcpJsonPath)) {
    try {
      const mcpJson: ClaudeMcpJson = JSON.parse(fs.readFileSync(mcpJsonPath, 'utf-8'));
      if (mcpJson.mcpServers) {
        for (const [name, config] of Object.entries(mcpJson.mcpServers)) {
          const transport = resolveTransportType(config.type);

          mcpServerConfigs.push({
            name,
            transport,
            url: config.url,
            command: config.command,
            args: config.args,
            env: config.env,
            headers: config.headers,
          });
        }
      }
    } catch {
      errors.push('Failed to parse .mcp.json');
    }
  }

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
  const skillsDir = path.join(pluginDir, 'skills');
  if (fs.existsSync(skillsDir)) {
    const skillDirs = fs.readdirSync(skillsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory());

    for (const skillDir of skillDirs) {
      const skillMdPath = path.join(skillsDir, skillDir.name, 'SKILL.md');
      if (!fs.existsSync(skillMdPath)) continue;

      try {
        const content = fs.readFileSync(skillMdPath, 'utf-8');
        const skillDef = parseMdSkill(content);

        // 5. Scan references/*.md and append to prompt
        const refsDir = path.join(skillsDir, skillDir.name, 'references');
        if (fs.existsSync(refsDir)) {
          const refFiles = fs.readdirSync(refsDir).filter((f) => f.endsWith('.md'));
          if (refFiles.length > 0) {
            const refContent = refFiles
              .map((f) => fs.readFileSync(path.join(refsDir, f), 'utf-8').trim())
              .join('\n\n');
            skillDef.prompt = skillDef.prompt
              ? `${skillDef.prompt}\n\n${refContent}`
              : refContent;
          }
        }

        const qualifiedName = qualifyName(namespace, skillDef.name);
        skillDefinitions.set(qualifiedName, skillDef);

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
