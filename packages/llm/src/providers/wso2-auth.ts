/**
 * WSO2 OAuth2 Client Credentials token manager.
 *
 * Fetches short-lived Bearer tokens from a WSO2 API Gateway using the
 * client_credentials grant and caches them in memory with a safety buffer
 * so callers never use an expired token.
 */

interface Wso2TokenResponse {
  access_token: string;
  token_type: string;
  /** Seconds until expiry, as reported by WSO2. Typically 3600 (1 hour). */
  expires_in: number;
  scope?: string;
}

interface CachedToken {
  token: string;
  /** Absolute epoch-ms timestamp after which the cached token should not be used. */
  expiresAt: number;
}

export interface Wso2AuthOptions {
  /** WSO2 token endpoint. e.g. https://api-gateway.example.com:443/token */
  authUrl: string;
  clientId: string;
  clientSecret: string;
  /**
   * Seconds to subtract from `expires_in` when caching, to avoid using a
   * token that expires during an in-flight request.
   * @default 300 (5 minutes)
   */
  bufferSeconds?: number;
  /** HTTP request timeout in milliseconds for the token endpoint call.
   * @default 10_000
   */
  timeoutMs?: number;
}

export class Wso2AuthService {
  private readonly authUrl: string;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly bufferSeconds: number;
  private readonly timeoutMs: number;
  private cachedToken: CachedToken | null = null;

  constructor(options: Wso2AuthOptions) {
    this.authUrl = options.authUrl;
    this.clientId = options.clientId;
    this.clientSecret = options.clientSecret;
    this.bufferSeconds = options.bufferSeconds ?? 300;
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  /**
   * Returns a valid Bearer token, fetching a new one from WSO2 if the cached
   * token is absent or about to expire.
   */
  async getAccessToken(): Promise<string> {
    if (this.cachedToken && Date.now() < this.cachedToken.expiresAt) {
      return this.cachedToken.token;
    }

    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.clientId,
      client_secret: this.clientSecret,
    });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await fetch(this.authUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        signal: controller.signal,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`WSO2 token request failed: ${msg}`);
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      let detail = '';
      try {
        detail = await response.text();
      } catch {
        // ignore parse errors
      }
      throw new Error(`WSO2 authentication failed (HTTP ${response.status}): ${detail}`);
    }

    const data = (await response.json()) as Wso2TokenResponse;
    const expiresAt = Date.now() + (data.expires_in - this.bufferSeconds) * 1000;

    this.cachedToken = { token: data.access_token, expiresAt };
    return data.access_token;
  }

  /** Force the next call to {@link getAccessToken} to fetch a fresh token. */
  clearCachedToken(): void {
    this.cachedToken = null;
  }

  /** Diagnostic information about the current cached token state. */
  getTokenStatus():
    | { cached: false }
    | { cached: true; valid: boolean; expiresAt: string; timeUntilExpirySeconds: number } {
    if (!this.cachedToken) return { cached: false };

    const now = Date.now();
    const remaining = this.cachedToken.expiresAt - now;
    return {
      cached: true,
      valid: remaining > 0,
      expiresAt: new Date(this.cachedToken.expiresAt).toISOString(),
      timeUntilExpirySeconds: Math.max(0, Math.floor(remaining / 1000)),
    };
  }
}
