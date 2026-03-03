/**
 * OpenAPI 3.1 spec builder for the NexoraKit API.
 * Hand-mapped (no external deps).
 */

export function buildOpenApiSpec(prefix: string = '/v1'): Record<string, unknown> {
  return {
    openapi: '3.1.0',
    info: {
      title: 'NexoraKit API',
      version: '2.0.0',
      description: 'Enterprise chatbot platform API — conversation-based, plugin-driven, provider-agnostic LLM.',
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

      // --- Conversations ---

      [`${prefix}/conversations`]: {
        post: {
          summary: 'Create a conversation',
          operationId: 'createConversation',
          tags: ['conversations'],
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: false,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateConversationRequest' } } },
          },
          responses: {
            201: {
              description: 'Conversation created',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/ConversationRecord' } } },
            },
            401: { $ref: '#/components/responses/Unauthorized' },
            429: { $ref: '#/components/responses/RateLimited' },
          },
        },
        get: {
          summary: 'List conversations',
          operationId: 'listConversations',
          tags: ['conversations'],
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } },
            { name: 'cursor', in: 'query', schema: { type: 'string' } },
          ],
          responses: {
            200: {
              description: 'Paginated conversation list',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/ConversationList' } } },
            },
            401: { $ref: '#/components/responses/Unauthorized' },
          },
        },
      },
      [`${prefix}/conversations/{id}`]: {
        get: {
          summary: 'Get a conversation',
          operationId: 'getConversation',
          tags: ['conversations'],
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            200: {
              description: 'Conversation details',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/ConversationRecord' } } },
            },
            401: { $ref: '#/components/responses/Unauthorized' },
            404: { $ref: '#/components/responses/NotFound' },
          },
        },
        patch: {
          summary: 'Update a conversation',
          operationId: 'updateConversation',
          tags: ['conversations'],
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/UpdateConversationRequest' } } },
          },
          responses: {
            200: {
              description: 'Conversation updated',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/ConversationRecord' } } },
            },
            401: { $ref: '#/components/responses/Unauthorized' },
            404: { $ref: '#/components/responses/NotFound' },
          },
        },
        delete: {
          summary: 'Delete a conversation',
          operationId: 'deleteConversation',
          tags: ['conversations'],
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            204: { description: 'Conversation deleted' },
            401: { $ref: '#/components/responses/Unauthorized' },
            404: { $ref: '#/components/responses/NotFound' },
          },
        },
      },
      [`${prefix}/conversations/{id}/messages`]: {
        post: {
          summary: 'Send a message to a conversation',
          operationId: 'sendMessage',
          tags: ['conversations'],
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/SendMessageRequest' } } },
          },
          responses: {
            200: {
              description: 'Message response with events',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/MessageResponse' } } },
            },
            401: { $ref: '#/components/responses/Unauthorized' },
            404: { $ref: '#/components/responses/NotFound' },
            429: { $ref: '#/components/responses/RateLimited' },
          },
        },
      },

      // --- Legacy chat ---

      [`${prefix}/chat`]: {
        post: {
          summary: 'Send a chat message (legacy)',
          operationId: 'postChat',
          tags: ['chat'],
          deprecated: true,
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ChatRequest' } } },
          },
          responses: {
            200: {
              description: 'Chat response with events',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/MessageResponse' } } },
            },
            401: { $ref: '#/components/responses/Unauthorized' },
            429: { $ref: '#/components/responses/RateLimited' },
          },
        },
      },

      // --- Plugins ---

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

      // --- Admin ---

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
            status: { type: 'string', enum: ['healthy', 'degraded'] },
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
        ChatInput: {
          oneOf: [
            { type: 'string', minLength: 1, maxLength: 100000 },
            { type: 'object', properties: { type: { const: 'text' }, text: { type: 'string' } }, required: ['type', 'text'] },
            { type: 'object', properties: { type: { const: 'action' }, actionId: { type: 'string' }, payload: { type: 'object' } }, required: ['type', 'actionId', 'payload'] },
            { type: 'object', properties: { type: { const: 'file' }, fileId: { type: 'string' }, text: { type: 'string' } }, required: ['type', 'fileId'] },
          ],
        },
        CreateConversationRequest: {
          type: 'object',
          properties: {
            title: { type: 'string', maxLength: 200 },
            systemPrompt: { type: 'string', maxLength: 50000 },
            templateId: { type: 'string' },
            workspaceId: { type: 'string' },
            model: { type: 'string' },
            agentId: { type: 'string' },
            pluginNamespaces: { type: 'array', items: { type: 'string' } },
            metadata: { type: 'object', additionalProperties: true },
          },
        },
        UpdateConversationRequest: {
          type: 'object',
          properties: {
            title: { type: 'string', maxLength: 200 },
            metadata: { type: 'object', additionalProperties: true },
          },
        },
        SendMessageRequest: {
          type: 'object',
          properties: {
            input: { $ref: '#/components/schemas/ChatInput' },
            pluginNamespaces: { type: 'array', items: { type: 'string' } },
            metadata: { type: 'object', additionalProperties: true },
          },
          required: ['input'],
        },
        ConversationRecord: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            teamId: { type: 'string' },
            userId: { type: 'string' },
            title: { type: 'string', nullable: true },
            systemPrompt: { type: 'string', nullable: true },
            templateId: { type: 'string', nullable: true },
            workspaceId: { type: 'string', nullable: true },
            model: { type: 'string', nullable: true },
            agentId: { type: 'string', nullable: true },
            pluginNamespaces: { type: 'array', items: { type: 'string' } },
            messageCount: { type: 'integer' },
            lastMessageAt: { type: 'string', nullable: true },
            metadata: { type: 'object', additionalProperties: true },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
            deletedAt: { type: 'string', format: 'date-time', nullable: true },
          },
        },
        ConversationList: {
          type: 'object',
          properties: {
            items: { type: 'array', items: { $ref: '#/components/schemas/ConversationRecord' } },
            nextCursor: { type: 'string', nullable: true },
          },
        },
        ChatRequest: {
          type: 'object',
          properties: {
            input: { $ref: '#/components/schemas/ChatInput' },
            conversationId: { type: 'string' },
            pluginNamespaces: { type: 'array', items: { type: 'string' } },
            metadata: { type: 'object', additionalProperties: true },
          },
          required: ['input'],
        },
        MessageResponse: {
          type: 'object',
          properties: {
            conversationId: { type: 'string' },
            message: { type: 'string' },
            blocks: { type: 'array', items: { $ref: '#/components/schemas/ResponseBlock' } },
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
        Action: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            label: { type: 'string' },
            style: { type: 'string', enum: ['primary', 'secondary', 'danger'] },
            payload: { type: 'object', additionalProperties: true },
          },
          required: ['id', 'label'],
        },
        FormField: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            label: { type: 'string' },
            type: { type: 'string', enum: ['text', 'number', 'select', 'checkbox', 'textarea'] },
            required: { type: 'boolean' },
            options: { type: 'array', items: { type: 'string' } },
            default: {},
          },
          required: ['name', 'label', 'type'],
        },
        TableColumn: {
          type: 'object',
          properties: {
            key: { type: 'string' },
            label: { type: 'string' },
          },
          required: ['key', 'label'],
        },
        ResponseBlock: {
          oneOf: [
            { type: 'object', properties: { type: { const: 'text' }, content: { type: 'string' } }, required: ['type', 'content'] },
            { type: 'object', properties: { type: { const: 'card' }, title: { type: 'string' }, body: { type: 'string' }, imageUrl: { type: 'string' }, actions: { type: 'array', items: { $ref: '#/components/schemas/Action' } } }, required: ['type', 'title'] },
            { type: 'object', properties: { type: { const: 'action' }, actions: { type: 'array', items: { $ref: '#/components/schemas/Action' } } }, required: ['type', 'actions'] },
            { type: 'object', properties: { type: { const: 'suggested_replies' }, replies: { type: 'array', items: { type: 'string' } } }, required: ['type', 'replies'] },
            { type: 'object', properties: { type: { const: 'table' }, columns: { type: 'array', items: { $ref: '#/components/schemas/TableColumn' } }, rows: { type: 'array', items: { type: 'object' } } }, required: ['type', 'columns', 'rows'] },
            { type: 'object', properties: { type: { const: 'image' }, url: { type: 'string' }, alt: { type: 'string' } }, required: ['type', 'url'] },
            { type: 'object', properties: { type: { const: 'code' }, code: { type: 'string' }, language: { type: 'string' } }, required: ['type', 'code'] },
            { type: 'object', properties: { type: { const: 'form' }, id: { type: 'string' }, title: { type: 'string' }, fields: { type: 'array', items: { $ref: '#/components/schemas/FormField' } }, submitLabel: { type: 'string' } }, required: ['type', 'id', 'fields'] },
            { type: 'object', properties: { type: { const: 'progress' }, label: { type: 'string' }, value: { type: 'number' }, max: { type: 'number' } }, required: ['type', 'label'] },
            { type: 'object', properties: { type: { type: 'string', pattern: '^custom:.+' }, data: {} }, required: ['type', 'data'] },
          ],
          discriminator: { propertyName: 'type' },
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
