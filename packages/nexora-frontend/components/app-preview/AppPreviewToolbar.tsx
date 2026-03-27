'use client';

import { Moon, Sun, ExternalLink, X, RefreshCw } from 'lucide-react';

interface AppPreviewToolbarProps {
  title: string;
  onThemeToggle?: () => void;
  onPopout?: () => void;
  onClose: () => void;
  onRefresh?: () => void;
}

/**
 * Toolbar above the app preview iframe.
 * Controls: theme toggle, popout to new tab, refresh, close.
 */
export function AppPreviewToolbar({
  title,
  onThemeToggle,
  onPopout,
  onClose,
  onRefresh,
}: AppPreviewToolbarProps) {
  return (
    <div className="flex items-center justify-between border-b bg-muted/30 px-3 py-1.5">
      <span className="truncate text-sm font-medium text-muted-foreground">
        {title}
      </span>
      <div className="flex items-center gap-1">
        {onThemeToggle && (
          <button
            onClick={onThemeToggle}
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            title="Toggle theme"
          >
            <Sun className="h-3.5 w-3.5 dark:hidden" />
            <Moon className="hidden h-3.5 w-3.5 dark:block" />
          </button>
        )}
        {onRefresh && (
          <button
            onClick={onRefresh}
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            title="Refresh"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        )}
        {onPopout && (
          <button
            onClick={onPopout}
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            title="Open in new tab"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </button>
        )}
        <button
          onClick={onClose}
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          title="Close preview"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
