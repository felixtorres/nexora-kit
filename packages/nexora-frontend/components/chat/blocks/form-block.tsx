'use client';

import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { FormBlock as FormBlockType, FormField } from '@/lib/block-types';

interface FormBlockProps {
  block: FormBlockType;
  onAction: (actionId: string, payload: Record<string, unknown>) => void;
}

function FieldInput({
  field,
  value,
  onChange,
  disabled,
}: {
  field: FormField;
  value: unknown;
  onChange: (val: unknown) => void;
  disabled: boolean;
}) {
  switch (field.type) {
    case 'select':
      return (
        <select
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className="w-full rounded-md border bg-background px-3 py-2 text-sm"
        >
          <option value="">Select...</option>
          {field.options?.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      );
    case 'checkbox':
      return (
        <input
          type="checkbox"
          checked={!!value}
          onChange={(e) => onChange(e.target.checked)}
          disabled={disabled}
          className="size-4 rounded border"
        />
      );
    case 'textarea':
      return (
        <textarea
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          rows={3}
          className="w-full rounded-md border bg-background px-3 py-2 text-sm resize-none"
        />
      );
    case 'number':
      return (
        <Input
          type="number"
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.valueAsNumber)}
          disabled={disabled}
        />
      );
    default:
      return (
        <Input
          type="text"
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
        />
      );
  }
}

export function FormBlock({ block, onAction }: FormBlockProps) {
  const [values, setValues] = useState<Record<string, unknown>>(() => {
    const initial: Record<string, unknown> = {};
    for (const field of block.fields) {
      if (field.default != null) initial[field.name] = field.default;
    }
    return initial;
  });
  const [submitted, setSubmitted] = useState(false);

  const handleChange = useCallback((name: string, value: unknown) => {
    setValues((prev) => ({ ...prev, [name]: value }));
  }, []);

  const handleSubmit = useCallback(() => {
    setSubmitted(true);
    onAction(block.id, values);
  }, [block.id, values, onAction]);

  return (
    <div className="space-y-4 rounded-lg border bg-muted/20 p-4">
      {block.title && (
        <h4 className="text-sm font-semibold">{block.title}</h4>
      )}
      {block.fields.map((field) => (
        <div key={field.name} className="space-y-1.5">
          <Label className="text-sm">
            {field.label}
            {field.required && <span className="text-red-500 ml-0.5">*</span>}
          </Label>
          <FieldInput
            field={field}
            value={values[field.name]}
            onChange={(val) => handleChange(field.name, val)}
            disabled={submitted}
          />
        </div>
      ))}
      <Button size="sm" onClick={handleSubmit} disabled={submitted}>
        {submitted ? 'Submitted' : (block.submitLabel ?? 'Submit')}
      </Button>
    </div>
  );
}
