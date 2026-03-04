import type { CliCommand } from './commands.js';
import { error } from './output.js';

/** Extract --flag names from a usage string. */
function extractFlags(usage: string): string[] {
  const flags: string[] = [];
  const re = /--([a-z][-a-z0-9]*)/g;
  let m;
  while ((m = re.exec(usage)) !== null) {
    flags.push(m[1]);
  }
  return [...new Set(flags)];
}

interface CommandMeta {
  /** Display name, e.g. "plugin init" */
  display: string;
  /** Internal name, e.g. "plugin:init" */
  name: string;
  /** Top-level command, e.g. "plugin" */
  prefix: string;
  /** Subcommand or empty, e.g. "init" */
  sub: string;
  description: string;
  flags: string[];
}

function buildMeta(commands: CliCommand[]): CommandMeta[] {
  return commands.map((cmd) => {
    const parts = cmd.name.split(':');
    return {
      display: cmd.name.replace(':', ' '),
      name: cmd.name,
      prefix: parts[0],
      sub: parts[1] ?? '',
      description: cmd.description,
      flags: extractFlags(cmd.usage),
    };
  });
}

function generateBash(metas: CommandMeta[]): string {
  const topLevels = [...new Set(metas.map((m) => m.prefix))];
  const subcommandMap = new Map<string, CommandMeta[]>();
  for (const m of metas) {
    if (!m.sub) continue;
    const list = subcommandMap.get(m.prefix) ?? [];
    list.push(m);
    subcommandMap.set(m.prefix, list);
  }

  const lines: string[] = [
    '# bash completion for nexora-kit',
    '# Add to ~/.bashrc: eval "$(nexora-kit completion --shell bash)"',
    '_nexora_kit() {',
    '  local cur prev words cword',
    '  _init_completion || return',
    '',
    '  if [[ $cword -eq 1 ]]; then',
    `    COMPREPLY=( $(compgen -W "${topLevels.join(' ')} --help --version" -- "$cur") )`,
    '    return',
    '  fi',
    '',
    '  local cmd="${words[1]}"',
    '  local subcmd="${words[2]}"',
    '',
    '  # Subcommand completion',
    '  if [[ $cword -eq 2 ]]; then',
    '    case "$cmd" in',
  ];

  for (const [prefix, subs] of subcommandMap) {
    const subNames = subs.map((s) => s.sub).join(' ');
    lines.push(`      ${prefix}) COMPREPLY=( $(compgen -W "${subNames}" -- "$cur") ); return ;;`);
  }

  lines.push(
    '    esac',
    '  fi',
    '',
    '  # Flag completion',
    '  if [[ "$cur" == -* ]]; then',
    '    local flags=""',
    '    case "$cmd" in',
  );

  // Top-level commands
  for (const m of metas.filter((m) => !m.sub)) {
    if (m.flags.length > 0) {
      const flagStr = m.flags.map((f) => `--${f}`).join(' ');
      lines.push(`      ${m.prefix}) flags="${flagStr}" ;;`);
    }
  }

  // Compound commands
  for (const [prefix, subs] of subcommandMap) {
    const caseBody = subs
      .filter((s) => s.flags.length > 0)
      .map((s) => `          ${s.sub}) flags="${s.flags.map((f) => `--${f}`).join(' ')}" ;;`)
      .join('\n');
    if (caseBody) {
      lines.push(`      ${prefix})`);
      lines.push('        case "$subcmd" in');
      lines.push(caseBody);
      lines.push('        esac ;;');
    }
  }

  lines.push(
    '    esac',
    '    COMPREPLY=( $(compgen -W "$flags --help --config" -- "$cur") )',
    '    return',
    '  fi',
    '}',
    '',
    'complete -F _nexora_kit nexora-kit',
  );

  return lines.join('\n');
}

function generateZsh(metas: CommandMeta[]): string {
  const topLevels = [...new Set(metas.map((m) => m.prefix))];
  const subcommandMap = new Map<string, CommandMeta[]>();
  for (const m of metas) {
    if (!m.sub) continue;
    const list = subcommandMap.get(m.prefix) ?? [];
    list.push(m);
    subcommandMap.set(m.prefix, list);
  }

  const lines: string[] = [
    '#compdef nexora-kit',
    '# zsh completion for nexora-kit',
    '# Add to ~/.zshrc: eval "$(nexora-kit completion --shell zsh)"',
    '',
    '_nexora-kit() {',
    '  local -a commands subcommands',
    '',
    '  if (( CURRENT == 2 )); then',
    '    commands=(',
  ];

  // Top-level completions with descriptions
  for (const prefix of topLevels) {
    const topCmd = metas.find((m) => m.prefix === prefix && !m.sub);
    const desc = topCmd?.description ?? `${prefix} commands`;
    lines.push(`      '${prefix}:${desc}'`);
  }

  lines.push(
    '    )',
    '    _describe "command" commands',
    '    return',
    '  fi',
    '',
    '  if (( CURRENT == 3 )); then',
    '    case "$words[2]" in',
  );

  for (const [prefix, subs] of subcommandMap) {
    lines.push(`      ${prefix})`);
    lines.push('        subcommands=(');
    for (const s of subs) {
      lines.push(`          '${s.sub}:${s.description}'`);
    }
    lines.push('        )');
    lines.push('        _describe "subcommand" subcommands ;;');
  }

  lines.push(
    '    esac',
    '    return',
    '  fi',
    '',
    '  # Flag completion',
    '  _arguments -s \\',
    "    '--help[Show help]' \\",
    "    '--config[Config file path]:file:_files' \\",
    "    '*:file:_files'",
    '}',
    '',
    'compdef _nexora-kit nexora-kit',
  );

  return lines.join('\n');
}

function generateFish(metas: CommandMeta[]): string {
  const topLevels = [...new Set(metas.map((m) => m.prefix))];
  const subcommandMap = new Map<string, CommandMeta[]>();
  for (const m of metas) {
    if (!m.sub) continue;
    const list = subcommandMap.get(m.prefix) ?? [];
    list.push(m);
    subcommandMap.set(m.prefix, list);
  }

  const lines: string[] = [
    '# fish completion for nexora-kit',
    '# Add to config: nexora-kit completion --shell fish | source',
    '# Or save to: ~/.config/fish/completions/nexora-kit.fish',
    '',
    '# Disable file completions by default',
    'complete -c nexora-kit -f',
    '',
    '# Helper: no subcommand entered yet',
    "function __nexora_no_subcommand",
    "  set -l cmd (commandline -opc)",
    "  test (count $cmd) -eq 1",
    "end",
    '',
    '# Top-level commands',
  ];

  // Top-level commands
  for (const prefix of topLevels) {
    const topCmd = metas.find((m) => m.prefix === prefix && !m.sub);
    const desc = topCmd?.description ?? `${prefix} commands`;
    lines.push(`complete -c nexora-kit -n __nexora_no_subcommand -a ${prefix} -d '${desc.replace(/'/g, "\\'")}'`);
  }

  lines.push('', '# Global flags');
  lines.push("complete -c nexora-kit -l help -s h -d 'Show help'");
  lines.push("complete -c nexora-kit -l version -s V -d 'Show version'");

  // Subcommand completions
  for (const [prefix, subs] of subcommandMap) {
    lines.push(`\n# ${prefix} subcommands`);

    // Condition: we're in the prefix command and need a subcommand
    const subNames = subs.map((s) => s.sub);
    const condBase = `__fish_seen_subcommand_from ${prefix}; and not __fish_seen_subcommand_from ${subNames.join(' ')}`;

    for (const s of subs) {
      lines.push(`complete -c nexora-kit -n '${condBase}' -a ${s.sub} -d '${s.description.replace(/'/g, "\\'")}'`);
    }

    // Flags per subcommand
    for (const s of subs) {
      if (s.flags.length === 0) continue;
      const flagCond = `__fish_seen_subcommand_from ${prefix}; and __fish_seen_subcommand_from ${s.sub}`;
      for (const flag of s.flags) {
        lines.push(`complete -c nexora-kit -n '${flagCond}' -l ${flag}`);
      }
    }
  }

  // Flags for top-level commands (no subcommand)
  for (const m of metas.filter((m) => !m.sub && m.flags.length > 0)) {
    lines.push(`\n# ${m.prefix} flags`);
    const cond = `__fish_seen_subcommand_from ${m.prefix}`;
    for (const flag of m.flags) {
      lines.push(`complete -c nexora-kit -n '${cond}' -l ${flag}`);
    }
  }

  return lines.join('\n');
}

export const completionCommand: CliCommand = {
  name: 'completion',
  description: 'Generate shell completion script',
  usage: 'nexora-kit completion --shell <bash|zsh|fish>',

  async run(args) {
    const shell = (args.flags['shell'] as string) ?? detectShell();

    if (!shell || !['bash', 'zsh', 'fish'].includes(shell)) {
      error('Specify shell: nexora-kit completion --shell <bash|zsh|fish>');
      process.exitCode = 1;
      return;
    }

    // We need access to the command list — import it dynamically to avoid circular deps
    // Instead, we hardcode the command metadata extraction here from the known commands
    const allCommands = await getAllCommands();
    const metas = buildMeta(allCommands);

    switch (shell) {
      case 'bash':
        console.log(generateBash(metas));
        break;
      case 'zsh':
        console.log(generateZsh(metas));
        break;
      case 'fish':
        console.log(generateFish(metas));
        break;
    }
  },
};

function detectShell(): string | undefined {
  const shell = process.env['SHELL'] ?? '';
  if (shell.endsWith('/fish')) return 'fish';
  if (shell.endsWith('/zsh')) return 'zsh';
  if (shell.endsWith('/bash')) return 'bash';
  return undefined;
}

/** Collect all commands by importing the command modules. */
async function getAllCommands(): Promise<CliCommand[]> {
  const { initCommand } = await import('./cmd-init.js');
  const { serveCommand } = await import('./cmd-serve.js');
  const { statusCommand } = await import('./cmd-status.js');
  const {
    pluginInitCommand, pluginAddCommand, pluginDevCommand,
    pluginTestCommand, pluginValidateCommand, pluginListCommand,
    pluginEnableCommand, pluginDisableCommand, pluginRemoveCommand,
  } = await import('./cmd-plugin.js');
  const { configGetCommand, configSetCommand, configValidateCommand, configShowCommand } = await import('./cmd-config.js');
  const {
    botCreateCommand, botListCommand, botGetCommand,
    botUpdateCommand, botDeleteCommand,
  } = await import('./cmd-bot.js');
  const {
    agentCreateCommand, agentListCommand, agentGetCommand,
    agentUpdateCommand, agentDeleteCommand, agentBindCommand,
  } = await import('./cmd-agent.js');
  const { adminUsageCommand, adminAuditCommand, adminFeedbackCommand, adminCleanupCommand } = await import('./cmd-admin.js');

  return [
    initCommand, serveCommand, statusCommand,
    pluginInitCommand, pluginAddCommand, pluginListCommand,
    pluginEnableCommand, pluginDisableCommand, pluginRemoveCommand,
    pluginDevCommand, pluginTestCommand, pluginValidateCommand,
    configGetCommand, configSetCommand, configValidateCommand, configShowCommand,
    botCreateCommand, botListCommand, botGetCommand, botUpdateCommand, botDeleteCommand,
    agentCreateCommand, agentListCommand, agentGetCommand, agentUpdateCommand, agentDeleteCommand, agentBindCommand,
    adminUsageCommand, adminAuditCommand, adminFeedbackCommand, adminCleanupCommand,
    completionCommand,
  ];
}
