'use client';

import { LayoutDashboard, Maximize2 } from 'lucide-react';
import type { CustomBlock } from '@/lib/block-types';

interface AppPreviewBlockData {
  appId: string;
  title: string;
  widgetCount: number;
  sizeBytes: number;
}

interface AppPreviewBlockProps {
  block: CustomBlock;
  onExpand?: (data: AppPreviewBlockData) => void;
}

/**
 * Inline block shown in the chat when a dashboard app is generated.
 * Clicking "Expand Preview" triggers the split-pane.
 *
 * This is registered as the renderer for `custom:app/preview` blocks.
 */
export function AppPreviewBlock({ block, onExpand }: AppPreviewBlockProps) {
  const data = block.data as AppPreviewBlockData;
  const sizeKB = Math.round(data.sizeBytes / 1024);

  return (
    <div className="flex items-center gap-3 rounded-lg border bg-muted/20 px-4 py-3">
      <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary">
        <LayoutDashboard className="h-5 w-5" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="truncate text-sm font-medium">{data.title}</p>
        <p className="text-xs text-muted-foreground">
          {data.widgetCount} widget{data.widgetCount !== 1 ? 's' : ''} &middot; {sizeKB}KB
        </p>
      </div>
      {onExpand && (
        <button
          onClick={() => onExpand(data)}
          className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        >
          <Maximize2 className="h-3.5 w-3.5" />
          Expand
        </button>
      )}
    </div>
  );
}
