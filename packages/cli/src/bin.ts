#!/usr/bin/env node

import { parseArgs } from './args.js';
import { CommandRouter } from './commands.js';
import { initCommand } from './cmd-init.js';
import { serveCommand } from './cmd-serve.js';
import {
  pluginInitCommand,
  pluginAddCommand,
  pluginDevCommand,
  pluginTestCommand,
  pluginValidateCommand,
} from './cmd-plugin.js';
import { configGetCommand, configSetCommand } from './cmd-config.js';
import { adminUsageCommand } from './cmd-admin.js';
import { error } from './output.js';

const router = new CommandRouter();

// Top-level commands
router.register(initCommand);
router.register(serveCommand);

// Plugin subcommands
router.register(pluginInitCommand);
router.register(pluginAddCommand);
router.register(pluginDevCommand);
router.register(pluginTestCommand);
router.register(pluginValidateCommand);

// Config subcommands
router.register(configGetCommand);
router.register(configSetCommand);

// Admin subcommands
router.register(adminUsageCommand);

const args = parseArgs(process.argv.slice(2), {
  aliases: { h: 'help', V: 'version', p: 'port', c: 'config' },
  booleans: ['help', 'version'],
});

router.route(args).catch((err) => {
  error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
