import { z } from 'zod';
import type { ResponseBlock } from './types.js';

export const MAX_BLOCKS_PER_MESSAGE = 20;

// --- Sub-type schemas ---

export const actionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  style: z.enum(['primary', 'secondary', 'danger']).optional(),
  payload: z.record(z.unknown()).optional(),
});

export const formFieldSchema = z.object({
  name: z.string().min(1),
  label: z.string().min(1),
  type: z.enum(['text', 'number', 'select', 'checkbox', 'textarea']),
  required: z.boolean().optional(),
  options: z.array(z.string()).optional(),
  default: z.unknown().optional(),
});

export const tableColumnSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
});

// --- Block schemas ---

export const textBlockSchema = z.object({
  type: z.literal('text'),
  content: z.string(),
});

export const cardBlockSchema = z.object({
  type: z.literal('card'),
  title: z.string().min(1),
  body: z.string().optional(),
  imageUrl: z.string().optional(),
  actions: z.array(actionSchema).optional(),
});

export const actionBlockSchema = z.object({
  type: z.literal('action'),
  actions: z.array(actionSchema).min(1),
});

export const suggestedRepliesBlockSchema = z.object({
  type: z.literal('suggested_replies'),
  replies: z.array(z.string()).min(1),
});

export const tableBlockSchema = z.object({
  type: z.literal('table'),
  columns: z.array(tableColumnSchema).min(1),
  rows: z.array(z.record(z.unknown())),
});

export const imageBlockSchema = z.object({
  type: z.literal('image'),
  url: z.string().min(1),
  alt: z.string().optional(),
});

export const codeBlockSchema = z.object({
  type: z.literal('code'),
  code: z.string(),
  language: z.string().optional(),
});

export const formBlockSchema = z.object({
  type: z.literal('form'),
  id: z.string().min(1),
  title: z.string().optional(),
  fields: z.array(formFieldSchema).min(1),
  submitLabel: z.string().optional(),
});

export const progressBlockSchema = z.object({
  type: z.literal('progress'),
  label: z.string().min(1),
  value: z.number().optional(),
  max: z.number().optional(),
});

export const customBlockSchema = z.object({
  type: z.string().regex(/^custom:.+/),
  data: z.unknown(),
});

export const responseBlockSchema = z.discriminatedUnion('type', [
  textBlockSchema,
  cardBlockSchema,
  actionBlockSchema,
  suggestedRepliesBlockSchema,
  tableBlockSchema,
  imageBlockSchema,
  codeBlockSchema,
  formBlockSchema,
  progressBlockSchema,
]).or(customBlockSchema);

/**
 * Validate an array of unknown values as ResponseBlocks.
 * Throws if any block is invalid or the array exceeds MAX_BLOCKS_PER_MESSAGE.
 */
export function validateBlocks(blocks: unknown[]): ResponseBlock[] {
  if (blocks.length > MAX_BLOCKS_PER_MESSAGE) {
    throw new Error(`Too many blocks: ${blocks.length} exceeds maximum of ${MAX_BLOCKS_PER_MESSAGE}`);
  }
  return blocks.map((block, i) => {
    const result = responseBlockSchema.safeParse(block);
    if (!result.success) {
      throw new Error(`Invalid block at index ${i}: ${result.error.issues[0].message}`);
    }
    return result.data as ResponseBlock;
  });
}

/**
 * Filter out transient blocks (ProgressBlock) that should not be persisted to storage.
 */
export function filterPersistableBlocks(blocks: ResponseBlock[]): ResponseBlock[] {
  return blocks.filter((b) => b.type !== 'progress');
}
