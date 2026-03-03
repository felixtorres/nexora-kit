import { z } from 'zod';
import type { AgentLoop, MessageStore } from '@nexora-kit/core';
import type { PluginLifecycleManager } from '@nexora-kit/plugins';
import type { AdminService } from '@nexora-kit/admin';
import type { IConversationStore } from '@nexora-kit/storage';

// --- Auth ---

export interface AuthIdentity {
  userId: string;
  teamId: string;
  role: 'admin' | 'user';
}

export interface AuthProvider {
  authenticate(req: ApiRequest): Promise<AuthIdentity | null>;
}

// --- Rate limiting ---

export interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetMs: number;
}

// --- Request / Response ---

export interface ApiRequest {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
  params: Record<string, string>;
  query: Record<string, string>;
  auth?: AuthIdentity;
}

export interface ApiResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

// --- Route handler ---

export type RouteHandler = (req: ApiRequest) => Promise<ApiResponse>;

export interface Route {
  method: string;
  pattern: string;
  handler: RouteHandler;
}

// --- Gateway config ---

export interface GatewayConfig {
  port: number;
  host?: string;
  apiPrefix?: string;
  agentLoop: AgentLoop;
  auth: AuthProvider;
  conversationStore?: IConversationStore;
  messageStore?: MessageStore;
  plugins?: PluginLifecycleManager;
  admin?: AdminService;
  rateLimit?: RateLimitConfig;
  wsHeartbeatMs?: number;
  allowedOrigins?: string[];
  maxBodyBytes?: number;
  publicMetrics?: boolean;
  wsMaxMessagesPerMinute?: number;
  wsMaxConcurrentChats?: number;
  wsMaxConnectionsPerUser?: number;
}

// --- Input schema (shared) ---

const chatInputSchema = z.union([
  z.string().min(1).max(100_000),
  z.object({ type: z.literal('text'), text: z.string().min(1).max(100_000) }),
  z.object({ type: z.literal('action'), actionId: z.string(), payload: z.record(z.unknown()) }),
  z.object({ type: z.literal('file'), fileId: z.string(), text: z.string().optional() }),
]);

// --- Conversation schemas ---

export const createConversationSchema = z.object({
  title: z.string().max(200).optional(),
  systemPrompt: z.string().max(50_000).optional(),
  templateId: z.string().optional(),
  workspaceId: z.string().optional(),
  model: z.string().optional(),
  agentId: z.string().optional(),
  pluginNamespaces: z.array(z.string()).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type CreateConversationBody = z.infer<typeof createConversationSchema>;

export const updateConversationSchema = z.object({
  title: z.string().max(200).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type UpdateConversationBody = z.infer<typeof updateConversationSchema>;

// --- Send message schema (conversationId is in URL path) ---

export const sendMessageSchema = z.object({
  input: chatInputSchema,
  pluginNamespaces: z.array(z.string()).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type SendMessageBody = z.infer<typeof sendMessageSchema>;

// --- Legacy chat request (kept for backward compat) ---

export const chatRequestSchema = z.object({
  input: chatInputSchema,
  conversationId: z.string().min(1).max(256).optional(),
  pluginNamespaces: z.array(z.string()).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type ChatRequestBody = z.infer<typeof chatRequestSchema>;

// --- WebSocket message types ---

export interface WsChatMessage {
  type: 'chat';
  conversationId?: string;
  input: string | { type: 'text'; text: string } | { type: 'action'; actionId: string; payload: Record<string, unknown> } | { type: 'file'; fileId: string; text?: string };
  pluginNamespaces?: string[];
  metadata?: Record<string, unknown>;
}

export interface WsPingMessage {
  type: 'ping';
}

export interface WsCancelMessage {
  type: 'cancel';
  conversationId: string;
}

export type WsClientMessage = WsChatMessage | WsPingMessage | WsCancelMessage;

export const wsChatMessageSchema = z.object({
  type: z.literal('chat'),
  conversationId: z.string().optional(),
  input: chatInputSchema,
  pluginNamespaces: z.array(z.string()).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const wsPingMessageSchema = z.object({
  type: z.literal('ping'),
});

export const wsCancelMessageSchema = z.object({
  type: z.literal('cancel'),
  conversationId: z.string(),
});
