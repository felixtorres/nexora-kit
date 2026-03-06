'use client';

import { useState } from 'react';
import {
  Brain,
  ChevronRight,
  Layers,
  RefreshCw,
  Sparkles,
  Workflow,
} from 'lucide-react';
import type { ActivityBlock as ActivityBlockType } from '@/lib/block-types';

const EVENT_CONFIG: Record<
  ActivityBlockType['event'],
  { icon: typeof Brain; color: string }
> = {
  turn_start: { icon: RefreshCw, color: 'text-blue-400' },
  turn_continue: { icon: Sparkles, color: 'text-amber-400' },
  compaction: { icon: Layers, color: 'text-violet-400' },
  sub_agent_start: { icon: Workflow, color: 'text-cyan-400' },
  sub_agent_end: { icon: Workflow, color: 'text-cyan-400' },
  thinking: { icon: Brain, color: 'text-pink-400' },
};

interface ActivityBlockProps {
  block: ActivityBlockType;
}

export function ActivityBlock({ block }: ActivityBlockProps) {
  const [expanded, setExpanded] = useState(false);
  const config = EVENT_CONFIG[block.event];
  const Icon = config.icon;
  const hasDetail = block.event === 'thinking' && block.detail;

  return (
    <div className="group flex items-start gap-2 rounded-md border border-transparent px-2 py-1 text-xs opacity-60 transition-opacity hover:opacity-90">
      <Icon className={`mt-px size-3 shrink-0 ${config.color}`} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          {hasDetail ? (
            <button
              type="button"
              onClick={() => setExpanded(!expanded)}
              className="flex items-center gap-1 font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              <ChevronRight
                className={`size-3 transition-transform ${expanded ? 'rotate-90' : ''}`}
              />
              {block.label}
            </button>
          ) : (
            <span className="font-medium text-muted-foreground">
              {block.label}
            </span>
          )}
          {block.detail && block.event !== 'thinking' && (
            <span className="text-muted-foreground/70">{block.detail}</span>
          )}
        </div>
        {hasDetail && expanded && (
          <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-muted/30 px-2 py-1.5 font-mono text-[11px] leading-relaxed text-muted-foreground">
            {block.detail}
          </pre>
        )}
      </div>
    </div>
  );
}
