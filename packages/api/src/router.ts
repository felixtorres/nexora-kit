import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ApiRequest, ApiResponse, Route, RouteHandler, AuthIdentity } from './types.js';

interface MatchResult {
  handler: RouteHandler;
  params: Record<string, string>;
}

export class Router {
  private routes: Route[] = [];

  add(method: string, pattern: string, handler: RouteHandler): void {
    this.routes.push({ method: method.toUpperCase(), pattern, handler });
  }

  get(pattern: string, handler: RouteHandler): void {
    this.add('GET', pattern, handler);
  }

  post(pattern: string, handler: RouteHandler): void {
    this.add('POST', pattern, handler);
  }

  match(method: string, path: string): MatchResult | null {
    for (const route of this.routes) {
      if (route.method !== method.toUpperCase()) continue;
      const params = matchPattern(route.pattern, path);
      if (params !== null) {
        return { handler: route.handler, params };
      }
    }
    return null;
  }
}

/** Match a route pattern like `/v1/plugins/:name` against a path */
function matchPattern(pattern: string, path: string): Record<string, string> | null {
  const patternParts = pattern.split('/');
  const pathParts = path.split('/');

  if (patternParts.length !== pathParts.length) return null;

  const params: Record<string, string> = {};

  for (let i = 0; i < patternParts.length; i++) {
    if (patternParts[i].startsWith(':')) {
      try {
        params[patternParts[i].slice(1)] = decodeURIComponent(pathParts[i]);
      } catch {
        return null; // Malformed URI component
      }
    } else if (patternParts[i] !== pathParts[i]) {
      return null;
    }
  }

  return params;
}

/** Parse an IncomingMessage into an ApiRequest */
export async function parseRequest(
  req: IncomingMessage,
  params: Record<string, string>,
  auth?: AuthIdentity,
  maxBodyBytes?: number,
): Promise<ApiRequest> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

  const query: Record<string, string> = {};
  for (const [key, value] of url.searchParams) {
    query[key] = value;
  }

  const headers: Record<string, string | string[] | undefined> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    headers[key] = value;
  }

  let body: unknown;
  if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
    const contentType = headers['content-type'];
    if (contentType && typeof contentType === 'string' && !contentType.startsWith('application/json')) {
      throw new ApiError(415, 'Unsupported Media Type: expected application/json', 'UNSUPPORTED_MEDIA_TYPE');
    }
    body = await readJsonBody(req, maxBodyBytes);
  }

  return {
    method: req.method ?? 'GET',
    url: url.pathname,
    headers,
    body,
    params,
    query,
    auth,
  };
}

async function readJsonBody(req: IncomingMessage, maxBytes: number = 1_048_576): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;

    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        req.destroy();
        reject(new ApiError(413, 'Request body too large'));
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (size === 0) {
        resolve(undefined);
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString()));
      } catch {
        reject(new ApiError(400, 'Invalid JSON body'));
      }
    });

    req.on('error', reject);
  });
}

/** Send an ApiResponse to an HTTP ServerResponse */
export function sendResponse(res: ServerResponse, apiRes: ApiResponse): void {
  for (const [key, value] of Object.entries(apiRes.headers)) {
    res.setHeader(key, value);
  }

  if (apiRes.body === null || apiRes.body === undefined) {
    res.writeHead(apiRes.status);
    res.end();
    return;
  }

  // If Content-Type is already set to non-JSON, send body as-is (e.g., HTML)
  const explicitContentType = apiRes.headers['Content-Type'] || apiRes.headers['content-type'];
  if (explicitContentType && !explicitContentType.includes('application/json')) {
    const raw = typeof apiRes.body === 'string' ? apiRes.body : JSON.stringify(apiRes.body);
    res.setHeader('Content-Length', Buffer.byteLength(raw));
    res.writeHead(apiRes.status);
    res.end(raw);
    return;
  }

  const json = JSON.stringify(apiRes.body);
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Length', Buffer.byteLength(json));
  res.writeHead(apiRes.status);
  res.end(json);
}

// --- Error handling ---

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function errorResponse(error: unknown): ApiResponse {
  if (error instanceof ApiError) {
    return {
      status: error.status,
      headers: {},
      body: {
        error: { message: error.message, code: error.code },
      },
    };
  }

  return {
    status: 500,
    headers: {},
    body: {
      error: { message: 'Internal server error', code: 'INTERNAL_ERROR' },
    },
  };
}

// --- Helpers ---

export function jsonResponse(status: number, body: unknown, headers?: Record<string, string>): ApiResponse {
  return { status, headers: headers ?? {}, body };
}
