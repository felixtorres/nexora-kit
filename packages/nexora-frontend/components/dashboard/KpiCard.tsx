'use client';

import { TrendingUp, TrendingDown } from 'lucide-react';
import {
  Card,
  CardContent,
  CardFooter,
} from '@/components/ui/card';

export interface KpiCardData {
  widgetId: string;
  title: string;
  value: number;
  formattedValue: string;
  format: 'number' | 'currency' | 'percent';
  delta?: number;
  formattedDelta?: string;
  comparisonLabel?: string;
}

interface KpiCardProps {
  data: KpiCardData;
}

export function KpiCard({ data }: KpiCardProps) {
  const isPositive = data.delta != null && data.delta >= 0;
  const isNegative = data.delta != null && data.delta < 0;

  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-3xl font-bold tracking-tight text-foreground">
          {data.formattedValue}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">{data.title}</p>
      </CardContent>
      {data.delta != null && data.formattedDelta && (
        <CardFooter className="text-xs">
          <span
            className={
              isPositive
                ? 'flex items-center gap-1 text-emerald-600 dark:text-emerald-400'
                : isNegative
                  ? 'flex items-center gap-1 text-red-600 dark:text-red-400'
                  : 'flex items-center gap-1 text-muted-foreground'
            }
          >
            {isPositive && <TrendingUp className="size-3.5" />}
            {isNegative && <TrendingDown className="size-3.5" />}
            {data.formattedDelta}
          </span>
          {data.comparisonLabel && (
            <span className="ml-1.5 text-muted-foreground">
              {data.comparisonLabel}
            </span>
          )}
        </CardFooter>
      )}
    </Card>
  );
}
