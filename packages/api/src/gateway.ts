import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import type { GatewayConfig, AuthIdentity } from './types.js';
import { Router, parseRequest, sendResponse, errorResponse, ApiError, jsonResponse } from './router.js';
import { RateLimiter } from './rate-limit.js';
import { WebSocketManager, isWebSocketUpgrade } from './websocket.js';
import {
  createChatHandler,
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
import { MetricsCollector } from './metrics.js';

export class Gateway {
  private server: Server | null = null;
  private readonly router: Router;
  private readonly rateLimiter: RateLimiter | null;
  private readonly wsManager: WebSocketManager;
  private readonly config: GatewayConfig;
  readonly metrics: MetricsCollector;

  constructor(config: GatewayConfig) {
    this.config = config;
    this.metrics = new MetricsCollector();
    const prefix = config.apiPrefix ?? '/v1';

    // Set up handlers
    const deps: HandlerDeps = {
      agentLoop: config.agentLoop,
      plugins: config.plugins,
    };

    // Set up router
    this.router = new Router();
    this.router.post(`${prefix}/chat`, createChatHandler(deps));
    this.router.get(`${prefix}/plugins`, createPluginsListHandler(deps));
    this.router.get(`${prefix}/plugins/:name`, createPluginDetailHandler(deps));
    this.router.get(`${prefix}/health`, createHealthHandler(deps));
    this.router.get(`${prefix}/metrics`, async () => jsonResponse(200, this.metrics.snapshot()));

    // Admin routes
    if (config.admin) {
      this.router.post(`${prefix}/admin/plugins/:name/enable`, createAdminPluginEnableHandler(config.admin));
      this.router.post(`${prefix}/admin/plugins/:name/disable`, createAdminPluginDisableHandler(config.admin));
      this.router.add('DELETE', `${prefix}/admin/plugins/:name`, createAdminPluginUninstallHandler(config.admin));
      this.router.get(`${prefix}/admin/audit-log`, createAdminAuditLogHandler(config.admin));
      this.router.post(`${prefix}/admin/audit-log/purge`, createAdminAuditPurgeHandler(config.admin));
      this.router.get(`${prefix}/admin/usage`, createAdminUsageHandler(config.admin));
    }

    // Rate limiter
    this.rateLimiter = config.rateLimit
      ? new RateLimiter(config.rateLimit)
      : null;

    // WebSocket manager
    this.wsManager = new WebSocketManager({
      agentLoop: config.agentLoop,
      auth: config.auth,
      heartbeatMs: config.wsHeartbeatMs,
    });
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
          this.wsManager.handleUpgrade(req, socket).catch(() => {
            socket.destroy();
          });
        } else {
          socket.destroy();
        }
      });

      this.server.on('error', reject);

      const host = this.config.host ?? '127.0.0.1';
      this.server.listen(this.config.port, host, () => {
        this.wsManager.startHeartbeat();
        this.rateLimiter?.startCleanup();
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    this.wsManager.stopHeartbeat();
    this.wsManager.closeAll();
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

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const requestStart = Date.now();

    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

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
      sendResponse(res, jsonResponse(404, { error: { message: 'Not found', code: 'NOT_FOUND' } }));
      return;
    }

    // Auth — skip for health and metrics endpoints (exact path match)
    let auth: AuthIdentity | undefined;
    const prefix = this.config.apiPrefix ?? '/v1';
    const isPublicEndpoint = url.pathname === `${prefix}/health` || url.pathname === `${prefix}/metrics`;
    if (!isPublicEndpoint) {
      auth = (await this.config.auth.authenticate({
        method,
        url: url.pathname,
        headers: req.headers as Record<string, string | string[] | undefined>,
        params: {},
        query: {},
      })) ?? undefined;

      if (!auth) {
        sendResponse(res, jsonResponse(401, { error: { message: 'Unauthorized', code: 'UNAUTHORIZED' } }));
        return;
      }

      // Rate limiting
      if (this.rateLimiter && auth) {
        const result = this.rateLimiter.check(auth.userId);
        res.setHeader('X-RateLimit-Remaining', String(result.remaining));
        res.setHeader('X-RateLimit-Reset', String(Math.ceil(result.resetMs / 1000)));
        if (!result.allowed) {
          sendResponse(res, jsonResponse(429, {
            error: { message: 'Rate limit exceeded', code: 'RATE_LIMITED' },
          }, {
            'Retry-After': String(Math.ceil(result.resetMs / 1000)),
          }));
          return;
        }
      }
    }

    // Parse and handle
    try {
      const apiReq = await parseRequest(req, match.params, auth);
      const apiRes = await match.handler(apiReq);
      sendResponse(res, apiRes);
      this.metrics.recordRequest(method, apiRes.status, Date.now() - requestStart);
    } catch (error) {
      const errRes = errorResponse(error);
      sendResponse(res, errRes);
      this.metrics.recordRequest(method, errRes.status, Date.now() - requestStart);
    }
  }
}
