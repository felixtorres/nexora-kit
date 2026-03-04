export interface ArgumentDef {
  name: string;
  type: 'string' | 'number' | 'boolean';
  description?: string;
  required?: boolean;
  default?: unknown;
  alias?: string;
  enum?: string[];
}

export interface CommandDefinition {
  name: string;
  description: string;
  args: ArgumentDef[];
  handler?: CommandHandler;
  prompt?: string;
}

export type CommandHandler = (context: CommandContext) => Promise<CommandResult>;

export interface CommandContext {
  args: Record<string, unknown>;
  raw: string;
  session?: { id: string; userId: string; teamId: string };
}

export interface CommandResult {
  content: string;
  isError?: boolean;
  /** When true, content is a prompt that should be sent to the LLM rather than returned directly. */
  isPrompt?: boolean;
}

export interface ParsedCommand {
  namespace: string;
  command: string;
  args: Record<string, unknown>;
}

export interface ParseError {
  message: string;
  argument?: string;
}
