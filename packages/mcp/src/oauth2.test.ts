import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  generateCodeVerifier,
  generateCodeChallenge,
  McpOAuth2Client,
} from './oauth2.js';

describe('PKCE helpers', () => {
  it('generates a code verifier of valid length', () => {
    const verifier = generateCodeVerifier();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier.length).toBeLessThanOrEqual(128);
    // URL-safe characters only
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('generates unique verifiers', () => {
    const a = generateCodeVerifier();
    const b = generateCodeVerifier();
    expect(a).not.toBe(b);
  });

  it('generates a code challenge as base64url SHA-256', () => {
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    const challenge = generateCodeChallenge(verifier);
    // Must be base64url (no +, /, or =)
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(challenge.length).toBeGreaterThan(0);
  });

  it('produces consistent challenges for the same verifier', () => {
    const verifier = generateCodeVerifier();
    expect(generateCodeChallenge(verifier)).toBe(generateCodeChallenge(verifier));
  });
});

// Save reference to the real fetch before any mocking
const realFetch = globalThis.fetch;

describe('McpOAuth2Client', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('returns cached token when valid', async () => {
    const client = new McpOAuth2Client({ clientId: 'test' });
    // Inject tokens via exchangeCode
    const tokens = {
      accessToken: 'cached-token',
      refreshToken: 'rt',
      expiresAt: Date.now() + 60_000,
    };
    (client as any).tokens = tokens;

    const token = await client.getAccessToken();
    expect(token).toBe('cached-token');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('concurrent getAccessToken calls share one refresh', async () => {
    const client = new McpOAuth2Client({ clientId: 'test' });
    // Expired token with refresh token — will throw since refreshAccessToken
    // throws "call authorize()" (no stored token endpoint)
    (client as any).tokens = {
      accessToken: 'expired',
      refreshToken: 'rt',
      expiresAt: Date.now() - 1000,
    };

    const p1 = client.getAccessToken();
    const p2 = client.getAccessToken();

    // Both should reject with the same error
    await expect(p1).rejects.toThrow('Token expired');
    await expect(p2).rejects.toThrow('Token expired');
  });

  it('hasValidToken returns true when token is valid', () => {
    const client = new McpOAuth2Client({});
    expect(client.hasValidToken()).toBe(false);

    (client as any).tokens = {
      accessToken: 'tok',
      expiresAt: Date.now() + 60_000,
    };
    expect(client.hasValidToken()).toBe(true);
  });

  it('hasValidToken returns false when expired', () => {
    const client = new McpOAuth2Client({});
    (client as any).tokens = {
      accessToken: 'tok',
      expiresAt: Date.now() - 1000,
    };
    expect(client.hasValidToken()).toBe(false);
  });

  it('clearTokens forces re-auth', async () => {
    const client = new McpOAuth2Client({});
    (client as any).tokens = {
      accessToken: 'tok',
      expiresAt: Date.now() + 60_000,
    };

    client.clearTokens();
    expect(client.hasValidToken()).toBe(false);
    await expect(client.getAccessToken()).rejects.toThrow('No valid token');
  });

  it('throws when no token and no refresh token', async () => {
    const client = new McpOAuth2Client({});
    await expect(client.getAccessToken()).rejects.toThrow('No valid token');
  });

  it('fetches resource metadata with RFC 9728 URL construction', async () => {
    const metadata = {
      resource: 'https://example.com/mcp',
      authorization_servers: ['https://auth.example.com'],
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(metadata),
    });

    const client = new McpOAuth2Client({});
    const result = await client.fetchResourceMetadata('https://example.com/mcp');

    expect(result).toEqual(metadata);
    // RFC 9728: .well-known at origin root, path appended after
    expect(mockFetch).toHaveBeenCalledWith(
      'https://example.com/.well-known/oauth-protected-resource/mcp',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('falls back to origin-only well-known URL on 404', async () => {
    const metadata = {
      resource: 'https://example.com/sse',
      authorization_servers: ['https://auth.example.com'],
    };
    // Path-based URL returns 404
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    });
    // Origin-only fallback succeeds
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(metadata),
    });

    const client = new McpOAuth2Client({});
    const result = await client.fetchResourceMetadata('https://example.com/sse');

    expect(result).toEqual(metadata);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://example.com/.well-known/oauth-protected-resource/sse',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(mockFetch).toHaveBeenCalledWith(
      'https://example.com/.well-known/oauth-protected-resource',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('fetches auth server metadata', async () => {
    const metadata = {
      issuer: 'https://auth.example.com',
      authorization_endpoint: 'https://auth.example.com/authorize',
      token_endpoint: 'https://auth.example.com/token',
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(metadata),
    });

    const client = new McpOAuth2Client({});
    const result = await client.fetchAuthServerMetadata('https://auth.example.com');

    expect(result).toEqual(metadata);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://auth.example.com/.well-known/oauth-authorization-server',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('exchanges code with correct POST body', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          access_token: 'new-at',
          refresh_token: 'new-rt',
          expires_in: 3600,
        }),
    });

    const client = new McpOAuth2Client({ clientId: 'my-app', clientSecret: 'secret' });
    const tokens = await client.exchangeCode(
      'auth-code-123',
      'verifier-abc',
      'http://127.0.0.1:9999/callback',
      'https://auth.example.com/token',
    );

    expect(tokens.accessToken).toBe('new-at');
    expect(tokens.refreshToken).toBe('new-rt');
    expect(tokens.expiresAt).toBeGreaterThan(Date.now());

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('https://auth.example.com/token');
    expect(opts.method).toBe('POST');

    const body = new URLSearchParams(opts.body);
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code')).toBe('auth-code-123');
    expect(body.get('code_verifier')).toBe('verifier-abc');
    expect(body.get('redirect_uri')).toBe('http://127.0.0.1:9999/callback');
    expect(body.get('client_id')).toBe('my-app');
    expect(body.get('client_secret')).toBe('secret');
  });

  it('applies 5-minute expiry buffer', async () => {
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          access_token: 'at',
          expires_in: 3600,
        }),
    });

    const client = new McpOAuth2Client({});
    const tokens = await client.exchangeCode('code', 'verifier', 'http://localhost/cb', 'https://auth/token');

    // 3600s * 1000 - 5min * 60 * 1000 = 3,600,000 - 300,000 = 3,300,000
    expect(tokens.expiresAt).toBe(now + 3_300_000);
    vi.restoreAllMocks();
  });

  it('starts callback server and receives code', async () => {
    const client = new McpOAuth2Client({});
    const { code, server } = await client.startCallbackServer(0);

    const addr = server.address() as { port: number };
    expect(addr.port).toBeGreaterThan(0);

    // Use real fetch for localhost
    const response = await realFetch(`http://127.0.0.1:${addr.port}/callback?code=test-code-123`);
    expect(response.ok).toBe(true);

    const receivedCode = await code;
    expect(receivedCode).toBe('test-code-123');

    server.close();
  });

  it('callback server handles error parameter', async () => {
    const client = new McpOAuth2Client({});
    const { code, server } = await client.startCallbackServer(0);

    const addr = server.address() as { port: number };

    // Attach the rejection handler BEFORE the fetch triggers it
    const codeResult = code.catch((err: Error) => err);

    const response = await realFetch(`http://127.0.0.1:${addr.port}/callback?error=access_denied`);
    expect(response.status).toBe(400);

    const err = await codeResult;
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain('access_denied');

    server.close();
  });
});
