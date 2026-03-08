import { z } from 'zod';
import type { ToolDefinition, Permission } from '@nexora-kit/core';
import type { ToolHandler } from '@nexora-kit/core';

export interface ToolExtension {
  name: string;
  description: string;
  parameters: ToolDefinition['parameters'];
  handler: ToolHandler;
  namespace?: string;
  sandbox?: {
    tier?: 'none' | 'basic' | 'strict';
    timeoutMs?: number;
  };
  permissions?: Permission[];
}

export const toolExtensionSchema = z.object({
  name: z.string().regex(
    /^[a-z][a-z0-9_-]*$/,
    'Tool name must start with a lowercase letter and contain only lowercase letters, digits, underscores, or hyphens',
  ),
  description: z.string().min(1),
  parameters: z.object({
    type: z.literal('object'),
    properties: z.record(z.any()),
    required: z.array(z.string()).optional(),
  }),
  handler: z.function(),
  namespace: z.string().optional(),
  sandbox: z.object({
    tier: z.enum(['none', 'basic', 'strict']).optional(),
    timeoutMs: z.number().positive().optional(),
  }).optional(),
  permissions: z.array(z.string()).optional(),
});

export const TOOLS_NAMESPACE = '__tools__';
