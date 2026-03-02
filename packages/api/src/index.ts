export type {
  AuthIdentity,
  AuthProvider,
  RateLimitConfig,
  RateLimitResult,
  ApiRequest,
  ApiResponse,
  RouteHandler,
  Route,
  GatewayConfig,
  ChatRequestBody,
  WsChatMessage,
  WsPingMessage,
  WsClientMessage,
} from './types.js';
export { chatRequestSchema, wsChatMessageSchema, wsPingMessageSchema } from './types.js';

export { ApiKeyAuth, JwtAuth, CompositeAuth } from './auth.js';
export type { JwtPayload } from './auth.js';

export { RateLimiter } from './rate-limit.js';

export { Router, ApiError, errorResponse, jsonResponse, parseRequest, sendResponse } from './router.js';

export {
  createChatHandler,
  createPluginsListHandler,
  createPluginDetailHandler,
  createHealthHandler,
} from './handlers.js';
export type { HandlerDeps } from './handlers.js';

export { WebSocketManager, isWebSocketUpgrade } from './websocket.js';
export type { WsConnection, WsRateLimitConfig } from './websocket.js';

export {
  createAdminPluginEnableHandler,
  createAdminPluginDisableHandler,
  createAdminPluginUninstallHandler,
  createAdminAuditLogHandler,
  createAdminUsageHandler,
  createAdminAuditPurgeHandler,
} from './admin-handlers.js';

export { MetricsCollector, type MetricsSnapshot } from './metrics.js';

export { Gateway } from './gateway.js';
export { buildOpenApiSpec } from './openapi.js';
