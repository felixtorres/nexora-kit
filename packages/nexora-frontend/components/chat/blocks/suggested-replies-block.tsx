'use client';

import { Button } from '@/components/ui/button';
import type { SuggestedRepliesBlock as SuggestedRepliesBlockType } from '@/lib/block-types';

interface SuggestedRepliesBlockProps {
  block: SuggestedRepliesBlockType;
  onReply: (text: string) => void;
}

export function SuggestedRepliesBlock({ block, onReply }: SuggestedRepliesBlockProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {block.replies.map((reply) => (
        <Button
          key={reply}
          variant="outline"
          size="sm"
          className="rounded-full"
          onClick={() => onReply(reply)}
        >
          {reply}
        </Button>
      ))}
    </div>
  );
}
