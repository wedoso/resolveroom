import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { DomainError, errorStatus } from '@/domain/errors';
import {
  agentActionSchema,
  createConflictSchema,
  privateBriefSchema,
  type Agent,
  type AgentPairing,
  type AgentToken,
  type ConflictParty,
  type User,
} from '@/domain/types';
import {
  normalizePairingCode,
  opaqueId,
  securePairingCode,
  secureToken,
  sha256,
} from '@/domain/security';
import type { Database } from '@/persistence/database';
import { ConflictService, filterEvents } from '@/services/conflicts';
import { JudgeService } from '@/judge/service';
import { MockJudgeProvider, type JudgeProvider } from '@/judge/providers';
import { openapiDocument } from './openapi';
import {
  authorizationUrl,
  exchangeOAuth,
  type OAuthCredentials,
  type OAuthProviderName,
} from '@/auth/oauth';
import { NotificationService, type EmailProvider } from '@/notifications/service';
import { agentAssets } from '@/generated/agent-assets';

type Identity = { kind: 'human'; user: User } | { kind: 'agent'; agent: Agent };
type AppEnv = { Variables: { requestId: string; identity?: Identity } };
type Options = {
  allowDevelopmentAuth?: boolean;
  judgeEnabled?: boolean;
  judgeMode?: 'disabled' | 'mock' | 'llm';
  judgeProvider?: JudgeProvider;
  appUrl?: string;
  secureCookies?: boolean;
  oauth?: Partial<Record<OAuthProviderName, OAuthCredentials>>;
  emailProvider?: EmailProvider;
  runnerStatus?: (agentId: string) => Promise<RunnerStatus>;
  disconnectRunner?: (agentId: string, reason: string) => Promise<void>;
};
export type RunnerStatus = {
  state: 'online' | 'working' | 'reconnecting' | 'reconnect_required';
  online: boolean;
  needs_reconnect: boolean;
  connected_at: string | null;
  last_seen_at: string | null;
  device_name: string | null;
  runner_version: string | null;
  provider: string | null;
  pending_tasks: number;
  active_conflict_id: string | null;
  reconnect_reason: string | null;
};
const disconnectedRunnerStatus = (): RunnerStatus => ({
  state: 'reconnect_required',
  online: false,
  needs_reconnect: true,
  connected_at: null,
  last_seen_at: null,
  device_name: null,
  runner_version: null,
  provider: null,
  pending_tasks: 0,
  active_conflict_id: null,
  reconnect_reason: 'runner_not_connected',
});
const limiter = new Map<string, { count: number; reset: number }>();
const shellArgument = (value: string) => JSON.stringify(value);
const bootstrapArguments = (origin: string, command: string[]) => [
  '--input-type=module',
  '--eval',
  agentAssets.loaderSource,
  `${origin}/agent/bootstrap.mjs`,
  agentAssets.bootstrapSha256,
  agentAssets.bundleSha256,
  ...command,
];
const bootstrapCommand = (origin: string, command: string[]) =>
  `<NODE_EXECUTABLE> ${bootstrapArguments(origin, command).map(shellArgument).join(' ')}`;
const codexNetworkExecution = (origin: string) => ({
  tool: 'exec_command',
  network_access: 'required',
  allowed_origin: origin,
  approval_strategy: 'use_existing_network_or_request_when_supported',
  when_network_is_available:
    'Invoke the exact bundled Node executable directly. Do not request escalation when the current environment already has network access.',
  when_approval_is_supported: {
    sandbox_permissions: 'require_escalated',
    justification: `Allow the bundled Node executable to connect only to ${origin} so it can install or reconnect the ResolveRoom Runner.`,
  },
  when_approval_policy_is_never:
    'Do not request unavailable escalation. If this environment already has network access, invoke the exact bundled Node executable normally. If it does not, stop without invoking it; the pairing code remains unconsumed.',
});
const codexRuntimePreparation = (origin: string, purpose: string) =>
  `call Codex's \`load_workspace_dependencies\` tool and select its returned \`node executable\`. Check the current execution environment before invoking it. If that environment already has network access, invoke the exact bundled Node normally—even when its approval policy is \`Never\`; do not request unavailable escalation. If network is restricted and approval is supported, first call \`exec_command\` with \`sandbox_permissions: "require_escalated"\` and the justification “Allow the bundled Node executable to connect only to ${origin} so it can ${purpose}.” If network is restricted and the approval policy is \`Never\`, stop without invoking the command and report that this task needs a network-enabled local environment`;

const jsonBody = async (c: Context) => {
  try {
    return await c.req.json();
  } catch {
    throw new DomainError('VALIDATION_ERROR', 'Request body must be valid JSON.', 422);
  }
};
const discardRequestBody = async (c: Context) => {
  if (c.req.raw.body && !c.req.raw.bodyUsed) await c.req.raw.arrayBuffer();
};
const human = (c: Context<AppEnv>): User => {
  const id = c.get('identity');
  if (!id || id.kind !== 'human')
    throw new DomainError('UNAUTHORIZED', 'Human sign-in is required.', 401);
  return id.user;
};
const agentIdentity = (c: Context<AppEnv>): Agent => {
  const id = c.get('identity');
  if (!id || id.kind !== 'agent')
    throw new DomainError('UNAUTHORIZED', 'A valid Agent bearer token is required.', 401);
  return id.agent;
};
const errorBody = (code: string, message: string, requestId: string) => ({
  error: { code, message, request_id: requestId },
});
const safeLogPath = (path: string) =>
  path.replace(/(\/invites\/)[^/]+/, '$1[redacted]').replace(/(\/share\/)[^/]+/, '$1[redacted]');

export function createApi(db: Database, options: Options = {}) {
  const app = new Hono<AppEnv>();
  const notifications = new NotificationService(db, options.emailProvider);
  const judgeEnabled = options.judgeEnabled ?? true;
  const conflicts = new ConflictService(db, notifications, judgeEnabled);
  const judge = new JudgeService(
    db,
    options.judgeProvider ?? new MockJudgeProvider(),
    notifications,
  );
  const judgeMode = judgeEnabled ? (options.judgeMode ?? 'mock') : 'disabled';
  const runnerStatus = options.runnerStatus ?? (async () => disconnectedRunnerStatus());
  app.use('*', secureHeaders());
  const allowedOrigin = new URL(options.appUrl ?? 'http://localhost:5173').origin;
  app.use(
    '/api/*',
    cors({
      origin: (origin) => (origin === allowedOrigin ? origin : allowedOrigin),
      credentials: true,
    }),
  );
  app.use('*', async (c, next) => {
    const requestId =
      c.req.header('x-request-id') ?? `req_${crypto.randomUUID().replaceAll('-', '')}`;
    c.set('requestId', requestId);
    c.header('x-request-id', requestId);
    await next();
  });
  app.use('/api/v1/*', async (c, next) => {
    const contentLength = Number(c.req.header('content-length') ?? 0);
    if (contentLength > 131_072)
      throw new DomainError('VALIDATION_ERROR', 'Request body exceeds 128 KiB.', 422);
    const authorization = c.req.header('authorization') ?? '';
    const session = getCookie(c, 'rr_session') ?? '';
    const developmentUser = options.allowDevelopmentAuth
      ? (c.req.header('x-dev-user-id') ?? '')
      : '';
    const identityKey = authorization || session || developmentUser;
    const identityHash = identityKey ? (await sha256(identityKey)).slice(0, 16) : 'anonymous';
    const conflictKey = c.req.path.match(/\/conflicts\/([^/]+)/)?.[1] ?? 'global';
    const rateBucket = c.req.path.includes('/agent-pairings/exchange')
      ? 'pairing'
      : c.req.path.includes('/actions')
        ? 'write'
        : 'read';
    const key = `${c.req.header('cf-connecting-ip') ?? 'local'}:${identityHash}:${conflictKey}:${rateBucket}`;
    const now = Date.now();
    if (limiter.size > 10_000)
      for (const [candidate, entry] of limiter) if (entry.reset < now) limiter.delete(candidate);
    const value = limiter.get(key);
    const limit = c.req.path.includes('/agent-pairings/exchange')
      ? 20
      : c.req.path.includes('/actions')
        ? 90
        : 600;
    if (!value || value.reset < now) limiter.set(key, { count: 1, reset: now + 60_000 });
    else if (value.count >= limit)
      throw new DomainError('RATE_LIMITED', 'Too many requests. Try again shortly.', 429);
    else value.count += 1;
    await next();
  });
  app.use('/api/v1/*', async (c, next) => {
    const startedAt = Date.now();
    await next();
    const identity = c.get('identity');
    console.log(
      JSON.stringify({
        level: 'info',
        request_id: c.get('requestId'),
        method: c.req.method,
        path: safeLogPath(c.req.path),
        status: c.res.status,
        duration_ms: Date.now() - startedAt,
        conflict_id: c.req.path.match(/\/conflicts\/([^/]+)/)?.[1] ?? null,
        actor_type: identity?.kind ?? 'anonymous',
      }),
    );
  });
  app.use('/api/v1/*', async (c, next) => {
    const auth = c.req.header('authorization');
    if (auth) {
      if (!auth.startsWith('Bearer ')) {
        await discardRequestBody(c);
        throw new DomainError('UNAUTHORIZED', 'Authorization header is malformed.', 401);
      }
      const raw = auth.slice(7);
      if (!raw.startsWith('rr_agent_')) {
        await discardRequestBody(c);
        throw new DomainError('UNAUTHORIZED', 'Bearer credential is not an Agent token.', 401);
      }
      const token = await db.findAgentToken(await sha256(raw));
      if (!token || token.revokedAt) {
        await discardRequestBody(c);
        throw new DomainError('TOKEN_REVOKED', 'Agent token is invalid or revoked.', 401);
      }
      const ag = await db.getAgent(token.agentId);
      if (!ag || ag.status !== 'active') {
        await discardRequestBody(c);
        throw new DomainError('TOKEN_REVOKED', 'Agent is inactive.', 401);
      }
      c.set('identity', { kind: 'agent', agent: ag });
    }
    if (!c.get('identity') && options.allowDevelopmentAuth) {
      const id = c.req.header('x-dev-user-id');
      if (id) {
        const user = await db.getUser(id);
        if (user) c.set('identity', { kind: 'human', user });
      }
    }
    if (!c.get('identity')) {
      const raw = getCookie(c, 'rr_session');
      if (raw) {
        const session = await db.findSession(await sha256(raw));
        if (session && !session.revokedAt && new Date(session.expiresAt) > new Date()) {
          const user = await db.getUser(session.userId);
          if (user && !user.deletedAt) c.set('identity', { kind: 'human', user });
        }
      }
    }
    await next();
  });

  app.get('/health', (c) => c.json({ status: 'ok', service: 'resolveroom' }));
  app.get('/openapi.json', (c) => c.json(openapiDocument));
  app.get('/.well-known/resolveroom-agent.json', (c) =>
    c.json({
      protocol: 'resolveroom-agent-pairing',
      version: '1.0',
      product: 'ResolveRoom',
      origin: allowedOrigin,
      pairing: {
        exchange_url: `${allowedOrigin}/api/v1/agent-pairings/exchange`,
        method: 'POST',
        code_format: 'XXXX-XXXX-XXXX',
        code_ttl_seconds: 600,
        single_use: true,
      },
      cli: {
        distribution: 'resolveroom-origin',
        version: agentAssets.version,
        bootstrap_url: `${allowedOrigin}/agent/bootstrap.mjs`,
        bootstrap_sha256: agentAssets.bootstrapSha256,
        bundle_url: `${allowedOrigin}/agent/resolveroom.mjs`,
        bundle_sha256: agentAssets.bundleSha256,
        manifest_url: `${allowedOrigin}/agent/manifest.json`,
        connect: bootstrapCommand(allowedOrigin, [
          'connect',
          '<PAIRING_CODE>',
          '--origin',
          allowedOrigin,
        ]),
        reconnect: bootstrapCommand(allowedOrigin, [
          'runner',
          'reconnect',
          '--origin',
          allowedOrigin,
        ]),
        uninstall: bootstrapCommand(allowedOrigin, [
          'runner',
          'uninstall',
          '--origin',
          allowedOrigin,
        ]),
        pair: bootstrapCommand(allowedOrigin, [
          'pair',
          '<PAIRING_CODE>',
          '--origin',
          allowedOrigin,
        ]),
        codex_app: {
          runtime_tool: 'load_workspace_dependencies',
          node_field: 'node executable',
          execution: codexNetworkExecution(allowedOrigin),
          environment:
            'Use the returned bundled node executable directly through exec_command. If the current environment already has network access, run it normally—even when its approval policy is Never. If network is restricted and approval is supported, request sandbox_permissions=require_escalated for the ResolveRoom origin before invoking it. Do not use system Node.js, npm, npx, pnpm, GitHub, or a package registry. The bootstrap creates its own private temporary directory and verifies both downloads by SHA-256.',
          connect_arguments: bootstrapArguments(allowedOrigin, [
            'connect',
            '<PAIRING_CODE>',
            '--origin',
            allowedOrigin,
          ]),
          reconnect_arguments: bootstrapArguments(allowedOrigin, [
            'runner',
            'reconnect',
            '--origin',
            allowedOrigin,
          ]),
          uninstall_arguments: bootstrapArguments(allowedOrigin, [
            'runner',
            'uninstall',
            '--origin',
            allowedOrigin,
          ]),
        },
      },
      runtime: {
        tasks: `${allowedOrigin}/api/v1/agent/tasks`,
        websocket: `${allowedOrigin.replace(/^http/, 'ws')}/api/v1/agent-runner/connect`,
        openapi: `${allowedOrigin}/openapi.json`,
      },
      security: {
        pairing_code_is_long_lived_credential: false,
        credential_is_returned_once: true,
        never_print_credential: true,
      },
    }),
  );
  app.get('/api/v1/auth/providers', (c) =>
    c.json({
      providers: Object.keys(options.oauth ?? {}),
      development: Boolean(options.allowDevelopmentAuth),
    }),
  );
  app.post('/api/v1/auth/development', async (c) => {
    if (!options.allowDevelopmentAuth) throw new DomainError('NOT_FOUND', 'Not found.', 404);
    const body = await jsonBody(c);
    const email = String(body.email ?? '')
      .trim()
      .toLowerCase();
    const displayName = String(body.display_name ?? '').trim();
    if (!email || !displayName)
      throw new DomainError('VALIDATION_ERROR', 'Email and display name are required.', 422);
    let user = await db.findUserByEmail(email);
    const isNewUser = !user;
    if (!user) {
      user = {
        id: opaqueId('usr'),
        email,
        displayName,
        avatarUrl: null,
        createdAt: new Date().toISOString(),
        deletedAt: null,
      };
      await db.createUser(user);
    }
    if (isNewUser)
      await db.recordAnalytics('user_created', user.id, null, { provider: 'development' });
    await establishSession(c, db, user.id, Boolean(options.secureCookies));
    return c.json({ user });
  });
  app.get('/api/v1/auth/oauth/:provider/start', async (c) => {
    const providerName = c.req.param('provider') as OAuthProviderName;
    const credentials = options.oauth?.[providerName];
    if (!credentials) throw new DomainError('NOT_FOUND', 'OAuth provider is not configured.', 404);
    const state = crypto.randomUUID();
    const requested = c.req.query('return_to') ?? '/dashboard';
    const returnTo =
      requested.startsWith('/') && !requested.startsWith('//') ? requested : '/dashboard';
    setCookie(c, 'rr_oauth_state', state, {
      httpOnly: true,
      secure: Boolean(options.secureCookies),
      sameSite: 'Lax',
      maxAge: 600,
      path: '/',
    });
    setCookie(c, 'rr_return_to', encodeURIComponent(returnTo), {
      httpOnly: true,
      secure: Boolean(options.secureCookies),
      sameSite: 'Lax',
      maxAge: 600,
      path: '/',
    });
    const redirect = `${options.appUrl}/api/v1/auth/oauth/${providerName}/callback`;
    return c.redirect(authorizationUrl(providerName, credentials, redirect, state));
  });
  app.get('/api/v1/auth/oauth/:provider/callback', async (c) => {
    const providerName = c.req.param('provider') as OAuthProviderName;
    const credentials = options.oauth?.[providerName];
    if (!credentials) throw new DomainError('NOT_FOUND', 'OAuth provider is not configured.', 404);
    const state = c.req.query('state');
    const code = c.req.query('code');
    if (!state || state !== getCookie(c, 'rr_oauth_state') || !code)
      throw new DomainError('UNAUTHORIZED', 'OAuth state validation failed.', 401);
    const profile = await exchangeOAuth(
      providerName,
      credentials,
      `${options.appUrl}/api/v1/auth/oauth/${providerName}/callback`,
      code,
    );
    let user = await db.findUserByAuthIdentity(providerName, profile.subject);
    if (!user) user = await db.findUserByEmail(profile.email);
    const isNewUser = !user;
    if (!user) {
      user = {
        id: opaqueId('usr'),
        email: profile.email,
        displayName: profile.displayName,
        avatarUrl: profile.avatarUrl,
        createdAt: new Date().toISOString(),
        deletedAt: null,
      };
      await db.createUser(user);
    }
    if (isNewUser)
      await db.recordAnalytics('user_created', user.id, null, { provider: providerName });
    await db.createAuthIdentity(
      `aid_${crypto.randomUUID().replaceAll('-', '')}`,
      user.id,
      providerName,
      profile.subject,
      new Date().toISOString(),
    );
    await establishSession(c, db, user.id, Boolean(options.secureCookies));
    const returnTo = decodeURIComponent(getCookie(c, 'rr_return_to') ?? '/dashboard');
    deleteCookie(c, 'rr_oauth_state', { path: '/' });
    deleteCookie(c, 'rr_return_to', { path: '/' });
    return c.redirect(`${options.appUrl}${returnTo}`);
  });
  app.post('/api/v1/auth/logout', async (c) => {
    const raw = getCookie(c, 'rr_session');
    if (raw) await db.revokeSession(await sha256(raw));
    deleteCookie(c, 'rr_session', { path: '/' });
    return c.body(null, 204);
  });
  app.get('/api/v1/auth/me', (c) => c.json({ user: human(c) }));
  app.get('/api/v1/capabilities', (c) =>
    c.json({ judge: { available: judgeEnabled, mode: judgeMode } }),
  );

  app.post('/api/v1/conflicts', async (c) => {
    const user = human(c);
    const parsed = createConflictSchema.safeParse(await jsonBody(c));
    if (!parsed.success)
      throw new DomainError(
        'VALIDATION_ERROR',
        parsed.error.issues[0]?.message ?? 'Invalid conflict.',
        422,
      );
    return c.json(await conflicts.createConflict(user.id, parsed.data), 201);
  });
  app.get('/api/v1/conflicts', async (c) => {
    const user = human(c);
    const list = await db.listConflictsForUser(user.id);
    const items = await Promise.all(
      list.map(async (conflict) => {
        const parties = await db.getParties(conflict.id);
        const yours = parties.find((p) => p.userId === user.id)!;
        const opponent = parties.find((p) => p.id !== yours.id)!;
        const events = await db.listEvents(conflict.id);
        const current = authoritativeTurn(conflict, parties, events);
        return {
          ...publicConflict(conflict),
          your_party: yours.role,
          opponent: { display_name: opponent.displayName, joined: Boolean(opponent.userId) },
          current_turn: current,
          judge_available: judgeEnabled,
        };
      }),
    );
    return c.json({ conflicts: items });
  });
  app.get('/api/v1/conflicts/:id', async (c) => {
    const identity = c.get('identity');
    if (!identity) throw new DomainError('UNAUTHORIZED', 'Authentication is required.', 401);
    const id = c.req.param('id');
    const conflict = await db.getConflict(id);
    if (!conflict) throw new DomainError('NOT_FOUND', 'Conflict not found.', 404);
    const parties = await db.getParties(id);
    let party: ConflictParty | null = null;
    if (identity.kind === 'human')
      party = parties.find((p) => p.userId === identity.user.id) ?? null;
    else party = parties.find((p) => p.agentId === identity.agent.id) ?? null;
    if (!party) throw new DomainError('NOT_FOUND', 'Conflict not found.', 404);
    const events = await db.listEvents(id);
    return c.json({
      ...publicConflict(conflict),
      your_party: party.role,
      current_turn: authoritativeTurn(conflict, parties, events),
      judge_available: judgeEnabled,
      parties: await Promise.all(
        parties.map(async (p) => ({
          id: p.id,
          role: p.role,
          display_name: p.displayName,
          agent_bound: Boolean(p.agentId),
          agent_connected: p.agentId ? (await runnerStatus(p.agentId)).online : false,
          runner: p.agentId ? await runnerStatus(p.agentId) : null,
          ...(p.id === party.id && p.agentId ? { agent_id: p.agentId } : {}),
          ready: p.ready,
          joined: Boolean(p.userId),
        })),
      ),
    });
  });
  app.get('/api/v1/conflicts/:id/events', async (c) => {
    const identity = c.get('identity');
    if (!identity) throw new DomainError('UNAUTHORIZED', 'Authentication is required.', 401);
    const id = c.req.param('id');
    const parties = await db.getParties(id);
    const party =
      identity.kind === 'human'
        ? parties.find((p) => p.userId === identity.user.id)
        : parties.find((p) => p.agentId === identity.agent.id);
    if (!party) throw new DomainError('NOT_FOUND', 'Conflict not found.', 404);
    return c.json({
      events: filterEvents(await db.listEvents(id), { kind: 'participant', partyId: party.id }),
    });
  });
  app.get('/api/v1/conflicts/:id/brief', async (c) => {
    const identity = c.get('identity');
    if (!identity) throw new DomainError('UNAUTHORIZED', 'Authentication is required.', 401);
    const id = c.req.param('id');
    const parties = await db.getParties(id);
    const party =
      identity.kind === 'human'
        ? parties.find((p) => p.userId === identity.user.id)
        : parties.find((p) => p.agentId === identity.agent.id);
    if (!party) throw new DomainError('NOT_FOUND', 'Conflict not found.', 404);
    return c.json({ brief: await db.getBrief(id, party.id) });
  });
  app.put('/api/v1/conflicts/:id/brief', async (c) => {
    const user = human(c);
    const parsed = privateBriefSchema.safeParse(await jsonBody(c));
    if (!parsed.success)
      throw new DomainError(
        'VALIDATION_ERROR',
        parsed.error.issues[0]?.message ?? 'Invalid brief.',
        422,
      );
    return c.json({ brief: await conflicts.saveBrief(c.req.param('id'), user.id, parsed.data) });
  });

  app.post('/api/v1/conflicts/:id/invite', async (c) => {
    await discardRequestBody(c);
    const user = human(c);
    const value = await conflicts.createInvite(c.req.param('id'), user.id);
    return c.json({
      invite: {
        id: value.invitation.id,
        expires_at: value.invitation.expiresAt,
        url: `${options.appUrl ?? ''}/join/${value.token}`,
      },
    });
  });
  app.post('/api/v1/invites/:token/accept', async (c) => {
    await discardRequestBody(c);
    return c.json(await conflicts.acceptInvite(c.req.param('token'), human(c).id));
  });
  app.delete('/api/v1/conflicts/:id/invites/:inviteId', async (c) => {
    await conflicts.revokeInvite(c.req.param('id'), c.req.param('inviteId'), human(c).id);
    return c.body(null, 204);
  });
  app.get('/api/v1/invites/:token', async (c) => {
    const invite = await db.findInvitation(await sha256(c.req.param('token')));
    if (!invite) throw new DomainError('NOT_FOUND', 'Invitation not found.', 404);
    const conflict = await db.getConflict(invite.conflictId);
    const parties = await db.getParties(invite.conflictId);
    return c.json({
      invite: {
        expires_at: invite.expiresAt,
        accepted: Boolean(invite.acceptedAt),
        revoked: Boolean(invite.revokedAt),
      },
      conflict: conflict && publicConflict(conflict),
      invited_by: parties.find((p) => p.role === 'party_a')?.displayName,
    });
  });
  app.post('/api/v1/conflicts/:id/ready', async (c) => {
    const body = await jsonBody(c);
    const user = human(c);
    const result = await conflicts.setReady(c.req.param('id'), user.id, body.ready !== false);
    if (judgeEnabled && result.started) await runJudgeIfNeeded(db, judge, c.req.param('id'));
    return c.json(result);
  });
  app.post('/api/v1/conflicts/:id/pause', async (c) => {
    await discardRequestBody(c);
    return c.json({ conflict: await conflicts.pause(c.req.param('id'), human(c).id) });
  });
  app.post('/api/v1/conflicts/:id/resume', async (c) => {
    await discardRequestBody(c);
    return c.json({ conflict: await conflicts.resume(c.req.param('id'), human(c).id) });
  });
  app.post('/api/v1/conflicts/:id/cancel', async (c) => {
    await discardRequestBody(c);
    return c.json({ conflict: await conflicts.cancel(c.req.param('id'), human(c).id) });
  });
  app.post('/api/v1/conflicts/:id/concede', async (c) => {
    await discardRequestBody(c);
    const value = await conflicts.concede(c.req.param('id'), human(c).id);
    const verdict = judgeEnabled ? await judge.run(c.req.param('id')) : null;
    return c.json({ conflict: value, verdict });
  });

  app.post('/api/v1/agents', async (c) => {
    const user = human(c);
    const body = await jsonBody(c);
    const name = String(body.name ?? '').trim();
    if (name.length < 2 || name.length > 120)
      throw new DomainError('VALIDATION_ERROR', 'Agent name must be 2–120 characters.', 422);
    const timestamp = new Date().toISOString();
    const value: Agent = {
      id: opaqueId('agt'),
      ownerUserId: user.id,
      name,
      status: 'active',
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await db.createAgent(value);
    await db.recordAnalytics('agent_created', user.id, null, { agent_id: value.id });
    return c.json({ agent: value }, 201);
  });
  app.get('/api/v1/agents', async (c) => {
    const agents = await db.listAgents(human(c).id);
    return c.json({
      agents: await Promise.all(
        agents.map(async (agent) => {
          const conflicts = await db.listConflictsForAgent(agent.id);
          const deletionBlockingConflict = conflicts.find((candidate) =>
            ['active', 'paused', 'judging'].includes(candidate.status),
          );
          const recoveryConflict = conflicts.find((candidate) =>
            ['inviting', 'briefing', 'active', 'paused', 'judging'].includes(candidate.status),
          );
          return {
            ...agent,
            deletion_blocked: Boolean(deletionBlockingConflict),
            active_conflict: recoveryConflict
              ? { id: recoveryConflict.id, title: recoveryConflict.title }
              : null,
            runner: await runnerStatus(agent.id),
          };
        }),
      ),
    });
  });
  app.get('/api/v1/agents/:id', async (c) => {
    const user = human(c);
    const value = await db.getAgent(c.req.param('id'));
    if (!value || value.ownerUserId !== user.id)
      throw new DomainError('NOT_FOUND', 'Agent not found.', 404);
    return c.json({ agent: { ...value, runner: await runnerStatus(value.id) } });
  });
  app.get('/api/v1/agents/:id/local-cleanup', async (c) => {
    const user = human(c);
    const agentId = c.req.param('id');
    const agent = await db.getAgent(agentId);
    if (!agent || agent.ownerUserId !== user.id || agent.status !== 'active')
      throw new DomainError('NOT_FOUND', 'Agent not found.', 404);
    const assigned = (await db.listConflictsForAgent(agentId)).find((conflict) =>
      ['active', 'paused', 'judging'].includes(conflict.status),
    );
    if (assigned)
      throw new DomainError(
        'INVALID_STATE',
        'This Runner is assigned to an unfinished conflict. Resolve or cancel that conflict before local cleanup.',
        409,
      );
    const args = bootstrapArguments(allowedOrigin, [
      'runner',
      'uninstall',
      '--origin',
      allowedOrigin,
    ]);
    const preparation = codexRuntimePreparation(allowedOrigin, 'remove the ResolveRoom Runner');
    c.header('Cache-Control', 'no-store, private');
    return c.json({
      instruction: `Remove this computer's ResolveRoom Runner for ${allowedOrigin}. First ${preparation}. Once network access is available, invoke that exact Node executable directly and exactly once with this JSON argument array: \`${JSON.stringify(args)}\`. Do not use the system Node.js, npm, npx, pnpm, GitHub, or a package registry. Do not wrap, redirect, capture, or parse the command output. This same-origin cleanup stops and unregisters the background service, terminates any recorded fallback process, removes the private Runner runtime and logs, and deletes only this ResolveRoom origin's local credential, including its macOS Keychain entry when present. It is idempotent and returns a credential-redacted structured result. It does not delete the server-side Agent identity; return to ResolveRoom after it succeeds and finish step 2 there.`,
      command: bootstrapCommand(allowedOrigin, ['runner', 'uninstall', '--origin', allowedOrigin]),
      codex_runtime: {
        tool: 'load_workspace_dependencies',
        node_field: 'node executable',
        distribution: 'same-origin self-contained cleanup',
        execution: codexNetworkExecution(allowedOrigin),
        bootstrap_sha256: agentAssets.bootstrapSha256,
        bundle_sha256: agentAssets.bundleSha256,
        arguments: args,
      },
      scope: {
        origin: allowedOrigin,
        removes: ['background service', 'Runner process', 'private runtime and logs', 'credential'],
        server_agent_deleted: false,
      },
    });
  });
  app.delete('/api/v1/agents/:id', async (c) => {
    const user = human(c);
    const agentId = c.req.param('id');
    const agent = await db.getAgent(agentId);
    if (!agent || agent.ownerUserId !== user.id || agent.status !== 'active')
      throw new DomainError('NOT_FOUND', 'Agent not found.', 404);
    const result = await db.revokeAgent(agentId, user.id);
    if (result.status === 'in_use')
      throw new DomainError(
        'INVALID_STATE',
        'This agent is assigned to an active conflict. Resolve or cancel that conflict before deleting the agent.',
        409,
      );
    if (result.status === 'not_found') throw new DomainError('NOT_FOUND', 'Agent not found.', 404);
    await options.disconnectRunner?.(agentId, 'agent_deleted');
    for (const party of result.unboundParties)
      await db.appendEvent({
        conflictId: party.conflictId,
        eventType: 'agent_unbound',
        actorType: 'user',
        actorId: user.id,
        partyId: party.id,
        partyRole: party.role,
        visibility: 'case',
        payload: { agent_id: agentId, reason: 'agent_deleted' },
      });
    await db.recordAnalytics('agent_deleted', user.id, null, { agent_id: agentId });
    return c.body(null, 204);
  });
  app.post('/api/v1/agents/:id/tokens', async (c) => {
    const user = human(c);
    const ag = await db.getAgent(c.req.param('id'));
    if (!ag || ag.ownerUserId !== user.id || ag.status !== 'active')
      throw new DomainError('NOT_FOUND', 'Agent not found.', 404);
    const raw = secureToken('rr_agent_');
    const timestamp = new Date().toISOString();
    const token = {
      id: opaqueId('tok'),
      agentId: ag.id,
      tokenHash: await sha256(raw),
      tokenPrefix: raw.slice(0, 18),
      createdAt: timestamp,
      lastUsedAt: null,
      revokedAt: null,
    };
    await db.createAgentToken(token);
    return c.json(
      {
        token: { id: token.id, value: raw, prefix: token.tokenPrefix, created_at: timestamp },
        warning: 'This credential is shown once. Store it securely.',
      },
      201,
    );
  });
  app.post('/api/v1/agents/:id/tokens/rotate', async (c) => {
    const user = human(c);
    const ag = await db.getAgent(c.req.param('id'));
    if (!ag || ag.ownerUserId !== user.id || ag.status !== 'active')
      throw new DomainError('NOT_FOUND', 'Agent not found.', 404);
    await db.revokeAllAgentTokens(ag.id);
    await options.disconnectRunner?.(ag.id, 'credential_rotated');
    const raw = secureToken('rr_agent_');
    const timestamp = new Date().toISOString();
    const token = {
      id: opaqueId('tok'),
      agentId: ag.id,
      tokenHash: await sha256(raw),
      tokenPrefix: raw.slice(0, 18),
      createdAt: timestamp,
      lastUsedAt: null,
      revokedAt: null,
    };
    await db.createAgentToken(token);
    return c.json(
      {
        token: { id: token.id, value: raw, prefix: token.tokenPrefix, created_at: timestamp },
        warning: 'Previous credentials were revoked. This new credential is shown once.',
      },
      201,
    );
  });
  app.delete('/api/v1/agents/:id/tokens/:tokenId', async (c) => {
    const ok = await db.revokeAgentToken(c.req.param('tokenId'), human(c).id);
    if (!ok) throw new DomainError('NOT_FOUND', 'Credential not found.', 404);
    await options.disconnectRunner?.(c.req.param('id'), 'credential_revoked');
    return c.body(null, 204);
  });
  app.post('/api/v1/conflicts/:id/agent', async (c) => {
    const body = await jsonBody(c);
    return c.json({
      party: await conflicts.bindAgent(c.req.param('id'), human(c).id, String(body.agent_id ?? '')),
    });
  });
  app.delete('/api/v1/conflicts/:id/agent', async (c) =>
    c.json({ party: await conflicts.unbindAgent(c.req.param('id'), human(c).id) }),
  );

  app.post('/api/v1/conflicts/:id/agent/pairings', async (c) => {
    const user = human(c);
    const body = await jsonBody(c);
    const conflictId = c.req.param('id');
    let { conflict, party } = await conflicts.requireParticipant(conflictId, user.id);
    if (['resolved', 'cancelled', 'expired'].includes(conflict.status))
      throw new DomainError('INVALID_STATE', 'This conflict no longer accepts an agent.', 409);

    let ag = party.agentId ? await db.getAgent(party.agentId) : null;
    if (!ag || ag.status !== 'active') {
      const timestamp = new Date().toISOString();
      const requestedName = String(body.agent_name ?? '').trim();
      ag = {
        id: opaqueId('agt'),
        ownerUserId: user.id,
        name:
          requestedName.length >= 2 && requestedName.length <= 120
            ? requestedName
            : `${user.displayName}'s Codex agent`,
        status: 'active',
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      await db.createAgent(ag);
      await db.recordAnalytics('agent_created', user.id, conflictId, { agent_id: ag.id });
      party = await conflicts.bindAgent(conflictId, user.id, ag.id);
      conflict = (await db.getConflict(conflictId)) ?? conflict;
    }

    await db.revokeOpenAgentPairings(ag.id);
    const code = securePairingCode();
    const createdAt = new Date().toISOString();
    const pairing: AgentPairing = {
      id: opaqueId('prg'),
      agentId: ag.id,
      conflictId,
      codeHash: await sha256(code),
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      claimedAt: null,
      revokedAt: null,
      clientName: null,
      createdAt,
    };
    await db.createAgentPairing(pairing);
    const codexArguments = bootstrapArguments(allowedOrigin, [
      'connect',
      code,
      '--origin',
      allowedOrigin,
    ]);
    const codexReconnectArguments = bootstrapArguments(allowedOrigin, [
      'runner',
      'reconnect',
      '--origin',
      allowedOrigin,
    ]);
    const command = bootstrapCommand(allowedOrigin, ['connect', code, '--origin', allowedOrigin]);
    const reconnectCommand = bootstrapCommand(allowedOrigin, [
      'runner',
      'reconnect',
      '--origin',
      allowedOrigin,
    ]);
    const runtimePreparation = `${codexRuntimePreparation(allowedOrigin, 'install or reconnect the ResolveRoom Runner')}; the pairing code will remain unconsumed`;
    return c.json(
      {
        pairing: pairingView(pairing),
        code,
        instruction: `Connect this computer's Codex to ResolveRoom for “${conflict.title}”. Before running anything, ${runtimePreparation}. Once network access is available, invoke that exact Node executable directly and exactly once with this JSON argument array: \`${JSON.stringify(codexArguments)}\`. Do not use the system Node.js, npm, npx, pnpm, GitHub, or any package registry. Do not wrap, redirect, capture, or parse the command's output. The argument array contains direct JavaScript source and does not require Base64 decoding or a second eval. The same-origin bootstrap verifies the downloaded bootstrap and self-contained Runner bundle by SHA-256, validates the local Codex executable before consuming the pairing code, replaces any stale copied runtime, stores a protected recovery copy of the credential, and enables automatic later turns. Protect the private brief and never print or reveal the stored credential. If a restricted attempt returns \`error: "network_access_required"\` with \`pairing_consumed: false\`, retry the same JSON arguments exactly once after network access becomes available. If the result has \`pairing_consumed: true\` but the Runner is not online, keep the returned credential private and recover without a new pairing code by invoking the same bundled Node executable once with: \`${JSON.stringify(codexReconnectArguments)}\`.`,
        command,
        reconnect_command: reconnectCommand,
        recovery_instruction: `Finish the ResolveRoom Runner setup without generating a new pairing code. First ${runtimePreparation}. Once network access is available, invoke that exact Node executable directly once with this JSON argument array: \`${JSON.stringify(codexReconnectArguments)}\`. This same-origin flow does not use npm, pnpm, GitHub, or a package registry. Do not wrap or redirect the command; its structured output is credential-redacted. If a restricted attempt returns \`error: "network_access_required"\`, retry the same JSON arguments exactly once after network access becomes available. Never print or reveal the stored credential or private brief.`,
        codex_runtime: {
          tool: 'load_workspace_dependencies',
          node_field: 'node executable',
          distribution: 'same-origin self-contained bundle',
          execution: codexNetworkExecution(allowedOrigin),
          bootstrap_sha256: agentAssets.bootstrapSha256,
          bundle_sha256: agentAssets.bundleSha256,
          arguments: codexArguments,
          recovery_arguments: codexReconnectArguments,
        },
        agent: { id: ag.id, name: ag.name },
        party: { id: party.id, role: party.role, agent_bound: true },
      },
      201,
    );
  });

  app.post('/api/v1/agent-pairings/exchange', async (c) => {
    const body = await jsonBody(c);
    const code = normalizePairingCode(String(body.code ?? ''));
    const clientName = String(body.client_name ?? 'Codex')
      .trim()
      .slice(0, 120);
    if (!code || clientName.length < 2)
      throw new DomainError(
        'VALIDATION_ERROR',
        'A valid pairing code and client name are required.',
        422,
      );
    const raw = secureToken('rr_agent_');
    const createdAt = new Date().toISOString();
    const token: AgentToken = {
      id: opaqueId('tok'),
      agentId: '',
      tokenHash: await sha256(raw),
      tokenPrefix: raw.slice(0, 18),
      createdAt,
      lastUsedAt: null,
      revokedAt: null,
    };
    const claimed = await db.claimAgentPairing(await sha256(code), clientName, token);
    if (!claimed)
      throw new DomainError(
        'NOT_FOUND',
        'This pairing code is invalid, expired, or already used.',
        404,
      );
    token.agentId = claimed.agentId;
    const ag = await db.getAgent(claimed.agentId);
    if (!ag) throw new DomainError('NOT_FOUND', 'This pairing code is unavailable.', 404);
    await options.disconnectRunner?.(ag.id, 'credential_rotated');
    return c.json({
      credential: raw,
      credential_type: 'Bearer',
      agent: { id: ag.id, name: ag.name },
      conflict_id: claimed.conflictId,
      api_base_url: `${allowedOrigin}/api/v1`,
      warning: 'This credential is returned once. Store it securely and never print it.',
    });
  });

  app.get('/api/v1/agent-pairings/:id', async (c) => {
    const user = human(c);
    const pairing = await db.getAgentPairing(c.req.param('id'));
    const ag = pairing ? await db.getAgent(pairing.agentId) : null;
    if (!pairing || !ag || ag.ownerUserId !== user.id)
      throw new DomainError('NOT_FOUND', 'Pairing not found.', 404);
    c.header('Cache-Control', 'no-store, private');
    return c.json({ pairing: pairingView(pairing) });
  });

  app.get('/api/v1/agent/tasks', async (c) => {
    const ag = agentIdentity(c);
    const all = await allAgentConflicts(db, ag.id);
    const tasks = await Promise.all(
      all.map(async ({ conflict, party, parties }) => {
        const turn = authoritativeTurn(conflict, parties, await db.listEvents(conflict.id));
        const isYourTurn = Boolean(turn && turn.party_id === party.id);
        return {
          conflict_id: conflict.id,
          title: conflict.title,
          status: conflict.status,
          phase: conflict.currentPhase,
          your_party: party.role,
          your_turn: isYourTurn,
          allowed_actions: isYourTurn && turn ? turn.allowed_actions : [],
          deadline_at: conflict.deadlineAt,
        };
      }),
    );
    return c.json({ tasks });
  });
  app.get('/api/v1/agent/runner', async (c) => {
    const ag = agentIdentity(c);
    return c.json({ agent: { id: ag.id, name: ag.name }, runner: await runnerStatus(ag.id) });
  });
  app.post('/api/v1/conflicts/:id/actions', async (c) => {
    const ag = agentIdentity(c);
    const parsed = agentActionSchema.safeParse(await jsonBody(c));
    if (!parsed.success)
      throw new DomainError(
        'VALIDATION_ERROR',
        parsed.error.issues[0]?.message ?? 'Invalid action.',
        422,
      );
    const result = await conflicts.submitAction(c.req.param('id'), ag.id, parsed.data);
    console.log(
      JSON.stringify({
        level: 'info',
        event: 'agent_action_accepted',
        request_id: c.get('requestId'),
        conflict_id: c.req.param('id'),
        event_id: result.event.id,
        actor_type: 'agent',
        duplicate: result.duplicate,
      }),
    );
    if (judgeEnabled && result.needsJudging) await judge.run(c.req.param('id'));
    return c.json({
      event_id: result.event.id,
      sequence_number: result.event.sequenceNumber,
      accepted: true,
      duplicate: result.duplicate,
    });
  });
  app.post('/api/v1/conflicts/:id/judge', async (c) => {
    await discardRequestBody(c);
    await conflicts.requireParticipant(c.req.param('id'), human(c).id);
    if (!judgeEnabled)
      throw new DomainError(
        'JUDGE_UNAVAILABLE',
        'Advisory assessment is not enabled for this ResolveRoom deployment.',
        503,
      );
    return c.json({ verdict: await judge.run(c.req.param('id')) });
  });
  app.post('/api/v1/conflicts/:id/complete', async (c) => {
    await discardRequestBody(c);
    return c.json({
      conflict: await conflicts.completeWithoutJudge(c.req.param('id'), human(c).id),
    });
  });
  app.get('/api/v1/conflicts/:id/verdict', async (c) => {
    await conflicts.requireParticipant(c.req.param('id'), human(c).id);
    const value = await db.getVerdict(c.req.param('id'));
    if (!value) throw new DomainError('NOT_FOUND', 'Verdict is not available.', 404);
    return c.json({ verdict: value });
  });

  app.post('/api/v1/conflicts/:id/share-links', async (c) => {
    const user = human(c);
    await conflicts.requireOwner(c.req.param('id'), user.id);
    const body = await jsonBody(c);
    const raw = secureToken('rr_share_');
    const link = {
      id: opaqueId('shr'),
      conflictId: c.req.param('id'),
      tokenHash: await sha256(raw),
      expiresAt: body.expires_at ?? null,
      revokedAt: null,
      createdByUserId: user.id,
      createdAt: new Date().toISOString(),
    };
    await db.createShareLink(link);
    await db.recordAnalytics('share_link_created', user.id, link.conflictId, {
      share_id: link.id,
    });
    return c.json(
      {
        share_link: {
          id: link.id,
          url: `${options.appUrl ?? ''}/share/${raw}`,
          expires_at: link.expiresAt,
          created_at: link.createdAt,
        },
      },
      201,
    );
  });
  app.get('/api/v1/conflicts/:id/share-links', async (c) => {
    const user = human(c);
    await conflicts.requireOwner(c.req.param('id'), user.id);
    return c.json({
      share_links: (await db.listShareLinks(c.req.param('id'))).map((s) => ({
        id: s.id,
        expires_at: s.expiresAt,
        revoked_at: s.revokedAt,
        created_at: s.createdAt,
      })),
    });
  });
  app.delete('/api/v1/conflicts/:id/share-links/:shareId', async (c) => {
    const user = human(c);
    await conflicts.requireOwner(c.req.param('id'), user.id);
    if (!(await db.revokeShareLink(c.req.param('shareId'), c.req.param('id'))))
      throw new DomainError('NOT_FOUND', 'Share link not found.', 404);
    return c.body(null, 204);
  });
  app.get('/api/v1/share/:token', async (c) => {
    const link = await db.findShareLink(await sha256(c.req.param('token')));
    if (!link || link.revokedAt || (link.expiresAt && new Date(link.expiresAt) <= new Date()))
      throw new DomainError('NOT_FOUND', 'This shared record is unavailable.', 404);
    const conflict = await db.getConflict(link.conflictId);
    if (!conflict) throw new DomainError('NOT_FOUND', 'This shared record is unavailable.', 404);
    const parties = await db.getParties(link.conflictId);
    return c.json({
      conflict: publicConflict(conflict),
      parties: parties.map((p) => ({ role: p.role, display_name: p.displayName })),
      events: filterEvents(await db.listEvents(link.conflictId), { kind: 'observer' }),
      verdict: await db.getVerdict(link.conflictId),
      read_only: true,
    });
  });
  app.get('/api/v1/notifications', async (c) =>
    c.json({ notifications: await db.listNotifications(human(c).id) }),
  );
  app.post('/api/v1/notifications/:id/read', async (c) => {
    if (!(await db.markNotificationRead(c.req.param('id'), human(c).id)))
      throw new DomainError('NOT_FOUND', 'Notification not found.', 404);
    return c.json({ read: true });
  });

  app.notFound((c) =>
    c.json(
      errorBody(
        'NOT_FOUND',
        'Route not found.',
        c.get('requestId') ?? `req_${crypto.randomUUID()}`,
      ),
      404,
    ),
  );
  app.onError((error, c) => {
    const requestId = c.get('requestId') ?? `req_${crypto.randomUUID()}`;
    if (error instanceof DomainError)
      return c.json(
        errorBody(error.code, error.message, requestId),
        errorStatus[error.code] as any,
      );
    console.error(
      JSON.stringify({
        level: 'error',
        request_id: requestId,
        method: c.req.method,
        path: safeLogPath(c.req.path),
        conflict_id: c.req.path.match(/\/conflicts\/([^/]+)/)?.[1] ?? null,
        actor_type: c.get('identity')?.kind ?? 'anonymous',
        message: error instanceof Error ? error.message : 'Unknown error',
      }),
    );
    return c.json(errorBody('INTERNAL_ERROR', 'An unexpected error occurred.', requestId), 500);
  });
  return app;
}

function publicConflict(c: any) {
  return {
    id: c.id,
    title: c.title,
    description: c.description,
    protocol_type: c.protocolType,
    status: c.status,
    phase: c.currentPhase,
    round: c.currentRound,
    max_rounds: c.maxRounds,
    deadline_at: c.deadlineAt,
    turn_timeout_seconds: c.turnTimeoutSeconds,
    created_at: c.createdAt,
    updated_at: c.updatedAt,
    resolved_at: c.resolvedAt,
  };
}
function pairingView(pairing: AgentPairing) {
  const status = pairing.revokedAt
    ? 'revoked'
    : pairing.claimedAt
      ? 'connected'
      : new Date(pairing.expiresAt) <= new Date()
        ? 'expired'
        : 'waiting';
  return {
    id: pairing.id,
    agent_id: pairing.agentId,
    conflict_id: pairing.conflictId,
    status,
    expires_at: pairing.expiresAt,
    claimed_at: pairing.claimedAt,
    client_name: pairing.clientName,
    created_at: pairing.createdAt,
  };
}
export function authoritativeTurn(conflict: any, parties: ConflictParty[], events: any[]) {
  if (conflict.status !== 'active') return null;
  const first = parties.find((p) => p.id === conflict.firstSpeakerPartyId)?.role ?? 'party_a';
  const phaseIndex = Math.max(
    0,
    ['opening', 'rebuttal', 'closing'].indexOf(conflict.currentPhase ?? 'opening'),
  );
  const phaseStart = events.findLastIndex((e) => e.eventType === 'phase_started');
  const used = events
    .slice(phaseStart + 1)
    .filter((e) =>
      ['argument_submitted', 'rebuttal_submitted', 'closing_statement_submitted'].includes(
        e.eventType,
      ),
    ).length;
  const firstThisPhase = phaseIndex % 2 === 0 ? first : first === 'party_a' ? 'party_b' : 'party_a';
  const role = used === 0 ? firstThisPhase : firstThisPhase === 'party_a' ? 'party_b' : 'party_a';
  const party = parties.find((p) => p.role === role)!;
  const primary =
    conflict.currentPhase === 'opening'
      ? 'argument'
      : conflict.currentPhase === 'rebuttal'
        ? 'rebuttal'
        : 'closing_statement';
  return {
    party_id: party.id,
    party_role: role,
    allowed_actions: [primary, 'evidence', 'concede'],
  };
}
async function allAgentConflicts(db: Database, agentId: string) {
  const list: any[] = [];
  for (const conflict of await db.listConflictsForAgent(agentId)) {
    const parties = await db.getParties(conflict.id);
    const party = parties.find((p) => p.agentId === agentId);
    if (party) list.push({ conflict, party, parties });
  }
  return list;
}
async function runJudgeIfNeeded(db: Database, judge: JudgeService, id: string) {
  const conflict = await db.getConflict(id);
  if (conflict?.status === 'judging') await judge.run(id);
}
async function establishSession(c: Context, db: Database, userId: string, secure: boolean) {
  const raw = secureToken('rr_session_');
  const createdAt = new Date().toISOString();
  await db.createSession({
    id: `ses_${crypto.randomUUID().replaceAll('-', '')}`,
    userId,
    tokenHash: await sha256(raw),
    expiresAt: new Date(Date.now() + 30 * 86400_000).toISOString(),
    createdAt,
    revokedAt: null,
  });
  setCookie(c, 'rr_session', raw, {
    httpOnly: true,
    secure,
    sameSite: 'Lax',
    maxAge: 30 * 86400,
    path: '/',
  });
}
