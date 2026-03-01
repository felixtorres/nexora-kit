import * as fs from 'node:fs';
import * as path from 'node:path';
import type { PluginInstance, ToolDefinition } from '@nexora-kit/core';
import type { SkillDefinition } from '@nexora-kit/skills';
import type { CommandDefinition } from '@nexora-kit/commands';
import { parseYamlSkill, parseMdSkill } from '@nexora-kit/skills';
import { parseYamlCommand } from '@nexora-kit/commands';
import { parseManifest } from './manifest.js';
import { qualifyName, validateNamespace } from './namespace.js';

export interface LoadResult {
  plugin: PluginInstance;
  errors: string[];
  skillDefinitions: Map<string, SkillDefinition>;
  commandDefinitions: Map<string, CommandDefinition>;
}

export function loadPlugin(pluginDir: string): LoadResult {
  const errors: string[] = [];
  const emptyResult = {
    skillDefinitions: new Map<string, SkillDefinition>(),
    commandDefinitions: new Map<string, CommandDefinition>(),
  };

  // Read plugin.yaml
  const manifestPath = path.join(pluginDir, 'plugin.yaml');
  if (!fs.existsSync(manifestPath)) {
    return {
      plugin: {
        manifest: { name: '', version: '0.0.0', namespace: '', permissions: [], dependencies: [], sandbox: { tier: 'basic' } },
        state: 'errored',
        tools: [],
        error: `No plugin.yaml found in ${pluginDir}`,
      },
      errors: [`No plugin.yaml found in ${pluginDir}`],
      ...emptyResult,
    };
  }

  const yamlContent = fs.readFileSync(manifestPath, 'utf-8');
  let manifest;
  try {
    manifest = parseManifest(yamlContent);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      plugin: {
        manifest: { name: '', version: '0.0.0', namespace: '', permissions: [], dependencies: [], sandbox: { tier: 'basic' } },
        state: 'errored',
        tools: [],
        error: `Invalid manifest: ${msg}`,
      },
      errors: [`Invalid manifest: ${msg}`],
      ...emptyResult,
    };
  }

  try {
    validateNamespace(manifest.namespace);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    errors.push(msg);
  }

  // Discover skill definitions from skills/ directory
  const tools: ToolDefinition[] = [];
  const skillDefinitions = new Map<string, SkillDefinition>();
  const skillsDir = path.join(pluginDir, 'skills');
  if (fs.existsSync(skillsDir)) {
    const files = fs.readdirSync(skillsDir).filter(
      (f) => f.endsWith('.yaml') || f.endsWith('.yml') || f.endsWith('.md'),
    );
    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(skillsDir, file), 'utf-8');
        let skillDef: SkillDefinition;

        if (file.endsWith('.md')) {
          skillDef = parseMdSkill(content);
        } else {
          skillDef = parseYamlSkill(content);
        }

        const qualifiedName = qualifyName(manifest.namespace, skillDef.name);
        skillDefinitions.set(qualifiedName, skillDef);

        // Convert skill parameters to ToolDefinition format
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
        errors.push(`Failed to parse skill file: ${file}`);
      }
    }
  }

  // Discover command definitions from commands/ directory
  const commandDefinitions = new Map<string, CommandDefinition>();
  const commandsDir = path.join(pluginDir, 'commands');
  if (fs.existsSync(commandsDir)) {
    const files = fs.readdirSync(commandsDir).filter(
      (f) => f.endsWith('.yaml') || f.endsWith('.yml'),
    );
    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(commandsDir, file), 'utf-8');
        const cmdDef = parseYamlCommand(content);
        const qualifiedName = qualifyName(manifest.namespace, cmdDef.name);
        commandDefinitions.set(qualifiedName, cmdDef);
      } catch {
        errors.push(`Failed to parse command file: ${file}`);
      }
    }
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
  };
}

export function discoverPlugins(baseDir: string): LoadResult[] {
  if (!fs.existsSync(baseDir)) return [];

  const results: LoadResult[] = [];
  const entries = fs.readdirSync(baseDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const pluginDir = path.join(baseDir, entry.name);
    const manifestPath = path.join(pluginDir, 'plugin.yaml');
    if (fs.existsSync(manifestPath)) {
      results.push(loadPlugin(pluginDir));
    }
  }

  return results;
}
