import type { CommandContext, CommandResult } from './types.js';
import { CommandParser } from './parser.js';
import { CommandRegistry } from './registry.js';

export class CommandDispatcher {
  private readonly parser: CommandParser;
  private readonly registry: CommandRegistry;

  constructor(registry: CommandRegistry) {
    this.registry = registry;
    this.parser = new CommandParser();
  }

  syncFromRegistry(): void {
    for (const entry of this.registry.list()) {
      if (!this.parser.has(entry.qualifiedName)) {
        this.parser.register(entry.namespace, entry.definition);
      }
    }
  }

  isCommand(input: string): boolean {
    const trimmed = input.trim();
    if (!trimmed.startsWith('/')) return false;

    const firstSpace = trimmed.indexOf(' ');
    const commandPart = firstSpace === -1 ? trimmed.slice(1) : trimmed.slice(1, firstSpace);
    return commandPart.includes(':') && this.parser.has(commandPart);
  }

  async dispatch(
    input: string,
    session?: { id: string; userId: string; teamId: string },
  ): Promise<CommandResult> {
    const { parsed, errors } = this.parser.parse(input);

    if (!parsed) {
      return { content: errors.map((e) => e.message).join('\n'), isError: true };
    }

    const qualifiedName = `${parsed.namespace}:${parsed.command}`;
    const entry = this.registry.get(qualifiedName);

    if (!entry?.handler) {
      return { content: `No handler registered for command '${qualifiedName}'`, isError: true };
    }

    const context: CommandContext = {
      args: parsed.args,
      raw: input,
      session,
    };

    try {
      return await entry.handler(context);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { content: `Command error: ${message}`, isError: true };
    }
  }

  generateHelp(): string {
    return this.parser.generateHelp();
  }

  generateCommandHelp(qualifiedName: string): string | null {
    return this.parser.generateCommandHelp(qualifiedName);
  }
}
