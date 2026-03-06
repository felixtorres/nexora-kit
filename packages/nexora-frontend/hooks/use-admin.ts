import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type Bot, type Agent, type PluginSummary } from '@/lib/api';
import { useSettings, useSettingsHydrated } from '@/store/settings';

/** Shorthand: queries should only run after settings hydrate from localStorage. */
function useApiReady() {
  const serverUrl = useSettings((s) => s.serverUrl);
  const apiKey = useSettings((s) => s.apiKey);
  const hydrated = useSettingsHydrated();
  return { serverUrl, enabled: hydrated && !!serverUrl && !!apiKey };
}

// ── Bots ───────────────────────────────────────────────────────────────

export function useBotList() {
  const { serverUrl, enabled } = useApiReady();
  return useQuery({
    queryKey: ['bots', serverUrl],
    queryFn: () => api.bots.list(),
    enabled,
  });
}

export function useCreateBot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<Bot>) => api.bots.create(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bots'] }),
  });
}

export function useUpdateBot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Bot> }) =>
      api.bots.update(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bots'] }),
  });
}

export function useDeleteBot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.bots.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bots'] }),
  });
}

// ── Agents ─────────────────────────────────────────────────────────────

export function useAgentList() {
  const { serverUrl, enabled } = useApiReady();
  return useQuery({
    queryKey: ['agents', serverUrl],
    queryFn: () => api.agents.list(),
    enabled,
  });
}

export function useCreateAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<Agent>) => api.agents.create(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agents'] }),
  });
}

export function useUpdateAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Agent> }) =>
      api.agents.update(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agents'] }),
  });
}

export function useDeleteAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.agents.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agents'] }),
  });
}

// ── Plugins ────────────────────────────────────────────────────────────

export function usePluginList() {
  const { serverUrl, enabled } = useApiReady();
  return useQuery({
    queryKey: ['plugins', serverUrl],
    queryFn: () => api.plugins.list(),
    enabled,
  });
}

export function useTogglePlugin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ name, enabled }: { name: string; enabled: boolean }) =>
      enabled ? api.plugins.enable(name) : api.plugins.disable(name),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['plugins'] }),
  });
}

export function useUninstallPlugin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => api.plugins.uninstall(name),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['plugins'] }),
  });
}

// ── Audit ──────────────────────────────────────────────────────────────

export function useAuditLog(params?: {
  actor?: string;
  action?: string;
  target?: string;
  since?: string;
  limit?: number;
}) {
  const { serverUrl, enabled } = useApiReady();
  return useQuery({
    queryKey: ['audit', serverUrl, params],
    queryFn: () => api.audit.list(params),
    enabled,
  });
}

export function usePurgeAuditLog() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.audit.purge(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['audit'] }),
  });
}

// ── Usage ──────────────────────────────────────────────────────────────

export function useUsageAnalytics(params?: {
  since?: string;
  pluginName?: string;
  breakdown?: 'plugin' | 'daily';
}) {
  const { serverUrl, enabled } = useApiReady();
  return useQuery({
    queryKey: ['usage', serverUrl, params],
    queryFn: () => api.usage.get(params),
    enabled,
  });
}
