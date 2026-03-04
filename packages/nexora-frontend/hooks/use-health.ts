import { useQuery } from "@tanstack/react-query";
import { api, type HealthResponse } from "@/lib/api";
import { useSettings } from "@/store/settings";

export type HealthStatus = "healthy" | "degraded" | "error" | "unconfigured";

export interface HealthState {
  status: HealthStatus;
  data?: HealthResponse;
  error?: Error;
  isLoading: boolean;
}

export function useHealth(): HealthState {
  const serverUrl = useSettings((s) => s.serverUrl);
  const apiKey = useSettings((s) => s.apiKey);

  const query = useQuery({
    queryKey: ["health", serverUrl],
    queryFn: () => api.health.check(),
    refetchInterval: 15_000,
    retry: false,
    enabled: !!serverUrl,
  });

  if (!serverUrl) {
    return { status: "unconfigured", isLoading: false };
  }

  if (query.isLoading) {
    return { status: "unconfigured", isLoading: true };
  }

  if (query.isError) {
    return {
      status: "error",
      error: query.error as Error,
      isLoading: false,
    };
  }

  return {
    status: query.data?.status ?? "error",
    data: query.data,
    isLoading: false,
  };
}
