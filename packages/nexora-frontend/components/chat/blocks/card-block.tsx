'use client';

import ReactMarkdown from 'react-markdown';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import type { CardBlock as CardBlockType, Action } from '@/lib/block-types';

const styleMap: Record<string, 'default' | 'outline' | 'destructive'> = {
  primary: 'default',
  secondary: 'outline',
  danger: 'destructive',
};

interface CardBlockProps {
  block: CardBlockType;
  onAction: (actionId: string, payload: Record<string, unknown>) => void;
}

export function CardBlock({ block, onAction }: CardBlockProps) {
  return (
    <Card>
      {block.imageUrl && (
        <img
          src={block.imageUrl}
          alt={block.title}
          className="w-full rounded-t-lg object-cover"
        />
      )}
      <CardHeader>
        <CardTitle className="text-base">{block.title}</CardTitle>
      </CardHeader>
      {block.body && (
        <CardContent>
          <div className="prose prose-sm dark:prose-invert max-w-none">
            <ReactMarkdown>{block.body}</ReactMarkdown>
          </div>
        </CardContent>
      )}
      {block.actions && block.actions.length > 0 && (
        <CardFooter className="gap-2">
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
        </CardFooter>
      )}
    </Card>
  );
}
