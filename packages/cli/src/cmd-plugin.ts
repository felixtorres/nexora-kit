import { mkdir, writeFile, readFile, readdir, access, cp } from 'node:fs/promises';
import { resolve, join, basename } from 'node:path';
import { execSync } from 'node:child_process';
import type { CliCommand } from './commands.js';
import { success, error, info, warn, fmt, table } from './output.js';
import { validateManifest, loadPlugin, discoverPlugins } from '@nexora-kit/plugins';
import { parse as parseYaml } from 'yaml';

// --- plugin init ---

const TEMPLATE_MANIFEST = `name: {{name}}
version: 0.1.0
namespace: {{namespace}}
description: A new NexoraKit plugin
permissions:
  - llm:invoke
sandbox:
  tier: basic
`;

const TEMPLATE_SKILL_YAML = `name: hello
description: A simple greeting skill
invocation: model
input_schema:
  type: object
  properties:
    name:
      type: string
      description: Name to greet
  required:
    - name
prompt: |
  Say hello to {{name}} in a friendly way.
`;

const TEMPLATE_TEST = `import { describe, it, expect } from 'vitest';
import { loadPlugin } from '@nexora-kit/plugins';
import { resolve } from 'node:path';

describe('{{name}} plugin', () => {
  it('loads without errors', () => {
    const result = loadPlugin(resolve(__dirname, '..'));
    expect(result.errors).toHaveLength(0);
    expect(result.plugin.manifest.namespace).toBe('{{namespace}}');
  });

  it('has expected tools', () => {
    const result = loadPlugin(resolve(__dirname, '..'));
    expect(result.plugin.tools.length).toBeGreaterThan(0);
  });
});
`;

export const pluginInitCommand: CliCommand = {
  name: 'plugin:init',
  description: 'Scaffold a new plugin from template',
  usage: 'nexora-kit plugin init <name> [--dir <directory>]',

  async run(args) {
    const name = args.positionals[0];
    if (!name) {
      error('Plugin name is required: nexora-kit plugin init <name>');
      process.exitCode = 1;
      return;
    }

    const namespace = name.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    const targetDir = resolve((args.flags['dir'] as string) ?? name);

    // Check if directory exists
    try {
      await access(targetDir);
      error(`Directory already exists: ${targetDir}`);
      process.exitCode = 1;
      return;
    } catch {
      // Expected
    }

    info(`Scaffolding plugin "${name}" in ${targetDir}`);

    // Create directories
    await mkdir(join(targetDir, 'skills'), { recursive: true });
    await mkdir(join(targetDir, 'commands'), { recursive: true });
    await mkdir(join(targetDir, 'tests'), { recursive: true });

    // Write manifest
    const manifest = TEMPLATE_MANIFEST
      .replace(/\{\{name\}\}/g, name)
      .replace(/\{\{namespace\}\}/g, namespace);
    await writeFile(join(targetDir, 'plugin.yaml'), manifest, 'utf-8');

    // Write example skill
    await writeFile(join(targetDir, 'skills', 'hello.yaml'), TEMPLATE_SKILL_YAML, 'utf-8');

    // Write test file
    const test = TEMPLATE_TEST
      .replace(/\{\{name\}\}/g, name)
      .replace(/\{\{namespace\}\}/g, namespace);
    await writeFile(join(targetDir, 'tests', 'plugin.test.ts'), test, 'utf-8');

    success(`Plugin "${name}" scaffolded!`);
    console.log(`\n  ${targetDir}/`);
    console.log('  ├── plugin.yaml        # Plugin manifest');
    console.log('  ├── skills/');
    console.log('  │   └── hello.yaml     # Example skill');
    console.log('  ├── commands/          # User-invoked commands');
    console.log('  └── tests/');
    console.log('      └── plugin.test.ts # Plugin tests');
    console.log(`\n  Next: nexora-kit plugin validate ${targetDir}`);
  },
};

// --- plugin add ---

export const pluginAddCommand: CliCommand = {
  name: 'plugin:add',
  description: 'Install a plugin from a local path',
  usage: 'nexora-kit plugin add <source> [--plugins-dir <dir>]',

  async run(args) {
    const source = args.positionals[0];
    if (!source) {
      error('Source path is required: nexora-kit plugin add <path>');
      process.exitCode = 1;
      return;
    }

    const sourcePath = resolve(source);
    const pluginsDir = resolve((args.flags['plugins-dir'] as string) ?? './plugins');

    // Validate the source plugin first
    try {
      const result = loadPlugin(sourcePath);
      if (result.errors.length > 0) {
        error(`Plugin has errors:`);
        for (const err of result.errors) {
          console.error(`  - ${err}`);
        }
        process.exitCode = 1;
        return;
      }

      const namespace = result.plugin.manifest.namespace;
      const destDir = join(pluginsDir, namespace);

      // Check if already installed
      try {
        await access(destDir);
        error(`Plugin "${namespace}" is already installed at ${destDir}`);
        process.exitCode = 1;
        return;
      } catch {
        // Expected
      }

      await mkdir(pluginsDir, { recursive: true });
      await cp(sourcePath, destDir, { recursive: true });

      success(`Plugin "${result.plugin.manifest.name}" installed to ${destDir}`);
      info(`Tools: ${result.plugin.tools.length}, Skills: ${result.skillDefinitions.size}, Commands: ${result.commandDefinitions.size}`);
    } catch (err) {
      error(`Failed to load plugin from ${sourcePath}: ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
    }
  },
};

// --- plugin dev ---

export const pluginDevCommand: CliCommand = {
  name: 'plugin:dev',
  description: 'Start dev server with plugin hot-reload',
  usage: 'nexora-kit plugin dev <plugin-dir> [--port <port>]',

  async run(args) {
    const pluginDir = resolve(args.positionals[0] ?? '.');
    const port = Number(args.flags['port'] ?? 3000);

    // Verify it's a valid plugin
    try {
      const result = loadPlugin(pluginDir);
      if (result.errors.length > 0) {
        error('Plugin has errors:');
        for (const err of result.errors) {
          console.error(`  - ${err}`);
        }
        process.exitCode = 1;
        return;
      }

      info(`Starting dev server for plugin "${result.plugin.manifest.name}"`);
      info(`Watching ${pluginDir} for changes...`);

      // Dynamic import to avoid pulling in all serve deps when not needed
      const { PluginDevWatcher } = await import('@nexora-kit/plugins');
      const { PermissionGate } = await import('@nexora-kit/sandbox');
      const { ConfigResolver } = await import('@nexora-kit/config');
      const { ToolDispatcher } = await import('@nexora-kit/core');
      const { PluginLifecycleManager } = await import('@nexora-kit/plugins');

      const permissionGate = new PermissionGate();
      const configResolver = new ConfigResolver();
      const toolDispatcher = new ToolDispatcher();

      const lifecycle = new PluginLifecycleManager({
        permissionGate,
        configResolver,
        toolDispatcher,
      });

      // Install and enable
      lifecycle.install(result.plugin);
      if (result.skillDefinitions.size > 0) {
        lifecycle.setSkillDefinitions(result.plugin.manifest.namespace, result.skillDefinitions);
      }
      lifecycle.registerPluginDir(result.plugin.manifest.namespace, pluginDir);
      lifecycle.enable(result.plugin.manifest.namespace);

      success(`Plugin loaded: ${result.plugin.manifest.namespace} (${result.plugin.tools.length} tools)`);

      // Start file watcher
      const controller = new AbortController();
      const watcher = new PluginDevWatcher(lifecycle, {
        debounceMs: 300,
        signal: controller.signal,
      });
      watcher.watch(result.plugin.manifest.namespace, pluginDir);

      info(`Hot-reload active. Press Ctrl+C to stop.`);

      process.on('SIGINT', () => {
        controller.abort();
        success('Dev server stopped.');
        process.exit(0);
      });

      // Keep process alive
      await new Promise(() => {});
    } catch (err) {
      error(`Failed to start dev server: ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
    }
  },
};

// --- plugin test ---

export const pluginTestCommand: CliCommand = {
  name: 'plugin:test',
  description: 'Run plugin test suite',
  usage: 'nexora-kit plugin test [plugin-dir]',

  async run(args) {
    const pluginDir = resolve(args.positionals[0] ?? '.');

    // Check for test files
    const testsDir = join(pluginDir, 'tests');
    try {
      await access(testsDir);
    } catch {
      error(`No tests/ directory found in ${pluginDir}`);
      process.exitCode = 1;
      return;
    }

    info(`Running tests in ${testsDir}`);

    try {
      execSync('npx vitest run', {
        cwd: pluginDir,
        stdio: 'inherit',
        env: { ...process.env, NODE_OPTIONS: '--experimental-vm-modules' },
      });
      success('All tests passed!');
    } catch {
      error('Some tests failed.');
      process.exitCode = 1;
    }
  },
};

// --- plugin validate ---

export const pluginValidateCommand: CliCommand = {
  name: 'plugin:validate',
  description: 'Validate plugin manifest, schema, and permissions',
  usage: 'nexora-kit plugin validate [plugin-dir]',

  async run(args) {
    const pluginDir = resolve(args.positionals[0] ?? '.');
    const issues: string[] = [];

    info(`Validating plugin at ${pluginDir}`);

    // 1. Check manifest exists
    const manifestPath = join(pluginDir, 'plugin.yaml');
    let manifestRaw: string;
    try {
      manifestRaw = await readFile(manifestPath, 'utf-8');
    } catch {
      error(`No plugin.yaml found in ${pluginDir}`);
      process.exitCode = 1;
      return;
    }

    // 2. Validate manifest schema
    const parsed = parseYaml(manifestRaw);
    const validation = validateManifest(parsed);
    if (!validation.success) {
      error('Manifest validation failed:');
      for (const err of validation.errors ?? []) {
        console.error(`  - ${err}`);
        issues.push(`manifest: ${err}`);
      }
    } else {
      success('Manifest schema valid');
    }

    // 3. Check skills directory
    const skillsDir = join(pluginDir, 'skills');
    try {
      const files = await readdir(skillsDir);
      const skillFiles = files.filter((f) => f.endsWith('.yaml') || f.endsWith('.md'));
      if (skillFiles.length === 0) {
        warn('No skill files found in skills/');
      } else {
        success(`Found ${skillFiles.length} skill file(s)`);
      }
    } catch {
      info('No skills/ directory (optional)');
    }

    // 4. Check commands directory
    const commandsDir = join(pluginDir, 'commands');
    try {
      const files = await readdir(commandsDir);
      const cmdFiles = files.filter((f) => f.endsWith('.yaml') || f.endsWith('.md'));
      if (cmdFiles.length === 0) {
        info('No command files found in commands/ (optional)');
      } else {
        success(`Found ${cmdFiles.length} command file(s)`);
      }
    } catch {
      info('No commands/ directory (optional)');
    }

    // 5. Full load test
    try {
      const result = loadPlugin(pluginDir);
      if (result.errors.length > 0) {
        error('Plugin load errors:');
        for (const err of result.errors) {
          console.error(`  - ${err}`);
          issues.push(err);
        }
      } else {
        success(`Plugin loads successfully: ${result.plugin.tools.length} tools, ${result.skillDefinitions.size} skills, ${result.commandDefinitions.size} commands`);
      }
    } catch (err) {
      error(`Plugin load failed: ${err instanceof Error ? err.message : String(err)}`);
      issues.push(`load: ${err instanceof Error ? err.message : String(err)}`);
    }

    // 6. Permission check
    if (validation.success && validation.data) {
      const manifest = validation.data;
      const dangerousPerms = manifest.permissions.filter((p) =>
        ['code:execute', 'fs:write', 'secret:read'].includes(p),
      );
      if (dangerousPerms.length > 0) {
        warn(`Plugin requests elevated permissions: ${dangerousPerms.join(', ')}`);
      }
    }

    // Summary
    console.log('');
    if (issues.length === 0) {
      success(fmt.bold('Validation passed — plugin is ready!'));
    } else {
      error(fmt.bold(`Validation found ${issues.length} issue(s)`));
      process.exitCode = 1;
    }
  },
};
