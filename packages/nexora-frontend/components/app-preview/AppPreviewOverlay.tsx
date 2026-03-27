'use client';

import { Loader2, LayoutDashboard } from 'lucide-react';

interface AppPreviewOverlayProps {
  state: 'empty' | 'loading' | 'error';
  errorMessage?: string;
}

/**
 * Overlay shown in the preview pane when no app is loaded,
 * when an app is loading, or when an error occurs.
 */
export function AppPreviewOverlay({ state, errorMessage }: AppPreviewOverlayProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
      {state === 'empty' && (
        <>
          <LayoutDashboard className="h-10 w-10 opacity-30" />
          <p className="text-sm">Ask the assistant to build a dashboard</p>
          <p className="text-xs opacity-60">The app preview will appear here</p>
        </>
      )}
      {state === 'loading' && (
        <>
          <Loader2 className="h-8 w-8 animate-spin opacity-50" />
          <p className="text-sm">Generating dashboard&hellip;</p>
        </>
      )}
      {state === 'error' && (
        <>
          <div className="rounded-full bg-destructive/10 p-3">
            <span className="text-lg">!</span>
          </div>
          <p className="text-sm font-medium text-destructive">Preview failed</p>
          {errorMessage && (
            <p className="max-w-xs text-center text-xs opacity-70">{errorMessage}</p>
          )}
        </>
      )}
    </div>
  );
}
