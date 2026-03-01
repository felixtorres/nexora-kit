import type { CommandDefinition, CommandHandler } from './types.js';

export interface RegisteredCommand {
  qualifiedName: string;
  namespace: string;
  definition: CommandDefinition;
  handler?: CommandHandler;
}

export class CommandRegistry {
  private commands = new Map<string, RegisteredCommand>();

  register(namespace: string, definition: CommandDefinition): void {
    const qualifiedName = `${namespace}:${definition.name}`;
    if (this.commands.has(qualifiedName)) {
      throw new Error(`Command '${qualifiedName}' is already registered`);
    }
    this.commands.set(qualifiedName, { qualifiedName, namespace, definition });
  }

  registerHandler(qualifiedName: string, handler: CommandHandler): void {
    const entry = this.commands.get(qualifiedName);
    if (!entry) {
      throw new Error(`Command '${qualifiedName}' is not registered`);
    }
    entry.handler = handler;
  }

  get(qualifiedName: string): RegisteredCommand | undefined {
    return this.commands.get(qualifiedName);
  }

  unregister(qualifiedName: string): void {
    this.commands.delete(qualifiedName);
  }

  unregisterNamespace(namespace: string): void {
    for (const [key, entry] of this.commands) {
      if (entry.namespace === namespace) {
        this.commands.delete(key);
      }
    }
  }

  list(): RegisteredCommand[] {
    return [...this.commands.values()];
  }

  has(qualifiedName: string): boolean {
    return this.commands.has(qualifiedName);
  }
}
