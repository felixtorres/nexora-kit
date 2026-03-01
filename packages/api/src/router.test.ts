import { describe, it, expect } from 'vitest';
import { Router, ApiError, errorResponse, jsonResponse } from './router.js';

describe('Router', () => {
  it('matches exact paths', () => {
    const router = new Router();
    const handler = async () => jsonResponse(200, 'ok');
    router.get('/v1/health', handler);

    const result = router.match('GET', '/v1/health');
    expect(result).not.toBeNull();
    expect(result!.handler).toBe(handler);
    expect(result!.params).toEqual({});
  });

  it('matches paths with params', () => {
    const router = new Router();
    const handler = async () => jsonResponse(200, 'ok');
    router.get('/v1/plugins/:name', handler);

    const result = router.match('GET', '/v1/plugins/my-plugin');
    expect(result).not.toBeNull();
    expect(result!.params).toEqual({ name: 'my-plugin' });
  });

  it('returns null for non-matching path', () => {
    const router = new Router();
    router.get('/v1/health', async () => jsonResponse(200, 'ok'));

    expect(router.match('GET', '/v1/plugins')).toBeNull();
  });

  it('returns null for non-matching method', () => {
    const router = new Router();
    router.get('/v1/health', async () => jsonResponse(200, 'ok'));

    expect(router.match('POST', '/v1/health')).toBeNull();
  });

  it('matches first registered route', () => {
    const router = new Router();
    const h1 = async () => jsonResponse(200, 'first');
    const h2 = async () => jsonResponse(200, 'second');
    router.get('/v1/test', h1);
    router.get('/v1/test', h2);

    const result = router.match('GET', '/v1/test');
    expect(result!.handler).toBe(h1);
  });

  it('supports POST routes', () => {
    const router = new Router();
    const handler = async () => jsonResponse(200, 'ok');
    router.post('/v1/chat', handler);

    expect(router.match('POST', '/v1/chat')).not.toBeNull();
    expect(router.match('GET', '/v1/chat')).toBeNull();
  });

  it('decodes URI components in params', () => {
    const router = new Router();
    router.get('/v1/plugins/:name', async () => jsonResponse(200, 'ok'));

    const result = router.match('GET', '/v1/plugins/my%20plugin');
    expect(result!.params.name).toBe('my plugin');
  });

  it('case-insensitive method matching', () => {
    const router = new Router();
    router.add('get', '/test', async () => jsonResponse(200, 'ok'));

    expect(router.match('GET', '/test')).not.toBeNull();
  });
});

describe('ApiError', () => {
  it('creates error with status and message', () => {
    const err = new ApiError(404, 'Not found');
    expect(err.status).toBe(404);
    expect(err.message).toBe('Not found');
    expect(err.code).toBeUndefined();
  });

  it('creates error with code', () => {
    const err = new ApiError(429, 'Too many requests', 'RATE_LIMITED');
    expect(err.code).toBe('RATE_LIMITED');
  });
});

describe('errorResponse', () => {
  it('formats ApiError', () => {
    const res = errorResponse(new ApiError(404, 'Not found', 'NOT_FOUND'));
    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: { message: 'Not found', code: 'NOT_FOUND' },
    });
  });

  it('formats unknown error as 500', () => {
    const res = errorResponse(new Error('oops'));
    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      error: { message: 'Internal server error', code: 'INTERNAL_ERROR' },
    });
  });
});
