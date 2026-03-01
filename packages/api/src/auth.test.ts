import { describe, it, expect } from 'vitest';
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
