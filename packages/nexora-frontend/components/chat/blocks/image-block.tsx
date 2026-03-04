'use client';

import { useState } from 'react';
import type { ImageBlock as ImageBlockType } from '@/lib/block-types';

export function ImageBlock({ block }: { block: ImageBlockType }) {
  const [error, setError] = useState(false);

  if (error) {
    return (
      <div className="flex items-center justify-center rounded-lg border border-dashed bg-muted/30 px-4 py-8 text-sm text-muted-foreground">
        Failed to load image
      </div>
    );
  }

  return (
    <img
      src={block.url}
      alt={block.alt ?? ''}
      onError={() => setError(true)}
      className="max-w-full rounded-lg border"
    />
  );
}
