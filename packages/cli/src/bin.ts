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
  pluginListCommand,
  pluginEnableCommand,
  pluginDisableCommand,
  pluginRemoveCommand,
} from './cmd-plugin.js';
import { configGetCommand, configSetCommand, configValidateCommand, configShowCommand } from './cmd-config.js';
import { adminUsageCommand, adminAuditCommand, adminFeedbackCommand, adminCleanupCommand } from './cmd-admin.js';
import { statusCommand } from './cmd-status.js';
import {
  botCreateCommand,
  botListCommand,
  botGetCommand,
  botUpdateCommand,
  botDeleteCommand,
} from './cmd-bot.js';
import {
  agentCreateCommand,
  agentListCommand,
  agentGetCommand,
  agentUpdateCommand,
  agentDeleteCommand,
  agentBindCommand,
} from './cmd-agent.js';
import { completionCommand } from './cmd-completion.js';
import {
  optimizeSkillCommand,
  optimizeToolCommand,
  optimizeBotCommand,
  optimizeListCommand,
  optimizeApproveCommand,
  optimizeRollbackCommand,
  optimizeStatusCommand,
} from './cmd-optimize.js';
import { error } from './output.js';

const router = new CommandRouter();

// Top-level commands
router.register(initCommand);
router.register(serveCommand);
router.register(statusCommand);

// Plugin subcommands
router.register(pluginInitCommand);
router.register(pluginAddCommand);
router.register(pluginListCommand);
router.register(pluginEnableCommand);
router.register(pluginDisableCommand);
router.register(pluginRemoveCommand);
router.register(pluginDevCommand);
router.register(pluginTestCommand);
router.register(pluginValidateCommand);

// Config subcommands
router.register(configGetCommand);
router.register(configSetCommand);
router.register(configValidateCommand);
router.register(configShowCommand);

// Bot subcommands
router.register(botCreateCommand);
router.register(botListCommand);
router.register(botGetCommand);
router.register(botUpdateCommand);
router.register(botDeleteCommand);

// Agent subcommands
router.register(agentCreateCommand);
router.register(agentListCommand);
router.register(agentGetCommand);
router.register(agentUpdateCommand);
router.register(agentDeleteCommand);
router.register(agentBindCommand);

// Admin subcommands
router.register(adminUsageCommand);
router.register(adminAuditCommand);
router.register(adminFeedbackCommand);
router.register(adminCleanupCommand);

// Optimize subcommands
router.register(optimizeSkillCommand);
router.register(optimizeToolCommand);
router.register(optimizeBotCommand);
router.register(optimizeListCommand);
router.register(optimizeApproveCommand);
router.register(optimizeRollbackCommand);
router.register(optimizeStatusCommand);

// Utility
router.register(completionCommand);

const args = parseArgs(process.argv.slice(2), {
  aliases: { h: 'help', V: 'version', p: 'port', c: 'config' },
  booleans: ['help', 'version'],
});

router.route(args).catch((err) => {
  error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
