import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ApiClient, ApiError, createClientFromConfig } from './api-client.js';

describe('ApiClient', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    mockFetch.mockReset();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends GET requests with auth header', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-length': '2' }),
      json: () => Promise.resolve({ ok: true }),
    });

    const client = new ApiClient('http://localhost:3000/v1', 'my-key');
    const result = await client.get('/admin/bots');

    expect(mockFetch).toHaveBeenCalledWith('http://localhost:3000/v1/admin/bots', {
      method: 'GET',
      headers: { Authorization: 'Bearer my-key' },
      body: undefined,
    });
    expect(result).toEqual({ ok: true });
  });

  it('sends POST requests with JSON body', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 201,
      headers: new Headers({ 'content-length': '10' }),
      json: () => Promise.resolve({ id: '123' }),
    });

    const client = new ApiClient('http://localhost:3000/v1', 'my-key');
    await client.post('/admin/bots', { name: 'test' });

    expect(mockFetch).toHaveBeenCalledWith('http://localhost:3000/v1/admin/bots', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer my-key',
        'Content-Type': 'application/json',
      },
      body: '{"name":"test"}',
    });
  });

  it('appends query parameters on GET', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-length': '2' }),
      json: () => Promise.resolve([]),
    });

    const client = new ApiClient('http://localhost:3000/v1', 'key');
    await client.get('/items', { since: '2026-01-01', limit: '10' });

    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('since=2026-01-01');
    expect(url).toContain('limit=10');
  });

  it('throws ApiError on non-ok response', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      text: () => Promise.resolve(JSON.stringify({ error: 'Bot not found' })),
    });

    const client = new ApiClient('http://localhost:3000/v1', 'key');
    await expect(client.get('/admin/bots/bad-id')).rejects.toThrow(ApiError);

    try {
      await client.get('/admin/bots/bad-id');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(404);
      expect((err as ApiError).message).toBe('Bot not found');
    }
  });

  it('handles 204 no-content responses', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 204,
      headers: new Headers(),
    });

    const client = new ApiClient('http://localhost:3000/v1', 'key');
    const result = await client.delete('/admin/bots/123');
    expect(result).toBeUndefined();
  });

  it('handles plain text error responses', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve('Internal Server Error'),
    });

    const client = new ApiClient('http://localhost:3000/v1', 'key');
    await expect(client.get('/health')).rejects.toThrow('Internal Server Error');
  });
});

describe('createClientFromConfig', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'nexora-api-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
    process.exitCode = undefined;
  });

  it('creates client from valid config', async () => {
    const configPath = join(tempDir, 'nexora.yaml');
    await writeFile(configPath, `
host: 127.0.0.1
port: 4000
auth:
  keys:
    - key: test-key-123
      userId: admin
      teamId: default
      role: admin
`, 'utf-8');

    const client = await createClientFromConfig(configPath);
    expect(client).toBeInstanceOf(ApiClient);
  });

  it('throws on missing config file', async () => {
    await expect(createClientFromConfig(join(tempDir, 'missing.yaml'))).rejects.toThrow();
    expect(process.exitCode).toBe(1);
  });

  it('throws on missing API key', async () => {
    const configPath = join(tempDir, 'nexora.yaml');
    await writeFile(configPath, `
host: 127.0.0.1
port: 3000
`, 'utf-8');

    await expect(createClientFromConfig(configPath)).rejects.toThrow();
    expect(process.exitCode).toBe(1);
  });
});
