import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { initSchema, SqliteEndUserStore, SqliteAgentStore } from '@nexora-kit/storage';
import { authenticateEndUser, createEndUserJwt } from './end-user-auth.js';
import type { ApiRequest } from './types.js';

function makeReq(headers: Record<string, string> = {}): ApiRequest {
  return {
    method: 'POST',
    url: '/test',
    headers,
    params: {},
    query: {},
  };
}

describe('authenticateEndUser', () => {
  let db: Database.Database;
  let endUserStore: SqliteEndUserStore;

  const agentId = 'agent-1';

  beforeEach(() => {
    db = new Database(':memory:');
    initSchema(db);
    endUserStore = new SqliteEndUserStore(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('anonymous mode', () => {
    it('resolves user from X-End-User-Id header', async () => {
      const identity = await authenticateEndUser(
        makeReq({ 'x-end-user-id': 'anon-123' }),
        agentId,
        { mode: 'anonymous' },
        endUserStore,
      );

      expect(identity.externalId).toBe('anon-123');
      expect(identity.agentId).toBe(agentId);
      expect(identity.endUserId).toBeDefined();
    });

    it('creates end user record on first visit', async () => {
      await authenticateEndUser(
        makeReq({ 'x-end-user-id': 'anon-new' }),
        agentId,
        { mode: 'anonymous' },
        endUserStore,
      );

      const users = endUserStore.list(agentId);
      expect(users).toHaveLength(1);
      expect(users[0].externalId).toBe('anon-new');
    });

    it('reuses existing user on repeat visit', async () => {
      const first = await authenticateEndUser(
        makeReq({ 'x-end-user-id': 'anon-repeat' }),
        agentId,
        { mode: 'anonymous' },
        endUserStore,
      );

      const second = await authenticateEndUser(
        makeReq({ 'x-end-user-id': 'anon-repeat' }),
        agentId,
        { mode: 'anonymous' },
        endUserStore,
      );

      expect(first.endUserId).toBe(second.endUserId);
      expect(endUserStore.list(agentId)).toHaveLength(1);
    });

    it('throws 400 if header missing', async () => {
      await expect(
        authenticateEndUser(makeReq(), agentId, { mode: 'anonymous' }, endUserStore),
      ).rejects.toThrow('X-End-User-Id header required');
    });

    it('works with default mode (undefined = anonymous)', async () => {
      const identity = await authenticateEndUser(
        makeReq({ 'x-end-user-id': 'default-mode' }),
        agentId,
        {},
        endUserStore,
      );

      expect(identity.externalId).toBe('default-mode');
    });
  });

  describe('token mode', () => {
    it('resolves user from Bearer token with prefix', async () => {
      const identity = await authenticateEndUser(
        makeReq({ authorization: 'Bearer nk_user123' }),
        agentId,
        { mode: 'token', tokenPrefix: 'nk_' },
        endUserStore,
      );

      expect(identity.externalId).toBe('user123');
    });

    it('throws 401 if no Bearer header', async () => {
      await expect(
        authenticateEndUser(makeReq(), agentId, { mode: 'token' }, endUserStore),
      ).rejects.toThrow('Bearer token required');
    });

    it('throws 401 if wrong prefix', async () => {
      await expect(
        authenticateEndUser(
          makeReq({ authorization: 'Bearer wrong_abc' }),
          agentId,
          { mode: 'token', tokenPrefix: 'nk_' },
          endUserStore,
        ),
      ).rejects.toThrow('Token must start with');
    });
  });

  describe('jwt mode', () => {
    const secret = 'test-secret-key';

    it('resolves user from valid JWT', async () => {
      const token = createEndUserJwt({ sub: 'user-jwt-1', name: 'Alice' }, secret);

      const identity = await authenticateEndUser(
        makeReq({ authorization: `Bearer ${token}` }),
        agentId,
        { mode: 'jwt', jwtSecret: secret },
        endUserStore,
      );

      expect(identity.externalId).toBe('user-jwt-1');
      expect(identity.displayName).toBe('Alice');
    });

    it('throws 401 for invalid signature', async () => {
      const token = createEndUserJwt({ sub: 'user-1' }, 'wrong-secret');

      await expect(
        authenticateEndUser(
          makeReq({ authorization: `Bearer ${token}` }),
          agentId,
          { mode: 'jwt', jwtSecret: secret },
          endUserStore,
        ),
      ).rejects.toThrow('Invalid JWT signature');
    });

    it('throws 401 for expired JWT', async () => {
      const token = createEndUserJwt({ sub: 'user-1', exp: Math.floor(Date.now() / 1000) - 60 }, secret);

      await expect(
        authenticateEndUser(
          makeReq({ authorization: `Bearer ${token}` }),
          agentId,
          { mode: 'jwt', jwtSecret: secret },
          endUserStore,
        ),
      ).rejects.toThrow('JWT expired');
    });

    it('throws 401 for missing sub claim', async () => {
      const token = createEndUserJwt({ name: 'NoSub' }, secret);

      await expect(
        authenticateEndUser(
          makeReq({ authorization: `Bearer ${token}` }),
          agentId,
          { mode: 'jwt', jwtSecret: secret },
          endUserStore,
        ),
      ).rejects.toThrow('must contain "sub" claim');
    });

    it('throws 500 if jwtSecret not configured', async () => {
      await expect(
        authenticateEndUser(
          makeReq({ authorization: 'Bearer abc.def.ghi' }),
          agentId,
          { mode: 'jwt' },
          endUserStore,
        ),
      ).rejects.toThrow('JWT secret not configured');
    });
  });
});
