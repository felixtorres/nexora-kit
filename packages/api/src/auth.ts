import type { AuthProvider, AuthIdentity, ApiRequest } from './types.js';

export class ApiKeyAuth implements AuthProvider {
  private readonly keys: Map<string, AuthIdentity>;

  constructor(keys: Record<string, AuthIdentity>) {
    this.keys = new Map(Object.entries(keys));
  }

  async authenticate(req: ApiRequest): Promise<AuthIdentity | null> {
    const header = req.headers['authorization'];
    if (!header || typeof header !== 'string') return null;

    const match = header.match(/^Bearer\s+(.+)$/i);
    if (!match) return null;

    return this.keys.get(match[1]) ?? null;
  }
}

export interface JwtPayload {
  sub: string;
  team: string;
  role?: 'admin' | 'user';
  exp?: number;
  iat?: number;
}

export class JwtAuth implements AuthProvider {
  private readonly secret: string;

  constructor(secret: string) {
    this.secret = secret;
  }

  async authenticate(req: ApiRequest): Promise<AuthIdentity | null> {
    const header = req.headers['authorization'];
    if (!header || typeof header !== 'string') return null;

    const match = header.match(/^Bearer\s+(.+)$/i);
    if (!match) return null;

    const payload = this.decodeAndVerify(match[1]);
    if (!payload) return null;

    return {
      userId: payload.sub,
      teamId: payload.team,
      role: payload.role ?? 'user',
    };
  }

  private decodeAndVerify(token: string): JwtPayload | null {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return null;

      // Verify signature using HMAC-SHA256
      const [headerB64, payloadB64, signatureB64] = parts;
      const expectedSig = this.hmacSign(`${headerB64}.${payloadB64}`);
      if (expectedSig !== signatureB64) return null;

      const payloadJson = Buffer.from(payloadB64, 'base64url').toString();
      const payload = JSON.parse(payloadJson) as JwtPayload;

      // Check expiry
      if (payload.exp && Date.now() / 1000 > payload.exp) return null;

      if (!payload.sub || !payload.team) return null;

      return payload;
    } catch {
      return null;
    }
  }

  private hmacSign(data: string): string {
    const { createHmac } = require('node:crypto') as typeof import('node:crypto');
    return createHmac('sha256', this.secret)
      .update(data)
      .digest('base64url');
  }

  /** Create a signed JWT token (for testing and admin tooling) */
  static createToken(payload: JwtPayload, secret: string): string {
    const { createHmac } = require('node:crypto') as typeof import('node:crypto');
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = createHmac('sha256', secret)
      .update(`${header}.${body}`)
      .digest('base64url');
    return `${header}.${body}.${signature}`;
  }
}

export class CompositeAuth implements AuthProvider {
  private readonly providers: AuthProvider[];

  constructor(providers: AuthProvider[]) {
    this.providers = providers;
  }

  async authenticate(req: ApiRequest): Promise<AuthIdentity | null> {
    for (const provider of this.providers) {
      const identity = await provider.authenticate(req);
      if (identity) return identity;
    }
    return null;
  }
}
