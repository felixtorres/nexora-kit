import { describe, it, expect, vi, afterEach } from 'vitest';
import { Router, parseRequest, ApiError } from './router.js';
import type { IncomingMessage } from 'node:http';
import { Readable } from 'node:stream';

function mockRequest(overrides: Partial<IncomingMessage> = {}): IncomingMessage {
  const readable = new Readable({ read() {} });
  Object.assign(readable, {
    method: 'GET',
    url: '/',
    headers: {},
    ...overrides,
  });
  return readable as unknown as IncomingMessage;
}

describe('Security: Route parameter handling', () => {
  it('rejects malformed URI components in route params', () => {
    const router = new Router();
    router.get('/plugins/:name', async (req) => ({ status: 200, headers: {}, body: { name: req.params.name } }));

    // %ZZ is not a valid percent-encoded sequence
    const result = router.match('GET', '/plugins/%ZZ');
    expect(result).toBeNull();
  });

  it('decodes valid URI components in route params', () => {
    const router = new Router();
    router.get('/plugins/:name', async (req) => ({ status: 200, headers: {}, body: { name: req.params.name } }));

    const result = router.match('GET', '/plugins/hello%20world');
    expect(result).not.toBeNull();
    expect(result!.params.name).toBe('hello world');
  });
});

describe('Security: Content-Type validation', () => {
  it('rejects non-JSON content types on POST', async () => {
    const req = mockRequest({
      method: 'POST',
      url: '/v1/chat',
      headers: { 'content-type': 'text/xml', host: 'localhost' },
    });

    await expect(parseRequest(req, {})).rejects.toThrow('Unsupported Media Type');
  });

  it('accepts application/json content type', async () => {
    const req = mockRequest({
      method: 'POST',
      url: '/v1/chat',
      headers: { 'content-type': 'application/json', host: 'localhost' },
    });

    // Push empty body so stream ends
    (req as any).push('{}');
    (req as any).push(null);

    const result = await parseRequest(req, {});
    expect(result.body).toEqual({});
  });

  it('accepts POST without content-type header', async () => {
    const req = mockRequest({
      method: 'POST',
      url: '/v1/chat',
      headers: { host: 'localhost' },
    });

    (req as any).push('{}');
    (req as any).push(null);

    const result = await parseRequest(req, {});
    expect(result.body).toEqual({});
  });
});

describe('Security: Body size limits', () => {
  it('rejects oversized request bodies', async () => {
    const req = mockRequest({
      method: 'POST',
      url: '/v1/chat',
      headers: { host: 'localhost' },
    });

    // Push more than 1MB
    const bigChunk = Buffer.alloc(1_100_000, 'x');
    setTimeout(() => {
      (req as any).push(bigChunk);
      (req as any).push(null);
    }, 0);

    await expect(parseRequest(req, {})).rejects.toThrow('too large');
  });
});

describe('Security: MetricsCollector', () => {
  it('does not leak sensitive data', async () => {
    const { MetricsCollector } = await import('./metrics.js');
    const metrics = new MetricsCollector();

    metrics.recordRequest('GET', 200, 10);
    metrics.recordRequest('POST', 401, 5);

    const snapshot = metrics.snapshot();
    // Should not contain any auth tokens, user IDs, etc.
    const jsonStr = JSON.stringify(snapshot);
    expect(jsonStr).not.toContain('Bearer');
    expect(jsonStr).not.toContain('password');
    expect(jsonStr).not.toContain('secret');
  });
});
