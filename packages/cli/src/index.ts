export { parseArgs, type ParsedArgs, type ArgParserOptions } from './args.js';
export { CommandRouter, type CliCommand } from './commands.js';
export { fmt, success, warn, error, info, table } from './output.js';
export { ApiClient, ApiError, createClientFromConfig, handleApiError } from './api-client.js';

export { initCommand } from './cmd-init.js';
export { serveCommand } from './cmd-serve.js';
export {
  pluginInitCommand,
  pluginAddCommand,
  pluginListCommand,
  pluginEnableCommand,
  pluginDisableCommand,
  pluginRemoveCommand,
  pluginDevCommand,
  pluginTestCommand,
  pluginValidateCommand,
} from './cmd-plugin.js';
export { configGetCommand, configSetCommand, configValidateCommand, configShowCommand } from './cmd-config.js';
export { adminUsageCommand, adminAuditCommand, adminFeedbackCommand, adminCleanupCommand } from './cmd-admin.js';
export { statusCommand } from './cmd-status.js';
export { completionCommand } from './cmd-completion.js';
export {
  botCreateCommand,
  botListCommand,
  botGetCommand,
  botUpdateCommand,
  botDeleteCommand,
} from './cmd-bot.js';
export {
  agentCreateCommand,
  agentListCommand,
  agentGetCommand,
  agentUpdateCommand,
  agentDeleteCommand,
  agentBindCommand,
} from './cmd-agent.js';
export {
  optimizeSkillCommand,
  optimizeToolCommand,
  optimizeBotCommand,
  optimizeListCommand,
  optimizeApproveCommand,
  optimizeRollbackCommand,
  optimizeStatusCommand,
} from './cmd-optimize.js';
