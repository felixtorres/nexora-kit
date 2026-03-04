"use client";

import { useHealth, type HealthStatus } from "@/hooks/use-health";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const dotColor: Record<HealthStatus, string> = {
  healthy: "bg-emerald-500",
  degraded: "bg-amber-500",
  error: "bg-red-500",
  unconfigured: "bg-zinc-400",
};

const statusLabel: Record<HealthStatus, string> = {
  healthy: "Connected",
  degraded: "Degraded",
  error: "Unreachable",
  unconfigured: "Not configured",
};

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

export function HealthIndicator() {
  const { status, data } = useHealth();

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button className="flex items-center gap-2 rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-accent">
            <span
              className={`inline-block h-2.5 w-2.5 rounded-full ${dotColor[status]}`}
            />
            <span className="hidden sm:inline">{statusLabel[status]}</span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="end">
          <div className="space-y-1 text-xs">
            <p>
              <span className="font-medium">Status:</span>{" "}
              {statusLabel[status]}
            </p>
            {data && (
              <>
                <p>
                  <span className="font-medium">Plugins:</span>{" "}
                  {data.plugins.enabled}/{data.plugins.total} enabled
                  {data.plugins.errored > 0 &&
                    `, ${data.plugins.errored} errored`}
                </p>
                <p>
                  <span className="font-medium">Uptime:</span>{" "}
                  {formatUptime(data.uptime)}
                </p>
              </>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
