import { createHmac } from 'node:crypto';
import type { EndUserAuthConfig } from '@nexora-kit/core';
import type { IEndUserStore, EndUserRecord } from '@nexora-kit/storage';
import type { ApiRequest } from './types.js';
import { ApiError } from './router.js';

export interface EndUserIdentity {
  endUserId: string;
  agentId: string;
  externalId: string;
  displayName: string | null;
}

export async function authenticateEndUser(
  req: ApiRequest,
  agentId: string,
  authConfig: EndUserAuthConfig,
  endUserStore: IEndUserStore,
): Promise<EndUserIdentity> {
  const mode = authConfig.mode ?? 'anonymous';

  let externalId: string;
  let displayName: string | undefined;

  if (mode === 'anonymous') {
    externalId = resolveAnonymousId(req);
  } else if (mode === 'token') {
    externalId = resolveTokenId(req, authConfig.tokenPrefix ?? 'nk_');
  } else if (mode === 'jwt') {
    const claims = resolveJwtClaims(req, authConfig.jwtSecret ?? '');
    externalId = claims.sub;
    displayName = claims.name;
  } else {
    throw new ApiError(500, `Unknown auth mode: ${mode}`, 'CONFIG_ERROR');
  }

  const endUser = await endUserStore.getOrCreate(agentId, externalId, displayName);

  return {
    endUserId: endUser.id,
    agentId,
    externalId,
    displayName: endUser.displayName,
  };
}

function resolveAnonymousId(req: ApiRequest): string {
  const header = req.headers['x-end-user-id'];
  const id = Array.isArray(header) ? header[0] : header;
  if (!id || id.trim().length === 0) {
    throw new ApiError(400, 'X-End-User-Id header required for anonymous auth', 'AUTH_REQUIRED');
  }
  return id.trim();
}

function resolveTokenId(req: ApiRequest, prefix: string): string {
  const authHeader = req.headers['authorization'];
  const value = Array.isArray(authHeader) ? authHeader[0] : authHeader;
  if (!value?.startsWith('Bearer ')) {
    throw new ApiError(401, 'Bearer token required', 'AUTH_REQUIRED');
  }

  const token = value.slice(7);
  if (!token.startsWith(prefix)) {
    throw new ApiError(401, `Token must start with "${prefix}"`, 'INVALID_TOKEN');
  }

  // The token IS the external ID (after prefix)
  const externalId = token.slice(prefix.length);
  if (externalId.length === 0) {
    throw new ApiError(401, 'Invalid token', 'INVALID_TOKEN');
  }

  return externalId;
}

interface JwtClaims {
  sub: string;
  name?: string;
}

function resolveJwtClaims(req: ApiRequest, secret: string): JwtClaims {
  if (!secret) {
    throw new ApiError(500, 'JWT secret not configured', 'CONFIG_ERROR');
  }

  const authHeader = req.headers['authorization'];
  const value = Array.isArray(authHeader) ? authHeader[0] : authHeader;
  if (!value?.startsWith('Bearer ')) {
    throw new ApiError(401, 'Bearer JWT required', 'AUTH_REQUIRED');
  }

  const token = value.slice(7);
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new ApiError(401, 'Invalid JWT format', 'INVALID_TOKEN');
  }

  const [headerB64, payloadB64, signatureB64] = parts;

  // Verify signature (HMAC-SHA256 only)
  const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString());
  if (header.alg !== 'HS256') {
    throw new ApiError(401, 'Only HS256 algorithm supported', 'INVALID_TOKEN');
  }

  const expectedSig = createHmac('sha256', secret)
    .update(`${headerB64}.${payloadB64}`)
    .digest('base64url');

  if (expectedSig !== signatureB64) {
    throw new ApiError(401, 'Invalid JWT signature', 'INVALID_TOKEN');
  }

  const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());

  if (!payload.sub || typeof payload.sub !== 'string') {
    throw new ApiError(401, 'JWT must contain "sub" claim', 'INVALID_TOKEN');
  }

  // Check expiration if present
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
    throw new ApiError(401, 'JWT expired', 'TOKEN_EXPIRED');
  }

  return {
    sub: payload.sub,
    name: payload.name,
  };
}

/** Helper to create a simple HS256 JWT for testing */
export function createEndUserJwt(payload: Record<string, unknown>, secret: string): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}
