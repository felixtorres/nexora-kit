import { describe, it, expect, beforeEach } from 'vitest';
import { ActionRouter } from './action-router.js';
import type { Message, ResponseBlock } from './types.js';

describe('ActionRouter', () => {
  let router: ActionRouter;

  beforeEach(() => {
    router = new ActionRouter();
  });

  it('registers actions from CardBlock', () => {
    const blocks: ResponseBlock[] = [
      {
        type: 'card',
        title: 'Order #1',
        actions: [
          { id: 'confirm-1', label: 'Confirm' },
          { id: 'cancel-1', label: 'Cancel' },
        ],
      },
    ];
    router.registerFromBlocks('conv-1', 'order-tool', blocks);

    expect(router.resolve('conv-1', 'confirm-1')).toEqual({ toolName: 'order-tool', actionId: 'confirm-1' });
    expect(router.resolve('conv-1', 'cancel-1')).toEqual({ toolName: 'order-tool', actionId: 'cancel-1' });
  });

  it('registers actions from ActionBlock', () => {
    const blocks: ResponseBlock[] = [
      {
        type: 'action',
        actions: [{ id: 'btn-save', label: 'Save' }],
      },
    ];
    router.registerFromBlocks('conv-1', 'save-tool', blocks);

    expect(router.resolve('conv-1', 'btn-save')).toEqual({ toolName: 'save-tool', actionId: 'btn-save' });
  });

  it('registers FormBlock by form id', () => {
    const blocks: ResponseBlock[] = [
      {
        type: 'form',
        id: 'feedback-form',
        fields: [{ name: 'rating', label: 'Rating', type: 'number' }],
      },
    ];
    router.registerFromBlocks('conv-1', 'feedback-tool', blocks);

    expect(router.resolve('conv-1', 'feedback-form')).toEqual({ toolName: 'feedback-tool', actionId: 'feedback-form' });
  });

  it('returns undefined for unknown actionId', () => {
    expect(router.resolve('conv-1', 'nonexistent')).toBeUndefined();
  });

  it('scopes mappings by conversationId', () => {
    const blocks: ResponseBlock[] = [
      { type: 'action', actions: [{ id: 'act-1', label: 'Act' }] },
    ];
    router.registerFromBlocks('conv-1', 'tool-a', blocks);

    expect(router.resolve('conv-1', 'act-1')).toBeDefined();
    expect(router.resolve('conv-2', 'act-1')).toBeUndefined();
  });

  it('clears mappings for a conversation', () => {
    router.registerFromBlocks('conv-1', 'tool-a', [
      { type: 'action', actions: [{ id: 'act-1', label: 'Act' }] },
    ]);

    router.clear('conv-1');
    expect(router.resolve('conv-1', 'act-1')).toBeUndefined();
  });

  it('ignores blocks without actions', () => {
    const blocks: ResponseBlock[] = [
      { type: 'text', content: 'hello' },
      { type: 'image', url: 'https://example.com/img.png' },
      { type: 'card', title: 'No actions' }, // card with no actions array
    ];
    router.registerFromBlocks('conv-1', 'tool-a', blocks);

    // No mappings created
    expect(router.resolve('conv-1', 'anything')).toBeUndefined();
  });

  it('rebuilds from messages', () => {
    const messages: Message[] = [
      { role: 'user', content: 'show order' },
      {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'tc-1', name: 'order-tool', input: {} },
        ],
      },
      {
        role: 'tool',
        content: [
          { type: 'tool_result', toolUseId: 'tc-1', content: 'order data' },
          {
            type: 'blocks',
            blocks: [
              {
                type: 'card',
                title: 'Order',
                actions: [{ id: 'confirm-order', label: 'Confirm' }],
              },
            ],
          },
        ],
      },
    ];

    router.rebuildFromMessages('conv-1', messages);

    expect(router.resolve('conv-1', 'confirm-order')).toEqual({
      toolName: 'order-tool',
      actionId: 'confirm-order',
    });
  });

  it('rebuild clears previous mappings first', () => {
    router.registerFromBlocks('conv-1', 'old-tool', [
      { type: 'action', actions: [{ id: 'old-act', label: 'Old' }] },
    ]);

    router.rebuildFromMessages('conv-1', []); // empty messages

    expect(router.resolve('conv-1', 'old-act')).toBeUndefined();
  });

  it('handles multiple tool messages in rebuild', () => {
    const messages: Message[] = [
      { role: 'user', content: 'go' },
      {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'tc-1', name: 'tool-a', input: {} },
          { type: 'tool_use', id: 'tc-2', name: 'tool-b', input: {} },
        ],
      },
      {
        role: 'tool',
        content: [
          { type: 'tool_result', toolUseId: 'tc-1', content: '' },
          { type: 'blocks', blocks: [{ type: 'action', actions: [{ id: 'a1', label: 'A1' }] }] },
        ],
      },
      {
        role: 'tool',
        content: [
          { type: 'tool_result', toolUseId: 'tc-2', content: '' },
          { type: 'blocks', blocks: [{ type: 'form', id: 'f1', fields: [{ name: 'x', label: 'X', type: 'text' }] }] },
        ],
      },
    ];

    router.rebuildFromMessages('conv-1', messages);

    expect(router.resolve('conv-1', 'a1')?.toolName).toBe('tool-a');
    expect(router.resolve('conv-1', 'f1')?.toolName).toBe('tool-b');
  });
});
