import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import type { Socket } from 'node:net';
import type { Logger } from '@nexora-kit/core';
import type { GatewayConfig, AuthIdentity } from './types.js';
import {
  Router,
  parseRequest,
  sendResponse,
  errorResponse,
  ApiError,
  jsonResponse,
} from './router.js';
import { RateLimiter } from './rate-limit.js';
import { WebSocketManager, isWebSocketUpgrade } from './websocket.js';
import { ClientWebSocketManager } from './client-websocket.js';
import {
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
  type HandlerDeps,
} from './handlers.js';
import {
  createAdminPluginEnableHandler,
  createAdminPluginDisableHandler,
  createAdminPluginUninstallHandler,
  createAdminAuditLogHandler,
  createAdminUsageHandler,
  createAdminAuditPurgeHandler,
} from './admin-handlers.js';
import {
  createBotCreateHandler,
  createBotListHandler,
  createBotGetHandler,
  createBotUpdateHandler,
  createBotDeleteHandler,
  createAgentCreateHandler,
  createAgentListHandler,
  createAgentGetHandler,
  createAgentUpdateHandler,
  createAgentDeleteHandler,
  createReplaceBindingsHandler,
  createEndUserListHandler,
  type BotAgentAdminDeps,
} from './bot-agent-admin-handlers.js';
import {
  createListMemoryHandler,
  createDeleteMemoryFactHandler,
  createDeleteAllMemoryHandler,
  type UserMemoryHandlerDeps,
} from './user-memory-handlers.js';
import {
  createTemplateCreateHandler,
  createTemplateListHandler,
  createTemplateGetHandler,
  createTemplateUpdateHandler,
  createTemplateDeleteHandler,
  type TemplateHandlerDeps,
} from './template-handlers.js';
import {
  createSubmitFeedbackHandler,
  createAdminFeedbackQueryHandler,
  createAdminFeedbackSummaryHandler,
  type FeedbackHandlerDeps,
} from './feedback-handlers.js';
import {
  createEditMessageHandler,
  createRegenerateMessageHandler,
  type MessageEditDeps,
} from './message-handlers.js';
import {
  createWorkspaceCreateHandler,
  createWorkspaceListHandler,
  createWorkspaceGetHandler,
  createWorkspaceUpdateHandler,
  createWorkspaceDeleteHandler,
  createDocumentCreateHandler,
  createDocumentListHandler,
  createDocumentUpdateHandler,
  createDocumentDeleteHandler,
  type WorkspaceHandlerDeps,
} from './workspace-handlers.js';
import {
  createFileUploadHandler,
  createFileGetHandler,
  createFileDownloadHandler,
  createFileDeleteHandler,
  createConversationFilesHandler,
  type FileHandlerDeps,
  type FileBackend,
} from './file-handlers.js';
import {
  createAgentAppearanceHandler,
  createClientConversationCreateHandler,
  createClientConversationListHandler,
  createClientConversationGetHandler,
  createClientSendMessageHandler,
  type ClientHandlerDeps,
} from './client-handlers.js';
import {
  createListArtifactsHandler,
  createGetArtifactHandler,
  createListArtifactVersionsHandler,
  createGetArtifactVersionHandler,
  createDeleteArtifactHandler,
  type ArtifactHandlerDeps,
} from './artifact-handlers.js';
import { MetricsCollector } from './metrics.js';
import { buildOpenApiSpec } from './openapi.js';

export class Gateway {
  private server: Server | null = null;
  private readonly router: Router;
  private readonly rateLimiter: RateLimiter | null;
  private readonly wsManager: WebSocketManager;
  private readonly clientWsManager: ClientWebSocketManager | null;
  private readonly config: GatewayConfig;
  private readonly logger: Logger | undefined;
  readonly metrics: MetricsCollector;

  constructor(config: GatewayConfig) {
    this.config = config;
    this.logger = config.logger;
    this.metrics = new MetricsCollector();
    const prefix = config.apiPrefix ?? '/v1';

    // Set up handlers
    const deps: HandlerDeps = {
      agentLoop: config.agentLoop,
      conversationStore: config.conversationStore,
      messageStore: config.messageStore,
      plugins: config.plugins,
      usageEventStore: config.usageEventStore,
      logger: config.logger?.child({ component: 'handler' }),
    };

    // Set up router
    this.router = new Router();

    // Conversation endpoints
    this.router.post(`${prefix}/conversations`, createConversationCreateHandler(deps));
    this.router.get(`${prefix}/conversations`, createConversationListHandler(deps));
    this.router.get(`${prefix}/conversations/:id`, createConversationGetHandler(deps));
    this.router.add('PATCH', `${prefix}/conversations/:id`, createConversationUpdateHandler(deps));
    this.router.add('DELETE', `${prefix}/conversations/:id`, createConversationDeleteHandler(deps));
    this.router.get(`${prefix}/conversations/:id/messages`, createMessageListHandler(deps));
    this.router.post(`${prefix}/conversations/:id/messages`, createSendMessageHandler(deps));

    // Message edit/regenerate endpoints (require conversationStore + messageStore)
    if (config.conversationStore && config.messageStore) {
      const msgEditDeps: MessageEditDeps = {
        agentLoop: config.agentLoop,
        conversationStore: config.conversationStore,
        messageStore: config.messageStore,
        feedbackStore: config.feedbackStore,
      };
      this.router.add(
        'PUT',
        `${prefix}/conversations/:id/messages/:seq`,
        createEditMessageHandler(msgEditDeps),
      );
      this.router.post(
        `${prefix}/conversations/:id/messages/:seq/regenerate`,
        createRegenerateMessageHandler(msgEditDeps),
      );
    }

    // Feedback endpoints
    if (config.feedbackStore) {
      const fbDeps: FeedbackHandlerDeps = { feedbackStore: config.feedbackStore };
      this.router.post(
        `${prefix}/conversations/:id/messages/:seq/feedback`,
        createSubmitFeedbackHandler(fbDeps),
      );
      this.router.get(`${prefix}/admin/feedback`, createAdminFeedbackQueryHandler(fbDeps));
      this.router.get(
        `${prefix}/admin/feedback/summary`,
        createAdminFeedbackSummaryHandler(fbDeps),
      );
    }

    // User memory endpoints
    if (config.userMemoryStore) {
      const umDeps: UserMemoryHandlerDeps = { userMemoryStore: config.userMemoryStore };
      this.router.get(`${prefix}/me/memory`, createListMemoryHandler(umDeps));
      this.router.add('DELETE', `${prefix}/me/memory/:key`, createDeleteMemoryFactHandler(umDeps));
      this.router.add('DELETE', `${prefix}/me/memory`, createDeleteAllMemoryHandler(umDeps));
    }

    // File endpoints
    if (config.fileStore && config.fileBackend) {
      const fileDeps: FileHandlerDeps = {
        fileStore: config.fileStore,
        conversationStore: config.conversationStore,
        fileBasePath: config.fileBasePath ?? 'data/files',
        maxFileSize: config.maxFileSize,
        allowedMimeTypes: config.allowedMimeTypes,
      };
      this.router.post(`${prefix}/files`, createFileUploadHandler(fileDeps, config.fileBackend));
      this.router.get(`${prefix}/files/:id`, createFileGetHandler(fileDeps));
      this.router.get(
        `${prefix}/files/:id/content`,
        createFileDownloadHandler(fileDeps, config.fileBackend),
      );
      this.router.add(
        'DELETE',
        `${prefix}/files/:id`,
        createFileDeleteHandler(fileDeps, config.fileBackend),
      );
      this.router.get(
        `${prefix}/conversations/:id/files`,
        createConversationFilesHandler(fileDeps),
      );
    }

    // Workspace endpoints
    if (config.workspaceStore && config.contextDocumentStore) {
      const wsDeps: WorkspaceHandlerDeps = {
        workspaceStore: config.workspaceStore,
        contextDocumentStore: config.contextDocumentStore,
      };
      this.router.post(`${prefix}/admin/workspaces`, createWorkspaceCreateHandler(wsDeps));
      this.router.get(`${prefix}/workspaces`, createWorkspaceListHandler(wsDeps));
      this.router.get(`${prefix}/workspaces/:id`, createWorkspaceGetHandler(wsDeps));
      this.router.add(
        'PATCH',
        `${prefix}/admin/workspaces/:id`,
        createWorkspaceUpdateHandler(wsDeps),
      );
      this.router.add(
        'DELETE',
        `${prefix}/admin/workspaces/:id`,
        createWorkspaceDeleteHandler(wsDeps),
      );
      this.router.post(`${prefix}/workspaces/:id/documents`, createDocumentCreateHandler(wsDeps));
      this.router.get(`${prefix}/workspaces/:id/documents`, createDocumentListHandler(wsDeps));
      this.router.add(
        'PATCH',
        `${prefix}/workspaces/:id/documents/:docId`,
        createDocumentUpdateHandler(wsDeps),
      );
      this.router.add(
        'DELETE',
        `${prefix}/workspaces/:id/documents/:docId`,
        createDocumentDeleteHandler(wsDeps),
      );
    }

    if (config.templateStore) {
      const tplDeps: TemplateHandlerDeps = { templateStore: config.templateStore };
      this.router.post(`${prefix}/admin/templates`, createTemplateCreateHandler(tplDeps));
      this.router.get(`${prefix}/templates`, createTemplateListHandler(tplDeps));
      this.router.get(`${prefix}/templates/:id`, createTemplateGetHandler(tplDeps));
      this.router.add(
        'PATCH',
        `${prefix}/admin/templates/:id`,
        createTemplateUpdateHandler(tplDeps),
      );
      this.router.add(
        'DELETE',
        `${prefix}/admin/templates/:id`,
        createTemplateDeleteHandler(tplDeps),
      );
    }

    // Artifact endpoints
    if (config.artifactStore) {
      const artDeps: ArtifactHandlerDeps = {
        artifactStore: config.artifactStore,
        conversationStore: config.conversationStore,
      };
      this.router.get(`${prefix}/conversations/:id/artifacts`, createListArtifactsHandler(artDeps));
      this.router.get(
        `${prefix}/conversations/:id/artifacts/:artifactId`,
        createGetArtifactHandler(artDeps),
      );
      this.router.get(
        `${prefix}/conversations/:id/artifacts/:artifactId/versions`,
        createListArtifactVersionsHandler(artDeps),
      );
      this.router.get(
        `${prefix}/conversations/:id/artifacts/:artifactId/versions/:version`,
        createGetArtifactVersionHandler(artDeps),
      );
      this.router.add(
        'DELETE',
        `${prefix}/conversations/:id/artifacts/:artifactId`,
        createDeleteArtifactHandler(artDeps),
      );
    }

    // Legacy chat endpoint
    this.router.post(`${prefix}/chat`, createChatHandler(deps));

    this.router.get(`${prefix}/plugins`, createPluginsListHandler(deps));
    this.router.get(`${prefix}/plugins/:name`, createPluginDetailHandler(deps));
    this.router.get(`${prefix}/health`, createHealthHandler(deps));
    this.router.get(`${prefix}/commands`, async () => {
      const cmds = config.commandDispatcher?.listCommands?.() ?? [];
      return jsonResponse(200, {
        commands: cmds.map((c) => ({
          name: `/${c.qualifiedName}`,
          description: c.description,
        })),
      });
    });
    this.router.get(`${prefix}/metrics`, async () => jsonResponse(200, this.metrics.snapshot()));
    this.router.get(`${prefix}/openapi.json`, async () =>
      jsonResponse(200, buildOpenApiSpec(prefix)),
    );

    // Admin routes
    if (config.admin) {
      this.router.post(
        `${prefix}/admin/plugins/:name/enable`,
        createAdminPluginEnableHandler(config.admin),
      );
      this.router.post(
        `${prefix}/admin/plugins/:name/disable`,
        createAdminPluginDisableHandler(config.admin),
      );
      this.router.add(
        'DELETE',
        `${prefix}/admin/plugins/:name`,
        createAdminPluginUninstallHandler(config.admin),
      );
      this.router.get(`${prefix}/admin/audit-log`, createAdminAuditLogHandler(config.admin));
      this.router.post(
        `${prefix}/admin/audit-log/purge`,
        createAdminAuditPurgeHandler(config.admin),
      );
      this.router.get(`${prefix}/admin/usage`, createAdminUsageHandler(config.admin));
    }

    // Bot & Agent admin routes
    if (
      config.botStore &&
      config.agentStore &&
      config.agentBotBindingStore &&
      config.endUserStore
    ) {
      const baDeps: BotAgentAdminDeps = {
        botStore: config.botStore,
        agentStore: config.agentStore,
        agentBotBindingStore: config.agentBotBindingStore,
        endUserStore: config.endUserStore,
      };

      this.router.post(`${prefix}/admin/bots`, createBotCreateHandler(baDeps));
      this.router.get(`${prefix}/admin/bots`, createBotListHandler(baDeps));
      this.router.get(`${prefix}/admin/bots/:id`, createBotGetHandler(baDeps));
      this.router.add('PATCH', `${prefix}/admin/bots/:id`, createBotUpdateHandler(baDeps));
      this.router.add('DELETE', `${prefix}/admin/bots/:id`, createBotDeleteHandler(baDeps));

      this.router.post(`${prefix}/admin/agents`, createAgentCreateHandler(baDeps));
      this.router.get(`${prefix}/admin/agents`, createAgentListHandler(baDeps));
      this.router.get(`${prefix}/admin/agents/:id`, createAgentGetHandler(baDeps));
      this.router.add('PATCH', `${prefix}/admin/agents/:id`, createAgentUpdateHandler(baDeps));
      this.router.add('DELETE', `${prefix}/admin/agents/:id`, createAgentDeleteHandler(baDeps));
      this.router.add(
        'PUT',
        `${prefix}/admin/agents/:id/bindings`,
        createReplaceBindingsHandler(baDeps),
      );
      this.router.get(`${prefix}/admin/agents/:id/end-users`, createEndUserListHandler(baDeps));

      // Client API routes (if conversationStore + messageStore also available)
      if (config.conversationStore && config.messageStore) {
        const clientDeps: ClientHandlerDeps = {
          agentStore: config.agentStore,
          agentBotBindingStore: config.agentBotBindingStore,
          endUserStore: config.endUserStore,
          conversationStore: config.conversationStore,
          messageStore: config.messageStore,
          agentLoop: config.agentLoop,
        };

        this.router.get(`${prefix}/agents/:slug`, createAgentAppearanceHandler(clientDeps));
        this.router.post(
          `${prefix}/agents/:slug/conversations`,
          createClientConversationCreateHandler(clientDeps),
        );
        this.router.get(
          `${prefix}/agents/:slug/conversations`,
          createClientConversationListHandler(clientDeps),
        );
        this.router.get(
          `${prefix}/agents/:slug/conversations/:id`,
          createClientConversationGetHandler(clientDeps),
        );
        this.router.post(
          `${prefix}/agents/:slug/conversations/:id/messages`,
          createClientSendMessageHandler(clientDeps),
        );
      }
    }

    // Rate limiter
    this.rateLimiter = config.rateLimit ? new RateLimiter(config.rateLimit) : null;

    // WebSocket manager
    this.wsManager = new WebSocketManager({
      agentLoop: config.agentLoop,
      auth: config.auth,
      heartbeatMs: config.wsHeartbeatMs,
      rateLimits: {
        maxMessagesPerMinute: config.wsMaxMessagesPerMinute,
        maxConcurrentChats: config.wsMaxConcurrentChats,
        maxConnectionsPerUser: config.wsMaxConnectionsPerUser,
      },
    });

    // Client WebSocket manager (for end-user access via /v1/agents/:slug/ws)
    if (config.agentStore && config.endUserStore) {
      this.clientWsManager = new ClientWebSocketManager({
        agentLoop: config.agentLoop,
        agentStore: config.agentStore,
        endUserStore: config.endUserStore,
        conversationStore: config.conversationStore,
        heartbeatMs: config.wsHeartbeatMs,
        rateLimits: {
          maxMessagesPerMinute:
            config.clientWsMaxMessagesPerMinute ?? config.wsMaxMessagesPerMinute,
          maxConcurrentChats: config.clientWsMaxConcurrentChats ?? config.wsMaxConcurrentChats,
          maxConnectionsPerEndUser: config.clientWsMaxConnectionsPerEndUser,
        },
      });
    } else {
      this.clientWsManager = null;
    }
  }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = createServer((req, res) => {
        this.handleRequest(req, res).catch((err) => {
          if (!res.headersSent) {
            sendResponse(res, errorResponse(err));
          }
        });
      });

      this.server.on('upgrade', (req: IncomingMessage, socket: Socket) => {
        if (isWebSocketUpgrade(req)) {
          // Route client WS: /v1/agents/:slug/ws
          const isClientWs = req.url?.match(/\/v1\/agents\/[^/]+\/ws/) && this.clientWsManager;
          if (isClientWs) {
            this.clientWsManager!.handleUpgrade(req, socket).catch(() => {
              socket.destroy();
            });
          } else {
            this.wsManager.handleUpgrade(req, socket).catch((err) => {
              console.error('[gateway] ws upgrade failed:', err);
              socket.destroy();
            });
          }
        } else {
          socket.destroy();
        }
      });

      this.server.on('error', reject);

      const host = this.config.host ?? '127.0.0.1';
      this.server.listen(this.config.port, host, () => {
        this.wsManager.startHeartbeat();
        this.clientWsManager?.startHeartbeat();
        this.rateLimiter?.startCleanup();
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    this.wsManager.stopHeartbeat();
    this.wsManager.closeAll();
    this.clientWsManager?.stopHeartbeat();
    this.clientWsManager?.closeAll();
    this.rateLimiter?.stopCleanup();

    return new Promise((resolve) => {
      if (!this.server) {
        resolve();
        return;
      }
      this.server.close(() => resolve());
    });
  }

  getAddress(): { host: string; port: number } | null {
    const addr = this.server?.address();
    if (!addr || typeof addr === 'string') return null;
    return { host: addr.address, port: addr.port };
  }

  private async resolveAgentBySlug(slug: string): Promise<{ id: string; teamId: string } | null> {
    const store = this.config.agentStore;
    if (!store) return null;

    if (store.getBySlugGlobal) {
      const agent = await store.getBySlugGlobal(slug);
      return agent ? { id: agent.id, teamId: agent.teamId } : null;
    }

    return null;
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const requestStart = Date.now();

    // Correlation ID
    const requestId =
      (req.headers['x-request-id'] as string | undefined) ??
      `req-${Date.now()}-${randomBytes(4).toString('hex')}`;
    res.setHeader('X-Request-Id', requestId);

    // CORS headers
    const corsOrigin = resolveCorsOrigin(this.config, req);
    res.setHeader('Access-Control-Allow-Origin', corsOrigin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization, X-Request-Id, X-End-User-Id',
    );
    if (this.config.allowedOrigins && this.config.allowedOrigins.length > 0) {
      res.setHeader('Vary', 'Origin');
    }

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const method = req.method ?? 'GET';

    // Route matching
    const match = this.router.match(method, url.pathname);
    if (!match) {
      this.logger?.warn('http.request', {
        method,
        path: url.pathname,
        status: 404,
        requestId,
        durationMs: Date.now() - requestStart,
      });
      sendResponse(res, jsonResponse(404, { error: { message: 'Not found', code: 'NOT_FOUND' } }));
      return;
    }

    // Auth — skip for health; skip for metrics only if publicMetrics is true
    // Client API routes (/v1/agents/:slug/*) handle their own end-user auth
    let auth: AuthIdentity | undefined;
    const prefix = this.config.apiPrefix ?? '/v1';
    const isHealthEndpoint = url.pathname === `${prefix}/health`;
    const isMetricsEndpoint = url.pathname === `${prefix}/metrics`;
    const isOpenApiEndpoint = url.pathname === `${prefix}/openapi.json`;
    const isClientApiRoute =
      url.pathname.startsWith(`${prefix}/agents/`) && !url.pathname.startsWith(`${prefix}/admin/`);
    const isPublicEndpoint =
      isHealthEndpoint ||
      isOpenApiEndpoint ||
      isClientApiRoute ||
      (isMetricsEndpoint && (this.config.publicMetrics ?? false));
    if (!isPublicEndpoint) {
      auth =
        (await this.config.auth.authenticate({
          method,
          url: url.pathname,
          headers: req.headers as Record<string, string | string[] | undefined>,
          params: {},
          query: {},
        })) ?? undefined;

      if (!auth) {
        this.logger?.warn('http.request', {
          method,
          path: url.pathname,
          status: 401,
          requestId,
          durationMs: Date.now() - requestStart,
        });
        sendResponse(
          res,
          jsonResponse(401, { error: { message: 'Unauthorized', code: 'UNAUTHORIZED' } }),
        );
        return;
      }

      // Rate limiting
      if (this.rateLimiter && auth) {
        const result = this.rateLimiter.check(auth.userId);
        res.setHeader('X-RateLimit-Remaining', String(result.remaining));
        res.setHeader('X-RateLimit-Reset', String(Math.ceil(result.resetMs / 1000)));
        if (!result.allowed) {
          this.logger?.warn('http.request', {
            method,
            path: url.pathname,
            status: 429,
            requestId,
            userId: auth.userId,
            durationMs: Date.now() - requestStart,
          });
          sendResponse(
            res,
            jsonResponse(
              429,
              {
                error: { message: 'Rate limit exceeded', code: 'RATE_LIMITED' },
              },
              {
                'Retry-After': String(Math.ceil(result.resetMs / 1000)),
              },
            ),
          );
          return;
        }
      }
    }

    // Parse and handle
    try {
      const apiReq = await parseRequest(req, match.params, auth, this.config.maxBodyBytes);

      // Wire client disconnect to AbortSignal for long-running requests
      const ac = new AbortController();
      req.socket.on('close', () => ac.abort());
      apiReq.signal = ac.signal;

      // For client API routes, resolve the agent by slug and inject into params
      if (isClientApiRoute && match.params.slug && this.config.agentStore) {
        const agent = await this.resolveAgentBySlug(match.params.slug);
        if (agent) {
          apiReq.params._agentId = agent.id;
          apiReq.params._teamId = agent.teamId;
        }
      }

      const apiRes = await match.handler(apiReq);
      sendResponse(res, apiRes);
      const durationMs = Date.now() - requestStart;
      this.metrics.recordRequest(method, apiRes.status, durationMs);
      this.logger?.info('http.request', {
        method,
        path: url.pathname,
        status: apiRes.status,
        requestId,
        userId: auth?.userId,
        durationMs,
      });
    } catch (error) {
      const errRes = errorResponse(error);
      sendResponse(res, errRes);
      const durationMs = Date.now() - requestStart;
      this.metrics.recordRequest(method, errRes.status, durationMs);
      this.logger?.error('http.request', {
        method,
        path: url.pathname,
        status: errRes.status,
        requestId,
        userId: auth?.userId,
        durationMs,
        err: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

function resolveCorsOrigin(config: GatewayConfig, req: IncomingMessage): string {
  const allowedOrigins = config.allowedOrigins;
  if (!allowedOrigins || allowedOrigins.length === 0) {
    return '*';
  }
  const origin = req.headers['origin'];
  if (origin && allowedOrigins.includes(origin)) {
    return origin;
  }
  return allowedOrigins[0];
}
