import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  agentCreateCommand,
  agentListCommand,
  agentGetCommand,
  agentUpdateCommand,
  agentDeleteCommand,
  agentBindCommand,
} from './cmd-agent.js';

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

describe('agent commands', () => {
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

  describe('agent create', () => {
    it('creates an agent with required fields', async () => {
      mockClient.post.mockResolvedValue({
        agent: { id: 'a1', slug: 'support', name: 'Support Agent', botId: 'b1' },
      });

      await agentCreateCommand.run({
        positionals: [],
        flags: {
          slug: 'support',
          name: 'Support Agent',
          bot: 'b1',
          strategy: 'single',
          config: 'test.yaml',
        },
      });

      expect(mockClient.post).toHaveBeenCalledWith('/admin/agents', {
        slug: 'support',
        name: 'Support Agent',
        botId: 'b1',
        orchestrationStrategy: 'single',
      });
    });

    it('passes rate limits', async () => {
      mockClient.post.mockResolvedValue({
        agent: { id: 'a1', slug: 'limited', name: 'Limited', botId: null },
      });

      await agentCreateCommand.run({
        positionals: [],
        flags: {
          slug: 'limited',
          name: 'Limited',
          'rate-limit-messages': '30',
          'rate-limit-conversations': '10',
          config: 'test.yaml',
        },
      });

      expect(mockClient.post).toHaveBeenCalledWith('/admin/agents', expect.objectContaining({
        rateLimits: { messagesPerMinute: 30, conversationsPerDay: 10 },
      }));
    });

    it('fails without required flags', async () => {
      await agentCreateCommand.run({
        positionals: [],
        flags: { slug: 'test', config: 'test.yaml' },
      });
      expect(process.exitCode).toBe(1);
      expect(mockClient.post).not.toHaveBeenCalled();
    });
  });

  describe('agent list', () => {
    it('displays agents in a table', async () => {
      mockClient.get.mockResolvedValue({
        agents: [
          { id: 'a1234567-full', slug: 'support', name: 'Support', orchestrationStrategy: 'single', enabled: true, createdAt: '2026-03-04' },
          { id: 'a2345678-full', slug: 'sales', name: 'Sales', orchestrationStrategy: 'orchestrate', enabled: false, createdAt: '2026-03-03' },
        ],
      });

      await agentListCommand.run({
        positionals: [],
        flags: { config: 'test.yaml' },
      });

      expect(mockClient.get).toHaveBeenCalledWith('/admin/agents');
      expect(logSpy).toHaveBeenCalled();
    });

    it('shows info message when no agents', async () => {
      mockClient.get.mockResolvedValue({ agents: [] });

      await agentListCommand.run({
        positionals: [],
        flags: { config: 'test.yaml' },
      });

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('No agents found'));
    });
  });

  describe('agent get', () => {
    it('displays agent details with bindings', async () => {
      mockClient.get.mockResolvedValue({
        agent: {
          id: 'a1',
          slug: 'support',
          name: 'Support Agent',
          description: 'Handles support',
          orchestrationStrategy: 'orchestrate',
          enabled: true,
          botId: 'b1',
          endUserAuth: { mode: 'token' },
          rateLimits: { messagesPerMinute: 30 },
          features: { artifacts: true, feedback: true },
          createdAt: '2026-03-04T10:00:00Z',
          updatedAt: '2026-03-04T10:00:00Z',
        },
        bindings: [
          { botId: 'b1234567-full', priority: 2, description: 'FAQ', keywords: ['help', 'faq'], createdAt: '2026-03-04', updatedAt: '2026-03-04' },
          { botId: 'b2345678-full', priority: 1, description: 'Sales', keywords: ['pricing'], createdAt: '2026-03-04', updatedAt: '2026-03-04' },
        ],
      });

      await agentGetCommand.run({
        positionals: ['a1'],
        flags: { config: 'test.yaml' },
      });

      expect(mockClient.get).toHaveBeenCalledWith('/admin/agents/a1');
      const allOutput = logSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
      expect(allOutput).toContain('Support Agent');
      expect(allOutput).toContain('orchestrate');
      expect(allOutput).toContain('token');
    });

    it('fails without id argument', async () => {
      await agentGetCommand.run({
        positionals: [],
        flags: { config: 'test.yaml' },
      });
      expect(process.exitCode).toBe(1);
    });
  });

  describe('agent update', () => {
    it('sends patch with provided fields', async () => {
      mockClient.patch.mockResolvedValue({
        agent: { id: 'a1', slug: 'support', name: 'Updated Agent' },
      });

      await agentUpdateCommand.run({
        positionals: ['a1'],
        flags: { name: 'Updated Agent', enabled: 'false', config: 'test.yaml' },
      });

      expect(mockClient.patch).toHaveBeenCalledWith('/admin/agents/a1', {
        name: 'Updated Agent',
        enabled: false,
      });
    });

    it('handles boolean enabled flag directly', async () => {
      mockClient.patch.mockResolvedValue({
        agent: { id: 'a1', slug: 'support', name: 'Agent' },
      });

      await agentUpdateCommand.run({
        positionals: ['a1'],
        flags: { enabled: true, config: 'test.yaml' },
      });

      expect(mockClient.patch).toHaveBeenCalledWith('/admin/agents/a1', {
        enabled: true,
      });
    });

    it('fails without any update flags', async () => {
      await agentUpdateCommand.run({
        positionals: ['a1'],
        flags: { config: 'test.yaml' },
      });
      expect(process.exitCode).toBe(1);
    });
  });

  describe('agent delete', () => {
    it('deletes an agent by id', async () => {
      mockClient.delete.mockResolvedValue(undefined);

      await agentDeleteCommand.run({
        positionals: ['a1'],
        flags: { config: 'test.yaml' },
      });

      expect(mockClient.delete).toHaveBeenCalledWith('/admin/agents/a1');
    });
  });

  describe('agent bind', () => {
    it('sets bindings with bot ids', async () => {
      mockClient.put.mockResolvedValue({
        bindings: [
          { botId: 'b1234567', priority: 2, keywords: [] },
          { botId: 'b2345678', priority: 1, keywords: [] },
        ],
      });

      await agentBindCommand.run({
        positionals: ['a1'],
        flags: { bots: 'b1,b2', config: 'test.yaml' },
      });

      expect(mockClient.put).toHaveBeenCalledWith('/admin/agents/a1/bindings', {
        bindings: [
          { botId: 'b1', priority: 2, keywords: [] },
          { botId: 'b2', priority: 1, keywords: [] },
        ],
      });
    });

    it('sets bindings with keywords', async () => {
      mockClient.put.mockResolvedValue({
        bindings: [
          { botId: 'b1', priority: 2, keywords: ['billing', 'payments'] },
          { botId: 'b2', priority: 1, keywords: ['tech'] },
        ],
      });

      await agentBindCommand.run({
        positionals: ['a1'],
        flags: { bots: 'b1,b2', keywords: 'billing,payments:tech', config: 'test.yaml' },
      });

      expect(mockClient.put).toHaveBeenCalledWith('/admin/agents/a1/bindings', {
        bindings: [
          { botId: 'b1', priority: 2, keywords: ['billing', 'payments'] },
          { botId: 'b2', priority: 1, keywords: ['tech'] },
        ],
      });
    });

    it('fails without required args', async () => {
      await agentBindCommand.run({
        positionals: [],
        flags: { config: 'test.yaml' },
      });
      expect(process.exitCode).toBe(1);
    });
  });
});
