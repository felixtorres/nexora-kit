// Mirrors the ResponseBlock union from @nexora-kit/core

export interface TableColumn {
  key: string;
  label: string;
}

export interface TableBlock {
  type: 'table';
  columns: TableColumn[];
  rows: Record<string, unknown>[];
}

export interface TextBlock {
  type: 'text';
  content: string;
}

export interface CodeBlock {
  type: 'code';
  language?: string;
  code: string;
}

export interface ImageBlock {
  type: 'image';
  url: string;
  alt?: string;
}

export interface Action {
  id: string;
  label: string;
  style?: 'primary' | 'secondary' | 'danger';
  payload?: Record<string, unknown>;
}

export interface ActionBlock {
  type: 'action';
  actions: Action[];
}

export interface FormField {
  name: string;
  label: string;
  type: 'text' | 'number' | 'select' | 'checkbox' | 'textarea';
  required?: boolean;
  options?: string[];
  default?: unknown;
}

export interface FormBlock {
  type: 'form';
  id: string;
  title?: string;
  fields: FormField[];
  submitLabel?: string;
}

export interface CardBlock {
  type: 'card';
  title: string;
  body?: string;
  imageUrl?: string;
  actions?: Action[];
}

export interface SuggestedRepliesBlock {
  type: 'suggested_replies';
  replies: string[];
}

export interface ProgressBlock {
  type: 'progress';
  label: string;
  value?: number;
  max?: number;
}

export interface CustomBlock {
  type: `custom:${string}`;
  data: unknown;
}

// Tool call block rendered as a collapsible status indicator (like Claude's UI)
export interface ToolCallBlock {
  type: 'tool_call';
  id: string;
  name: string;
  input?: Record<string, unknown>;
  status: 'executing' | 'completed' | 'error';
  result?: string;
  isError?: boolean;
}

// ErrorBlock is not in backend ResponseBlock union but kept for frontend-only error rendering
export interface ErrorBlock {
  type: 'error';
  message: string;
  code?: string;
}

// ActivityBlock is frontend-only — renders agent lifecycle events with muted styling
export interface ActivityBlock {
  type: 'activity';
  event:
    | 'turn_start'
    | 'turn_continue'
    | 'compaction'
    | 'sub_agent_start'
    | 'sub_agent_end'
    | 'thinking';
  label: string;
  detail?: string;
  timestamp: number;
}

export type ResponseBlock =
  | TextBlock
  | CardBlock
  | ActionBlock
  | SuggestedRepliesBlock
  | TableBlock
  | ImageBlock
  | CodeBlock
  | FormBlock
  | ProgressBlock
  | CustomBlock;

// Frontend display union includes ErrorBlock, ToolCallBlock, and ActivityBlock for local rendering
export type DisplayBlock = ResponseBlock | ErrorBlock | ToolCallBlock | ActivityBlock;

// ── Message types ──────────────────────────────────────────────────────

export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  blocks?: DisplayBlock[];
}

export interface SendMessageResponse {
  conversationId: string;
  message: string;
  blocks?: ResponseBlock[];
}

export interface ConversationRecord {
  id: string;
  title?: string;
  messageCount: number;
  lastMessageAt?: string;
  agentId?: string;
  model?: string;
  pluginNamespaces?: string[];
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

// ── Artifact streaming types ───────────────────────────────────────────

export interface StreamingArtifact {
  artifactId: string;
  title: string;
  content: string;
  done: boolean;
}
