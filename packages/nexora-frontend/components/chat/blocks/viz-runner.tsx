'use client';

import { useState, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { Play, Loader2 } from 'lucide-react';
import { runVisualization, getPyodideState, type VizResult } from '@/lib/pyodide';

const Plot = dynamic(() => import('react-plotly.js'), { ssr: false });

type RunnerState = 'idle' | 'loading-pyodide' | 'executing' | 'rendered' | 'error';

export function VizRunner({
  code,
  tableData,
}: {
  code: string;
  tableData?: Record<string, unknown>[];
}) {
  const [state, setState] = useState<RunnerState>('idle');
  const [result, setResult] = useState<VizResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleRun = useCallback(async () => {
    try {
      const pyState = getPyodideState();
      setState(pyState === 'ready' ? 'executing' : 'loading-pyodide');

      const vizResult = await runVisualization(code, tableData);
      setResult(vizResult);
      setState('rendered');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setState('error');
    }
  }, [code, tableData]);

  return (
    <div className="mt-2">
      {state === 'idle' && (
        <button
          onClick={handleRun}
          className="flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 transition-colors"
        >
          <Play className="size-3" />
          Run
        </button>
      )}

      {state === 'loading-pyodide' && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-3 animate-spin" />
          Loading Python runtime...
        </div>
      )}

      {state === 'executing' && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-3 animate-spin" />
          Running...
        </div>
      )}

      {state === 'rendered' && result?.type === 'plotly' && (
        <div className="mt-2 rounded-lg border bg-white dark:bg-zinc-900 overflow-hidden">
          <Plot
            data={result.figure.data as Plotly.Data[]}
            layout={{
              ...result.figure.layout,
              autosize: true,
              margin: { l: 50, r: 30, t: 40, b: 50 },
              paper_bgcolor: 'transparent',
              plot_bgcolor: 'transparent',
            }}
            config={{ responsive: true, displayModeBar: true }}
            style={{ width: '100%', height: 400 }}
            useResizeHandler
          />
          <div className="border-t px-3 py-1.5">
            <button
              onClick={handleRun}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Re-run
            </button>
          </div>
        </div>
      )}

      {state === 'rendered' && result?.type === 'image' && (
        <div className="mt-2 rounded-lg border bg-white dark:bg-zinc-900 overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={result.dataUrl} alt="Python visualization" className="w-full" />
          <div className="border-t px-3 py-1.5">
            <button
              onClick={handleRun}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Re-run
            </button>
          </div>
        </div>
      )}

      {state === 'error' && (
        <div className="mt-2 space-y-2">
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
            {error}
          </div>
          <button
            onClick={handleRun}
            className="flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 transition-colors"
          >
            <Play className="size-3" />
            Retry
          </button>
        </div>
      )}
    </div>
  );
}
