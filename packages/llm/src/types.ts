export interface LlmMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | LlmContentBlock[];
}

export type LlmContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; toolUseId: string; content: string; isError?: boolean };

export interface LlmToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface LlmRequest {
  model: string;
  messages: LlmMessage[];
  tools?: LlmToolDefinition[];
  temperature?: number;
  maxTokens?: number;
  stream: boolean;
}

export type LlmEvent =
  | { type: 'text'; content: string }
  | { type: 'tool_call'; id: string; name: string; input: unknown }
  | { type: 'usage'; inputTokens: number; outputTokens: number }
  | { type: 'thinking'; content: string }
  | { type: 'done' };

export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  contextWindow: number;
  maxOutputTokens: number;
}
