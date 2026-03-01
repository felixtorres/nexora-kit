import type { Context, Message, Session, ToolDefinition } from './types.js';

export interface ContextManagerOptions {
  defaultSystemPrompt?: string;
  maxContextTokens?: number;
}

export class ContextManager {
  private readonly defaultSystemPrompt: string;
  private readonly maxContextTokens: number;

  constructor(options: ContextManagerOptions = {}) {
    this.defaultSystemPrompt = options.defaultSystemPrompt ?? 'You are a helpful assistant.';
    this.maxContextTokens = options.maxContextTokens ?? 100_000;
  }

  assemble(session: Session, tools: ToolDefinition[], systemPrompt?: string): Context {
    return {
      systemPrompt: systemPrompt ?? this.defaultSystemPrompt,
      messages: [...session.messages],
      tools,
      metadata: { ...session.metadata },
    };
  }

  append(session: Session, message: Message): void {
    session.messages.push(message);
    session.updatedAt = new Date();
  }

  truncate(session: Session, maxTokens?: number): void {
    const limit = maxTokens ?? this.maxContextTokens;
    // Rough token estimate: 4 chars ≈ 1 token
    let totalChars = 0;
    for (const msg of session.messages) {
      totalChars += typeof msg.content === 'string' ? msg.content.length : JSON.stringify(msg.content).length;
    }

    const estimatedTokens = Math.ceil(totalChars / 4);
    if (estimatedTokens <= limit) return;

    // Keep system messages and the most recent messages
    const systemMessages = session.messages.filter((m) => m.role === 'system');
    const nonSystem = session.messages.filter((m) => m.role !== 'system');

    // Remove oldest non-system messages until under budget
    while (nonSystem.length > 1) {
      const chars = nonSystem.reduce((sum, m) => {
        return sum + (typeof m.content === 'string' ? m.content.length : JSON.stringify(m.content).length);
      }, 0);
      if (Math.ceil(chars / 4) <= limit) break;
      nonSystem.shift();
    }

    session.messages = [...systemMessages, ...nonSystem];
  }
}
