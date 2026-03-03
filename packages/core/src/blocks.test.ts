import { describe, it, expect } from 'vitest';
import {
  responseBlockSchema,
  validateBlocks,
  filterPersistableBlocks,
  MAX_BLOCKS_PER_MESSAGE,
  actionSchema,
  formFieldSchema,
  textBlockSchema,
  cardBlockSchema,
  actionBlockSchema,
  suggestedRepliesBlockSchema,
  tableBlockSchema,
  imageBlockSchema,
  codeBlockSchema,
  formBlockSchema,
  progressBlockSchema,
  customBlockSchema,
} from './blocks.js';

describe('Block Zod schemas', () => {
  it('validates TextBlock', () => {
    const result = textBlockSchema.safeParse({ type: 'text', content: 'Hello' });
    expect(result.success).toBe(true);
  });

  it('validates CardBlock with actions', () => {
    const result = cardBlockSchema.safeParse({
      type: 'card',
      title: 'Order #123',
      body: 'Your order is ready',
      actions: [{ id: 'confirm', label: 'Confirm', style: 'primary' }],
    });
    expect(result.success).toBe(true);
  });

  it('validates CardBlock minimal (title only)', () => {
    const result = cardBlockSchema.safeParse({ type: 'card', title: 'Simple' });
    expect(result.success).toBe(true);
  });

  it('validates ActionBlock', () => {
    const result = actionBlockSchema.safeParse({
      type: 'action',
      actions: [{ id: 'btn-1', label: 'Click me' }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects ActionBlock with empty actions', () => {
    const result = actionBlockSchema.safeParse({ type: 'action', actions: [] });
    expect(result.success).toBe(false);
  });

  it('validates SuggestedRepliesBlock', () => {
    const result = suggestedRepliesBlockSchema.safeParse({
      type: 'suggested_replies',
      replies: ['Yes', 'No', 'Maybe'],
    });
    expect(result.success).toBe(true);
  });

  it('validates TableBlock', () => {
    const result = tableBlockSchema.safeParse({
      type: 'table',
      columns: [{ key: 'name', label: 'Name' }, { key: 'age', label: 'Age' }],
      rows: [{ name: 'Alice', age: 30 }, { name: 'Bob', age: 25 }],
    });
    expect(result.success).toBe(true);
  });

  it('validates ImageBlock', () => {
    const result = imageBlockSchema.safeParse({
      type: 'image',
      url: 'https://example.com/img.png',
      alt: 'A photo',
    });
    expect(result.success).toBe(true);
  });

  it('validates CodeBlock', () => {
    const result = codeBlockSchema.safeParse({
      type: 'code',
      code: 'console.log("hi")',
      language: 'javascript',
    });
    expect(result.success).toBe(true);
  });

  it('validates FormBlock', () => {
    const result = formBlockSchema.safeParse({
      type: 'form',
      id: 'feedback-form',
      title: 'Feedback',
      fields: [
        { name: 'rating', label: 'Rating', type: 'number', required: true },
        { name: 'comment', label: 'Comment', type: 'textarea' },
      ],
      submitLabel: 'Send',
    });
    expect(result.success).toBe(true);
  });

  it('validates ProgressBlock', () => {
    const result = progressBlockSchema.safeParse({
      type: 'progress',
      label: 'Processing...',
      value: 50,
      max: 100,
    });
    expect(result.success).toBe(true);
  });

  it('validates CustomBlock with custom: prefix', () => {
    const result = customBlockSchema.safeParse({
      type: 'custom:myapp/widget',
      data: { foo: 'bar' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects CustomBlock without custom: prefix', () => {
    const result = customBlockSchema.safeParse({ type: 'widget', data: {} });
    expect(result.success).toBe(false);
  });
});

describe('responseBlockSchema (discriminated union)', () => {
  it('parses all 9 standard block types', () => {
    const blocks = [
      { type: 'text', content: 'hi' },
      { type: 'card', title: 'Card' },
      { type: 'action', actions: [{ id: 'a', label: 'A' }] },
      { type: 'suggested_replies', replies: ['Yes'] },
      { type: 'table', columns: [{ key: 'k', label: 'K' }], rows: [] },
      { type: 'image', url: 'https://example.com/img.png' },
      { type: 'code', code: 'x = 1' },
      { type: 'form', id: 'f1', fields: [{ name: 'x', label: 'X', type: 'text' }] },
      { type: 'progress', label: 'Loading' },
    ];
    for (const block of blocks) {
      expect(responseBlockSchema.safeParse(block).success).toBe(true);
    }
  });

  it('parses custom blocks via fallback', () => {
    const result = responseBlockSchema.safeParse({ type: 'custom:ns/chart', data: [1, 2, 3] });
    expect(result.success).toBe(true);
  });

  it('rejects block with unknown type', () => {
    const result = responseBlockSchema.safeParse({ type: 'unknown', content: 'hi' });
    expect(result.success).toBe(false);
  });

  it('rejects block missing required fields', () => {
    const result = responseBlockSchema.safeParse({ type: 'card' }); // missing title
    expect(result.success).toBe(false);
  });
});

describe('Action schema', () => {
  it('validates action with payload', () => {
    const result = actionSchema.safeParse({ id: 'buy', label: 'Buy', style: 'primary', payload: { itemId: '123' } });
    expect(result.success).toBe(true);
  });

  it('rejects action without id', () => {
    const result = actionSchema.safeParse({ label: 'Buy' });
    expect(result.success).toBe(false);
  });
});

describe('FormField schema', () => {
  it('validates select field with options', () => {
    const result = formFieldSchema.safeParse({ name: 'color', label: 'Color', type: 'select', options: ['red', 'blue'] });
    expect(result.success).toBe(true);
  });

  it('rejects field with invalid type', () => {
    const result = formFieldSchema.safeParse({ name: 'x', label: 'X', type: 'date' });
    expect(result.success).toBe(false);
  });
});

describe('validateBlocks', () => {
  it('validates an array of valid blocks', () => {
    const blocks = validateBlocks([
      { type: 'text', content: 'Hello' },
      { type: 'card', title: 'Info' },
    ]);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].type).toBe('text');
  });

  it('throws on invalid block in array', () => {
    expect(() => validateBlocks([{ type: 'card' }])).toThrow('Invalid block at index 0');
  });

  it('throws when exceeding MAX_BLOCKS_PER_MESSAGE', () => {
    const blocks = Array.from({ length: MAX_BLOCKS_PER_MESSAGE + 1 }, () => ({ type: 'text', content: 'x' }));
    expect(() => validateBlocks(blocks)).toThrow('Too many blocks');
  });

  it('accepts exactly MAX_BLOCKS_PER_MESSAGE blocks', () => {
    const blocks = Array.from({ length: MAX_BLOCKS_PER_MESSAGE }, () => ({ type: 'text', content: 'x' }));
    expect(validateBlocks(blocks)).toHaveLength(MAX_BLOCKS_PER_MESSAGE);
  });
});

describe('filterPersistableBlocks', () => {
  it('strips ProgressBlock from array', () => {
    const blocks = filterPersistableBlocks([
      { type: 'text', content: 'done' },
      { type: 'progress', label: 'Loading', value: 50, max: 100 },
      { type: 'card', title: 'Result' },
    ]);
    expect(blocks).toHaveLength(2);
    expect(blocks.every((b) => b.type !== 'progress')).toBe(true);
  });

  it('returns all blocks when no ProgressBlock present', () => {
    const input = [
      { type: 'text' as const, content: 'a' },
      { type: 'text' as const, content: 'b' },
    ];
    expect(filterPersistableBlocks(input)).toEqual(input);
  });

  it('returns empty array when all blocks are progress', () => {
    const blocks = filterPersistableBlocks([
      { type: 'progress', label: 'A' },
      { type: 'progress', label: 'B' },
    ]);
    expect(blocks).toHaveLength(0);
  });
});
