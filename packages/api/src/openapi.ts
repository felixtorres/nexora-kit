/**
 * OpenAPI 3.1 spec builder for the NexoraKit API.
 * Hand-mapped (no external deps).
 */

export function buildOpenApiSpec(prefix: string = '/v1'): Record<string, unknown> {
  return {
    openapi: '3.1.0',
    info: {
      title: 'NexoraKit API',
      version: '1.0.0',
      description: 'Enterprise chatbot platform API — plugin-based, provider-agnostic LLM.',
    },
    paths: {
      [`${prefix}/health`]: {
        get: {
          summary: 'Health check',
          operationId: 'getHealth',
          tags: ['system'],
          responses: {
            200: {
              description: 'Service is healthy',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/HealthResponse' } } },
            },
          },
        },
      },
      [`${prefix}/metrics`]: {
        get: {
          summary: 'Request metrics',
          operationId: 'getMetrics',
          tags: ['system'],
          security: [{ bearerAuth: [] }],
          responses: {
            200: {
              description: 'Metrics snapshot',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/MetricsSnapshot' } } },
            },
            401: { $ref: '#/components/responses/Unauthorized' },
          },
        },
      },
      [`${prefix}/chat`]: {
        post: {
          summary: 'Send a chat message',
          operationId: 'postChat',
          tags: ['chat'],
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ChatRequest' } } },
          },
          responses: {
            200: {
              description: 'Chat response with events',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/ChatResponse' } } },
            },
            401: { $ref: '#/components/responses/Unauthorized' },
            429: { $ref: '#/components/responses/RateLimited' },
          },
        },
      },
      [`${prefix}/plugins`]: {
        get: {
          summary: 'List installed plugins',
          operationId: 'listPlugins',
          tags: ['plugins'],
          security: [{ bearerAuth: [] }],
          responses: {
            200: {
              description: 'Plugin list',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/PluginList' } } },
            },
            401: { $ref: '#/components/responses/Unauthorized' },
          },
        },
      },
      [`${prefix}/plugins/{name}`]: {
        get: {
          summary: 'Get plugin details',
          operationId: 'getPlugin',
          tags: ['plugins'],
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: 'name', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            200: {
              description: 'Plugin details',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/PluginDetail' } } },
            },
            401: { $ref: '#/components/responses/Unauthorized' },
            404: { $ref: '#/components/responses/NotFound' },
          },
        },
      },
      [`${prefix}/admin/plugins/{name}/enable`]: {
        post: {
          summary: 'Enable a plugin',
          operationId: 'enablePlugin',
          tags: ['admin'],
          security: [{ bearerAuth: [] }],
          parameters: [{ name: 'name', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            200: { description: 'Plugin enabled' },
            401: { $ref: '#/components/responses/Unauthorized' },
            403: { $ref: '#/components/responses/Forbidden' },
          },
        },
      },
      [`${prefix}/admin/plugins/{name}/disable`]: {
        post: {
          summary: 'Disable a plugin',
          operationId: 'disablePlugin',
          tags: ['admin'],
          security: [{ bearerAuth: [] }],
          parameters: [{ name: 'name', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            200: { description: 'Plugin disabled' },
            401: { $ref: '#/components/responses/Unauthorized' },
            403: { $ref: '#/components/responses/Forbidden' },
          },
        },
      },
      [`${prefix}/admin/audit-log`]: {
        get: {
          summary: 'Query audit log',
          operationId: 'getAuditLog',
          tags: ['admin'],
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: 'actor', in: 'query', schema: { type: 'string' } },
            { name: 'action', in: 'query', schema: { type: 'string' } },
            { name: 'since', in: 'query', schema: { type: 'string', format: 'date-time' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1 } },
          ],
          responses: {
            200: { description: 'Audit events' },
            401: { $ref: '#/components/responses/Unauthorized' },
            403: { $ref: '#/components/responses/Forbidden' },
          },
        },
      },
      [`${prefix}/admin/usage`]: {
        get: {
          summary: 'Query usage analytics',
          operationId: 'getUsage',
          tags: ['admin'],
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: 'breakdown', in: 'query', schema: { type: 'string', enum: ['plugin', 'daily'] } },
            { name: 'since', in: 'query', schema: { type: 'string', format: 'date-time' } },
            { name: 'pluginName', in: 'query', schema: { type: 'string' } },
          ],
          responses: {
            200: { description: 'Usage data' },
            401: { $ref: '#/components/responses/Unauthorized' },
            403: { $ref: '#/components/responses/Forbidden' },
          },
        },
      },
    },
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT or API Key',
        },
      },
      schemas: {
        HealthResponse: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['healthy'] },
          },
          required: ['status'],
        },
        MetricsSnapshot: {
          type: 'object',
          properties: {
            uptime_seconds: { type: 'integer' },
            requests_total: { type: 'integer' },
            requests_by_status: { type: 'object', additionalProperties: { type: 'integer' } },
            requests_by_method: { type: 'object', additionalProperties: { type: 'integer' } },
            active_connections: { type: 'integer' },
            avg_latency_ms: { type: 'integer' },
            p95_latency_ms: { type: 'integer' },
          },
        },
        ChatRequest: {
          type: 'object',
          properties: {
            message: { type: 'string', minLength: 1, maxLength: 100000 },
            sessionId: { type: 'string' },
            pluginNamespaces: { type: 'array', items: { type: 'string' } },
            metadata: { type: 'object', additionalProperties: true },
          },
          required: ['message'],
        },
        ChatResponse: {
          type: 'object',
          properties: {
            message: { type: 'string' },
            sessionId: { type: 'string' },
            events: { type: 'array', items: { type: 'object' } },
          },
        },
        PluginList: {
          type: 'object',
          properties: {
            plugins: {
              type: 'array',
              items: { $ref: '#/components/schemas/PluginSummary' },
            },
          },
        },
        PluginSummary: {
          type: 'object',
          properties: {
            namespace: { type: 'string' },
            name: { type: 'string' },
            version: { type: 'string' },
            state: { type: 'string' },
          },
        },
        PluginDetail: {
          type: 'object',
          properties: {
            namespace: { type: 'string' },
            name: { type: 'string' },
            version: { type: 'string' },
            description: { type: 'string' },
            state: { type: 'string' },
            tools: { type: 'array', items: { type: 'object' } },
          },
        },
        Error: {
          type: 'object',
          properties: {
            error: {
              type: 'object',
              properties: {
                message: { type: 'string' },
                code: { type: 'string' },
              },
              required: ['message'],
            },
          },
        },
      },
      responses: {
        Unauthorized: {
          description: 'Authentication required',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
        Forbidden: {
          description: 'Admin access required',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
        NotFound: {
          description: 'Resource not found',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
        RateLimited: {
          description: 'Rate limit exceeded',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
          headers: {
            'Retry-After': { schema: { type: 'integer' } },
          },
        },
      },
    },
  };
}
