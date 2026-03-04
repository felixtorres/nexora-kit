'use client';

import { useState } from 'react';
import { BarChart3 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useUsageAnalytics } from '@/hooks/use-admin';

type BreakdownMode = 'plugin' | 'daily';

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export default function UsagePage() {
  const [breakdown, setBreakdown] = useState<BreakdownMode>('plugin');
  const { data, isLoading } = useUsageAnalytics({ breakdown });

  const rows = data?.data ?? [];
  const totalTokens = data?.totalTokens ?? rows.reduce((sum, r) => sum + r.totalTokens, 0);

  return (
    <div className="flex-1 space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Usage Analytics</h1>
          <p className="text-sm text-muted-foreground">Token usage and request metrics</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant={breakdown === 'plugin' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setBreakdown('plugin')}
          >
            By Plugin
          </Button>
          <Button
            variant={breakdown === 'daily' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setBreakdown('daily')}
          >
            Daily
          </Button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Tokens</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{isLoading ? '-' : formatTokens(totalTokens)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Requests</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {isLoading ? '-' : rows.reduce((sum, r) => sum + r.requestCount, 0).toLocaleString()}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {breakdown === 'plugin' ? 'Active Plugins' : 'Days with Activity'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{isLoading ? '-' : rows.length}</div>
          </CardContent>
        </Card>
      </div>

      {/* Breakdown table */}
      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-12 w-full rounded" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <BarChart3 className="mb-3 size-10 opacity-50" />
          <p className="text-sm">No usage data yet.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-4 py-2 text-left font-medium">
                  {breakdown === 'plugin' ? 'Plugin' : 'Date'}
                </th>
                <th className="px-4 py-2 text-right font-medium">Input</th>
                <th className="px-4 py-2 text-right font-medium">Output</th>
                <th className="px-4 py-2 text-right font-medium">Total</th>
                <th className="px-4 py-2 text-right font-medium">Requests</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((row, i) => {
                const key = breakdown === 'plugin' ? row.pluginName : row.date;
                const pct = totalTokens > 0 ? (row.totalTokens / totalTokens) * 100 : 0;
                return (
                  <tr key={key ?? i} className="hover:bg-muted/20">
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        <span>{key ?? 'unknown'}</span>
                        {pct > 10 && (
                          <Badge variant="secondary" className="text-xs">
                            {pct.toFixed(0)}%
                          </Badge>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-xs">
                      {formatTokens(row.inputTokens)}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-xs">
                      {formatTokens(row.outputTokens)}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-xs font-medium">
                      {formatTokens(row.totalTokens)}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-xs">
                      {row.requestCount.toLocaleString()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
