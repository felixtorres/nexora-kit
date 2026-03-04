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
  SendMessageBody,
  CreateConversationBody,
  UpdateConversationBody,
  WsChatMessage,
  WsPingMessage,
  WsCancelMessage,
  WsClientMessage,
} from './types.js';
export {
  chatRequestSchema,
  sendMessageSchema,
  createConversationSchema,
  updateConversationSchema,
  wsChatMessageSchema,
  wsPingMessageSchema,
  wsCancelMessageSchema,
} from './types.js';

export { ApiKeyAuth, JwtAuth, CompositeAuth } from './auth.js';
export type { JwtPayload } from './auth.js';

export { RateLimiter } from './rate-limit.js';

export { Router, ApiError, errorResponse, jsonResponse, parseRequest, sendResponse } from './router.js';

export {
  createChatHandler,
  createConversationCreateHandler,
  createConversationListHandler,
  createConversationGetHandler,
  createConversationUpdateHandler,
  createConversationDeleteHandler,
  createMessageListHandler,
  createSendMessageHandler,
  createPluginsListHandler,
  createPluginDetailHandler,
  createHealthHandler,
} from './handlers.js';
export type { HandlerDeps } from './handlers.js';

export { WebSocketManager, isWebSocketUpgrade } from './websocket.js';
export type { WsConnection, WsRateLimitConfig } from './websocket.js';

export { ClientWebSocketManager } from './client-websocket.js';
export type { ClientWsConnection, ClientWsManagerDeps } from './client-websocket.js';

export { computeAcceptKey, decodeFrame, encodeFrame, sendJsonFrame } from './ws-utils.js';
export type { DecodedFrame } from './ws-utils.js';

export {
  createAdminPluginEnableHandler,
  createAdminPluginDisableHandler,
  createAdminPluginUninstallHandler,
  createAdminAuditLogHandler,
  createAdminUsageHandler,
  createAdminAuditPurgeHandler,
} from './admin-handlers.js';

export {
  createListArtifactsHandler,
  createGetArtifactHandler,
  createListArtifactVersionsHandler,
  createGetArtifactVersionHandler,
  createDeleteArtifactHandler,
} from './artifact-handlers.js';
export type { ArtifactHandlerDeps } from './artifact-handlers.js';

export { MetricsCollector, type MetricsSnapshot } from './metrics.js';

export { Gateway } from './gateway.js';
export { buildOpenApiSpec } from './openapi.js';
