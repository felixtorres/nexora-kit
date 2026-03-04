import { randomBytes, createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { exec } from 'node:child_process';

export interface OAuth2Config {
  clientId?: string;
  clientSecret?: string;
  scopes?: string[];
  callbackPort?: number;
}

export interface OAuth2Tokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
}

interface ProtectedResourceMetadata {
  resource: string;
  authorization_servers: string[];
}

interface AuthorizationServerMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
  scopes_supported?: string[];
  code_challenge_methods_supported?: string[];
}

export function generateCodeVerifier(): string {
  return randomBytes(32)
    .toString('base64url')
    .slice(0, 64);
}

export function generateCodeChallenge(verifier: string): string {
  return createHash('sha256')
    .update(verifier)
    .digest('base64url');
}

export class McpOAuth2Client {
  private readonly config: OAuth2Config;
  private tokens: OAuth2Tokens | null = null;
  private refreshPromise: Promise<string> | null = null;

  constructor(config: OAuth2Config) {
    this.config = config;
  }

  async getAccessToken(): Promise<string> {
    if (this.tokens && Date.now() < this.tokens.expiresAt) {
      return this.tokens.accessToken;
    }

    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    if (this.tokens?.refreshToken) {
      this.refreshPromise = this.refreshAccessToken().finally(() => {
        this.refreshPromise = null;
      });
      return this.refreshPromise;
    }

    throw new Error('No valid token and no refresh token available — call authorize() first');
  }

  hasValidToken(): boolean {
    return this.tokens != null && Date.now() < this.tokens.expiresAt;
  }

  clearTokens(): void {
    this.tokens = null;
    this.refreshPromise = null;
  }

  async authorize(resourceMetadataUrl: string): Promise<void> {
    const resourceMeta = await this.fetchResourceMetadata(resourceMetadataUrl);
    if (!resourceMeta.authorization_servers.length) {
      throw new Error('No authorization servers found in resource metadata');
    }

    const authServerMeta = await this.fetchAuthServerMetadata(resourceMeta.authorization_servers[0]);

    const verifier = generateCodeVerifier();
    const challenge = generateCodeChallenge(verifier);

    const callbackPort = this.config.callbackPort ?? 0;
    const { code, server } = await this.startCallbackServer(callbackPort);

    const actualPort = (server.address() as { port: number }).port;
    const redirectUri = `http://127.0.0.1:${actualPort}/callback`;

    const authUrl = new URL(authServerMeta.authorization_endpoint);
    authUrl.searchParams.set('response_type', 'code');
    if (this.config.clientId) authUrl.searchParams.set('client_id', this.config.clientId);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('code_challenge', challenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');
    if (this.config.scopes?.length) {
      authUrl.searchParams.set('scope', this.config.scopes.join(' '));
    }
    authUrl.searchParams.set('state', randomBytes(16).toString('hex'));

    this.openBrowser(authUrl.toString());

    let authCode: string;
    try {
      authCode = await code;
    } finally {
      server.close();
    }

    this.tokens = await this.exchangeCode(
      authCode,
      verifier,
      redirectUri,
      authServerMeta.token_endpoint,
    );
  }

  async fetchResourceMetadata(url: string): Promise<ProtectedResourceMetadata> {
    // RFC 9728: .well-known is at the origin root, with the resource path
    // appended after it. e.g. https://example.com/sse →
    // https://example.com/.well-known/oauth-protected-resource/sse
    const parsed = new URL(url);
    const pathSuffix = parsed.pathname === '/' ? '' : parsed.pathname;
    const metaUrl = `${parsed.origin}/.well-known/oauth-protected-resource${pathSuffix}`;

    const response = await fetch(metaUrl, {
      signal: AbortSignal.timeout(10_000),
    });

    // Fall back to origin-only (no path suffix) if the path-based URL 404s
    if (response.status === 404 && pathSuffix) {
      const fallbackUrl = `${parsed.origin}/.well-known/oauth-protected-resource`;
      const fallback = await fetch(fallbackUrl, {
        signal: AbortSignal.timeout(10_000),
      });
      if (!fallback.ok) {
        throw new Error(`Failed to fetch resource metadata: ${fallback.status}`);
      }
      return fallback.json() as Promise<ProtectedResourceMetadata>;
    }

    if (!response.ok) {
      throw new Error(`Failed to fetch resource metadata: ${response.status}`);
    }

    return response.json() as Promise<ProtectedResourceMetadata>;
  }

  async fetchAuthServerMetadata(issuer: string): Promise<AuthorizationServerMetadata> {
    const metaUrl = issuer.endsWith('/')
      ? `${issuer}.well-known/oauth-authorization-server`
      : `${issuer}/.well-known/oauth-authorization-server`;

    const response = await fetch(metaUrl, {
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch auth server metadata: ${response.status}`);
    }

    return response.json() as Promise<AuthorizationServerMetadata>;
  }

  async exchangeCode(
    code: string,
    codeVerifier: string,
    redirectUri: string,
    tokenEndpoint: string,
  ): Promise<OAuth2Tokens> {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      code_verifier: codeVerifier,
      redirect_uri: redirectUri,
    });
    if (this.config.clientId) body.set('client_id', this.config.clientId);
    if (this.config.clientSecret) body.set('client_secret', this.config.clientSecret);

    const response = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`Token exchange failed (${response.status}): ${detail}`);
    }

    const data = (await response.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
    };

    const expiresIn = data.expires_in ?? 3600;
    const bufferMs = 5 * 60 * 1000;

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + expiresIn * 1000 - bufferMs,
    };
  }

  private async refreshAccessToken(): Promise<string> {
    if (!this.tokens?.refreshToken) {
      throw new Error('No refresh token available');
    }

    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: this.tokens.refreshToken,
    });
    if (this.config.clientId) body.set('client_id', this.config.clientId);
    if (this.config.clientSecret) body.set('client_secret', this.config.clientSecret);

    // We need the token endpoint — stored implicitly via the last authorize flow.
    // For refresh, re-discover from the same auth server or fail.
    // In practice, the refresh_token is only present if we previously authorized,
    // so we stored the token endpoint. For now, throw — caller should re-authorize.
    throw new Error('Token expired — call authorize() to re-authenticate');
  }

  startCallbackServer(port: number): Promise<{ code: Promise<string>; server: Server }> {
    return new Promise((resolveServer, rejectServer) => {
      let resolveCode: (code: string) => void;
      let rejectCode: (err: Error) => void;
      const codePromise = new Promise<string>((res, rej) => {
        resolveCode = res;
        rejectCode = rej;
      });

      const server = createServer((req, res) => {
        const url = new URL(req.url ?? '/', `http://127.0.0.1`);
        if (url.pathname === '/callback') {
          const code = url.searchParams.get('code');
          const error = url.searchParams.get('error');

          if (error) {
            res.writeHead(400, { 'Content-Type': 'text/html' });
            res.end(`<html><body><h1>Authorization Failed</h1><p>${error}</p></body></html>`);
            rejectCode!(new Error(`OAuth2 authorization error: ${error}`));
            return;
          }

          if (code) {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end('<html><body><h1>Authorization Successful</h1><p>You can close this window.</p></body></html>');
            resolveCode!(code);
            return;
          }
        }

        res.writeHead(404);
        res.end();
      });

      server.listen(port, '127.0.0.1', () => {
        resolveServer({ code: codePromise, server });
      });

      server.on('error', rejectServer);
    });
  }

  openBrowser(url: string): void {
    const platform = process.platform;
    const cmd = platform === 'darwin' ? 'open' : platform === 'win32' ? 'start' : 'xdg-open';
    exec(`${cmd} "${url}"`, (err) => {
      if (err) {
        // eslint-disable-next-line no-console
        console.log(`Open this URL in your browser to authenticate:\n${url}`);
      }
    });
  }
}
