import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { stringify as stringifyYaml } from 'yaml';

export interface TestPluginOptions {
  name: string;
  namespace?: string;
  version?: string;
  permissions?: string[];
  skills?: Array<{
    name: string;
    description?: string;
    invocation?: 'model' | 'user' | 'both';
    prompt?: string;
    parameters?: Record<string, unknown>;
  }>;
  commands?: Array<{
    name: string;
    description?: string;
    args?: Array<{ name: string; type?: string; required?: boolean }>;
  }>;
}

/**
 * Creates a temporary plugin directory with manifest, skills, and commands.
 * Returns the directory path. Caller should clean up with rm -rf.
 */
export async function createTestPlugin(options: TestPluginOptions): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), `nexora-test-plugin-`));
  const namespace = options.namespace ?? options.name.toLowerCase().replace(/[^a-z0-9-]/g, '-');

  // Write manifest
  const manifest = {
    name: options.name,
    version: options.version ?? '1.0.0',
    namespace,
    permissions: options.permissions ?? ['llm:invoke'],
    sandbox: { tier: 'basic' },
  };
  await writeFile(join(dir, 'plugin.yaml'), stringifyYaml(manifest), 'utf-8');

  // Write skills
  if (options.skills && options.skills.length > 0) {
    await mkdir(join(dir, 'skills'), { recursive: true });
    for (const skill of options.skills) {
      const skillDef: Record<string, unknown> = {
        name: skill.name,
        description: skill.description ?? `${skill.name} skill`,
        invocation: skill.invocation ?? 'model',
        input_schema: skill.parameters ?? {
          type: 'object',
          properties: { input: { type: 'string' } },
        },
        prompt: skill.prompt ?? `Execute ${skill.name} with {{input}}`,
      };
      await writeFile(join(dir, 'skills', `${skill.name}.yaml`), stringifyYaml(skillDef), 'utf-8');
    }
  }

  // Write commands
  if (options.commands && options.commands.length > 0) {
    await mkdir(join(dir, 'commands'), { recursive: true });
    for (const cmd of options.commands) {
      const cmdDef: Record<string, unknown> = {
        name: cmd.name,
        description: cmd.description ?? `${cmd.name} command`,
        args: cmd.args ?? [],
      };
      await writeFile(join(dir, 'commands', `${cmd.name}.yaml`), stringifyYaml(cmdDef), 'utf-8');
    }
  }

  return dir;
}
