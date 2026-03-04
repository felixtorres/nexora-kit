import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Wso2AuthService } from './wso2-auth.js';
import { Wso2Provider } from './wso2.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const AUTH_URL = 'https://api-gateway.example.com/token';
const BASE_URL = 'https://api-gateway.example.com/t/org/openaiendpoint/1';
const CLIENT_ID = 'test-client-id';
const CLIENT_SECRET = 'test-client-secret';
const DEPLOYMENT_ID = 'gpt-4o-deployment';
const API_VERSION = '2024-12-01-preview';

function makeTokenResponse(expiresIn = 3600) {
  return {
    access_token: 'mock-access-token',
    token_type: 'Bearer',
    expires_in: expiresIn,
  };
}

function makeChatResponse(content = 'Hello from WSO2') {
  return {
    choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  };
}

// ---------------------------------------------------------------------------
// Wso2AuthService
// ---------------------------------------------------------------------------

describe('Wso2AuthService', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches a token using client_credentials grant', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(makeTokenResponse()), { status: 200 }),
    );

    const service = new Wso2AuthService({
      authUrl: AUTH_URL,
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
    });

    const token = await service.getAccessToken();
    expect(token).toBe('mock-access-token');

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(AUTH_URL);
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe(
      'application/x-www-form-urlencoded',
    );
    const body = init.body as string;
    expect(body).toContain('grant_type=client_credentials');
    expect(body).toContain(`client_id=${CLIENT_ID}`);
    expect(body).toContain(`client_secret=${CLIENT_SECRET}`);
  });

  it('caches the token and avoids a second fetch', async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify(makeTokenResponse(3600)), { status: 200 }),
    );

    const service = new Wso2AuthService({
      authUrl: AUTH_URL,
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
    });

    await service.getAccessToken();
    await service.getAccessToken();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('re-fetches after clearCachedToken()', async () => {
    // Each call needs its own Response instance — body can only be read once
    fetchSpy
      .mockResolvedValueOnce(new Response(JSON.stringify(makeTokenResponse(3600)), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify(makeTokenResponse(3600)), { status: 200 }),
      );

    const service = new Wso2AuthService({
      authUrl: AUTH_URL,
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
    });

    await service.getAccessToken();
    service.clearCachedToken();
    await service.getAccessToken();

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('throws when the token endpoint returns a non-200 status', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }));

    const service = new Wso2AuthService({
      authUrl: AUTH_URL,
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
    });

    await expect(service.getAccessToken()).rejects.toThrow('WSO2 authentication failed (HTTP 401)');
  });

  it('reports token status correctly', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(makeTokenResponse(3600)), { status: 200 }),
    );

    const service = new Wso2AuthService({
      authUrl: AUTH_URL,
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
    });

    expect(service.getTokenStatus()).toEqual({ cached: false });

    await service.getAccessToken();

    const status = service.getTokenStatus();
    expect(status.cached).toBe(true);
    if (status.cached) {
      expect(status.valid).toBe(true);
      expect(status.timeUntilExpirySeconds).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Wso2Provider
// ---------------------------------------------------------------------------

describe('Wso2Provider', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  function makeProvider(overrides: Partial<ConstructorParameters<typeof Wso2Provider>[0]> = {}) {
    return new Wso2Provider({
      authUrl: AUTH_URL,
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      baseUrl: BASE_URL,
      deploymentId: DEPLOYMENT_ID,
      apiVersion: API_VERSION,
      ...overrides,
    });
  }

  function mockFetchSequence(...responses: Response[]) {
    let idx = 0;
    fetchSpy.mockImplementation(() => Promise.resolve(responses[idx++]!));
  }

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('throws on construction when required options are missing', () => {
    // Env vars are not set in the test environment, so omitting authUrl throws at runtime
    expect(() => new Wso2Provider({})).toThrow('authUrl is required');
  });

  it('registers the deployment as a model entry', () => {
    const provider = makeProvider();
    expect(provider.models).toHaveLength(1);
    expect(provider.models[0]!.id).toBe(DEPLOYMENT_ID);
    expect(provider.models[0]!.provider).toBe('wso2-azure-openai');
  });

  it('performs a non-streaming chat call and yields LlmEvents', async () => {
    mockFetchSequence(
      new Response(JSON.stringify(makeTokenResponse()), { status: 200 }),
      new Response(JSON.stringify(makeChatResponse('Test response')), { status: 200 }),
    );

    const provider = makeProvider();
    const events: import('../types.js').LlmEvent[] = [];

    for await (const event of provider.chat({
      model: DEPLOYMENT_ID,
      messages: [{ role: 'user', content: 'Hello' }],
      stream: false,
    })) {
      events.push(event);
    }

    const textEvent = events.find((e) => e.type === 'text');
    expect(textEvent).toBeDefined();
    if (textEvent?.type === 'text') {
      expect(textEvent.content).toBe('Test response');
    }

    const usageEvent = events.find((e) => e.type === 'usage');
    expect(usageEvent).toBeDefined();
    if (usageEvent?.type === 'usage') {
      expect(usageEvent.inputTokens).toBe(10);
      expect(usageEvent.outputTokens).toBe(5);
    }

    expect(events[events.length - 1]!.type).toBe('done');
  });

  it('sends the correct URL with api-version query param', async () => {
    mockFetchSequence(
      new Response(JSON.stringify(makeTokenResponse()), { status: 200 }),
      new Response(JSON.stringify(makeChatResponse()), { status: 200 }),
    );

    const provider = makeProvider();
    for await (const _ of provider.chat({
      model: DEPLOYMENT_ID,
      messages: [{ role: 'user', content: 'hi' }],
      stream: false,
    })) {
      // consume
    }

    // Second fetch is the LLM call
    const [llmUrl, llmInit] = fetchSpy.mock.calls[1] as [string, RequestInit];
    expect(llmUrl).toContain(`/openai/deployments/${DEPLOYMENT_ID}/chat/completions`);
    expect(llmUrl).toContain(`api-version=${API_VERSION}`);
    expect((llmInit.headers as Record<string, string>)['Authorization']).toBe(
      'Bearer mock-access-token',
    );
  });

  it('throws on non-200 LLM response', async () => {
    mockFetchSequence(
      new Response(JSON.stringify(makeTokenResponse()), { status: 200 }),
      new Response('Internal Server Error', { status: 500 }),
    );

    const provider = makeProvider();

    await expect(async () => {
      for await (const _ of provider.chat({
        model: DEPLOYMENT_ID,
        messages: [{ role: 'user', content: 'hi' }],
        stream: false,
      })) {
        // consume
      }
    }).rejects.toThrow('WSO2 API error (HTTP 500)');
  });

  it('performs a streaming chat call and yields text chunks', async () => {
    const sseBody = [
      'data: {"choices":[{"delta":{"content":"Hello"},"finish_reason":null,"index":0}]}\n',
      'data: {"choices":[{"delta":{"content":" world"},"finish_reason":null,"index":0}]}\n',
      'data: [DONE]\n',
    ].join('\n');

    mockFetchSequence(
      new Response(JSON.stringify(makeTokenResponse()), { status: 200 }),
      new Response(sseBody, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }),
    );

    const provider = makeProvider();
    const textChunks: string[] = [];

    for await (const event of provider.chat({
      model: DEPLOYMENT_ID,
      messages: [{ role: 'user', content: 'stream test' }],
      stream: true,
    })) {
      if (event.type === 'text') textChunks.push(event.content);
    }

    expect(textChunks).toEqual(['Hello', ' world']);
  });

  it('estimates token count roughly', async () => {
    const provider = makeProvider();
    const count = await provider.countTokens([{ role: 'user', content: 'a'.repeat(400) }]);
    expect(count).toBe(100); // 400 chars / 4
  });

  it('throws when deploymentId is not configured', () => {
    expect(
      () =>
        new Wso2Provider({
          authUrl: AUTH_URL,
          clientId: CLIENT_ID,
          clientSecret: CLIENT_SECRET,
          baseUrl: BASE_URL,
          // deploymentId intentionally omitted
        }),
    ).toThrow('deploymentId is required');
  });

  it('emits both text and tool_calls from a single response', async () => {
    const responseWithBoth = {
      choices: [
        {
          message: {
            role: 'assistant',
            content: 'Let me check that.',
            tool_calls: [
              {
                id: 'call-1',
                type: 'function',
                function: { name: 'lookup', arguments: '{"q":"test"}' },
              },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    };

    mockFetchSequence(
      new Response(JSON.stringify(makeTokenResponse()), { status: 200 }),
      new Response(JSON.stringify(responseWithBoth), { status: 200 }),
    );

    const provider = makeProvider();
    const events: import('../types.js').LlmEvent[] = [];

    for await (const event of provider.chat({
      model: DEPLOYMENT_ID,
      messages: [{ role: 'user', content: 'Hello' }],
      stream: false,
      tools: [{ name: 'lookup', description: 'Look up info', parameters: { type: 'object', properties: { q: { type: 'string' } } } }],
    })) {
      events.push(event);
    }

    const textEvent = events.find((e) => e.type === 'text');
    expect(textEvent).toBeDefined();
    if (textEvent?.type === 'text') {
      expect(textEvent.content).toBe('Let me check that.');
    }

    const toolEvent = events.find((e) => e.type === 'tool_call');
    expect(toolEvent).toBeDefined();
    if (toolEvent?.type === 'tool_call') {
      expect(toolEvent.name).toBe('lookup');
    }
  });

  it('exposes tokenStatus and clearCachedToken', async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify(makeTokenResponse(3600)), { status: 200 }),
    );

    const provider = makeProvider();
    expect(provider.tokenStatus).toEqual({ cached: false });

    // Trigger a token fetch by doing a block call
    fetchSpy
      .mockResolvedValueOnce(new Response(JSON.stringify(makeTokenResponse(3600)), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(makeChatResponse()), { status: 200 }));

    for await (const _ of provider.chat({
      model: DEPLOYMENT_ID,
      messages: [{ role: 'user', content: 'hi' }],
      stream: false,
    })) {
      // consume
    }

    expect(provider.tokenStatus.cached).toBe(true);

    provider.clearCachedToken();
    expect(provider.tokenStatus).toEqual({ cached: false });
  });
});
