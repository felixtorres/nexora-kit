'use client';

import { useRef, useState, useEffect, lazy, Suspense } from 'react';
import { Loader2, AlertCircle } from 'lucide-react';
import type { VisualizationSpec } from 'react-vega';
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

const VegaLite = lazy(() =>
  import('react-vega').then((mod) => ({ default: mod.VegaLite }))
);

export interface ChartWidgetData {
  widgetId: string;
  title: string;
  spec: { engine: 'vega-lite'; config: Record<string, unknown> };
  data: Record<string, unknown>[];
  columns: { key: string; label: string; type: string }[];
  rowCount: number;
  truncated: boolean;
}

interface ChartWidgetProps {
  data: ChartWidgetData;
}

export function ChartWidget({ data }: ChartWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(500);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setWidth(entry.contentRect.width);
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // Build the full Vega-Lite spec with data injected.
  // The config comes pre-validated from the backend; cast to VisualizationSpec.
  const vegaLiteSpec = {
    ...data.spec.config,
    width: width - 80,
    autosize: { type: 'fit' as const, contains: 'padding' as const },
    data: { values: data.data },
  } as VisualizationSpec;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{data.title}</CardTitle>
      </CardHeader>
      <CardContent ref={containerRef}>
        {error ? (
          <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
            <AlertCircle className="size-4 shrink-0" />
            <span>Failed to render chart: {error}</span>
          </div>
        ) : (
          <Suspense
            fallback={
              <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Loading chart...
              </div>
            }
          >
            <div className="overflow-hidden rounded-md">
              <VegaLite
                spec={vegaLiteSpec}
                actions={false}
                onError={(err: Error) => setError(err.message)}
              />
            </div>
          </Suspense>
        )}
      </CardContent>
      <CardFooter className="text-xs text-muted-foreground">
        {data.rowCount} row{data.rowCount !== 1 ? 's' : ''}
        {data.truncated && (
          <span className="ml-1 text-amber-600 dark:text-amber-400">
            (truncated)
          </span>
        )}
      </CardFooter>
    </Card>
  );
}
