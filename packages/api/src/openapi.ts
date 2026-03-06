/**
 * OpenAPI 3.1 spec builder for the NexoraKit API.
 * Hand-mapped (no external deps).
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

const idParam = (name: string) => ({ name, in: 'path' as const, required: true, schema: { type: 'string' } });

const authResponses = {
  401: { $ref: '#/components/responses/Unauthorized' },
};

const adminResponses = {
  401: { $ref: '#/components/responses/Unauthorized' },
  403: { $ref: '#/components/responses/Forbidden' },
};

const notFoundResp = { 404: { $ref: '#/components/responses/NotFound' } };
const rateLimitResp = { 429: { $ref: '#/components/responses/RateLimited' } };
const noContent = { 204: { description: 'Deleted' } };
const jsonContent = (ref: string) => ({ 'application/json': { schema: { $ref: `#/components/schemas/${ref}` } } });
const jsonBody = (ref: string, required = true) => ({ required, content: jsonContent(ref) });

export function buildOpenApiSpec(prefix: string = '/v1'): Record<string, unknown> {
  return {
    openapi: '3.1.0',
    info: {
      title: 'NexoraKit API',
      version: '2.0.0',
      description: 'Enterprise chatbot platform API — conversation-based, plugin-driven, provider-agnostic LLM.',
    },
    paths: {
      // --- System ---

      [`${prefix}/health`]: {
        get: {
          summary: 'Health check',
          operationId: 'getHealth',
          tags: ['system'],
          responses: {
            200: { description: 'Service is healthy', content: jsonContent('HealthResponse') },
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
            200: { description: 'Metrics snapshot', content: jsonContent('MetricsSnapshot') },
            ...authResponses,
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
          requestBody: jsonBody('CreateConversationRequest', false),
          responses: {
            201: { description: 'Conversation created', content: jsonContent('ConversationRecord') },
            ...authResponses,
            ...rateLimitResp,
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
            200: { description: 'Paginated conversation list', content: jsonContent('ConversationList') },
            ...authResponses,
          },
        },
      },
      [`${prefix}/conversations/{id}`]: {
        get: {
          summary: 'Get a conversation',
          operationId: 'getConversation',
          tags: ['conversations'],
          security: [{ bearerAuth: [] }],
          parameters: [idParam('id')],
          responses: {
            200: { description: 'Conversation details', content: jsonContent('ConversationRecord') },
            ...authResponses,
            ...notFoundResp,
          },
        },
        patch: {
          summary: 'Update a conversation',
          operationId: 'updateConversation',
          tags: ['conversations'],
          security: [{ bearerAuth: [] }],
          parameters: [idParam('id')],
          requestBody: jsonBody('UpdateConversationRequest'),
          responses: {
            200: { description: 'Conversation updated', content: jsonContent('ConversationRecord') },
            ...authResponses,
            ...notFoundResp,
          },
        },
        delete: {
          summary: 'Delete a conversation',
          operationId: 'deleteConversation',
          tags: ['conversations'],
          security: [{ bearerAuth: [] }],
          parameters: [idParam('id')],
          responses: {
            ...noContent,
            ...authResponses,
            ...notFoundResp,
          },
        },
      },
      [`${prefix}/conversations/{id}/messages`]: {
        get: {
          summary: 'List messages in a conversation',
          operationId: 'listMessages',
          tags: ['conversations'],
          security: [{ bearerAuth: [] }],
          parameters: [idParam('id')],
          responses: {
            200: { description: 'Message list', content: jsonContent('MessageList') },
            ...authResponses,
            ...notFoundResp,
          },
        },
        post: {
          summary: 'Send a message to a conversation',
          operationId: 'sendMessage',
          tags: ['conversations'],
          security: [{ bearerAuth: [] }],
          parameters: [idParam('id')],
          requestBody: jsonBody('SendMessageRequest'),
          responses: {
            200: { description: 'Message response with events', content: jsonContent('MessageResponse') },
            ...authResponses,
            ...notFoundResp,
            ...rateLimitResp,
          },
        },
      },

      // --- Message Edit & Regenerate ---

      [`${prefix}/conversations/{id}/messages/{seq}`]: {
        put: {
          summary: 'Edit a message',
          operationId: 'editMessage',
          tags: ['conversations'],
          security: [{ bearerAuth: [] }],
          parameters: [idParam('id'), { name: 'seq', in: 'path', required: true, schema: { type: 'integer' } }],
          requestBody: jsonBody('EditMessageRequest'),
          responses: {
            200: { description: 'Edited message response', content: jsonContent('MessageResponse') },
            ...authResponses,
            ...notFoundResp,
          },
        },
      },
      [`${prefix}/conversations/{id}/messages/{seq}/regenerate`]: {
        post: {
          summary: 'Regenerate a message',
          operationId: 'regenerateMessage',
          tags: ['conversations'],
          security: [{ bearerAuth: [] }],
          parameters: [idParam('id'), { name: 'seq', in: 'path', required: true, schema: { type: 'integer' } }],
          responses: {
            200: { description: 'Regenerated message response', content: jsonContent('MessageResponse') },
            ...authResponses,
            ...notFoundResp,
          },
        },
      },

      // --- Feedback ---

      [`${prefix}/conversations/{id}/messages/{seq}/feedback`]: {
        post: {
          summary: 'Submit feedback on a message',
          operationId: 'submitFeedback',
          tags: ['feedback'],
          security: [{ bearerAuth: [] }],
          parameters: [idParam('id'), { name: 'seq', in: 'path', required: true, schema: { type: 'integer' } }],
          requestBody: jsonBody('SubmitFeedbackRequest'),
          responses: {
            200: { description: 'Feedback recorded', content: jsonContent('FeedbackRecord') },
            ...authResponses,
          },
        },
      },

      // --- Files ---

      [`${prefix}/files`]: {
        post: {
          summary: 'Upload a file',
          operationId: 'uploadFile',
          tags: ['files'],
          security: [{ bearerAuth: [] }],
          requestBody: jsonBody('UploadFileRequest'),
          responses: {
            201: { description: 'File uploaded', content: jsonContent('FileRecord') },
            ...authResponses,
          },
        },
      },
      [`${prefix}/files/{id}`]: {
        get: {
          summary: 'Get file metadata',
          operationId: 'getFile',
          tags: ['files'],
          security: [{ bearerAuth: [] }],
          parameters: [idParam('id')],
          responses: {
            200: { description: 'File metadata', content: jsonContent('FileRecord') },
            ...authResponses,
            ...notFoundResp,
          },
        },
        delete: {
          summary: 'Delete a file',
          operationId: 'deleteFile',
          tags: ['files'],
          security: [{ bearerAuth: [] }],
          parameters: [idParam('id')],
          responses: {
            ...noContent,
            ...authResponses,
            ...notFoundResp,
          },
        },
      },
      [`${prefix}/files/{id}/content`]: {
        get: {
          summary: 'Download file content',
          operationId: 'downloadFile',
          tags: ['files'],
          security: [{ bearerAuth: [] }],
          parameters: [idParam('id')],
          responses: {
            200: { description: 'File content (base64)', content: jsonContent('FileContent') },
            ...authResponses,
            ...notFoundResp,
          },
        },
      },
      [`${prefix}/conversations/{id}/files`]: {
        get: {
          summary: 'List files in a conversation',
          operationId: 'listConversationFiles',
          tags: ['files'],
          security: [{ bearerAuth: [] }],
          parameters: [idParam('id')],
          responses: {
            200: { description: 'File list', content: jsonContent('FileList') },
            ...authResponses,
          },
        },
      },

      // --- Artifacts ---

      [`${prefix}/conversations/{id}/artifacts`]: {
        get: {
          summary: 'List artifacts in a conversation',
          operationId: 'listArtifacts',
          tags: ['artifacts'],
          security: [{ bearerAuth: [] }],
          parameters: [idParam('id')],
          responses: {
            200: { description: 'Artifact list', content: jsonContent('ArtifactList') },
            ...authResponses,
          },
        },
      },
      [`${prefix}/conversations/{id}/artifacts/{artifactId}`]: {
        get: {
          summary: 'Get an artifact',
          operationId: 'getArtifact',
          tags: ['artifacts'],
          security: [{ bearerAuth: [] }],
          parameters: [idParam('id'), idParam('artifactId')],
          responses: {
            200: { description: 'Artifact details', content: jsonContent('ArtifactRecord') },
            ...authResponses,
            ...notFoundResp,
          },
        },
        delete: {
          summary: 'Delete an artifact',
          operationId: 'deleteArtifact',
          tags: ['artifacts'],
          security: [{ bearerAuth: [] }],
          parameters: [idParam('id'), idParam('artifactId')],
          responses: {
            ...noContent,
            ...authResponses,
            ...notFoundResp,
          },
        },
      },
      [`${prefix}/conversations/{id}/artifacts/{artifactId}/versions`]: {
        get: {
          summary: 'List artifact versions',
          operationId: 'listArtifactVersions',
          tags: ['artifacts'],
          security: [{ bearerAuth: [] }],
          parameters: [idParam('id'), idParam('artifactId')],
          responses: {
            200: { description: 'Version list', content: jsonContent('ArtifactVersionList') },
            ...authResponses,
            ...notFoundResp,
          },
        },
      },
      [`${prefix}/conversations/{id}/artifacts/{artifactId}/versions/{version}`]: {
        get: {
          summary: 'Get a specific artifact version',
          operationId: 'getArtifactVersion',
          tags: ['artifacts'],
          security: [{ bearerAuth: [] }],
          parameters: [idParam('id'), idParam('artifactId'), { name: 'version', in: 'path', required: true, schema: { type: 'integer' } }],
          responses: {
            200: { description: 'Artifact version', content: jsonContent('ArtifactVersionRecord') },
            ...authResponses,
            ...notFoundResp,
          },
        },
      },

      // --- User Memory ---

      [`${prefix}/me/memory`]: {
        get: {
          summary: 'List user memory facts',
          operationId: 'listMemory',
          tags: ['memory'],
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: 'namespace', in: 'query', schema: { type: 'string' } },
          ],
          responses: {
            200: { description: 'Memory facts', content: jsonContent('MemoryFactList') },
            ...authResponses,
          },
        },
        delete: {
          summary: 'Delete all user memory',
          operationId: 'deleteAllMemory',
          tags: ['memory'],
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: 'confirm', in: 'query', required: true, schema: { type: 'string', enum: ['true'] } },
          ],
          responses: {
            ...noContent,
            ...authResponses,
          },
        },
      },
      [`${prefix}/me/memory/{key}`]: {
        delete: {
          summary: 'Delete a memory fact',
          operationId: 'deleteMemoryFact',
          tags: ['memory'],
          security: [{ bearerAuth: [] }],
          parameters: [idParam('key')],
          responses: {
            ...noContent,
            ...authResponses,
          },
        },
      },

      // --- Templates ---

      [`${prefix}/templates`]: {
        get: {
          summary: 'List conversation templates',
          operationId: 'listTemplates',
          tags: ['templates'],
          security: [{ bearerAuth: [] }],
          responses: {
            200: { description: 'Template list', content: jsonContent('TemplateList') },
            ...authResponses,
          },
        },
      },
      [`${prefix}/templates/{id}`]: {
        get: {
          summary: 'Get a template',
          operationId: 'getTemplate',
          tags: ['templates'],
          security: [{ bearerAuth: [] }],
          parameters: [idParam('id')],
          responses: {
            200: { description: 'Template details', content: jsonContent('ConversationTemplateRecord') },
            ...authResponses,
            ...notFoundResp,
          },
        },
      },

      // --- Workspaces ---

      [`${prefix}/workspaces`]: {
        get: {
          summary: 'List workspaces',
          operationId: 'listWorkspaces',
          tags: ['workspaces'],
          security: [{ bearerAuth: [] }],
          responses: {
            200: { description: 'Workspace list', content: jsonContent('WorkspaceList') },
            ...authResponses,
          },
        },
      },
      [`${prefix}/workspaces/{id}`]: {
        get: {
          summary: 'Get a workspace',
          operationId: 'getWorkspace',
          tags: ['workspaces'],
          security: [{ bearerAuth: [] }],
          parameters: [idParam('id')],
          responses: {
            200: { description: 'Workspace details', content: jsonContent('WorkspaceRecord') },
            ...authResponses,
            ...notFoundResp,
          },
        },
      },
      [`${prefix}/workspaces/{id}/documents`]: {
        get: {
          summary: 'List documents in a workspace',
          operationId: 'listDocuments',
          tags: ['workspaces'],
          security: [{ bearerAuth: [] }],
          parameters: [idParam('id')],
          responses: {
            200: { description: 'Document list', content: jsonContent('DocumentList') },
            ...authResponses,
          },
        },
      },

      // --- Legacy Chat ---

      [`${prefix}/chat`]: {
        post: {
          summary: 'Send a chat message (legacy)',
          operationId: 'postChat',
          tags: ['chat'],
          deprecated: true,
          security: [{ bearerAuth: [] }],
          requestBody: jsonBody('ChatRequest'),
          responses: {
            200: { description: 'Chat response with events', content: jsonContent('MessageResponse') },
            ...authResponses,
            ...rateLimitResp,
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
            200: { description: 'Plugin list', content: jsonContent('PluginList') },
            ...authResponses,
          },
        },
      },
      [`${prefix}/plugins/{name}`]: {
        get: {
          summary: 'Get plugin details',
          operationId: 'getPlugin',
          tags: ['plugins'],
          security: [{ bearerAuth: [] }],
          parameters: [idParam('name')],
          responses: {
            200: { description: 'Plugin details', content: jsonContent('PluginDetail') },
            ...authResponses,
            ...notFoundResp,
          },
        },
      },

      // --- Admin: Plugins ---

      [`${prefix}/admin/plugins/{name}/enable`]: {
        post: {
          summary: 'Enable a plugin',
          operationId: 'enablePlugin',
          tags: ['admin'],
          security: [{ bearerAuth: [] }],
          parameters: [idParam('name')],
          responses: {
            200: { description: 'Plugin enabled' },
            ...adminResponses,
          },
        },
      },
      [`${prefix}/admin/plugins/{name}/disable`]: {
        post: {
          summary: 'Disable a plugin',
          operationId: 'disablePlugin',
          tags: ['admin'],
          security: [{ bearerAuth: [] }],
          parameters: [idParam('name')],
          responses: {
            200: { description: 'Plugin disabled' },
            ...adminResponses,
          },
        },
      },
      [`${prefix}/admin/plugins/{name}`]: {
        delete: {
          summary: 'Uninstall a plugin',
          operationId: 'uninstallPlugin',
          tags: ['admin'],
          security: [{ bearerAuth: [] }],
          parameters: [idParam('name')],
          responses: {
            ...noContent,
            ...adminResponses,
          },
        },
      },

      // --- Admin: Audit & Usage ---

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
            ...adminResponses,
          },
        },
      },
      [`${prefix}/admin/audit-log/purge`]: {
        post: {
          summary: 'Purge old audit events',
          operationId: 'purgeAuditLog',
          tags: ['admin'],
          security: [{ bearerAuth: [] }],
          requestBody: jsonBody('PurgeAuditLogRequest'),
          responses: {
            200: { description: 'Audit log purged' },
            ...adminResponses,
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
            ...adminResponses,
          },
        },
      },

      // --- Admin: Feedback ---

      [`${prefix}/admin/feedback`]: {
        get: {
          summary: 'Query feedback',
          operationId: 'queryFeedback',
          tags: ['admin'],
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: 'pluginNamespace', in: 'query', schema: { type: 'string' } },
            { name: 'rating', in: 'query', schema: { type: 'string', enum: ['positive', 'negative'] } },
            { name: 'from', in: 'query', schema: { type: 'string', format: 'date-time' } },
            { name: 'to', in: 'query', schema: { type: 'string', format: 'date-time' } },
            { name: 'cursor', in: 'query', schema: { type: 'string' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } },
          ],
          responses: {
            200: { description: 'Paginated feedback list', content: jsonContent('FeedbackList') },
            ...adminResponses,
          },
        },
      },
      [`${prefix}/admin/feedback/summary`]: {
        get: {
          summary: 'Get feedback summary',
          operationId: 'getFeedbackSummary',
          tags: ['admin'],
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: 'pluginNamespace', in: 'query', schema: { type: 'string' } },
            { name: 'model', in: 'query', schema: { type: 'string' } },
            { name: 'from', in: 'query', schema: { type: 'string', format: 'date-time' } },
            { name: 'to', in: 'query', schema: { type: 'string', format: 'date-time' } },
          ],
          responses: {
            200: { description: 'Aggregated feedback stats', content: jsonContent('FeedbackSummary') },
            ...adminResponses,
          },
        },
      },

      // --- Admin: Bots ---

      [`${prefix}/admin/bots`]: {
        post: {
          summary: 'Create a bot',
          operationId: 'createBot',
          tags: ['bots'],
          security: [{ bearerAuth: [] }],
          requestBody: jsonBody('CreateBotRequest'),
          responses: {
            201: { description: 'Bot created', content: jsonContent('BotRecord') },
            ...adminResponses,
          },
        },
        get: {
          summary: 'List bots',
          operationId: 'listBots',
          tags: ['bots'],
          security: [{ bearerAuth: [] }],
          responses: {
            200: { description: 'Bot list', content: jsonContent('BotList') },
            ...adminResponses,
          },
        },
      },
      [`${prefix}/admin/bots/{id}`]: {
        get: {
          summary: 'Get a bot',
          operationId: 'getBot',
          tags: ['bots'],
          security: [{ bearerAuth: [] }],
          parameters: [idParam('id')],
          responses: {
            200: { description: 'Bot details', content: jsonContent('BotRecord') },
            ...adminResponses,
            ...notFoundResp,
          },
        },
        patch: {
          summary: 'Update a bot',
          operationId: 'updateBot',
          tags: ['bots'],
          security: [{ bearerAuth: [] }],
          parameters: [idParam('id')],
          requestBody: jsonBody('UpdateBotRequest'),
          responses: {
            200: { description: 'Bot updated', content: jsonContent('BotRecord') },
            ...adminResponses,
            ...notFoundResp,
          },
        },
        delete: {
          summary: 'Delete a bot',
          operationId: 'deleteBot',
          tags: ['bots'],
          security: [{ bearerAuth: [] }],
          parameters: [idParam('id')],
          responses: {
            ...noContent,
            ...adminResponses,
            ...notFoundResp,
          },
        },
      },

      // --- Admin: Agents ---

      [`${prefix}/admin/agents`]: {
        post: {
          summary: 'Create an agent',
          operationId: 'createAgent',
          tags: ['agents'],
          security: [{ bearerAuth: [] }],
          requestBody: jsonBody('CreateAgentRequest'),
          responses: {
            201: { description: 'Agent created', content: jsonContent('AgentRecord') },
            ...adminResponses,
          },
        },
        get: {
          summary: 'List agents',
          operationId: 'listAgents',
          tags: ['agents'],
          security: [{ bearerAuth: [] }],
          responses: {
            200: { description: 'Agent list', content: jsonContent('AgentList') },
            ...adminResponses,
          },
        },
      },
      [`${prefix}/admin/agents/{id}`]: {
        get: {
          summary: 'Get an agent',
          operationId: 'getAgent',
          tags: ['agents'],
          security: [{ bearerAuth: [] }],
          parameters: [idParam('id')],
          responses: {
            200: { description: 'Agent details with bindings', content: jsonContent('AgentWithBindings') },
            ...adminResponses,
            ...notFoundResp,
          },
        },
        patch: {
          summary: 'Update an agent',
          operationId: 'updateAgent',
          tags: ['agents'],
          security: [{ bearerAuth: [] }],
          parameters: [idParam('id')],
          requestBody: jsonBody('UpdateAgentRequest'),
          responses: {
            200: { description: 'Agent updated', content: jsonContent('AgentRecord') },
            ...adminResponses,
            ...notFoundResp,
          },
        },
        delete: {
          summary: 'Delete an agent',
          operationId: 'deleteAgent',
          tags: ['agents'],
          security: [{ bearerAuth: [] }],
          parameters: [idParam('id')],
          responses: {
            ...noContent,
            ...adminResponses,
            ...notFoundResp,
          },
        },
      },
      [`${prefix}/admin/agents/{id}/bindings`]: {
        put: {
          summary: 'Replace agent-bot bindings',
          operationId: 'replaceBindings',
          tags: ['agents'],
          security: [{ bearerAuth: [] }],
          parameters: [idParam('id')],
          requestBody: jsonBody('ReplaceBindingsRequest'),
          responses: {
            200: { description: 'Bindings replaced', content: jsonContent('BindingList') },
            ...adminResponses,
            ...notFoundResp,
          },
        },
      },
      [`${prefix}/admin/agents/{id}/end-users`]: {
        get: {
          summary: 'List end users for an agent',
          operationId: 'listEndUsers',
          tags: ['agents'],
          security: [{ bearerAuth: [] }],
          parameters: [idParam('id')],
          responses: {
            200: { description: 'End user list', content: jsonContent('EndUserList') },
            ...adminResponses,
          },
        },
      },

      // --- Admin: Templates ---

      [`${prefix}/admin/templates`]: {
        post: {
          summary: 'Create a conversation template',
          operationId: 'createTemplate',
          tags: ['admin'],
          security: [{ bearerAuth: [] }],
          requestBody: jsonBody('CreateTemplateRequest'),
          responses: {
            201: { description: 'Template created', content: jsonContent('ConversationTemplateRecord') },
            ...adminResponses,
          },
        },
      },
      [`${prefix}/admin/templates/{id}`]: {
        patch: {
          summary: 'Update a template',
          operationId: 'updateTemplate',
          tags: ['admin'],
          security: [{ bearerAuth: [] }],
          parameters: [idParam('id')],
          requestBody: jsonBody('UpdateTemplateRequest'),
          responses: {
            200: { description: 'Template updated', content: jsonContent('ConversationTemplateRecord') },
            ...adminResponses,
            ...notFoundResp,
          },
        },
        delete: {
          summary: 'Delete a template',
          operationId: 'deleteTemplate',
          tags: ['admin'],
          security: [{ bearerAuth: [] }],
          parameters: [idParam('id')],
          responses: {
            ...noContent,
            ...adminResponses,
            ...notFoundResp,
          },
        },
      },

      // --- Admin: Workspaces & Documents ---

      [`${prefix}/admin/workspaces`]: {
        post: {
          summary: 'Create a workspace',
          operationId: 'createWorkspace',
          tags: ['admin'],
          security: [{ bearerAuth: [] }],
          requestBody: jsonBody('CreateWorkspaceRequest'),
          responses: {
            201: { description: 'Workspace created', content: jsonContent('WorkspaceRecord') },
            ...adminResponses,
          },
        },
      },
      [`${prefix}/admin/workspaces/{id}`]: {
        patch: {
          summary: 'Update a workspace',
          operationId: 'updateWorkspace',
          tags: ['admin'],
          security: [{ bearerAuth: [] }],
          parameters: [idParam('id')],
          requestBody: jsonBody('UpdateWorkspaceRequest'),
          responses: {
            200: { description: 'Workspace updated', content: jsonContent('WorkspaceRecord') },
            ...adminResponses,
            ...notFoundResp,
          },
        },
        delete: {
          summary: 'Delete a workspace',
          operationId: 'deleteWorkspace',
          tags: ['admin'],
          security: [{ bearerAuth: [] }],
          parameters: [idParam('id')],
          responses: {
            ...noContent,
            ...adminResponses,
            ...notFoundResp,
          },
        },
      },
      [`${prefix}/admin/workspaces/{id}/documents`]: {
        post: {
          summary: 'Create a document in a workspace',
          operationId: 'createDocument',
          tags: ['admin'],
          security: [{ bearerAuth: [] }],
          parameters: [idParam('id')],
          requestBody: jsonBody('CreateDocumentRequest'),
          responses: {
            201: { description: 'Document created', content: jsonContent('ContextDocumentRecord') },
            ...adminResponses,
          },
        },
      },
      [`${prefix}/admin/workspaces/{wsId}/documents/{docId}`]: {
        patch: {
          summary: 'Update a document',
          operationId: 'updateDocument',
          tags: ['admin'],
          security: [{ bearerAuth: [] }],
          parameters: [idParam('wsId'), idParam('docId')],
          requestBody: jsonBody('UpdateDocumentRequest'),
          responses: {
            200: { description: 'Document updated', content: jsonContent('ContextDocumentRecord') },
            ...adminResponses,
            ...notFoundResp,
          },
        },
        delete: {
          summary: 'Delete a document',
          operationId: 'deleteDocument',
          tags: ['admin'],
          security: [{ bearerAuth: [] }],
          parameters: [idParam('wsId'), idParam('docId')],
          responses: {
            ...noContent,
            ...adminResponses,
            ...notFoundResp,
          },
        },
      },

      // --- Client API ---

      [`${prefix}/agents/{slug}`]: {
        get: {
          summary: 'Get agent appearance (client)',
          operationId: 'getAgentAppearance',
          tags: ['client'],
          parameters: [idParam('slug')],
          responses: {
            200: { description: 'Agent public info', content: jsonContent('AgentAppearance') },
            ...notFoundResp,
          },
        },
      },
      [`${prefix}/agents/{slug}/conversations`]: {
        post: {
          summary: 'Create a conversation (client)',
          operationId: 'clientCreateConversation',
          tags: ['client'],
          parameters: [idParam('slug')],
          responses: {
            201: { description: 'Conversation created', content: jsonContent('ConversationRecord') },
            ...rateLimitResp,
          },
        },
        get: {
          summary: 'List conversations (client)',
          operationId: 'clientListConversations',
          tags: ['client'],
          parameters: [idParam('slug')],
          responses: {
            200: { description: 'Conversation list', content: jsonContent('ConversationList') },
          },
        },
      },
      [`${prefix}/agents/{slug}/conversations/{id}`]: {
        get: {
          summary: 'Get a conversation (client)',
          operationId: 'clientGetConversation',
          tags: ['client'],
          parameters: [idParam('slug'), idParam('id')],
          responses: {
            200: { description: 'Conversation details', content: jsonContent('ConversationRecord') },
            ...notFoundResp,
          },
        },
      },
      [`${prefix}/agents/{slug}/conversations/{id}/messages`]: {
        post: {
          summary: 'Send a message (client)',
          operationId: 'clientSendMessage',
          tags: ['client'],
          parameters: [idParam('slug'), idParam('id')],
          requestBody: jsonBody('SendMessageRequest'),
          responses: {
            200: { description: 'Message response', content: jsonContent('MessageResponse') },
            ...notFoundResp,
            ...rateLimitResp,
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
        // --- System ---
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

        // --- Chat / Messages ---
        ChatInput: {
          oneOf: [
            { type: 'string', minLength: 1, maxLength: 100000 },
            { type: 'object', properties: { type: { const: 'text' }, text: { type: 'string' } }, required: ['type', 'text'] },
            { type: 'object', properties: { type: { const: 'action' }, actionId: { type: 'string' }, payload: { type: 'object' } }, required: ['type', 'actionId', 'payload'] },
            { type: 'object', properties: { type: { const: 'file' }, fileId: { type: 'string' }, text: { type: 'string' } }, required: ['type', 'fileId'] },
          ],
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
        EditMessageRequest: {
          type: 'object',
          properties: {
            input: { $ref: '#/components/schemas/ChatInput' },
          },
          required: ['input'],
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
          },
        },
        MessageList: {
          type: 'object',
          properties: {
            messages: { type: 'array', items: { $ref: '#/components/schemas/Message' } },
          },
        },
        Message: {
          type: 'object',
          properties: {
            role: { type: 'string', enum: ['user', 'assistant'] },
            content: { type: 'string' },
            blocks: { type: 'array', items: { $ref: '#/components/schemas/ResponseBlock' } },
          },
        },

        // --- Conversations ---
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

        // --- Plugins ---
        PluginList: {
          type: 'object',
          properties: {
            plugins: { type: 'array', items: { $ref: '#/components/schemas/PluginSummary' } },
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

        // --- Bots ---
        CreateBotRequest: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            description: { type: 'string' },
            systemPrompt: { type: 'string' },
            model: { type: 'string' },
            pluginNamespaces: { type: 'array', items: { type: 'string' } },
            temperature: { type: 'number', minimum: 0, maximum: 2 },
            maxTurns: { type: 'integer', minimum: 1, maximum: 100 },
            workspaceId: { type: 'string', nullable: true },
            metadata: { type: 'object', additionalProperties: true },
          },
          required: ['name', 'systemPrompt', 'model'],
        },
        UpdateBotRequest: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            description: { type: 'string' },
            systemPrompt: { type: 'string' },
            model: { type: 'string' },
            pluginNamespaces: { type: 'array', items: { type: 'string' } },
            temperature: { type: 'number', minimum: 0, maximum: 2 },
            maxTurns: { type: 'integer', minimum: 1, maximum: 100 },
            workspaceId: { type: 'string', nullable: true },
            metadata: { type: 'object', additionalProperties: true },
          },
        },
        BotRecord: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            teamId: { type: 'string' },
            name: { type: 'string' },
            description: { type: 'string', nullable: true },
            systemPrompt: { type: 'string' },
            model: { type: 'string' },
            pluginNamespaces: { type: 'array', items: { type: 'string' } },
            temperature: { type: 'number' },
            maxTurns: { type: 'integer' },
            workspaceId: { type: 'string', nullable: true },
            metadata: { type: 'object', additionalProperties: true },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        BotList: {
          type: 'object',
          properties: {
            bots: { type: 'array', items: { $ref: '#/components/schemas/BotRecord' } },
          },
        },

        // --- Agents ---
        CreateAgentRequest: {
          type: 'object',
          properties: {
            slug: { type: 'string', pattern: '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$', maxLength: 60 },
            name: { type: 'string' },
            description: { type: 'string' },
            orchestrationStrategy: { type: 'string', enum: ['single', 'route', 'orchestrate'] },
            orchestratorModel: { type: 'string' },
            orchestratorPrompt: { type: 'string' },
            botId: { type: 'string', nullable: true },
            fallbackBotId: { type: 'string', nullable: true },
            endUserAuth: { $ref: '#/components/schemas/EndUserAuthConfig' },
            rateLimits: { $ref: '#/components/schemas/AgentRateLimits' },
            appearance: { $ref: '#/components/schemas/AgentAppearance' },
            features: { type: 'object', additionalProperties: { type: 'boolean' } },
            enabled: { type: 'boolean' },
          },
          required: ['slug', 'name'],
        },
        UpdateAgentRequest: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            description: { type: 'string' },
            orchestrationStrategy: { type: 'string', enum: ['single', 'route', 'orchestrate'] },
            orchestratorModel: { type: 'string' },
            orchestratorPrompt: { type: 'string' },
            botId: { type: 'string', nullable: true },
            fallbackBotId: { type: 'string', nullable: true },
            endUserAuth: { $ref: '#/components/schemas/EndUserAuthConfig' },
            rateLimits: { $ref: '#/components/schemas/AgentRateLimits' },
            appearance: { $ref: '#/components/schemas/AgentAppearance' },
            features: { type: 'object', additionalProperties: { type: 'boolean' } },
            enabled: { type: 'boolean' },
          },
        },
        AgentRecord: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            teamId: { type: 'string' },
            slug: { type: 'string' },
            name: { type: 'string' },
            description: { type: 'string', nullable: true },
            orchestrationStrategy: { type: 'string' },
            orchestratorModel: { type: 'string', nullable: true },
            orchestratorPrompt: { type: 'string', nullable: true },
            botId: { type: 'string', nullable: true },
            fallbackBotId: { type: 'string', nullable: true },
            endUserAuth: { $ref: '#/components/schemas/EndUserAuthConfig' },
            rateLimits: { $ref: '#/components/schemas/AgentRateLimits' },
            appearance: { $ref: '#/components/schemas/AgentAppearance' },
            features: { type: 'object', additionalProperties: { type: 'boolean' } },
            enabled: { type: 'boolean' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        AgentWithBindings: {
          allOf: [
            { $ref: '#/components/schemas/AgentRecord' },
            { type: 'object', properties: { bindings: { type: 'array', items: { $ref: '#/components/schemas/AgentBotBinding' } } } },
          ],
        },
        AgentList: {
          type: 'object',
          properties: {
            agents: { type: 'array', items: { $ref: '#/components/schemas/AgentRecord' } },
          },
        },
        EndUserAuthConfig: {
          type: 'object',
          properties: {
            mode: { type: 'string', enum: ['anonymous', 'token', 'jwt'] },
            jwtSecret: { type: 'string' },
            tokenPrefix: { type: 'string' },
          },
        },
        AgentRateLimits: {
          type: 'object',
          properties: {
            messagesPerMinute: { type: 'integer' },
            conversationsPerDay: { type: 'integer' },
          },
        },
        AgentAppearance: {
          type: 'object',
          properties: {
            displayName: { type: 'string' },
            avatarUrl: { type: 'string' },
            description: { type: 'string' },
            welcomeMessage: { type: 'string' },
            placeholder: { type: 'string' },
          },
        },

        // --- Bindings ---
        ReplaceBindingsRequest: {
          type: 'object',
          properties: {
            bindings: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  botId: { type: 'string' },
                  priority: { type: 'integer' },
                  description: { type: 'string' },
                  keywords: { type: 'array', items: { type: 'string' } },
                },
                required: ['botId'],
              },
            },
          },
          required: ['bindings'],
        },
        AgentBotBinding: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            agentId: { type: 'string' },
            botId: { type: 'string' },
            priority: { type: 'integer' },
            description: { type: 'string', nullable: true },
            keywords: { type: 'array', items: { type: 'string' } },
          },
        },
        BindingList: {
          type: 'object',
          properties: {
            bindings: { type: 'array', items: { $ref: '#/components/schemas/AgentBotBinding' } },
          },
        },

        // --- End Users ---
        EndUserRecord: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            agentId: { type: 'string' },
            externalId: { type: 'string' },
            displayName: { type: 'string', nullable: true },
            metadata: { type: 'object', additionalProperties: true },
            createdAt: { type: 'string', format: 'date-time' },
            lastSeenAt: { type: 'string', format: 'date-time' },
          },
        },
        EndUserList: {
          type: 'object',
          properties: {
            users: { type: 'array', items: { $ref: '#/components/schemas/EndUserRecord' } },
          },
        },

        // --- Files ---
        UploadFileRequest: {
          type: 'object',
          properties: {
            conversationId: { type: 'string' },
            filename: { type: 'string', maxLength: 255 },
            mimeType: { type: 'string', maxLength: 100 },
            content: { type: 'string', description: 'Base64-encoded file data' },
          },
          required: ['conversationId', 'filename', 'mimeType', 'content'],
        },
        FileRecord: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            conversationId: { type: 'string' },
            userId: { type: 'string' },
            filename: { type: 'string' },
            mimeType: { type: 'string' },
            sizeBytes: { type: 'integer' },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        FileContent: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            filename: { type: 'string' },
            mimeType: { type: 'string' },
            content: { type: 'string', description: 'Base64-encoded file data' },
          },
        },
        FileList: {
          type: 'object',
          properties: {
            files: { type: 'array', items: { $ref: '#/components/schemas/FileRecord' } },
          },
        },

        // --- Workspaces ---
        CreateWorkspaceRequest: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            description: { type: 'string' },
            systemPrompt: { type: 'string' },
            metadata: { type: 'object', additionalProperties: true },
          },
          required: ['name'],
        },
        UpdateWorkspaceRequest: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            description: { type: 'string', nullable: true },
            systemPrompt: { type: 'string', nullable: true },
            metadata: { type: 'object', additionalProperties: true },
          },
        },
        WorkspaceRecord: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            teamId: { type: 'string' },
            name: { type: 'string' },
            description: { type: 'string', nullable: true },
            systemPrompt: { type: 'string', nullable: true },
            metadata: { type: 'object', additionalProperties: true },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        WorkspaceList: {
          type: 'object',
          properties: {
            workspaces: { type: 'array', items: { $ref: '#/components/schemas/WorkspaceRecord' } },
          },
        },

        // --- Documents ---
        CreateDocumentRequest: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            content: { type: 'string' },
            priority: { type: 'integer', minimum: 0, maximum: 100 },
            metadata: { type: 'object', additionalProperties: true },
          },
          required: ['title', 'content'],
        },
        UpdateDocumentRequest: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            content: { type: 'string' },
            priority: { type: 'integer', minimum: 0, maximum: 100 },
            metadata: { type: 'object', additionalProperties: true },
          },
        },
        ContextDocumentRecord: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            workspaceId: { type: 'string' },
            title: { type: 'string' },
            content: { type: 'string' },
            priority: { type: 'integer' },
            metadata: { type: 'object', additionalProperties: true },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        DocumentList: {
          type: 'object',
          properties: {
            documents: { type: 'array', items: { $ref: '#/components/schemas/ContextDocumentRecord' } },
          },
        },

        // --- Templates ---
        CreateTemplateRequest: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            description: { type: 'string' },
            systemPrompt: { type: 'string' },
            pluginNamespaces: { type: 'array', items: { type: 'string' } },
            model: { type: 'string' },
            temperature: { type: 'number', minimum: 0, maximum: 2 },
            maxTurns: { type: 'integer', minimum: 1, maximum: 100 },
            metadata: { type: 'object', additionalProperties: true },
          },
          required: ['name'],
        },
        UpdateTemplateRequest: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            description: { type: 'string' },
            systemPrompt: { type: 'string', nullable: true },
            pluginNamespaces: { type: 'array', items: { type: 'string' } },
            model: { type: 'string', nullable: true },
            temperature: { type: 'number', minimum: 0, maximum: 2, nullable: true },
            maxTurns: { type: 'integer', minimum: 1, maximum: 100, nullable: true },
            metadata: { type: 'object', additionalProperties: true },
          },
        },
        ConversationTemplateRecord: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            teamId: { type: 'string' },
            name: { type: 'string' },
            description: { type: 'string', nullable: true },
            systemPrompt: { type: 'string', nullable: true },
            pluginNamespaces: { type: 'array', items: { type: 'string' } },
            model: { type: 'string', nullable: true },
            temperature: { type: 'number', nullable: true },
            maxTurns: { type: 'integer', nullable: true },
            metadata: { type: 'object', additionalProperties: true },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        TemplateList: {
          type: 'object',
          properties: {
            templates: { type: 'array', items: { $ref: '#/components/schemas/ConversationTemplateRecord' } },
          },
        },

        // --- Feedback ---
        SubmitFeedbackRequest: {
          type: 'object',
          properties: {
            rating: { type: 'string', enum: ['positive', 'negative'] },
            comment: { type: 'string' },
            tags: { type: 'array', items: { type: 'string' }, maxItems: 10 },
          },
          required: ['rating'],
        },
        FeedbackRecord: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            conversationId: { type: 'string' },
            messageSeq: { type: 'integer' },
            userId: { type: 'string' },
            rating: { type: 'string', enum: ['positive', 'negative'] },
            comment: { type: 'string', nullable: true },
            tags: { type: 'array', items: { type: 'string' } },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        FeedbackList: {
          type: 'object',
          properties: {
            items: { type: 'array', items: { $ref: '#/components/schemas/FeedbackRecord' } },
            nextCursor: { type: 'string', nullable: true },
          },
        },
        FeedbackSummary: {
          type: 'object',
          properties: {
            total: { type: 'integer' },
            positive: { type: 'integer' },
            negative: { type: 'integer' },
            positiveRate: { type: 'number' },
            topTags: { type: 'array', items: { type: 'object', properties: { tag: { type: 'string' }, count: { type: 'integer' } } } },
          },
        },

        // --- User Memory ---
        UserMemoryFact: {
          type: 'object',
          properties: {
            key: { type: 'string' },
            value: { type: 'string' },
            namespace: { type: 'string' },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        MemoryFactList: {
          type: 'object',
          properties: {
            facts: { type: 'array', items: { $ref: '#/components/schemas/UserMemoryFact' } },
          },
        },

        // --- Artifacts ---
        ArtifactRecord: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            conversationId: { type: 'string' },
            title: { type: 'string' },
            content: { type: 'string' },
            currentVersion: { type: 'integer' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        ArtifactVersionRecord: {
          type: 'object',
          properties: {
            artifactId: { type: 'string' },
            version: { type: 'integer' },
            content: { type: 'string' },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        ArtifactList: {
          type: 'object',
          properties: {
            artifacts: { type: 'array', items: { $ref: '#/components/schemas/ArtifactRecord' } },
          },
        },
        ArtifactVersionList: {
          type: 'object',
          properties: {
            versions: { type: 'array', items: { $ref: '#/components/schemas/ArtifactVersionRecord' } },
          },
        },

        // --- Admin ---
        PurgeAuditLogRequest: {
          type: 'object',
          properties: {
            olderThanDays: { type: 'integer', minimum: 1 },
          },
          required: ['olderThanDays'],
        },

        // --- Response Blocks ---
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

        // --- Errors ---
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
          content: jsonContent('Error'),
        },
        Forbidden: {
          description: 'Admin access required',
          content: jsonContent('Error'),
        },
        NotFound: {
          description: 'Resource not found',
          content: jsonContent('Error'),
        },
        RateLimited: {
          description: 'Rate limit exceeded',
          content: jsonContent('Error'),
          headers: {
            'Retry-After': { schema: { type: 'integer' } },
          },
        },
      },
    },
  };
}
