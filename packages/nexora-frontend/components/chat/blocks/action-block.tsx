'use client';

import { Button } from '@/components/ui/button';
import type { ActionBlock as ActionBlockType, Action } from '@/lib/block-types';

interface ActionBlockProps {
  block: ActionBlockType;
  onAction: (actionId: string, payload: Record<string, unknown>) => void;
}

const styleMap: Record<string, 'default' | 'outline' | 'destructive'> = {
  primary: 'default',
  secondary: 'outline',
  danger: 'destructive',
};

export function ActionBlock({ block, onAction }: ActionBlockProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {block.actions.map((action: Action) => (
        <Button
          key={action.id}
          variant={styleMap[action.style ?? 'primary'] ?? 'default'}
          size="sm"
          onClick={() => onAction(action.id, action.payload ?? {})}
        >
          {action.label}
        </Button>
      ))}
    </div>
  );
}
