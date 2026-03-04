'use client';

import { Loader2 } from 'lucide-react';
import type { ProgressBlock as ProgressBlockType } from '@/lib/block-types';

export function ProgressBlock({ block }: { block: ProgressBlockType }) {
  const hasProgress = block.value != null && block.max != null && block.max > 0;
  const percent = hasProgress ? Math.round((block.value! / block.max!) * 100) : 0;

  return (
    <div className="flex items-center gap-3 rounded-lg border bg-muted/20 px-4 py-3">
      {hasProgress ? (
        <>
          <div className="flex-1">
            <div className="mb-1 text-sm font-medium">{block.label}</div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-all duration-300"
                style={{ width: `${percent}%` }}
              />
            </div>
          </div>
          <span className="text-xs text-muted-foreground">{percent}%</span>
        </>
      ) : (
        <>
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
          <span className="text-sm">{block.label}</span>
        </>
      )}
    </div>
  );
}
