import type { ArgumentDef, CommandDefinition, ParsedCommand, ParseError } from './types.js';

export class CommandParser {
  private commands = new Map<string, CommandDefinition>();

  register(namespace: string, command: CommandDefinition): void {
    const key = `${namespace}:${command.name}`;
    this.commands.set(key, command);
  }

  unregister(qualifiedName: string): void {
    this.commands.delete(qualifiedName);
  }

  parse(input: string): { parsed: ParsedCommand; errors: ParseError[] } | { parsed: null; errors: ParseError[] } {
    const trimmed = input.trim();
    if (!trimmed.startsWith('/')) {
      return { parsed: null, errors: [{ message: 'Command must start with /' }] };
    }

    const tokens = tokenize(trimmed.slice(1));
    if (tokens.length === 0) {
      return { parsed: null, errors: [{ message: 'Empty command' }] };
    }

    const commandToken = tokens[0];
    const separatorIdx = commandToken.indexOf(':');
    if (separatorIdx === -1) {
      return { parsed: null, errors: [{ message: `Invalid command format: expected /namespace:command, got /${commandToken}` }] };
    }

    const namespace = commandToken.slice(0, separatorIdx);
    const command = commandToken.slice(separatorIdx + 1);
    if (!namespace || !command) {
      return { parsed: null, errors: [{ message: 'Empty namespace or command name' }] };
    }

    const qualifiedName = `${namespace}:${command}`;
    const definition = this.commands.get(qualifiedName);
    if (!definition) {
      return { parsed: null, errors: [{ message: `Unknown command: /${qualifiedName}` }] };
    }

    const argTokens = tokens.slice(1);
    const { args, errors } = parseArguments(argTokens, definition.args);

    if (errors.length > 0) {
      return { parsed: null, errors };
    }

    return {
      parsed: { namespace, command, args },
      errors: [],
    };
  }

  generateHelp(): string {
    if (this.commands.size === 0) return 'No commands available.';

    const lines: string[] = ['Available commands:', ''];
    for (const [key, def] of this.commands) {
      lines.push(`  /${key} — ${def.description}`);
    }
    return lines.join('\n');
  }

  generateCommandHelp(qualifiedName: string): string | null {
    const def = this.commands.get(qualifiedName);
    if (!def) return null;

    const lines: string[] = [`/${qualifiedName} — ${def.description}`, ''];
    if (def.args.length === 0) {
      lines.push('  No arguments.');
      return lines.join('\n');
    }

    lines.push('Arguments:');
    for (const arg of def.args) {
      const alias = arg.alias ? ` (-${arg.alias})` : '';
      const required = arg.required ? ' [required]' : '';
      const defaultVal = arg.default !== undefined ? ` (default: ${arg.default})` : '';
      const enumVals = arg.enum ? ` (one of: ${arg.enum.join(', ')})` : '';
      const desc = arg.description ? ` — ${arg.description}` : '';
      lines.push(`  --${arg.name}${alias}${desc}${required}${defaultVal}${enumVals}`);
    }
    return lines.join('\n');
  }

  has(qualifiedName: string): boolean {
    return this.commands.has(qualifiedName);
  }
}

function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < input.length) {
    // Skip whitespace
    while (i < input.length && input[i] === ' ') i++;
    if (i >= input.length) break;

    // Quoted string
    if (input[i] === '"' || input[i] === "'") {
      const quote = input[i];
      i++;
      let token = '';
      while (i < input.length && input[i] !== quote) {
        token += input[i];
        i++;
      }
      i++; // skip closing quote
      tokens.push(token);
    } else {
      // Unquoted token
      let token = '';
      while (i < input.length && input[i] !== ' ') {
        token += input[i];
        i++;
      }
      tokens.push(token);
    }
  }
  return tokens;
}

function parseArguments(
  tokens: string[],
  defs: ArgumentDef[],
): { args: Record<string, unknown>; errors: ParseError[] } {
  const args: Record<string, unknown> = {};
  const errors: ParseError[] = [];

  // Build alias map
  const aliasMap = new Map<string, string>();
  for (const def of defs) {
    if (def.alias) {
      aliasMap.set(def.alias, def.name);
    }
  }

  // Build def lookup
  const defMap = new Map<string, ArgumentDef>();
  for (const def of defs) {
    defMap.set(def.name, def);
  }

  let positionalIndex = 0;
  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i];

    if (token.startsWith('--')) {
      // Named argument
      const name = token.slice(2);
      const def = defMap.get(name);
      if (!def) {
        errors.push({ message: `Unknown argument: --${name}`, argument: name });
        i++;
        continue;
      }

      if (def.type === 'boolean') {
        args[name] = true;
        i++;
      } else {
        i++;
        if (i >= tokens.length) {
          errors.push({ message: `Missing value for --${name}`, argument: name });
          continue;
        }
        args[name] = coerce(tokens[i], def.type);
        i++;
      }
    } else if (token.startsWith('-') && token.length === 2) {
      // Alias
      const alias = token.slice(1);
      const name = aliasMap.get(alias);
      if (!name) {
        errors.push({ message: `Unknown alias: -${alias}`, argument: alias });
        i++;
        continue;
      }
      const def = defMap.get(name)!;

      if (def.type === 'boolean') {
        args[name] = true;
        i++;
      } else {
        i++;
        if (i >= tokens.length) {
          errors.push({ message: `Missing value for -${alias}`, argument: name });
          continue;
        }
        args[name] = coerce(tokens[i], def.type);
        i++;
      }
    } else {
      // Positional argument
      if (positionalIndex < defs.length) {
        const def = defs[positionalIndex];
        args[def.name] = coerce(token, def.type);
        positionalIndex++;
      }
      i++;
    }
  }

  // Apply defaults and check required
  for (const def of defs) {
    if (args[def.name] === undefined) {
      if (def.default !== undefined) {
        args[def.name] = def.default;
      } else if (def.required) {
        errors.push({ message: `Missing required argument: --${def.name}`, argument: def.name });
      }
    }

    // Enum validation
    if (def.enum && args[def.name] !== undefined) {
      if (!def.enum.includes(String(args[def.name]))) {
        errors.push({
          message: `Invalid value for --${def.name}: "${args[def.name]}". Must be one of: ${def.enum.join(', ')}`,
          argument: def.name,
        });
      }
    }
  }

  return { args, errors };
}

function coerce(value: string, type: string): unknown {
  switch (type) {
    case 'number': {
      const num = Number(value);
      return isNaN(num) ? value : num;
    }
    case 'boolean':
      return value === 'true' || value === '1';
    default:
      return value;
  }
}
