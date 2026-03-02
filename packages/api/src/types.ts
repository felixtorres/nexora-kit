import { z } from 'zod';
import type { AgentLoop } from '@nexora-kit/core';
import type { PluginLifecycleManager } from '@nexora-kit/plugins';
import type { AdminService } from '@nexora-kit/admin';

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

// --- Chat request validation ---

export const chatRequestSchema = z.object({
  message: z.string().min(1).max(100_000),
  sessionId: z.string().min(1).max(256).optional(),
  pluginNamespaces: z.array(z.string()).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type ChatRequestBody = z.infer<typeof chatRequestSchema>;

// --- WebSocket message types ---

export interface WsChatMessage {
  type: 'chat';
  sessionId?: string;
  message: string;
  pluginNamespaces?: string[];
  metadata?: Record<string, unknown>;
}

export interface WsPingMessage {
  type: 'ping';
}

export type WsClientMessage = WsChatMessage | WsPingMessage;

export const wsChatMessageSchema = z.object({
  type: z.literal('chat'),
  sessionId: z.string().optional(),
  message: z.string().min(1).max(100_000),
  pluginNamespaces: z.array(z.string()).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const wsPingMessageSchema = z.object({
  type: z.literal('ping'),
});
