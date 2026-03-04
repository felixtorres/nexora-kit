import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  botCreateCommand,
  botListCommand,
  botGetCommand,
  botUpdateCommand,
  botDeleteCommand,
} from './cmd-bot.js';

const { mockClient } = vi.hoisted(() => ({
  mockClient: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('./api-client.js', () => ({
  ApiClient: vi.fn(),
  ApiError: class extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
      this.name = 'ApiError';
    }
  },
  createClientFromConfig: vi.fn().mockResolvedValue(mockClient),
  handleApiError: vi.fn(() => { process.exitCode = 1; }),
}));

describe('bot commands', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    errSpy.mockRestore();
    vi.clearAllMocks();
    process.exitCode = undefined;
  });

  describe('bot create', () => {
    it('creates a bot with required fields', async () => {
      mockClient.post.mockResolvedValue({
        bot: { id: 'b1', name: 'My Bot', model: 'claude-sonnet-4-6' },
      });

      await botCreateCommand.run({
        positionals: [],
        flags: {
          name: 'My Bot',
          model: 'claude-sonnet-4-6',
          'system-prompt': 'You are helpful',
          config: 'test.yaml',
        },
      });

      expect(mockClient.post).toHaveBeenCalledWith('/admin/bots', {
        name: 'My Bot',
        model: 'claude-sonnet-4-6',
        systemPrompt: 'You are helpful',
      });
    });

    it('passes optional fields', async () => {
      mockClient.post.mockResolvedValue({
        bot: { id: 'b1', name: 'My Bot', model: 'claude-sonnet-4-6' },
      });

      await botCreateCommand.run({
        positionals: [],
        flags: {
          name: 'My Bot',
          model: 'claude-sonnet-4-6',
          'system-prompt': 'Helpful',
          plugins: 'faq,onboarding',
          temperature: '0.7',
          'max-turns': '10',
          config: 'test.yaml',
        },
      });

      expect(mockClient.post).toHaveBeenCalledWith('/admin/bots', {
        name: 'My Bot',
        model: 'claude-sonnet-4-6',
        systemPrompt: 'Helpful',
        pluginNamespaces: ['faq', 'onboarding'],
        temperature: 0.7,
        maxTurns: 10,
      });
    });

    it('fails without required flags', async () => {
      await botCreateCommand.run({
        positionals: [],
        flags: { name: 'My Bot', config: 'test.yaml' },
      });

      expect(process.exitCode).toBe(1);
      expect(mockClient.post).not.toHaveBeenCalled();
    });
  });

  describe('bot list', () => {
    it('displays bots in a table', async () => {
      mockClient.get.mockResolvedValue({
        bots: [
          { id: 'b1234567-full', name: 'FAQ Bot', model: 'claude-sonnet-4-6', pluginNamespaces: ['faq'], createdAt: '2026-03-04T10:00:00Z' },
          { id: 'b2345678-full', name: 'Helper', model: 'gpt-4o', pluginNamespaces: [], createdAt: '2026-03-03T10:00:00Z' },
        ],
      });

      await botListCommand.run({
        positionals: [],
        flags: { config: 'test.yaml' },
      });

      expect(mockClient.get).toHaveBeenCalledWith('/admin/bots');
      // Verify table was rendered (console.log called multiple times)
      expect(logSpy).toHaveBeenCalled();
    });

    it('shows info message when no bots', async () => {
      mockClient.get.mockResolvedValue({ bots: [] });

      await botListCommand.run({
        positionals: [],
        flags: { config: 'test.yaml' },
      });

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('No bots found'));
    });
  });

  describe('bot get', () => {
    it('displays bot details', async () => {
      mockClient.get.mockResolvedValue({
        bot: {
          id: 'b1',
          name: 'FAQ Bot',
          model: 'claude-sonnet-4-6',
          description: 'A FAQ bot',
          systemPrompt: 'You answer FAQs',
          pluginNamespaces: ['faq'],
          temperature: 0.5,
          maxTurns: 5,
          createdAt: '2026-03-04T10:00:00Z',
          updatedAt: '2026-03-04T10:00:00Z',
        },
      });

      await botGetCommand.run({
        positionals: ['b1'],
        flags: { config: 'test.yaml' },
      });

      expect(mockClient.get).toHaveBeenCalledWith('/admin/bots/b1');
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('FAQ Bot'));
    });

    it('fails without id argument', async () => {
      await botGetCommand.run({
        positionals: [],
        flags: { config: 'test.yaml' },
      });
      expect(process.exitCode).toBe(1);
    });
  });

  describe('bot update', () => {
    it('sends patch with provided fields', async () => {
      mockClient.patch.mockResolvedValue({
        bot: { id: 'b1', name: 'Updated Bot', model: 'claude-sonnet-4-6' },
      });

      await botUpdateCommand.run({
        positionals: ['b1'],
        flags: { name: 'Updated Bot', model: 'gpt-4o', config: 'test.yaml' },
      });

      expect(mockClient.patch).toHaveBeenCalledWith('/admin/bots/b1', {
        name: 'Updated Bot',
        model: 'gpt-4o',
      });
    });

    it('fails without any update flags', async () => {
      await botUpdateCommand.run({
        positionals: ['b1'],
        flags: { config: 'test.yaml' },
      });
      expect(process.exitCode).toBe(1);
    });

    it('fails without id argument', async () => {
      await botUpdateCommand.run({
        positionals: [],
        flags: { name: 'Updated', config: 'test.yaml' },
      });
      expect(process.exitCode).toBe(1);
    });
  });

  describe('bot delete', () => {
    it('deletes a bot by id', async () => {
      mockClient.delete.mockResolvedValue(undefined);

      await botDeleteCommand.run({
        positionals: ['b1'],
        flags: { config: 'test.yaml' },
      });

      expect(mockClient.delete).toHaveBeenCalledWith('/admin/bots/b1');
    });

    it('fails without id argument', async () => {
      await botDeleteCommand.run({
        positionals: [],
        flags: { config: 'test.yaml' },
      });
      expect(process.exitCode).toBe(1);
    });
  });
});
