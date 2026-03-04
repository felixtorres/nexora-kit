import { mkdir, writeFile, readFile, readdir, access, cp, rm, mkdtemp } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { resolve, join, relative, basename, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import type { CliCommand } from './commands.js';
import { success, error, info, warn, fmt, table } from './output.js';
import {
  validateManifest,
  loadPlugin,
  loadClaudePlugin,
  isClaudePlugin,
  loadMcpPlugin,
  isMcpPlugin,
  discoverPlugins,
} from '@nexora-kit/plugins';
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
    const manifest = TEMPLATE_MANIFEST.replace(/\{\{name\}\}/g, name).replace(
      /\{\{namespace\}\}/g,
      namespace,
    );
    await writeFile(join(targetDir, 'plugin.yaml'), manifest, 'utf-8');

    // Write example skill
    await writeFile(join(targetDir, 'skills', 'hello.yaml'), TEMPLATE_SKILL_YAML, 'utf-8');

    // Write test file
    const test = TEMPLATE_TEST.replace(/\{\{name\}\}/g, name).replace(
      /\{\{namespace\}\}/g,
      namespace,
    );
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

/**
 * Extract a ZIP archive to a target directory, skipping macOS junk entries
 * (__MACOSX/, .DS_Store, ._*) and stripping a common top-level directory
 * prefix if the entire archive lives inside one folder (the typical case when
 * a directory is zipped on macOS / GitHub).
 */
async function extractZip(zipPath: string, destDir: string): Promise<void> {
  const { unzipSync } = await import('fflate');
  const { readFileSync } = await import('node:fs');

  const zipData = readFileSync(zipPath);
  const files = unzipSync(zipData);
  // Determine if all non-junk entries share a common top-level prefix to strip
  const allPaths = Object.keys(files);
  const meaningfulPaths = allPaths.filter(
    (p) => !p.startsWith('__MACOSX/') && !p.endsWith('.DS_Store') && !basename(p).startsWith('._'),
  );
  const firstSegments = new Set(meaningfulPaths.map((p) => p.split('/')[0]));
  const commonPrefix =
    firstSegments.size === 1 ? (firstSegments.values().next().value as string) + '/' : '';

  await mkdir(destDir, { recursive: true });

  for (const [filePath, data] of Object.entries(files)) {
    // Skip macOS metadata noise
    if (
      filePath.startsWith('__MACOSX/') ||
      filePath.includes('/.DS_Store') ||
      filePath.endsWith('.DS_Store') ||
      basename(filePath).startsWith('._')
    ) {
      continue;
    }

    const strippedPath =
      commonPrefix && filePath.startsWith(commonPrefix)
        ? filePath.slice(commonPrefix.length)
        : filePath;

    if (!strippedPath) continue; // was the root folder entry itself

    const outPath = resolve(destDir, strippedPath);

    // Zip Slip guard: ensure resolved path stays within destDir
    if (!outPath.startsWith(destDir + '/') && outPath !== destDir) {
      throw new Error(`Zip entry escapes target directory: ${filePath}`);
    }

    if (filePath.endsWith('/')) {
      // Directory entry
      await mkdir(outPath, { recursive: true });
    } else {
      await mkdir(join(outPath, '..'), { recursive: true });
      await writeFile(outPath, data);
    }
  }
}

// --- plugin add ---

/**
 * Convert a GitHub repo URL to its archive ZIP download URL.
 * Supports: https://github.com/owner/repo[/tree/branch]
 */
function toGithubZipUrl(url: string): string {
  const m = url.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\/tree\/([^/]+))?(?:\/.*)?$/);
  if (!m) throw new Error(`Cannot parse GitHub URL: ${url}`);
  const [, owner, repo, branch = 'main'] = m;
  return `https://github.com/${owner}/${repo}/archive/refs/heads/${branch}.zip`;
}

/** Download a URL to a temporary .zip file, returning the file path. */
async function downloadToTempFile(url: string): Promise<string> {
  const destPath = join(tmpdir(), `nexora-plugin-${Date.now()}.zip`);
  const response = await fetch(url, { redirect: 'follow' } as RequestInit);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }
  const buffer = await response.arrayBuffer();
  await writeFile(destPath, Buffer.from(buffer));
  return destPath;
}

/**
 * Scan subdirectories (up to depth 2) for plugin roots when the top-level
 * directory is a plugin repository rather than a single plugin.
 */
async function findPluginDirs(baseDir: string): Promise<string[]> {
  const results: string[] = [];

  async function scan(dir: string, depth: number): Promise<void> {
    if (depth > 2) return;
    // If this dir is itself a plugin, record it and don't recurse further
    try { await access(join(dir, 'plugin.yaml')); results.push(dir); return; } catch {}
    if (isClaudePlugin(dir) || isMcpPlugin(dir)) { results.push(dir); return; }
    // Recurse into non-hidden subdirectories
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      await Promise.all(
        entries
          .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
          .map((e) => scan(join(dir, e.name), depth + 1)),
      );
    } catch { /* ignore permission errors */ }
  }

  // Start from children of baseDir — the root was already checked by the caller
  try {
    const entries = await readdir(baseDir, { withFileTypes: true });
    await Promise.all(
      entries
        .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
        .map((e) => scan(join(baseDir, e.name), 1)),
    );
  } catch { /* ignore */ }

  return results;
}

export const pluginAddCommand: CliCommand = {
  name: 'plugin:add',
  description: 'Install a plugin from a local path, ZIP file, or GitHub URL',
  usage: 'nexora-kit plugin add <source> [--plugins-dir <dir>]',

  async run(args) {
    const source = args.positionals[0];
    if (!source) {
      error('Source path is required: nexora-kit plugin add <path|url>');
      process.exitCode = 1;
      return;
    }

    const pluginsDir = resolve((args.flags['plugins-dir'] as string) ?? './plugins');

    let tempDir: string | undefined;
    let downloadedZip: string | undefined;
    let sourcePath: string;

    // Handle URL sources (GitHub or generic ZIP URL)
    const isUrl = source.startsWith('http://') || source.startsWith('https://');
    if (isUrl) {
      const zipUrl =
        /github\.com\/[^/]+\/[^/]/.test(source) && !source.endsWith('.zip')
          ? toGithubZipUrl(source)
          : source;
      info(`Downloading plugin from ${zipUrl}...`);
      try {
        downloadedZip = await downloadToTempFile(zipUrl);
        sourcePath = downloadedZip;
      } catch (err) {
        error(`Failed to download plugin: ${err instanceof Error ? err.message : String(err)}`);
        process.exitCode = 1;
        return;
      }
    } else {
      sourcePath = resolve(source);
    }

    let pluginSourcePath = sourcePath;

    // Extract ZIP archives to a temp directory before loading
    if (extname(sourcePath).toLowerCase() === '.zip') {
      tempDir = await mkdtemp(join(tmpdir(), 'nexora-plugin-'));
      try {
        info(`Extracting ${basename(sourcePath)}...`);
        await extractZip(sourcePath, tempDir);
        pluginSourcePath = tempDir;
      } catch (err) {
        await rm(tempDir, { recursive: true, force: true });
        error(`Failed to extract ZIP: ${err instanceof Error ? err.message : String(err)}`);
        process.exitCode = 1;
        return;
      }
    }

    // Resolve the best LoadResult for a given plugin directory
    function resolvePlugin(dir: string) {
      let result = loadPlugin(dir);
      if (result.errors.length > 0 && isClaudePlugin(dir)) result = loadClaudePlugin(dir);
      else if (result.errors.length > 0 && isMcpPlugin(dir)) result = loadMcpPlugin(dir);
      return result;
    }

    // Install one resolved LoadResult; returns false if already installed or errored
    async function installOne(result: ReturnType<typeof loadPlugin>, srcDir: string): Promise<boolean> {
      if (result.errors.length > 0) {
        error(`Plugin has errors:`);
        for (const err of result.errors) console.error(`  - ${err}`);
        return false;
      }
      const namespace = result.plugin.manifest.namespace;
      const destDir = join(pluginsDir, namespace);
      try {
        await access(destDir);
        error(`Plugin "${namespace}" is already installed at ${destDir}`);
        return false;
      } catch { /* not installed yet */ }
      await mkdir(pluginsDir, { recursive: true });
      await cp(srcDir, destDir, { recursive: true });
      success(`Plugin "${result.plugin.manifest.name}" installed to ${destDir}`);
      info(`Tools: ${result.plugin.tools.length}, Skills: ${result.skillDefinitions.size}, Commands: ${result.commandDefinitions.size}`);
      return true;
    }

    try {
      const result = resolvePlugin(pluginSourcePath);

      if (result.errors.length > 0) {
        // No format at root — this may be a plugin repository; scan subdirectories
        const subDirs = await findPluginDirs(pluginSourcePath);
        if (subDirs.length === 0) {
          error(`No recognized plugin format found in the extracted directory.`);
          console.error(`  Expected one of:`);
          console.error(`    - plugin.yaml                 (Nexora plugin format)`);
          console.error(`    - .claude-plugin/plugin.json  (Claude plugin format)`);
          console.error(`    - .mcp.json                   (MCP-native plugin format)`);
          process.exitCode = 1;
          return;
        }
        if (subDirs.length > 1) {
          info(`Found ${subDirs.length} plugins in repository:`);
          for (const d of subDirs) info(`  ${relative(pluginSourcePath, d)}`);
        }
        let installed = 0;
        for (const dir of subDirs) {
          const sub = resolvePlugin(dir);
          if (await installOne(sub, dir)) installed++;
        }
        if (installed === 0) process.exitCode = 1;
        return;
      }

      if (!(await installOne(result, pluginSourcePath))) process.exitCode = 1;
    } catch (err) {
      error(
        `Failed to load plugin from ${sourcePath}: ${err instanceof Error ? err.message : String(err)}`,
      );
      process.exitCode = 1;
    } finally {
      if (tempDir) {
        await rm(tempDir, { recursive: true, force: true });
      }
      if (downloadedZip) {
        await rm(downloadedZip, { force: true });
      }
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

      success(
        `Plugin loaded: ${result.plugin.manifest.namespace} (${result.plugin.tools.length} tools)`,
      );

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
        success(
          `Plugin loads successfully: ${result.plugin.tools.length} tools, ${result.skillDefinitions.size} skills, ${result.commandDefinitions.size} commands`,
        );
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
