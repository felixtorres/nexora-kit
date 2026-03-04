'use client';

import { useState, useCallback } from 'react';
import { Play, Loader2, FileJson, Activity, Terminal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError, type MetricsResponse } from '@/lib/api';
import { useSettings } from '@/store/settings';

type Tab = 'explorer' | 'openapi' | 'metrics';

// ── API Explorer ───────────────────────────────────────────────────────

const ENDPOINTS = [
  { method: 'GET', path: '/health', label: 'Health Check' },
  { method: 'GET', path: '/metrics', label: 'Metrics' },
  { method: 'GET', path: '/openapi.json', label: 'OpenAPI Spec' },
  { method: 'GET', path: '/conversations', label: 'List Conversations' },
  { method: 'GET', path: '/admin/bots', label: 'List Bots' },
  { method: 'GET', path: '/admin/agents', label: 'List Agents' },
  { method: 'GET', path: '/plugins', label: 'List Plugins' },
  { method: 'GET', path: '/admin/audit-log', label: 'Audit Log' },
  { method: 'GET', path: '/admin/usage', label: 'Usage Analytics' },
  { method: 'POST', path: '/conversations', label: 'Create Conversation' },
  { method: 'POST', path: '/admin/bots', label: 'Create Bot' },
  { method: 'POST', path: '/admin/agents', label: 'Create Agent' },
] as const;

type ExplorerResult =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'success'; status: number; data: unknown; durationMs: number }
  | { state: 'error'; status?: number; message: string; durationMs: number };

function ApiExplorer() {
  const { serverUrl, apiKey } = useSettings();
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [body, setBody] = useState('{}');
  const [result, setResult] = useState<ExplorerResult>({ state: 'idle' });

  const endpoint = ENDPOINTS[selectedIdx];

  const handleRun = useCallback(async () => {
    setResult({ state: 'loading' });
    const start = performance.now();
    const url = `${serverUrl.replace(/\/$/, '')}/v1${endpoint.path}`;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

    try {
      const options: RequestInit = { method: endpoint.method, headers };
      if (endpoint.method === 'POST') {
        options.body = body;
      }
      const res = await fetch(url, options);
      const durationMs = Math.round(performance.now() - start);
      const data = res.status === 204 ? null : await res.json().catch(() => null);

      if (res.ok) {
        setResult({ state: 'success', status: res.status, data, durationMs });
      } else {
        setResult({
          state: 'error',
          status: res.status,
          message: data?.error?.message ?? res.statusText,
          durationMs,
        });
      }
    } catch (err) {
      const durationMs = Math.round(performance.now() - start);
      setResult({
        state: 'error',
        message: err instanceof Error ? err.message : 'Request failed',
        durationMs,
      });
    }
  }, [serverUrl, apiKey, endpoint, body]);

  return (
    <div className="space-y-4">
      <div className="flex gap-3">
        <div className="flex-1 space-y-1.5">
          <Label>Endpoint</Label>
          <select
            value={selectedIdx}
            onChange={(e) => {
              setSelectedIdx(Number(e.target.value));
              setResult({ state: 'idle' });
            }}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
          >
            {ENDPOINTS.map((ep, i) => (
              <option key={i} value={i}>
                {ep.method} /v1{ep.path} — {ep.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-end">
          <Button onClick={handleRun} disabled={result.state === 'loading'}>
            {result.state === 'loading' ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <Play className="mr-2 size-4" />
            )}
            Run
          </Button>
        </div>
      </div>

      {endpoint.method === 'POST' && (
        <div className="space-y-1.5">
          <Label>Request Body (JSON)</Label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={6}
            className="w-full rounded-md border bg-zinc-950 px-3 py-2 font-mono text-sm text-zinc-300 resize-none focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      )}

      {result.state !== 'idle' && result.state !== 'loading' && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Badge variant={result.state === 'success' ? 'default' : 'destructive'}>
              {result.state === 'success' ? result.status : result.status ?? 'ERR'}
            </Badge>
            <span className="text-xs text-muted-foreground font-mono">
              {result.durationMs}ms
            </span>
          </div>
          <pre className="max-h-96 overflow-auto rounded-lg border bg-zinc-950 p-3 text-sm text-zinc-300 leading-relaxed">
            {result.state === 'success'
              ? JSON.stringify(result.data, null, 2)
              : result.message}
          </pre>
        </div>
      )}
    </div>
  );
}

// ── OpenAPI Viewer ─────────────────────────────────────────────────────

function OpenApiViewer() {
  const serverUrl = useSettings((s) => s.serverUrl);
  const apiKey = useSettings((s) => s.apiKey);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['openapi', serverUrl],
    queryFn: async () => {
      const url = `${serverUrl.replace(/\/$/, '')}/v1/openapi.json`;
      const headers: Record<string, string> = {};
      if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
      const res = await fetch(url, { headers });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return res.json();
    },
    enabled: !!serverUrl,
    retry: false,
  });

  if (isLoading) {
    return <Skeleton className="h-64 w-full rounded-lg" />;
  }

  if (error) {
    return (
      <div className="space-y-3">
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
          Failed to load OpenAPI spec: {(error as Error).message}
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()}>Retry</Button>
      </div>
    );
  }

  const spec = data as Record<string, unknown>;
  const info = spec?.info as Record<string, unknown> | undefined;
  const paths = spec?.paths as Record<string, Record<string, unknown>> | undefined;

  return (
    <div className="space-y-4">
      {info && (
        <div>
          <h3 className="text-lg font-semibold">{String(info.title ?? 'API')}</h3>
          <p className="text-sm text-muted-foreground">
            {String(info.description ?? '')} · v{String(info.version ?? '?')}
          </p>
        </div>
      )}

      {paths && (
        <div className="overflow-hidden rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Method</th>
                <th className="px-4 py-2 text-left font-medium">Path</th>
                <th className="px-4 py-2 text-left font-medium">Summary</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {Object.entries(paths).flatMap(([path, methods]) =>
                Object.entries(methods).map(([method, details]) => {
                  const d = details as Record<string, unknown>;
                  const methodUpper = method.toUpperCase();
                  const color =
                    methodUpper === 'GET' ? 'text-green-600' :
                    methodUpper === 'POST' ? 'text-blue-600' :
                    methodUpper === 'PUT' || methodUpper === 'PATCH' ? 'text-yellow-600' :
                    methodUpper === 'DELETE' ? 'text-red-600' : '';
                  return (
                    <tr key={`${method}-${path}`} className="hover:bg-muted/20">
                      <td className={`px-4 py-1.5 font-mono text-xs font-bold ${color}`}>
                        {methodUpper}
                      </td>
                      <td className="px-4 py-1.5 font-mono text-xs">{path}</td>
                      <td className="px-4 py-1.5 text-xs text-muted-foreground">
                        {String(d.summary ?? d.description ?? '')}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      <details>
        <summary className="cursor-pointer text-xs text-muted-foreground">Raw JSON</summary>
        <pre className="mt-2 max-h-96 overflow-auto rounded-lg border bg-zinc-950 p-3 text-[11px] text-zinc-300 leading-relaxed">
          {JSON.stringify(data, null, 2)}
        </pre>
      </details>
    </div>
  );
}

// ── Metrics Panel ──────────────────────────────────────────────────────

function MetricsPanel() {
  const serverUrl = useSettings((s) => s.serverUrl);

  const { data, isLoading, error } = useQuery({
    queryKey: ['metrics', serverUrl],
    queryFn: () => api.metrics.get(),
    enabled: !!serverUrl,
    refetchInterval: 10_000,
  });

  if (isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-24 rounded-lg" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
        Failed to load metrics: {(error as Error).message}
      </div>
    );
  }

  const m = data as MetricsResponse;

  function formatUptime(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const min = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return `${h}h ${min}m`;
    if (min > 0) return `${min}m ${s}s`;
    return `${s}s`;
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">Uptime</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatUptime(m.uptime)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Requests</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{m.requests.total.toLocaleString()}</div>
            {m.requests.errors > 0 && (
              <p className="text-xs text-red-500">{m.requests.errors} errors</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">p95 Latency</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{m.latency.p95}ms</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">Connections</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{m.connections}</div>
          </CardContent>
        </Card>
      </div>
      <p className="text-xs text-muted-foreground">Auto-refreshes every 10 seconds</p>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────

const tabs: { key: Tab; label: string; icon: typeof Terminal }[] = [
  { key: 'explorer', label: 'API Explorer', icon: Terminal },
  { key: 'openapi', label: 'OpenAPI Spec', icon: FileJson },
  { key: 'metrics', label: 'Metrics', icon: Activity },
];

export default function PlaygroundPage() {
  const [activeTab, setActiveTab] = useState<Tab>('explorer');

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Developer Playground</h1>
        <p className="text-sm text-muted-foreground">
          Inspect your NexoraKit API, run requests, and monitor metrics.
        </p>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 border-b">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-1.5 border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === tab.key
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <tab.icon className="size-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'explorer' && <ApiExplorer />}
      {activeTab === 'openapi' && <OpenApiViewer />}
      {activeTab === 'metrics' && <MetricsPanel />}
    </div>
  );
}
