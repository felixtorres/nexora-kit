import type { ParsedArgs } from './args.js';

export interface CliCommand {
  name: string;
  description: string;
  usage: string;
  run(args: ParsedArgs): Promise<void>;
}

export class CommandRouter {
  private readonly commands = new Map<string, CliCommand>();

  register(command: CliCommand): void {
    this.commands.set(command.name, command);
  }

  get(name: string): CliCommand | undefined {
    return this.commands.get(name);
  }

  list(): CliCommand[] {
    return [...this.commands.values()];
  }

  async route(args: ParsedArgs): Promise<void> {
    const [commandName, ...rest] = args.positionals;

    if (!commandName || args.flags['help'] || args.flags['h']) {
      this.printHelp();
      return;
    }

    if (args.flags['version'] || args.flags['V']) {
      console.log('nexora-kit 0.1.0');
      return;
    }

    // Support nested commands: "plugin init" → "plugin:init"
    const subcommand = rest[0];
    const compoundName = subcommand ? `${commandName}:${subcommand}` : undefined;

    const command = (compoundName ? this.commands.get(compoundName) : undefined) ?? this.commands.get(commandName);

    if (!command) {
      console.error(`Unknown command: ${commandName}`);
      console.error(`Run 'nexora-kit --help' for usage.`);
      process.exitCode = 1;
      return;
    }

    // If we matched a compound command, shift the positionals
    const routedArgs: ParsedArgs = compoundName && this.commands.has(compoundName)
      ? { positionals: rest.slice(1), flags: args.flags }
      : { positionals: rest, flags: args.flags };

    await command.run(routedArgs);
  }

  printHelp(): void {
    console.log('nexora-kit — Enterprise chatbot platform CLI\n');
    console.log('Usage: nexora-kit <command> [options]\n');
    console.log('Commands:');

    // Group by prefix
    const grouped = new Map<string, CliCommand[]>();
    for (const cmd of this.commands.values()) {
      const prefix = cmd.name.includes(':') ? cmd.name.split(':')[0] : cmd.name;
      const list = grouped.get(prefix) ?? [];
      list.push(cmd);
      grouped.set(prefix, list);
    }

    for (const [, cmds] of grouped) {
      for (const cmd of cmds) {
        const displayName = cmd.name.replace(':', ' ');
        console.log(`  ${displayName.padEnd(24)} ${cmd.description}`);
      }
    }

    console.log('\nOptions:');
    console.log('  --help, -h             Show help');
    console.log('  --version, -V          Show version');
  }
}
