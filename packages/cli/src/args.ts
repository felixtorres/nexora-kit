/**
 * Lightweight CLI argument parser — no external dependencies.
 *
 * Supports:
 *  - Positional args (commands and subcommands)
 *  - Named flags: --flag value, --flag=value, -f value
 *  - Boolean flags: --verbose (true), --no-verbose (false)
 *  - Aliases: { v: 'verbose' }
 */

export interface ParsedArgs {
  /** Positional arguments (commands, subcommands, trailing values) */
  positionals: string[];
  /** Named flags */
  flags: Record<string, string | boolean>;
}

export interface ArgParserOptions {
  /** Short flag aliases, e.g. { v: 'verbose', p: 'port' } */
  aliases?: Record<string, string>;
  /** Flags that are always boolean (never consume next arg as value) */
  booleans?: string[];
}

export function parseArgs(argv: string[], options: ArgParserOptions = {}): ParsedArgs {
  const aliases = options.aliases ?? {};
  const booleans = new Set(options.booleans ?? []);
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];

    if (arg === '--') {
      // Everything after -- is positional
      positionals.push(...argv.slice(i + 1));
      break;
    }

    if (arg.startsWith('--no-')) {
      const name = arg.slice(5);
      flags[name] = false;
      i++;
      continue;
    }

    if (arg.startsWith('--')) {
      const eqIdx = arg.indexOf('=');
      if (eqIdx !== -1) {
        const name = arg.slice(2, eqIdx);
        flags[name] = arg.slice(eqIdx + 1);
      } else {
        const name = arg.slice(2);
        if (booleans.has(name) || i + 1 >= argv.length || argv[i + 1].startsWith('-')) {
          flags[name] = true;
        } else {
          flags[name] = argv[i + 1];
          i++;
        }
      }
      i++;
      continue;
    }

    if (arg.startsWith('-') && arg.length === 2) {
      const short = arg[1];
      const name = aliases[short] ?? short;
      if (booleans.has(name) || i + 1 >= argv.length || argv[i + 1].startsWith('-')) {
        flags[name] = true;
      } else {
        flags[name] = argv[i + 1];
        i++;
      }
      i++;
      continue;
    }

    positionals.push(arg);
    i++;
  }

  return { positionals, flags };
}
