import { createHmac } from 'node:crypto';
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
  private readonly secrets: string[];

  constructor(secret: string);
  constructor(secrets: string[]);
  constructor(secretOrSecrets: string | string[]) {
    this.secrets = Array.isArray(secretOrSecrets) ? secretOrSecrets : [secretOrSecrets];
    if (this.secrets.length === 0) {
      throw new Error('At least one secret is required');
    }
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

      const [headerB64, payloadB64, signatureB64] = parts;

      // Validate algorithm — reject 'none' and non-HS256
      const headerJson = Buffer.from(headerB64, 'base64url').toString();
      const header = JSON.parse(headerJson) as { alg?: string };
      if (header.alg !== 'HS256') return null;

      // Try each secret (supports key rotation)
      let valid = false;
      for (const secret of this.secrets) {
        const expectedSig = hmacSign(`${headerB64}.${payloadB64}`, secret);
        if (expectedSig === signatureB64) {
          valid = true;
          break;
        }
      }
      if (!valid) return null;

      const payloadJson = Buffer.from(payloadB64, 'base64url').toString();
      const payload = JSON.parse(payloadJson) as JwtPayload;

      // Check expiry
      if (payload.exp && Date.now() / 1000 > payload.exp) return null;

      // Reject tokens with iat in the future (30s tolerance)
      if (payload.iat && payload.iat > Date.now() / 1000 + 30) return null;

      if (!payload.sub || !payload.team) return null;

      return payload;
    } catch {
      return null;
    }
  }

  /** Create a signed JWT token (for testing and admin tooling) */
  static createToken(payload: JwtPayload, secret: string): string {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = hmacSign(`${header}.${body}`, secret);
    return `${header}.${body}.${signature}`;
  }
}

function hmacSign(data: string, secret: string): string {
  return createHmac('sha256', secret)
    .update(data)
    .digest('base64url');
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
