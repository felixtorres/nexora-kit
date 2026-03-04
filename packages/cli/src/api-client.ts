import { resolve } from 'node:path';
import { readFile, access } from 'node:fs/promises';
import { parse as parseYaml } from 'yaml';
import { error } from './output.js';

export class ApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
  ) {}

  async get<T>(path: string, query?: Record<string, string>): Promise<T> {
    return this.request('GET', path, undefined, query);
  }

  async post<T>(path: string, body?: unknown): Promise<T> {
    return this.request('POST', path, body);
  }

  async patch<T>(path: string, body: unknown): Promise<T> {
    return this.request('PATCH', path, body);
  }

  async put<T>(path: string, body: unknown): Promise<T> {
    return this.request('PUT', path, body);
  }

  async delete(path: string): Promise<void> {
    await this.request('DELETE', path);
  }

  private async request<T>(method: string, path: string, body?: unknown, query?: Record<string, string>): Promise<T> {
    let url = `${this.baseUrl}${path}`;
    if (query) {
      const params = new URLSearchParams(
        Object.entries(query).filter(([, v]) => v !== undefined),
      );
      const qs = params.toString();
      if (qs) url += `?${qs}`;
    }

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.apiKey}`,
    };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    const res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const text = await res.text();
      let message: string;
      try {
        const json = JSON.parse(text);
        message = json.error ?? json.message ?? text;
      } catch {
        message = text;
      }
      throw new ApiError(res.status, message);
    }

    if (res.status === 204 || res.headers.get('content-length') === '0') {
      return undefined as T;
    }

    return res.json() as Promise<T>;
  }
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function createClientFromConfig(configPath: string): Promise<ApiClient> {
  const resolved = resolve(configPath);

  try {
    await access(resolved);
  } catch {
    error(`Config file not found: ${resolved}`);
    error(`Run 'nexora-kit init' to create one.`);
    process.exitCode = 1;
    throw new Error('Config file not found');
  }

  const raw = await readFile(resolved, 'utf-8');
  const config = parseYaml(raw) as Record<string, unknown>;

  const host = (config.host as string) ?? '127.0.0.1';
  const port = (config.port as number) ?? 3000;
  const baseUrl = `http://${host}:${port}/v1`;

  const auth = config.auth as Record<string, unknown> | undefined;
  const keys = (auth?.keys as Array<Record<string, string>>) ?? [];
  const apiKey = keys[0]?.key;

  if (!apiKey) {
    error('No API key found in config. Add auth.keys to nexora.yaml.');
    process.exitCode = 1;
    throw new Error('No API key configured');
  }

  return new ApiClient(baseUrl, apiKey);
}

export function handleApiError(err: unknown): void {
  if (err instanceof ApiError) {
    if (err.status === 401 || err.status === 403) {
      error(`Authentication failed (${err.status}): ${err.message}`);
    } else if (err.status === 404) {
      error(`Not found: ${err.message}`);
    } else {
      error(`Server error (${err.status}): ${err.message}`);
    }
  } else if (err instanceof TypeError && (err as NodeJS.ErrnoException).cause) {
    error('Cannot connect to server. Is it running? Start with: nexora-kit serve');
  } else if (err instanceof Error && err.message === 'Config file not found') {
    // Already handled in createClientFromConfig
  } else if (err instanceof Error && err.message === 'No API key configured') {
    // Already handled in createClientFromConfig
  } else {
    error(err instanceof Error ? err.message : String(err));
  }
  process.exitCode = 1;
}
