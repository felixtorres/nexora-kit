import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';
import type { JsonRpcRequest, JsonRpcResponse, JsonRpcNotification } from './types.js';
import { McpOAuth2Client } from './oauth2.js';

export interface McpTransport {
  connect(): Promise<void>;
  request(method: string, params?: Record<string, unknown>): Promise<unknown>;
  notify(method: string, params?: Record<string, unknown>): void;
  close(): Promise<void>;
  isConnected(): boolean;
}

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export class StdioTransport implements McpTransport {
  private process: ChildProcess | null = null;
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();
  private buffer = '';
  private connected = false;
  private readonly command: string;
  private readonly args: string[];
  private readonly env: Record<string, string> | undefined;
  private readonly timeoutMs: number;
  private stderrChunks: string[] = [];

  constructor(options: {
    command: string;
    args?: string[];
    env?: Record<string, string>;
    timeoutMs?: number;
  }) {
    this.command = options.command;
    this.args = options.args ?? [];
    this.env = options.env;
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  async connect(): Promise<void> {
    if (this.connected) return;

    this.process = spawn(this.command, this.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: this.env ? { ...process.env, ...this.env } : undefined,
    });

    this.process.stdout!.on('data', (chunk: Buffer) => {
      this.buffer += chunk.toString();
      this.processBuffer();
    });

    this.process.stderr!.on('data', (chunk: Buffer) => {
      this.stderrChunks.push(chunk.toString());
      if (this.stderrChunks.length > 100) this.stderrChunks.shift();
    });

    this.process.on('exit', () => {
      this.connected = false;
      for (const [id, pending] of this.pending) {
        pending.reject(new Error('Process exited'));
        clearTimeout(pending.timer);
        this.pending.delete(id);
      }
    });

    this.connected = true;
  }

  async request(method: string, params?: Record<string, unknown>): Promise<unknown> {
    if (!this.connected || !this.process) {
      throw new Error('Transport not connected');
    }

    const id = this.nextId++;
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id,
      method,
      ...(params ? { params } : {}),
    };

    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Request timed out after ${this.timeoutMs}ms: ${method}`));
      }, this.timeoutMs);

      this.pending.set(id, { resolve, reject, timer });
      this.process!.stdin!.write(JSON.stringify(request) + '\n');
    });
  }

  notify(method: string, params?: Record<string, unknown>): void {
    if (!this.connected || !this.process) return;

    const notification: JsonRpcNotification = {
      jsonrpc: '2.0',
      method,
      ...(params ? { params } : {}),
    };

    this.process.stdin!.write(JSON.stringify(notification) + '\n');
  }

  async close(): Promise<void> {
    if (!this.process) return;

    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Transport closing'));
      this.pending.delete(id);
    }

    this.connected = false;
    this.process.kill();
    this.process = null;
  }

  isConnected(): boolean {
    return this.connected;
  }

  getStderr(): string {
    return this.stderrChunks.join('');
  }

  private processBuffer(): void {
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const message = JSON.parse(trimmed) as JsonRpcResponse;
        if ('id' in message && message.id != null) {
          const pending = this.pending.get(message.id);
          if (pending) {
            clearTimeout(pending.timer);
            this.pending.delete(message.id);
            if (message.error) {
              pending.reject(
                new Error(`JSON-RPC error ${message.error.code}: ${message.error.message}`),
              );
            } else {
              pending.resolve(message.result);
            }
          }
        }
      } catch {
        // Ignore non-JSON lines (server log output, etc.)
      }
    }
  }
}

export class SseTransport implements McpTransport {
  private connected = false;
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();
  private abortController: AbortController | null = null;
  private readonly url: string;
  private readonly headers: Record<string, string>;
  private readonly timeoutMs: number;
  private messageEndpoint: string | null = null;
  private auth?: McpOAuth2Client;
  private endpointReady: Promise<void> | null = null;
  private resolveEndpointReady: (() => void) | null = null;

  constructor(options: {
    url: string;
    headers?: Record<string, string>;
    timeoutMs?: number;
    auth?: McpOAuth2Client;
  }) {
    this.url = options.url;
    this.headers = options.headers ?? {};
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.auth = options.auth;
  }

  async connect(): Promise<void> {
    if (this.connected) return;

    this.abortController = new AbortController();

    let response = await fetch(this.url, {
      headers: await this.buildSseHeaders(),
      signal: this.abortController.signal,
    });

    // On auth-related failures, run OAuth2 flow and retry
    if (this.isAuthRequired(response.status)) {
      if (!this.auth) {
        this.auth = new McpOAuth2Client({});
      }
      this.auth.clearTokens();
      const wwwAuth = response.headers.get('www-authenticate');
      const resourceMetadataUrl = this.parseWwwAuthenticate(wwwAuth);
      await this.auth.authorize(resourceMetadataUrl ?? this.url);

      response = await fetch(this.url, {
        headers: await this.buildSseHeaders(),
        signal: this.abortController.signal,
      });
    }

    if (!response.ok) {
      throw new Error(`SSE connection failed: ${response.status} ${response.statusText}`);
    }

    if (!response.body) {
      throw new Error('SSE response has no body');
    }

    // Wait for the endpoint event before returning — the server must tell us
    // where to POST messages before we can send any requests.
    this.endpointReady = new Promise<void>((resolve) => {
      this.resolveEndpointReady = resolve;
    });

    this.connected = true;
    this.consumeStream(response.body);

    // Wait for endpoint event or timeout
    await Promise.race([
      this.endpointReady,
      new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error('Timed out waiting for SSE endpoint event')), this.timeoutMs),
      ),
    ]);
  }

  async request(method: string, params?: Record<string, unknown>): Promise<unknown> {
    if (!this.connected) {
      throw new Error('Transport not connected');
    }

    const endpoint = this.messageEndpoint ?? this.url;
    const id = this.nextId++;
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id,
      method,
      ...(params ? { params } : {}),
    };

    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Request timed out after ${this.timeoutMs}ms: ${method}`));
      }, this.timeoutMs);

      this.pending.set(id, { resolve, reject, timer });

      this.buildPostHeaders().then((headers) => {
        fetch(endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify(request),
        }).catch((err) => {
          this.pending.delete(id);
          clearTimeout(timer);
          reject(err instanceof Error ? err : new Error(String(err)));
        });
      });
    });
  }

  notify(method: string, params?: Record<string, unknown>): void {
    if (!this.connected) return;

    const endpoint = this.messageEndpoint ?? this.url;
    const notification: JsonRpcNotification = {
      jsonrpc: '2.0',
      method,
      ...(params ? { params } : {}),
    };

    this.buildPostHeaders().then((headers) => {
      fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(notification),
      }).catch(() => {});
    });
  }

  async close(): Promise<void> {
    this.connected = false;
    this.abortController?.abort();
    this.abortController = null;

    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Transport closing'));
      this.pending.delete(id);
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  private async consumeStream(body: ReadableStream<Uint8Array>): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (this.connected) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() ?? '';

        for (const event of events) {
          this.processEvent(event);
        }
      }
    } catch {
      // Stream closed or aborted
    } finally {
      this.connected = false;
      reader.releaseLock();
    }
  }

  private processEvent(event: string): void {
    let eventType = 'message';
    let data = '';

    for (const line of event.split('\n')) {
      if (line.startsWith('event:')) {
        eventType = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        data += line.slice(5).trim();
      }
    }

    if (eventType === 'endpoint' && data) {
      // Server tells us where to POST messages
      this.messageEndpoint = new URL(data, this.url).toString();
      if (this.resolveEndpointReady) {
        this.resolveEndpointReady();
        this.resolveEndpointReady = null;
      }
      return;
    }

    if (!data) return;

    try {
      const message = JSON.parse(data) as JsonRpcResponse;
      if ('id' in message && message.id != null) {
        const pending = this.pending.get(message.id);
        if (pending) {
          clearTimeout(pending.timer);
          this.pending.delete(message.id);
          if (message.error) {
            pending.reject(
              new Error(`JSON-RPC error ${message.error.code}: ${message.error.message}`),
            );
          } else {
            pending.resolve(message.result);
          }
        }
      }
    } catch {
      // Ignore non-JSON events
    }
  }

  private async buildSseHeaders(): Promise<Record<string, string>> {
    const headers: Record<string, string> = { ...this.headers, Accept: 'text/event-stream' };
    if (this.auth && this.auth.hasValidToken()) {
      headers['Authorization'] = `Bearer ${await this.auth.getAccessToken()}`;
    }
    return headers;
  }

  private async buildPostHeaders(): Promise<Record<string, string>> {
    const headers: Record<string, string> = { ...this.headers, 'Content-Type': 'application/json' };
    if (this.auth && this.auth.hasValidToken()) {
      headers['Authorization'] = `Bearer ${await this.auth.getAccessToken()}`;
    }
    return headers;
  }

  private parseWwwAuthenticate(header: string | null): string | null {
    if (!header) return null;
    const match = header.match(/resource_metadata="([^"]+)"/);
    return match ? match[1] : null;
  }

  private isAuthRequired(status: number): boolean {
    return status === 401 || status === 403 || status === 405;
  }
}

export class HttpTransport implements McpTransport {
  private connected = false;
  private nextId = 1;
  private sessionId: string | null = null;
  private readonly url: string;
  private readonly headers: Record<string, string>;
  private readonly timeoutMs: number;
  private auth?: McpOAuth2Client;

  constructor(options: {
    url: string;
    headers?: Record<string, string>;
    timeoutMs?: number;
    auth?: McpOAuth2Client;
  }) {
    this.url = options.url;
    this.headers = options.headers ?? {};
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.auth = options.auth;
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    this.connected = true;
  }

  async request(method: string, params?: Record<string, unknown>): Promise<unknown> {
    if (!this.connected) {
      throw new Error('Transport not connected');
    }

    const id = this.nextId++;
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id,
      method,
      ...(params ? { params } : {}),
    };

    const headers = await this.buildHeaders();

    let response = await fetch(this.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    // On auth-related failures, try OAuth2 flow once.
    // Auto-create McpOAuth2Client if not configured (matches Claude Desktop
    // behavior — discovers auth requirements from the 401 response).
    if (this.isAuthRequired(response.status)) {
      if (!this.auth) {
        this.auth = new McpOAuth2Client({});
      }
      this.auth.clearTokens();
      const wwwAuth = response.headers.get('www-authenticate');
      const resourceMetadataUrl = this.parseWwwAuthenticate(wwwAuth);
      await this.auth.authorize(resourceMetadataUrl ?? this.url);

      const retryHeaders = await this.buildHeaders();
      response = await fetch(this.url, {
        method: 'POST',
        headers: retryHeaders,
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    }

    if (!response.ok) {
      throw new Error(`HTTP request failed: ${response.status} ${response.statusText}`);
    }

    this.captureSessionId(response);

    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('text/event-stream') && response.body) {
      return this.parseSseResponse(response.body, id);
    }

    const json = await response.json() as JsonRpcResponse;
    if (json.error) {
      throw new Error(`JSON-RPC error ${json.error.code}: ${json.error.message}`);
    }

    return json.result;
  }

  notify(method: string, params?: Record<string, unknown>): void {
    if (!this.connected) return;

    const notification: JsonRpcNotification = {
      jsonrpc: '2.0',
      method,
      ...(params ? { params } : {}),
    };

    this.buildHeaders().then((headers) => {
      fetch(this.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(notification),
      }).catch(() => {});
    });
  }

  async close(): Promise<void> {
    if (this.sessionId) {
      const notification: JsonRpcNotification = {
        jsonrpc: '2.0',
        method: 'notifications/cancelled',
      };

      try {
        const headers = await this.buildHeaders();
        await fetch(this.url, {
          method: 'POST',
          headers,
          body: JSON.stringify(notification),
          signal: AbortSignal.timeout(5000),
        });
      } catch {
        // Best-effort close
      }
    }

    this.connected = false;
    this.sessionId = null;
  }

  isConnected(): boolean {
    return this.connected;
  }

  private async buildHeaders(): Promise<Record<string, string>> {
    const headers: Record<string, string> = {
      ...this.headers,
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
    };
    if (this.sessionId) {
      headers['mcp-session-id'] = this.sessionId;
    }
    if (this.auth && this.auth.hasValidToken()) {
      headers['Authorization'] = `Bearer ${await this.auth.getAccessToken()}`;
    }
    return headers;
  }

  private captureSessionId(response: Response): void {
    const sessionHeader = response.headers.get('mcp-session-id');
    if (sessionHeader) {
      this.sessionId = sessionHeader;
    }
  }

  private async parseSseResponse(body: ReadableStream<Uint8Array>, requestId: number): Promise<unknown> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() ?? '';

        for (const event of events) {
          let data = '';
          for (const line of event.split('\n')) {
            if (line.startsWith('data:')) {
              data += line.slice(5).trim();
            }
          }
          if (!data) continue;

          try {
            const message = JSON.parse(data) as JsonRpcResponse;
            if ('id' in message && message.id === requestId) {
              if (message.error) {
                throw new Error(`JSON-RPC error ${message.error.code}: ${message.error.message}`);
              }
              return message.result;
            }
          } catch (err) {
            if (err instanceof Error && err.message.startsWith('JSON-RPC error')) throw err;
            // Ignore non-JSON events
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    throw new Error(`No SSE response received for request ${requestId}`);
  }

  private parseWwwAuthenticate(header: string | null): string | null {
    if (!header) return null;
    const match = header.match(/resource_metadata="([^"]+)"/);
    return match ? match[1] : null;
  }

  private isAuthRequired(status: number): boolean {
    // 401 = standard. Some servers/gateways return 403 or 405 for
    // unauthenticated requests (e.g. Kyvos returns 405 without a Bearer token).
    return status === 401 || status === 403 || status === 405;
  }
}
