import { useSettings } from '@/store/settings';
import type { ConversationRecord, Message, SendMessageResponse } from '@/lib/block-types';

// ── Types ──────────────────────────────────────────────────────────────

export interface HealthResponse {
  status: 'healthy' | 'degraded';
  plugins: { total: number; enabled: number; errored: number };
  uptime: number;
}

export interface Bot {
  id: string;
  name: string;
  description?: string;
  systemPrompt: string;
  pluginNamespaces?: string[];
  model: string;
  temperature?: number;
  maxTurns?: number;
  workspaceId?: string;
  metadata?: Record<string, unknown>;
}

export interface Agent {
  id: string;
  slug: string;
  name: string;
  description?: string;
  orchestrationStrategy?: 'single' | 'orchestrate' | 'route';
  orchestratorModel?: string;
  botId?: string;
  fallbackBotId?: string;
  appearance?: AgentAppearance;
  endUserAuth?: { mode?: 'anonymous' | 'token' | 'jwt' };
  rateLimits?: { messagesPerMinute?: number; conversationsPerDay?: number };
  features?: AgentFeatures;
  enabled?: boolean;
}

export interface AgentAppearance {
  displayName?: string;
  avatarUrl?: string;
  description?: string;
  welcomeMessage?: string;
  placeholder?: string;
}

export interface AgentFeatures {
  artifacts?: boolean;
  fileUpload?: boolean;
  feedback?: boolean;
  memory?: boolean;
}

export interface PluginSummary {
  namespace: string;
  name: string;
  version?: string;
  state: string;
  description?: string;
  toolCount?: number;
}

export type { ConversationRecord } from '@/lib/block-types';

export interface AuditEvent {
  id: number;
  actor: string;
  action: string;
  target?: string;
  createdAt: string;
  result: 'success' | 'failure';
  details?: Record<string, unknown>;
}

export interface UsageSummary {
  pluginName?: string;
  date?: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  requestCount: number;
  // API plugin breakdown uses totalInputTokens/totalOutputTokens
  totalInputTokens?: number;
  totalOutputTokens?: number;
}

export interface FeedbackItem {
  id: string;
  conversationId: string;
  messageSeq: number;
  rating: 'positive' | 'negative';
  comment?: string;
  tags?: string[];
  createdAt: string;
}

export interface FeedbackSummary {
  total: number;
  positive: number;
  negative: number;
  ratio: number;
}

export interface MetricsResponse {
  uptime_seconds: number;
  requests_total: number;
  requests_by_status: Record<string, number>;
  requests_by_method: Record<string, number>;
  active_connections: number;
  avg_latency_ms: number;
  p95_latency_ms: number;
  plugins_enabled: number;
  plugins_total: number;
}

// ── API Error ──────────────────────────────────────────────────────────

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string | undefined,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// ── Fetch helper ───────────────────────────────────────────────────────

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const { serverUrl, apiKey } = useSettings.getState();
  const url = `${serverUrl.replace(/\/$/, '')}/v1${path}`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  const res = await fetch(url, { ...options, headers });

  if (!res.ok) {
    let code: string | undefined;
    let message = res.statusText;
    try {
      const body = await res.json();
      code = body?.error?.code;
      message = body?.error?.message ?? message;
    } catch {
      // non-JSON error body
    }
    throw new ApiError(res.status, code, message);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// ── API namespaces ─────────────────────────────────────────────────────

export const api = {
  health: {
    check: () => request<HealthResponse>('/health'),
  },

  metrics: {
    get: () => request<MetricsResponse>('/metrics'),
  },

  commands: {
    list: () => request<{ commands: Array<{ name: string; description: string }> }>('/commands'),
  },

  bots: {
    list: () => request<{ bots: Bot[] }>('/admin/bots'),
    get: (id: string) => request<Bot>(`/admin/bots/${id}`),
    create: (data: Partial<Bot>) =>
      request<Bot>('/admin/bots', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    update: (id: string, data: Partial<Bot>) =>
      request<Bot>(`/admin/bots/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    delete: (id: string) => request<void>(`/admin/bots/${id}`, { method: 'DELETE' }),
  },

  agents: {
    list: () => request<{ agents: Agent[] }>('/admin/agents'),
    get: (id: string) => request<Agent>(`/admin/agents/${id}`),
    create: (data: Partial<Agent>) =>
      request<Agent>('/admin/agents', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    update: (id: string, data: Partial<Agent>) =>
      request<Agent>(`/admin/agents/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    delete: (id: string) => request<void>(`/admin/agents/${id}`, { method: 'DELETE' }),
  },

  plugins: {
    list: () => request<{ plugins: PluginSummary[] }>('/plugins'),
    get: (name: string) => request<PluginSummary>(`/plugins/${name}`),
    enable: (name: string) =>
      request<{ status: string }>(`/admin/plugins/${name}/enable`, {
        method: 'POST',
      }),
    disable: (name: string) =>
      request<{ status: string }>(`/admin/plugins/${name}/disable`, {
        method: 'POST',
      }),
    uninstall: (name: string) =>
      request<{ status: string }>(`/admin/plugins/${name}`, {
        method: 'DELETE',
      }),
  },

  conversations: {
    list: (params?: { limit?: number; cursor?: string }) => {
      const qs = new URLSearchParams();
      if (params?.limit) qs.set('limit', String(params.limit));
      if (params?.cursor) qs.set('cursor', params.cursor);
      const q = qs.toString();
      return request<{
        items: ConversationRecord[];
        nextCursor: string | null;
      }>(`/conversations${q ? `?${q}` : ''}`);
    },
    get: (id: string) => request<ConversationRecord>(`/conversations/${id}`),
    create: (data?: {
      title?: string;
      agentId?: string;
      systemPrompt?: string;
      model?: string;
      pluginNamespaces?: string[];
    }) =>
      request<ConversationRecord>('/conversations', {
        method: 'POST',
        body: JSON.stringify(data ?? {}),
      }),
    update: (id: string, data: { title?: string }) =>
      request<ConversationRecord>(`/conversations/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    delete: (id: string) => request<void>(`/conversations/${id}`, { method: 'DELETE' }),
  },

  messages: {
    list: (conversationId: string) =>
      request<{ messages: Message[] }>(`/conversations/${conversationId}/messages`),
    send: (conversationId: string, input: string) =>
      request<SendMessageResponse>(`/conversations/${conversationId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ input }),
      }),
  },

  audit: {
    list: (params?: {
      actor?: string;
      action?: string;
      target?: string;
      since?: string;
      limit?: number;
    }) => {
      const qs = new URLSearchParams();
      if (params?.actor) qs.set('actor', params.actor);
      if (params?.action) qs.set('action', params.action);
      if (params?.target) qs.set('target', params.target);
      if (params?.since) qs.set('since', params.since);
      if (params?.limit) qs.set('limit', String(params.limit));
      const q = qs.toString();
      return request<{ events: AuditEvent[]; count: number }>(
        `/admin/audit-log${q ? `?${q}` : ''}`,
      );
    },
    purge: () =>
      request<{ deleted: number }>('/admin/audit-log/purge', {
        method: 'POST',
        body: JSON.stringify({}),
      }),
  },

  usage: {
    get: (params?: { since?: string; pluginName?: string; breakdown?: 'plugin' | 'daily' }) => {
      const qs = new URLSearchParams();
      if (params?.since) qs.set('since', params.since);
      if (params?.pluginName) qs.set('pluginName', params.pluginName);
      if (params?.breakdown) qs.set('breakdown', params.breakdown);
      const q = qs.toString();
      return request<{
        breakdown: string;
        data: UsageSummary[];
        totalTokens?: number;
      }>(`/admin/usage${q ? `?${q}` : ''}`);
    },
  },

  feedback: {
    list: (params?: { rating?: 'positive' | 'negative'; cursor?: string; limit?: number }) => {
      const qs = new URLSearchParams();
      if (params?.rating) qs.set('rating', params.rating);
      if (params?.cursor) qs.set('cursor', params.cursor);
      if (params?.limit) qs.set('limit', String(params.limit));
      const q = qs.toString();
      return request<{ items: FeedbackItem[] }>(`/admin/feedback${q ? `?${q}` : ''}`);
    },
    summary: (params?: { from?: string; to?: string }) => {
      const qs = new URLSearchParams();
      if (params?.from) qs.set('from', params.from);
      if (params?.to) qs.set('to', params.to);
      const q = qs.toString();
      return request<{ summary: FeedbackSummary }>(`/admin/feedback/summary${q ? `?${q}` : ''}`);
    },
  },
} as const;
