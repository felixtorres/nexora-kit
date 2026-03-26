'use client';

import { useState } from 'react';

interface FilterField {
  name: string;
  label: string;
  type: 'select' | 'date-range' | 'number-range' | 'text-search';
  options?: string[];
  default?: unknown;
}

export interface FilterBarData {
  dashboardId: string;
  filterId: string;
  fields: FilterField[];
  currentValues: Record<string, unknown>;
}

interface FilterBarProps {
  data: FilterBarData;
  onAction?: (actionId: string, payload: Record<string, unknown>) => void;
}

export function FilterBar({ data, onAction }: FilterBarProps) {
  const [values, setValues] = useState<Record<string, unknown>>(data.currentValues ?? {});

  const handleChange = (field: string, value: unknown) => {
    setValues((prev) => ({ ...prev, [field]: value }));
    onAction?.(`filter-${field}`, {
      dashboardId: data.dashboardId,
      filterId: data.filterId,
      field,
      value,
    });
  };

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-3">
      {data.fields.map((field) => (
        <div key={field.name} className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">{field.label}</label>
          {field.type === 'select' && (
            <select
              value={String(values[field.name] ?? '')}
              onChange={(e) => handleChange(field.name, e.target.value || undefined)}
              className="rounded-md border bg-background px-2 py-1.5 text-sm"
            >
              <option value="">All</option>
              {(field.options ?? []).map((opt) => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          )}
          {field.type === 'text-search' && (
            <input
              type="text"
              placeholder="Search..."
              value={String(values[field.name] ?? '')}
              onChange={(e) => handleChange(field.name, e.target.value || undefined)}
              className="rounded-md border bg-background px-2 py-1.5 text-sm"
            />
          )}
          {field.type === 'number-range' && (
            <div className="flex items-center gap-1">
              <input
                type="number"
                placeholder="Min"
                value={String((values[field.name] as { min?: number })?.min ?? '')}
                onChange={(e) => handleChange(field.name, {
                  ...(values[field.name] as object ?? {}),
                  min: e.target.value ? Number(e.target.value) : undefined,
                })}
                className="w-20 rounded-md border bg-background px-2 py-1.5 text-sm"
              />
              <span className="text-xs text-muted-foreground">–</span>
              <input
                type="number"
                placeholder="Max"
                value={String((values[field.name] as { max?: number })?.max ?? '')}
                onChange={(e) => handleChange(field.name, {
                  ...(values[field.name] as object ?? {}),
                  max: e.target.value ? Number(e.target.value) : undefined,
                })}
                className="w-20 rounded-md border bg-background px-2 py-1.5 text-sm"
              />
            </div>
          )}
          {field.type === 'date-range' && (
            <div className="flex items-center gap-1">
              <input
                type="date"
                value={String((values[field.name] as { from?: string })?.from ?? '')}
                onChange={(e) => handleChange(field.name, {
                  ...(values[field.name] as object ?? {}),
                  from: e.target.value || undefined,
                })}
                className="rounded-md border bg-background px-2 py-1.5 text-sm"
              />
              <span className="text-xs text-muted-foreground">–</span>
              <input
                type="date"
                value={String((values[field.name] as { to?: string })?.to ?? '')}
                onChange={(e) => handleChange(field.name, {
                  ...(values[field.name] as object ?? {}),
                  to: e.target.value || undefined,
                })}
                className="rounded-md border bg-background px-2 py-1.5 text-sm"
              />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
