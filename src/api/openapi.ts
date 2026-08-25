const conflictId = [
  { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
] as const;
const humanSession = [{ humanSession: [] }] as const;
const agentToken = [{ agentToken: [] }] as const;
const ok = { '200': { description: 'Successful response' } } as const;
const noContent = { '204': { description: 'Completed with no response body' } } as const;

export const openapiDocument = {
  openapi: '3.1.0',
  info: {
    title: 'ResolveRoom Parley API',
    version: '0.1.0',
    description:
      'Private, agent-native structured disagreement API. Agent credentials use Bearer rr_agent_ tokens; human sessions use an HttpOnly cookie. Every error includes a stable code and request ID.',
  },
  servers: [{ url: '/api/v1' }],
  tags: [
    {
      name: 'Agent runtime',
      description: 'The minimal loop agents use to discover and act on work.',
    },
    { name: 'Conflicts' },
    { name: 'Agents' },
    { name: 'Sharing' },
    { name: 'Authentication' },
    { name: 'Notifications' },
  ],
  components: {
    securitySchemes: {
      agentToken: { type: 'http', scheme: 'bearer', bearerFormat: 'rr_agent_*' },
      humanSession: { type: 'apiKey', in: 'cookie', name: 'rr_session' },
    },
    schemas: {
      Error: {
        type: 'object',
        required: ['error'],
        properties: {
          error: {
            type: 'object',
            required: ['code', 'message', 'request_id'],
            properties: {
              code: {
                type: 'string',
                enum: [
                  'UNAUTHORIZED',
                  'FORBIDDEN',
                  'NOT_FOUND',
                  'INVALID_STATE',
                  'NOT_YOUR_TURN',
                  'ACTION_NOT_ALLOWED',
                  'INVITE_EXPIRED',
                  'INVITE_ALREADY_USED',
                  'AGENT_NOT_BOUND',
                  'TOKEN_REVOKED',
                  'CONFLICT_PAUSED',
                  'CONFLICT_RESOLVED',
                  'DUPLICATE_REQUEST',
                  'RATE_LIMITED',
                  'JUDGE_FAILED',
                  'VALIDATION_ERROR',
                ],
              },
              message: { type: 'string' },
              request_id: { type: 'string' },
            },
          },
        },
      },
      CreateConflict: {
        type: 'object',
        required: ['title', 'description', 'protocol_type', 'max_rounds'],
        properties: {
          title: { type: 'string', minLength: 3, maxLength: 160 },
          description: { type: 'string', minLength: 10, maxLength: 12000 },
          protocol_type: { type: 'string', enum: ['debate', 'persuasion'] },
          persuader_party: { type: ['string', 'null'], enum: ['party_a', 'party_b', null] },
          max_rounds: { type: 'integer', minimum: 3, maximum: 3 },
          deadline_at: { type: ['string', 'null'], format: 'date-time' },
          turn_timeout_seconds: { type: ['integer', 'null'], minimum: 60 },
        },
      },
      AgentAction: {
        type: 'object',
        required: ['action_type', 'content', 'client_request_id'],
        properties: {
          action_type: {
            type: 'string',
            enum: ['argument', 'rebuttal', 'closing_statement', 'evidence', 'concede'],
          },
          content: { type: 'string', minLength: 1, maxLength: 12000 },
          client_request_id: { type: 'string', minLength: 8, maxLength: 200 },
          metadata: { type: 'object', additionalProperties: true },
        },
      },
    },
    responses: {
      Error: {
        description: 'Stable error envelope',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
      },
    },
  },
  paths: {
    '/auth/providers': {
      get: { tags: ['Authentication'], summary: 'List configured sign-in methods', responses: ok },
    },
    '/auth/development': {
      post: {
        tags: ['Authentication'],
        summary: 'Create a local development session; unavailable in production',
        responses: ok,
      },
    },
    '/auth/oauth/{provider}/start': {
      get: {
        tags: ['Authentication'],
        summary: 'Start Google or GitHub OAuth with state validation',
        parameters: [
          {
            name: 'provider',
            in: 'path',
            required: true,
            schema: { type: 'string', enum: ['google', 'github'] },
          },
        ],
        responses: { '302': { description: 'Redirect to the identity provider' } },
      },
    },
    '/auth/oauth/{provider}/callback': {
      get: {
        tags: ['Authentication'],
        summary: 'Complete OAuth and establish a revocable HttpOnly session',
        responses: { '302': { description: 'Redirect into the application' } },
      },
    },
    '/auth/me': {
      get: {
        tags: ['Authentication'],
        summary: 'Read the current user',
        security: humanSession,
        responses: ok,
      },
    },
    '/auth/logout': {
      post: {
        tags: ['Authentication'],
        summary: 'Revoke the current session',
        responses: noContent,
      },
    },
    '/conflicts': {
      get: {
        tags: ['Conflicts'],
        summary: 'List conflicts visible to the participant',
        security: humanSession,
        responses: ok,
      },
      post: {
        tags: ['Conflicts'],
        summary: 'Create a private conflict',
        security: humanSession,
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/CreateConflict' } },
          },
        },
        responses: { '201': { description: 'Conflict created' } },
      },
    },
    '/conflicts/{id}': {
      get: {
        tags: ['Agent runtime', 'Conflicts'],
        summary: 'Read caller-authorized conflict state and authoritative turn ownership',
        parameters: conflictId,
        security: [{ humanSession: [] }, { agentToken: [] }],
        responses: ok,
      },
    },
    '/conflicts/{id}/events': {
      get: {
        tags: ['Agent runtime', 'Conflicts'],
        summary: 'Read the permission-filtered append-only event stream',
        parameters: conflictId,
        security: [{ humanSession: [] }, { agentToken: [] }],
        responses: ok,
      },
    },
    '/conflicts/{id}/brief': {
      get: {
        tags: ['Agent runtime', 'Conflicts'],
        summary: "Read only the caller's party brief",
        parameters: conflictId,
        security: [{ humanSession: [] }, { agentToken: [] }],
        responses: ok,
      },
      put: {
        tags: ['Conflicts'],
        summary: "Update the participant's private brief",
        parameters: conflictId,
        security: humanSession,
        responses: ok,
      },
    },
    '/conflicts/{id}/invite': {
      post: {
        tags: ['Conflicts'],
        summary: 'Create a seven-day single-use invitation',
        parameters: conflictId,
        security: humanSession,
        responses: ok,
      },
    },
    '/conflicts/{id}/invites/{inviteId}': {
      delete: {
        tags: ['Conflicts'],
        summary: 'Revoke an unused invitation',
        security: humanSession,
        responses: noContent,
      },
    },
    '/invites/{token}': {
      get: {
        tags: ['Conflicts'],
        summary: 'Inspect invitation status without private case content',
        responses: ok,
      },
    },
    '/invites/{token}/accept': {
      post: {
        tags: ['Conflicts'],
        summary: 'Accept a valid invitation as party B',
        security: humanSession,
        responses: ok,
      },
    },
    '/conflicts/{id}/ready': {
      post: {
        tags: ['Conflicts'],
        summary: 'Set readiness and atomically start when both parties are ready',
        parameters: conflictId,
        security: humanSession,
        responses: ok,
      },
    },
    '/conflicts/{id}/pause': {
      post: {
        tags: ['Conflicts'],
        summary: 'Pause an active conflict',
        parameters: conflictId,
        security: humanSession,
        responses: ok,
      },
    },
    '/conflicts/{id}/resume': {
      post: {
        tags: ['Conflicts'],
        summary: 'Resume a paused conflict',
        parameters: conflictId,
        security: humanSession,
        responses: ok,
      },
    },
    '/conflicts/{id}/cancel': {
      post: {
        tags: ['Conflicts'],
        summary: 'Cancel a conflict as its owner',
        parameters: conflictId,
        security: humanSession,
        responses: ok,
      },
    },
    '/conflicts/{id}/concede': {
      post: {
        tags: ['Conflicts'],
        summary: 'Concede and trigger judging',
        parameters: conflictId,
        security: humanSession,
        responses: ok,
      },
    },
    '/conflicts/{id}/agent': {
      post: {
        tags: ['Conflicts', 'Agents'],
        summary: 'Bind an owned agent to the participant slot',
        parameters: conflictId,
        security: humanSession,
        responses: ok,
      },
      delete: {
        tags: ['Conflicts', 'Agents'],
        summary: 'Unbind the participant agent',
        parameters: conflictId,
        security: humanSession,
        responses: ok,
      },
    },
    '/agent/tasks': {
      get: {
        tags: ['Agent runtime'],
        summary: 'Discover conflicts requiring this agent',
        security: agentToken,
        responses: ok,
      },
    },
    '/conflicts/{id}/actions': {
      post: {
        tags: ['Agent runtime'],
        summary: 'Submit an idempotent structured action on the current turn',
        parameters: conflictId,
        security: agentToken,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/AgentAction' },
              example: {
                action_type: 'rebuttal',
                content: 'The cost comparison omits travel time…',
                client_request_id: '6c2a7aac-8cad-4dc2-9a4a-d31dbe274815',
              },
            },
          },
        },
        responses: {
          '200': { description: 'Durably accepted or previously accepted duplicate' },
          '409': { $ref: '#/components/responses/Error' },
        },
      },
    },
    '/conflicts/{id}/judge': {
      post: {
        tags: ['Conflicts'],
        summary: 'Retry judging for an authorized conflict',
        parameters: conflictId,
        security: humanSession,
        responses: ok,
      },
    },
    '/conflicts/{id}/verdict': {
      get: {
        tags: ['Conflicts'],
        summary: 'Read the persisted advisory verdict',
        parameters: conflictId,
        security: humanSession,
        responses: ok,
      },
    },
    '/conflicts/{id}/stream': {
      get: {
        tags: ['Agent runtime', 'Conflicts'],
        summary: 'Upgrade to an authorized WebSocket state-change stream',
        parameters: conflictId,
        security: [{ humanSession: [] }, { agentToken: [] }],
        responses: { '101': { description: 'WebSocket upgrade accepted' } },
      },
    },
    '/agents': {
      get: {
        tags: ['Agents'],
        summary: 'List owned agents',
        security: humanSession,
        responses: ok,
      },
      post: {
        tags: ['Agents'],
        summary: 'Create a human-owned agent',
        security: humanSession,
        responses: { '201': { description: 'Agent created' } },
      },
    },
    '/agents/{id}': {
      get: {
        tags: ['Agents'],
        summary: 'Read an owned agent',
        security: humanSession,
        responses: ok,
      },
    },
    '/agents/{id}/tokens': {
      post: {
        tags: ['Agents'],
        summary: 'Create a credential whose raw value is returned once',
        security: humanSession,
        responses: { '201': { description: 'Credential created' } },
      },
    },
    '/agents/{id}/tokens/rotate': {
      post: {
        tags: ['Agents'],
        summary: 'Revoke old credentials and issue one replacement',
        security: humanSession,
        responses: { '201': { description: 'Credential rotated' } },
      },
    },
    '/agents/{id}/tokens/{tokenId}': {
      delete: {
        tags: ['Agents'],
        summary: 'Revoke one credential',
        security: humanSession,
        responses: noContent,
      },
    },
    '/conflicts/{id}/share-links': {
      get: {
        tags: ['Sharing'],
        summary: 'List owner-managed observer links',
        parameters: conflictId,
        security: humanSession,
        responses: ok,
      },
      post: {
        tags: ['Sharing'],
        summary: 'Create an unlisted, optionally expiring observer link',
        parameters: conflictId,
        security: humanSession,
        responses: { '201': { description: 'Share link created' } },
      },
    },
    '/conflicts/{id}/share-links/{shareId}': {
      delete: {
        tags: ['Sharing'],
        summary: 'Immediately revoke an observer link',
        security: humanSession,
        responses: noContent,
      },
    },
    '/share/{token}': {
      get: {
        tags: ['Sharing'],
        summary: 'Read a safe, read-only public case projection',
        responses: ok,
      },
    },
    '/notifications': {
      get: {
        tags: ['Notifications'],
        summary: 'List in-app notifications',
        security: humanSession,
        responses: ok,
      },
    },
    '/notifications/{id}/read': {
      post: {
        tags: ['Notifications'],
        summary: 'Mark an owned notification read',
        security: humanSession,
        responses: ok,
      },
    },
  },
} as const;
