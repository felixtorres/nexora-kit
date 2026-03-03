import { describe, it, expect } from 'vitest';
import { createProviderFromConfig } from './factory.js';
import { AnthropicProvider } from './providers/anthropic.js';
import { Wso2Provider } from './providers/wso2.js';
import type { LlmMessage } from './types.js';

describe('createProviderFromConfig', () => {
  describe('stub provider', () => {
    it('returns a stub provider when config is undefined', () => {
      const provider = createProviderFromConfig(undefined);
      expect(provider.name).toBe('stub');
    });

    it('returns a stub provider when provider is "stub"', () => {
      const provider = createProviderFromConfig({ provider: 'stub' });
      expect(provider.name).toBe('stub');
    });

    it('returns a stub provider when provider is not specified', () => {
      const provider = createProviderFromConfig({});
      expect(provider.name).toBe('stub');
    });

    it('stub provider has at least one model', () => {
      const provider = createProviderFromConfig();
      expect(provider.models.length).toBeGreaterThan(0);
    });

    it('stub provider chat yields a helpful message', async () => {
      const provider = createProviderFromConfig();
      const req = { model: 'stub', messages: [] as LlmMessage[], stream: false };
      const chunks: string[] = [];
      for await (const chunk of provider.chat(req)) {
        if (chunk.type === 'text') chunks.push(chunk.content);
      }
      expect(chunks.join('')).toMatch(/not configured/i);
    });

    it('stub provider countTokens returns 0', async () => {
      const provider = createProviderFromConfig();
      const messages: LlmMessage[] = [];
      const count = await provider.countTokens(messages);
      expect(count).toBe(0);
    });
  });

  describe('anthropic provider', () => {
    it('returns an AnthropicProvider instance', () => {
      const provider = createProviderFromConfig({
        provider: 'anthropic',
        apiKey: 'test-key',
      });
      expect(provider).toBeInstanceOf(AnthropicProvider);
    });

    it('has name "anthropic"', () => {
      const provider = createProviderFromConfig({
        provider: 'anthropic',
        apiKey: 'test-key',
      });
      expect(provider.name).toBe('anthropic');
    });

    it('accepts optional model and maxTokens', () => {
      const provider = createProviderFromConfig({
        provider: 'anthropic',
        apiKey: 'test-key',
        model: 'claude-3-5-sonnet-20241022',
        defaultMaxTokens: 2048,
      });
      expect(provider).toBeInstanceOf(AnthropicProvider);
    });
  });

  describe('wso2-azure-openai provider', () => {
    it('returns a Wso2Provider instance', () => {
      const provider = createProviderFromConfig({
        provider: 'wso2-azure-openai',
        wso2ClientId: 'test-client',
        wso2ClientSecret: 'test-secret',
        wso2AuthUrl: 'https://auth.example.com/token',
        wso2BaseUrl: 'https://gateway.example.com',
        wso2DeploymentId: 'gpt-4o',
      });
      expect(provider).toBeInstanceOf(Wso2Provider);
    });

    it('has name "wso2-azure-openai"', () => {
      const provider = createProviderFromConfig({
        provider: 'wso2-azure-openai',
        wso2AuthUrl: 'https://auth.example.com/token',
        wso2ClientId: 'id',
        wso2ClientSecret: 'secret',
        wso2BaseUrl: 'https://gateway.example.com',
        wso2DeploymentId: 'gpt-4o',
      });
      expect(provider.name).toBe('wso2-azure-openai');
    });

    it('accepts all optional wso2 fields', () => {
      const provider = createProviderFromConfig({
        provider: 'wso2-azure-openai',
        wso2ClientId: 'id',
        wso2ClientSecret: 'secret',
        wso2AuthUrl: 'https://auth.example.com/token',
        wso2BaseUrl: 'https://gateway.example.com',
        wso2DeploymentId: 'gpt-4o',
        wso2ApiVersion: '2024-12-01-preview',
        defaultMaxTokens: 8192,
      });
      expect(provider).toBeInstanceOf(Wso2Provider);
    });
  });

  describe('unknown provider', () => {
    it('throws a descriptive error for unknown provider names', () => {
      expect(() => createProviderFromConfig({ provider: 'openai' } as never)).toThrow(
        /Unknown LLM provider "openai"/,
      );
    });

    it('error message lists valid options', () => {
      expect(() => createProviderFromConfig({ provider: 'bedrock' } as never)).toThrow(
        /anthropic.*wso2-azure-openai.*stub/,
      );
    });
  });
});
