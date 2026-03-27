import { z } from 'zod';
import type { AgentLoop, MessageStore, Logger } from '@nexora-kit/core';
import type { PluginLifecycleManager } from '@nexora-kit/plugins';
import type { AdminService } from '@nexora-kit/admin';
import type {
  IConversationStore,
  IBotStore,
  IAgentStore,
  IAgentBotBindingStore,
  IEndUserStore,
  IFeedbackStore,
  IUserMemoryStore,
  IConversationTemplateStore,
  IFileStore,
  IWorkspaceStore,
  IContextDocumentStore,
  IArtifactStore,
  IUsageEventStore,
} from '@nexora-kit/storage';

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
  signal?: AbortSignal;
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
  logger?: Logger;
  agentLoop: AgentLoop;
  auth: AuthProvider;
  conversationStore?: IConversationStore;
  messageStore?: MessageStore;
  plugins?: PluginLifecycleManager;
  admin?: AdminService;
  botStore?: IBotStore;
  agentStore?: IAgentStore;
  agentBotBindingStore?: IAgentBotBindingStore;
  endUserStore?: IEndUserStore;
  feedbackStore?: IFeedbackStore;
  userMemoryStore?: IUserMemoryStore;
  templateStore?: IConversationTemplateStore;
  fileStore?: IFileStore;
  fileBackend?: import('./file-handlers.js').FileBackend;
  workspaceStore?: IWorkspaceStore;
  contextDocumentStore?: IContextDocumentStore;
  artifactStore?: IArtifactStore;
  usageEventStore?: IUsageEventStore;
  fileBasePath?: string;
  maxFileSize?: number;
  allowedMimeTypes?: string[];
  /** Dashboard plugin store — enables GET /shared/dashboards/:token */
  dashboardStore?: { getByToken(token: string): Promise<{ dashboard: { definition: string; title: string }; share: { expiresAt?: string } } | null> };
  rateLimit?: RateLimitConfig;
  wsHeartbeatMs?: number;
  allowedOrigins?: string[];
  maxBodyBytes?: number;
  commandDispatcher?: { listCommands?(): Array<{ qualifiedName: string; description: string }> };
  publicMetrics?: boolean;
  wsMaxMessagesPerMinute?: number;
  wsMaxConcurrentChats?: number;
  wsMaxConnectionsPerUser?: number;
  clientWsMaxMessagesPerMinute?: number;
  clientWsMaxConcurrentChats?: number;
  clientWsMaxConnectionsPerEndUser?: number;
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

// --- Edit message schema ---

export const editMessageSchema = z.object({
  input: chatInputSchema,
});

export type EditMessageBody = z.infer<typeof editMessageSchema>;

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
  input:
    | string
    | { type: 'text'; text: string }
    | { type: 'action'; actionId: string; payload: Record<string, unknown> }
    | { type: 'file'; fileId: string; text?: string };
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

// --- Bot schemas ---

const slugPattern = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

export const createBotSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  systemPrompt: z.string().min(1).max(50_000),
  pluginNamespaces: z.array(z.string()).optional(),
  model: z.string().min(1).max(100),
  temperature: z.number().min(0).max(2).optional(),
  maxTurns: z.number().int().min(1).max(100).optional(),
  workspaceId: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type CreateBotBody = z.infer<typeof createBotSchema>;

export const updateBotSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  systemPrompt: z.string().min(1).max(50_000).optional(),
  pluginNamespaces: z.array(z.string()).optional(),
  model: z.string().min(1).max(100).optional(),
  temperature: z.number().min(0).max(2).nullable().optional(),
  maxTurns: z.number().int().min(1).max(100).nullable().optional(),
  workspaceId: z.string().nullable().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type UpdateBotBody = z.infer<typeof updateBotSchema>;

// --- Agent schemas ---

const orchestrationStrategySchema = z.enum(['single', 'orchestrate', 'route']);

const appearanceSchema = z
  .object({
    displayName: z.string().max(100).optional(),
    avatarUrl: z.string().url().optional(),
    description: z.string().max(500).optional(),
    welcomeMessage: z.string().max(2000).optional(),
    placeholder: z.string().max(200).optional(),
  })
  .optional();

const endUserAuthSchema = z
  .object({
    mode: z.enum(['anonymous', 'token', 'jwt']).optional(),
    jwtSecret: z.string().optional(),
    tokenPrefix: z.string().optional(),
  })
  .optional();

const rateLimitsSchema = z
  .object({
    messagesPerMinute: z.number().int().min(1).optional(),
    conversationsPerDay: z.number().int().min(1).optional(),
  })
  .optional();

const featuresSchema = z
  .object({
    artifacts: z.boolean().optional(),
    fileUpload: z.boolean().optional(),
    feedback: z.boolean().optional(),
    memory: z.boolean().optional(),
  })
  .optional();

export const createAgentSchema = z.object({
  slug: z
    .string()
    .min(1)
    .max(60)
    .regex(slugPattern, 'Slug must be lowercase alphanumeric with hyphens'),
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  orchestrationStrategy: orchestrationStrategySchema.optional(),
  orchestratorModel: z.string().optional(),
  orchestratorPrompt: z.string().max(50_000).optional(),
  botId: z.string().optional(),
  fallbackBotId: z.string().optional(),
  appearance: appearanceSchema,
  endUserAuth: endUserAuthSchema,
  rateLimits: rateLimitsSchema,
  features: featuresSchema,
  enabled: z.boolean().optional(),
});

export type CreateAgentBody = z.infer<typeof createAgentSchema>;

export const updateAgentSchema = z.object({
  slug: z
    .string()
    .min(1)
    .max(60)
    .regex(slugPattern, 'Slug must be lowercase alphanumeric with hyphens')
    .optional(),
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  orchestrationStrategy: orchestrationStrategySchema.optional(),
  orchestratorModel: z.string().nullable().optional(),
  orchestratorPrompt: z.string().max(50_000).nullable().optional(),
  botId: z.string().nullable().optional(),
  fallbackBotId: z.string().nullable().optional(),
  appearance: appearanceSchema,
  endUserAuth: endUserAuthSchema,
  rateLimits: rateLimitsSchema,
  features: featuresSchema,
  enabled: z.boolean().optional(),
});

export type UpdateAgentBody = z.infer<typeof updateAgentSchema>;

// --- Binding schema ---

const bindingSchema = z.object({
  botId: z.string().min(1),
  priority: z.number().int().min(0).optional(),
  description: z.string().max(500).optional(),
  keywords: z.array(z.string()).optional(),
});

export const replaceBindingsSchema = z.object({
  bindings: z.array(bindingSchema),
});

export type ReplaceBindingsBody = z.infer<typeof replaceBindingsSchema>;
