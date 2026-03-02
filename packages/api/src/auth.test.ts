import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { ApiKeyAuth, JwtAuth, CompositeAuth } from './auth.js';
import type { ApiRequest } from './types.js';

function makeReq(authorization?: string): ApiRequest {
  return {
    method: 'GET',
    url: '/test',
    headers: authorization ? { authorization } : {},
    params: {},
    query: {},
  };
}

describe('ApiKeyAuth', () => {
  const auth = new ApiKeyAuth({
    'key-123': { userId: 'user1', teamId: 'team1', role: 'user' },
    'admin-key': { userId: 'admin1', teamId: 'team1', role: 'admin' },
  });

  it('authenticates valid API key', async () => {
    const identity = await auth.authenticate(makeReq('Bearer key-123'));
    expect(identity).toEqual({ userId: 'user1', teamId: 'team1', role: 'user' });
  });

  it('returns admin identity for admin key', async () => {
    const identity = await auth.authenticate(makeReq('Bearer admin-key'));
    expect(identity?.role).toBe('admin');
  });

  it('returns null for invalid key', async () => {
    const identity = await auth.authenticate(makeReq('Bearer bad-key'));
    expect(identity).toBeNull();
  });

  it('returns null for missing header', async () => {
    const identity = await auth.authenticate(makeReq());
    expect(identity).toBeNull();
  });

  it('returns null for non-Bearer header', async () => {
    const identity = await auth.authenticate(makeReq('Basic dXNlcjpwYXNz'));
    expect(identity).toBeNull();
  });
});

describe('JwtAuth', () => {
  const secret = 'test-secret-key';
  const auth = new JwtAuth(secret);

  it('authenticates valid JWT', async () => {
    const token = JwtAuth.createToken(
      { sub: 'user1', team: 'team1', role: 'admin' },
      secret,
    );
    const identity = await auth.authenticate(makeReq(`Bearer ${token}`));
    expect(identity).toEqual({ userId: 'user1', teamId: 'team1', role: 'admin' });
  });

  it('defaults role to user', async () => {
    const token = JwtAuth.createToken({ sub: 'user2', team: 'team2' }, secret);
    const identity = await auth.authenticate(makeReq(`Bearer ${token}`));
    expect(identity?.role).toBe('user');
  });

  it('rejects expired token', async () => {
    const token = JwtAuth.createToken(
      { sub: 'user1', team: 'team1', exp: Math.floor(Date.now() / 1000) - 60 },
      secret,
    );
    const identity = await auth.authenticate(makeReq(`Bearer ${token}`));
    expect(identity).toBeNull();
  });

  it('rejects token with wrong secret', async () => {
    const token = JwtAuth.createToken({ sub: 'user1', team: 'team1' }, 'wrong-secret');
    const identity = await auth.authenticate(makeReq(`Bearer ${token}`));
    expect(identity).toBeNull();
  });

  it('rejects malformed token', async () => {
    const identity = await auth.authenticate(makeReq('Bearer not.a.valid-jwt'));
    expect(identity).toBeNull();
  });

  it('rejects token missing sub', async () => {
    const token = JwtAuth.createToken({ sub: '', team: 'team1' }, secret);
    const identity = await auth.authenticate(makeReq(`Bearer ${token}`));
    expect(identity).toBeNull();
  });

  it('returns null for missing header', async () => {
    const identity = await auth.authenticate(makeReq());
    expect(identity).toBeNull();
  });

  // --- JWT hardening tests ---

  it('rejects token with alg: none', async () => {
    // Forge a token with alg=none
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify({ sub: 'user1', team: 'team1' })).toString('base64url');
    const token = `${header}.${body}.`;
    const identity = await auth.authenticate(makeReq(`Bearer ${token}`));
    expect(identity).toBeNull();
  });

  it('rejects token with non-HS256 algorithm', async () => {
    // Forge a token with alg=HS384
    const header = Buffer.from(JSON.stringify({ alg: 'HS384', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify({ sub: 'user1', team: 'team1' })).toString('base64url');
    const signature = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
    const token = `${header}.${body}.${signature}`;
    const identity = await auth.authenticate(makeReq(`Bearer ${token}`));
    expect(identity).toBeNull();
  });

  it('rejects token with iat in the future', async () => {
    const futureIat = Math.floor(Date.now() / 1000) + 120; // 2 minutes in future
    const token = JwtAuth.createToken(
      { sub: 'user1', team: 'team1', iat: futureIat },
      secret,
    );
    const identity = await auth.authenticate(makeReq(`Bearer ${token}`));
    expect(identity).toBeNull();
  });

  it('accepts token with iat slightly in the future (within 30s tolerance)', async () => {
    const slightFuture = Math.floor(Date.now() / 1000) + 10; // 10s in future
    const token = JwtAuth.createToken(
      { sub: 'user1', team: 'team1', iat: slightFuture },
      secret,
    );
    const identity = await auth.authenticate(makeReq(`Bearer ${token}`));
    expect(identity).not.toBeNull();
    expect(identity?.userId).toBe('user1');
  });

  it('supports key rotation with multiple secrets', async () => {
    const oldSecret = 'old-secret';
    const newSecret = 'new-secret';
    const rotatingAuth = new JwtAuth([newSecret, oldSecret]);

    // Token signed with old key should still work
    const oldToken = JwtAuth.createToken({ sub: 'user1', team: 'team1' }, oldSecret);
    const identity1 = await rotatingAuth.authenticate(makeReq(`Bearer ${oldToken}`));
    expect(identity1?.userId).toBe('user1');

    // Token signed with new key should work
    const newToken = JwtAuth.createToken({ sub: 'user2', team: 'team1' }, newSecret);
    const identity2 = await rotatingAuth.authenticate(makeReq(`Bearer ${newToken}`));
    expect(identity2?.userId).toBe('user2');

    // Token signed with unknown key should fail
    const badToken = JwtAuth.createToken({ sub: 'user3', team: 'team1' }, 'unknown-secret');
    const identity3 = await rotatingAuth.authenticate(makeReq(`Bearer ${badToken}`));
    expect(identity3).toBeNull();
  });

  it('throws if constructed with empty secrets array', () => {
    expect(() => new JwtAuth([])).toThrow('At least one secret');
  });
});

describe('CompositeAuth', () => {
  const secret = 'test-secret';
  const apiKeyAuth = new ApiKeyAuth({
    'api-key-1': { userId: 'apiuser', teamId: 'team1', role: 'user' },
  });
  const jwtAuth = new JwtAuth(secret);
  const composite = new CompositeAuth([apiKeyAuth, jwtAuth]);

  it('authenticates via API key (first provider)', async () => {
    const identity = await composite.authenticate(makeReq('Bearer api-key-1'));
    expect(identity?.userId).toBe('apiuser');
  });

  it('falls through to JWT if API key fails', async () => {
    const token = JwtAuth.createToken({ sub: 'jwtuser', team: 'team2' }, secret);
    const identity = await composite.authenticate(makeReq(`Bearer ${token}`));
    expect(identity?.userId).toBe('jwtuser');
  });

  it('returns null if all providers fail', async () => {
    const identity = await composite.authenticate(makeReq('Bearer unknown'));
    expect(identity).toBeNull();
  });
});
