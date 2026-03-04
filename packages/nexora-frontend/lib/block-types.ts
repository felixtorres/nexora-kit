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
  text: string;
}

export interface CodeBlock {
  type: 'code';
  language?: string;
  code: string;
  title?: string;
}

export interface ImageBlock {
  type: 'image';
  url: string;
  alt?: string;
  caption?: string;
}

export interface ActionButton {
  actionId: string;
  label: string;
  style?: 'primary' | 'secondary' | 'destructive';
}

export interface ActionBlock {
  type: 'action';
  actions: ActionButton[];
}

export interface FormField {
  name: string;
  label: string;
  type: 'text' | 'number' | 'select' | 'checkbox' | 'textarea';
  required?: boolean;
  options?: string[];
  defaultValue?: string | number | boolean;
}

export interface FormBlock {
  type: 'form';
  formId: string;
  title?: string;
  fields: FormField[];
  submitLabel?: string;
}

export interface ArtifactBlock {
  type: 'artifact';
  artifactId: string;
  title: string;
  content: string;
  language?: string;
  version?: number;
}

export interface ProgressBlock {
  type: 'progress';
  label: string;
  current?: number;
  total?: number;
}

export interface ErrorBlock {
  type: 'error';
  message: string;
  code?: string;
}

export interface CustomBlock {
  type: `custom:${string}`;
  data: unknown;
}

export type ResponseBlock =
  | TextBlock
  | TableBlock
  | CodeBlock
  | ImageBlock
  | ActionBlock
  | FormBlock
  | ArtifactBlock
  | ProgressBlock
  | ErrorBlock
  | CustomBlock;

// ── Message types ──────────────────────────────────────────────────────

export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  blocks?: ResponseBlock[];
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
