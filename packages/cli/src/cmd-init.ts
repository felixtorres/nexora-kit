import { mkdir, writeFile, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { CliCommand } from './commands.js';
import { success, error, info } from './output.js';

const DEFAULT_CONFIG = `# NexoraKit Instance Configuration
# See docs for full reference: https://nexora-kit.dev/docs/config

name: my-instance
port: 3000
host: 127.0.0.1

auth:
  type: api-key
  keys:
    - key: dev-key-change-me
      userId: dev
      teamId: default
      role: admin

storage:
  path: ./data/nexora.db

plugins:
  directory: ./plugins

sandbox:
  defaultTier: basic

# LLM provider configuration (uncomment and fill in one block)
#
# Anthropic (Claude):
# llm:
#   provider: anthropic
#   apiKey: \${ANTHROPIC_API_KEY}
#   model: claude-3-5-sonnet-20241022
#
# WSO2 / Azure OpenAI (corporate gateway):
# llm:
#   provider: wso2-azure-openai
#   wso2ClientId: \${WSO2_CLIENT_ID}
#   wso2ClientSecret: \${WSO2_CLIENT_SECRET}
#   wso2AuthUrl: \${WSO2_AUTH_URL}
#   wso2BaseUrl: \${WSO2_BASE_URL}
#   wso2DeploymentId: \${WSO2_DEPLOYMENT_ID}
#   wso2ApiVersion: "2024-12-01-preview"
#   # For models that reject legacy params (e.g. gpt-5.x, o1, o3), uncomment both:
#   # useMaxCompletionTokens: true
#   # omitUnsupportedParams: true
#
# Agent settings:
# agent:
#   # Limit conversation history sent per turn (tokens). Lower for small-context models.
#   # e.g. set to 8000 for gpt-5.2 through WSO2/Azure which has a ~10k context window.
#   # maxContextTokens: 8000
`;

const PLUGIN_GITKEEP = '';

export const initCommand: CliCommand = {
  name: 'init',
  description: 'Scaffold a new NexoraKit instance',
  usage: 'nexora-kit init [directory] [--name <name>]',

  async run(args) {
    const dir = resolve(args.positionals[0] ?? '.');
    const name = (args.flags['name'] as string) ?? 'my-instance';

    // Check if already initialized
    try {
      await access(join(dir, 'nexora.yaml'));
      error(`Directory already contains a nexora.yaml — aborting.`);
      process.exitCode = 1;
      return;
    } catch {
      // Expected — directory not yet initialized
    }

    info(`Scaffolding NexoraKit instance in ${dir}`);

    // Create directory structure
    const dirs = ['plugins', 'data'];
    for (const d of dirs) {
      await mkdir(join(dir, d), { recursive: true });
    }

    // Write config file
    const config = DEFAULT_CONFIG.replace('my-instance', name);
    await writeFile(join(dir, 'nexora.yaml'), config, 'utf-8');

    // Write .gitkeep in plugins dir
    await writeFile(join(dir, 'plugins', '.gitkeep'), PLUGIN_GITKEEP, 'utf-8');

    // Write .gitignore
    await writeFile(join(dir, '.gitignore'), 'data/\nnode_modules/\n', 'utf-8');

    success(`Instance "${name}" scaffolded successfully!`);
    console.log(`\n  ${dir}/`);
    console.log('  ├── nexora.yaml       # Instance configuration');
    console.log('  ├── plugins/          # Plugin directory');
    console.log('  ├── data/             # SQLite database (auto-created)');
    console.log('  └── .gitignore');
    console.log(`\n  Next: nexora-kit serve`);
  },
};
