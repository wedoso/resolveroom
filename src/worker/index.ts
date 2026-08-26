import { DurableObject } from 'cloudflare:workers';
import { authoritativeTurn, createApi, type RunnerStatus } from '@/api/app';
import { D1Store } from '@/persistence/d1';
import { LLMJudgeProvider, MockJudgeProvider, type JudgeProvider } from '@/judge/providers';
import { sha256 } from '@/domain/security';
import { ConflictService } from '@/services/conflicts';
import { JudgeService } from '@/judge/service';
import {
  ConsoleEmailProvider,
  HttpEmailProvider,
  NotificationService,
  type EmailProvider,
} from '@/notifications/service';

export interface Env {
  DB: D1Database;
  CONFLICT_ROOMS: DurableObjectNamespace;
  AGENT_RUNNERS: DurableObjectNamespace;
  ASSETS: Fetcher;
  ENVIRONMENT: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  JUDGE_PROVIDER: string;
  JUDGE_API_URL?: string;
  JUDGE_API_KEY?: string;
  JUDGE_MODEL?: string;
  EMAIL_PROVIDER: string;
  EMAIL_API_URL?: string;
  EMAIL_API_KEY?: string;
  EMAIL_FROM?: string;
  PUBLIC_APP_URL: string;
}

function provider(env: Env): JudgeProvider {
  if (env.JUDGE_PROVIDER === 'llm') {
    if (!env.JUDGE_API_URL || !env.JUDGE_API_KEY || !env.JUDGE_MODEL)
      throw new Error('JUDGE_PROVIDER=llm requires JUDGE_API_URL, JUDGE_API_KEY, and JUDGE_MODEL.');
    return new LLMJudgeProvider(env.JUDGE_API_URL, env.JUDGE_API_KEY, env.JUDGE_MODEL);
  }
  if (env.JUDGE_PROVIDER === 'mock' && env.ENVIRONMENT !== 'production')
    return new MockJudgeProvider();
  throw new Error('The Judge provider is disabled.');
}

const judgeEnabled = (env: Env) =>
  env.JUDGE_PROVIDER === 'llm' ||
  (env.JUDGE_PROVIDER === 'mock' && env.ENVIRONMENT !== 'production');

function apiOptions(env: Env) {
  const oauth: any = {};
  const judgeMode: 'disabled' | 'mock' | 'llm' = judgeEnabled(env)
    ? (env.JUDGE_PROVIDER as 'mock' | 'llm')
    : 'disabled';
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET)
    oauth.google = { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET };
  if (env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET)
    oauth.github = { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET };
  return {
    allowDevelopmentAuth: env.ENVIRONMENT !== 'production',
    judgeEnabled: judgeEnabled(env),
    judgeMode,
    judgeProvider: judgeEnabled(env) ? provider(env) : undefined,
    appUrl: env.PUBLIC_APP_URL,
    secureCookies: env.ENVIRONMENT === 'production',
    oauth,
    emailProvider: emailProvider(env),
    runnerStatus: async (agentId: string) => {
      const response = await env.AGENT_RUNNERS.getByName(agentId).fetch(
        'https://resolveroom.internal/internal/status',
      );
      return response.json<RunnerStatus>();
    },
    disconnectRunner: async (agentId: string, reason: string) => {
      await env.AGENT_RUNNERS.getByName(agentId).fetch(
        new Request('https://resolveroom.internal/internal/disconnect', {
          method: 'POST',
          body: JSON.stringify({ reason }),
        }),
      );
    },
  };
}

type RunnerJob = {
  id: string;
  conflict_id: string;
  party_id: string;
  phase: string | null;
  allowed_actions: string[];
  request_id: string;
  queued_at: string;
  state: 'queued' | 'working';
  attempts?: number;
  next_attempt_at?: string;
};

type RunnerMetadata = {
  connected_at: string | null;
  last_seen_at: string | null;
  device_name: string | null;
  runner_version: string | null;
  provider: string | null;
};

const runnerOfflineAfterMs = 75_000;

export class AgentRunner extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/internal/status') return Response.json(await this.status());
    if (url.pathname === '/internal/disconnect' && request.method === 'POST') {
      const body = (await request.json().catch(() => ({}))) as { reason?: string };
      for (const socket of this.ctx.getWebSockets())
        socket.close(4001, String(body.reason ?? 'authorization_changed').slice(0, 120));
      await this.ctx.storage.put('disconnect_reason', body.reason ?? 'authorization_changed');
      return new Response(null, { status: 204 });
    }
    if (url.pathname === '/internal/dispatch' && request.method === 'POST') {
      const job = (await request.json()) as RunnerJob;
      const jobs = await this.jobs();
      if (!jobs[job.id]) {
        jobs[job.id] = {
          ...job,
          attempts: 0,
          next_attempt_at: new Date(Date.now() + 30_000).toISOString(),
        };
        await this.ctx.storage.put('jobs', jobs);
      }
      this.send({ type: 'task', job: jobs[job.id] });
      await this.scheduleJobAlarm(jobs);
      return Response.json({ queued: true, online: this.ctx.getWebSockets().length > 0 });
    }
    if (
      url.pathname === '/api/v1/agent-runner/connect' &&
      request.headers.get('Upgrade')?.toLowerCase() === 'websocket'
    ) {
      const agentId = request.headers.get('x-resolveroom-agent-id');
      if (!agentId) return new Response('Unauthorized', { status: 401 });
      for (const existing of this.ctx.getWebSockets())
        existing.close(4000, 'A newer Runner connection replaced this one.');
      const pair = new WebSocketPair();
      const client = pair[0];
      const server = pair[1];
      const now = new Date().toISOString();
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment({ agent_id: agentId, connected_at: now });
      const metadata: RunnerMetadata = {
        connected_at: now,
        last_seen_at: now,
        device_name: null,
        runner_version: null,
        provider: null,
      };
      await this.ctx.storage.put('metadata', metadata);
      await this.ctx.storage.delete('disconnect_reason');
      server.send(JSON.stringify({ type: 'connected', heartbeat_interval_ms: 25_000 }));
      for (const job of Object.values(await this.jobs()))
        server.send(JSON.stringify({ type: 'task', job }));
      return new Response(null, { status: 101, webSocket: client });
    }
    return new Response('Not found', { status: 404 });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    if (typeof message !== 'string' || message.length > 16_384) return;
    let value: Record<string, unknown>;
    try {
      value = JSON.parse(message) as Record<string, unknown>;
    } catch {
      return;
    }
    const now = new Date().toISOString();
    const current = (await this.ctx.storage.get<RunnerMetadata>('metadata')) ?? {
      connected_at: now,
      last_seen_at: now,
      device_name: null,
      runner_version: null,
      provider: null,
    };
    if (value.type === 'hello' || value.type === 'heartbeat') {
      await this.ctx.storage.put('metadata', {
        ...current,
        last_seen_at: now,
        ...(typeof value.device_name === 'string'
          ? { device_name: value.device_name.slice(0, 120) }
          : {}),
        ...(typeof value.runner_version === 'string'
          ? { runner_version: value.runner_version.slice(0, 32) }
          : {}),
        ...(typeof value.provider === 'string' ? { provider: value.provider.slice(0, 32) } : {}),
      });
      if (value.type === 'hello')
        for (const job of Object.values(await this.jobs()))
          ws.send(JSON.stringify({ type: 'task', job }));
      return;
    }
    const jobId = typeof value.job_id === 'string' ? value.job_id : '';
    if (!jobId) return;
    const jobs = await this.jobs();
    if (value.type === 'ack' && jobs[jobId]) {
      jobs[jobId] = {
        ...jobs[jobId],
        state: 'working',
        next_attempt_at: new Date(Date.now() + 10 * 60_000).toISOString(),
      };
      await this.ctx.storage.put('jobs', jobs);
      await this.scheduleJobAlarm(jobs);
    }
    if (value.type === 'completed' || value.type === 'stale') {
      delete jobs[jobId];
      await this.ctx.storage.put('jobs', jobs);
      await this.scheduleJobAlarm(jobs);
    }
    if (value.type === 'failed' && jobs[jobId]) {
      const attempts = (jobs[jobId].attempts ?? 0) + 1;
      jobs[jobId] = {
        ...jobs[jobId],
        state: 'queued',
        attempts,
        next_attempt_at: new Date(
          Date.now() + Math.min(60_000, 5_000 * 2 ** Math.min(attempts - 1, 4)),
        ).toISOString(),
      };
      await this.ctx.storage.put('jobs', jobs);
      await this.scheduleJobAlarm(jobs);
    }
  }

  async alarm() {
    const jobs = await this.jobs();
    const now = Date.now();
    let changed = false;
    for (const [id, job] of Object.entries(jobs)) {
      const due = job.next_attempt_at ? new Date(job.next_attempt_at).getTime() <= now : true;
      if (!due) continue;
      const next = {
        ...job,
        state: 'queued' as const,
        next_attempt_at: new Date(now + 30_000).toISOString(),
      };
      jobs[id] = next;
      changed = true;
      this.send({ type: 'task', job: next });
    }
    if (changed) await this.ctx.storage.put('jobs', jobs);
    await this.scheduleJobAlarm(jobs);
  }

  webSocketClose() {}

  webSocketError() {}

  private async jobs() {
    return (await this.ctx.storage.get<Record<string, RunnerJob>>('jobs')) ?? {};
  }

  private async scheduleJobAlarm(jobs: Record<string, RunnerJob>) {
    const next = Object.values(jobs)
      .map((job) => (job.next_attempt_at ? new Date(job.next_attempt_at).getTime() : Date.now()))
      .filter(Number.isFinite)
      .sort((left, right) => left - right)[0];
    if (next === undefined) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(Math.max(Date.now() + 1000, next));
  }

  private send(value: unknown) {
    const payload = JSON.stringify(value);
    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.send(payload);
      } catch {
        // A replacement connection will receive the durable queued job.
      }
    }
  }

  private async status() {
    const metadata = (await this.ctx.storage.get<RunnerMetadata>('metadata')) ?? {
      connected_at: null,
      last_seen_at: null,
      device_name: null,
      runner_version: null,
      provider: null,
    };
    const jobs = Object.values(await this.jobs());
    const connected = this.ctx.getWebSockets().length > 0;
    const lastSeenMs = metadata.last_seen_at ? new Date(metadata.last_seen_at).getTime() : 0;
    const fresh = connected && Date.now() - lastSeenMs <= runnerOfflineAfterMs;
    const recentlyLost =
      !connected && lastSeenMs > 0 && Date.now() - lastSeenMs <= runnerOfflineAfterMs;
    const state = fresh
      ? jobs.some((job) => job.state === 'working')
        ? 'working'
        : 'online'
      : recentlyLost || connected
        ? 'reconnecting'
        : 'reconnect_required';
    return {
      state,
      online: state === 'online' || state === 'working',
      needs_reconnect: state === 'reconnect_required',
      connected_at: metadata.connected_at,
      last_seen_at: metadata.last_seen_at,
      device_name: metadata.device_name,
      runner_version: metadata.runner_version,
      provider: metadata.provider,
      pending_tasks: jobs.length,
      active_conflict_id: jobs.find((job) => job.state === 'working')?.conflict_id ?? null,
      reconnect_reason:
        (await this.ctx.storage.get<string>('disconnect_reason')) ??
        (state === 'reconnect_required' ? 'runner_offline' : null),
    };
  }
}

function emailProvider(env: Env): EmailProvider {
  if (env.EMAIL_PROVIDER === 'http') {
    if (!env.EMAIL_API_URL || !env.EMAIL_API_KEY)
      throw new Error('EMAIL_PROVIDER=http requires EMAIL_API_URL and EMAIL_API_KEY.');
    return new HttpEmailProvider(
      env.EMAIL_API_URL,
      env.EMAIL_API_KEY,
      env.EMAIL_FROM ?? 'ResolveRoom <notifications@example.com>',
    );
  }
  return new ConsoleEmailProvider();
}

export class ConflictRoom extends DurableObject<Env> {
  private sockets = new Set<WebSocket>();
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
  }
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/internal/dispatch' && request.method === 'POST') {
      const body = (await request.json()) as { conflict_id?: string };
      if (!body.conflict_id) return new Response('Bad request', { status: 400 });
      await this.dispatchCurrentTurn(body.conflict_id);
      return new Response(null, { status: 204 });
    }
    if (url.pathname === '/internal/alarm') {
      const conflictId = url.searchParams.get('conflict_id');
      if (!conflictId) return new Response('Bad request', { status: 400 });
      await this.ctx.storage.put('conflictId', conflictId);
      await this.alarm();
      return new Response(null, { status: 204 });
    }
    if (url.pathname.endsWith('/stream') && request.headers.get('Upgrade') === 'websocket') {
      const conflictId = url.pathname.split('/').at(-2)!;
      if (!(await this.canSubscribe(request, conflictId)))
        return new Response('Unauthorized', { status: 401 });
      const pair = new WebSocketPair();
      const client = pair[0];
      const server = pair[1];
      this.ctx.acceptWebSocket(server);
      this.sockets.add(server);
      server.send(JSON.stringify({ type: 'connected', at: new Date().toISOString() }));
      return new Response(null, { status: 101, webSocket: client });
    }
    const api = createApi(new D1Store(this.env.DB), apiOptions(this.env));
    const response = await api.fetch(request, this.env as any);
    if (response.ok && request.method !== 'GET') {
      let conflictId = url.pathname.match(/^\/api\/v1\/conflicts\/([^/]+)/)?.[1];
      const inviteToken = url.pathname.match(/^\/api\/v1\/invites\/([^/]+)\/accept$/)?.[1];
      if (!conflictId && inviteToken)
        conflictId = (await new D1Store(this.env.DB).findInvitation(await sha256(inviteToken)))
          ?.conflictId;
      if (conflictId) await this.scheduleAlarm(conflictId);
      if (conflictId) await this.dispatchCurrentTurn(conflictId);
      this.broadcast();
    }
    return response;
  }
  async alarm() {
    const db = new D1Store(this.env.DB);
    const conflicts = new ConflictService(db);
    const conflictId = await this.ctx.storage.get<string>('conflictId');
    if (!conflictId) return;
    const result = await conflicts.handleAlarm(conflictId);
    if (judgeEnabled(this.env) && result.needsJudging)
      await new JudgeService(
        db,
        provider(this.env),
        new NotificationService(db, emailProvider(this.env)),
      ).run(conflictId);
    await this.scheduleAlarm(conflictId);
    if (result.changed) {
      await this.dispatchCurrentTurn(conflictId);
      this.broadcast();
    }
  }
  private async scheduleAlarm(conflictId: string) {
    await this.ctx.storage.put('conflictId', conflictId);
    const conflict = await new D1Store(this.env.DB).getConflict(conflictId);
    if (!conflict || conflict.status !== 'active') {
      await this.ctx.storage.deleteAlarm();
      return;
    }
    const candidates = [
      conflict.deadlineAt ? new Date(conflict.deadlineAt).getTime() : Number.POSITIVE_INFINITY,
      conflict.turnTimeoutSeconds
        ? Date.now() + conflict.turnTimeoutSeconds * 1000
        : Number.POSITIVE_INFINITY,
    ];
    const next = Math.min(...candidates);
    if (Number.isFinite(next)) await this.ctx.storage.setAlarm(Math.max(Date.now() + 1000, next));
    else await this.ctx.storage.deleteAlarm();
  }
  private async dispatchCurrentTurn(conflictId: string) {
    const db = new D1Store(this.env.DB);
    const conflict = await db.getConflict(conflictId);
    if (!conflict || conflict.status !== 'active') return;
    const parties = await db.getParties(conflictId);
    const events = await db.listEvents(conflictId);
    const turn = authoritativeTurn(conflict, parties, events);
    if (!turn) return;
    const party = parties.find((candidate) => candidate.id === turn.party_id);
    if (!party?.agentId) return;
    const latestSequence = events.at(-1)?.sequenceNumber ?? 0;
    const job: RunnerJob = {
      id: `job_${conflictId}_${conflict.version}_${latestSequence}_${party.id}`,
      conflict_id: conflictId,
      party_id: party.id,
      phase: conflict.currentPhase,
      allowed_actions: turn.allowed_actions,
      request_id: `runner_${conflictId}_${conflict.version}_${latestSequence}_${party.id}`,
      queued_at: new Date().toISOString(),
      state: 'queued',
    };
    await this.env.AGENT_RUNNERS.getByName(party.agentId).fetch(
      new Request('https://resolveroom.internal/internal/dispatch', {
        method: 'POST',
        body: JSON.stringify(job),
      }),
    );
  }
  private broadcast() {
    const message = JSON.stringify({ type: 'state_changed', at: new Date().toISOString() });
    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.send(message);
      } catch {
        this.sockets.delete(socket);
      }
    }
  }
  private async canSubscribe(request: Request, conflictId: string) {
    const db = new D1Store(this.env.DB);
    const authorization = request.headers.get('Authorization');
    if (authorization?.startsWith('Bearer rr_agent_')) {
      const token = await db.findAgentToken(await sha256(authorization.slice(7)));
      return Boolean(
        token && !token.revokedAt && (await db.findPartyForAgent(conflictId, token.agentId)),
      );
    }
    const sessionToken = request.headers
      .get('Cookie')
      ?.split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith('rr_session='))
      ?.slice('rr_session='.length);
    if (sessionToken) {
      const session = await db.findSession(await sha256(decodeURIComponent(sessionToken)));
      if (
        session &&
        !session.revokedAt &&
        new Date(session.expiresAt) > new Date() &&
        (await db.findPartyForUser(conflictId, session.userId))
      )
        return true;
    }
    const shareToken = urlSafeToken(new URL(request.url).searchParams.get('share_token'));
    if (shareToken) {
      const link = await db.findShareLink(await sha256(shareToken));
      return Boolean(
        link &&
        link.conflictId === conflictId &&
        !link.revokedAt &&
        (!link.expiresAt || new Date(link.expiresAt) > new Date()),
      );
    }
    return false;
  }
  webSocketClose(ws: WebSocket) {
    this.sockets.delete(ws);
  }
  webSocketError(ws: WebSocket) {
    this.sockets.delete(ws);
  }
}

function urlSafeToken(value: string | null) {
  return value?.startsWith('rr_share_') ? value : null;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/api/v1/agent-runner/connect') {
      if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket')
        return new Response('Upgrade required', { status: 426 });
      const authorization = request.headers.get('Authorization');
      if (!authorization?.startsWith('Bearer rr_agent_'))
        return new Response('Unauthorized', { status: 401 });
      const db = new D1Store(env.DB);
      const token = await db.findAgentToken(await sha256(authorization.slice(7)));
      const agent = token && !token.revokedAt ? await db.getAgent(token.agentId) : null;
      if (!agent || agent.status !== 'active') return new Response('Unauthorized', { status: 401 });
      const headers = new Headers(request.headers);
      headers.delete('Authorization');
      headers.set('x-resolveroom-agent-id', agent.id);
      const response = await env.AGENT_RUNNERS.getByName(agent.id).fetch(
        new Request(request, { headers }),
      );
      ctx.waitUntil(
        (async () => {
          const conflicts = await db.listConflictsForAgent(agent.id);
          await Promise.all(
            conflicts
              .filter((conflict) => conflict.status === 'active')
              .map((conflict) =>
                env.CONFLICT_ROOMS.getByName(conflict.id).fetch(
                  new Request('https://resolveroom.internal/internal/dispatch', {
                    method: 'POST',
                    body: JSON.stringify({ conflict_id: conflict.id }),
                  }),
                ),
              ),
          );
        })(),
      );
      return response;
    }
    const inviteAcceptance =
      request.method === 'POST'
        ? url.pathname.match(/^\/api\/v1\/invites\/([^/]+)\/accept$/)
        : null;
    if (inviteAcceptance) {
      const invitation = await new D1Store(env.DB).findInvitation(
        await sha256(inviteAcceptance[1]),
      );
      if (invitation) {
        const id = env.CONFLICT_ROOMS.idFromName(invitation.conflictId);
        return env.CONFLICT_ROOMS.get(id).fetch(request);
      }
    }
    // Every conflict-scoped request must observe the same coordination boundary. Splitting reads
    // (conflict, events) from writes and private reads (actions, brief) can expose different D1
    // consistency views immediately after pairing, which looks like a valid task followed by a 404.
    const coordinated = url.pathname.match(/^\/api\/v1\/conflicts\/([^/]+)(?:\/|$)/);
    if (coordinated) {
      const id = env.CONFLICT_ROOMS.idFromName(coordinated[1]);
      return env.CONFLICT_ROOMS.get(id).fetch(request);
    }
    if (
      url.pathname.startsWith('/api/') ||
      url.pathname === '/openapi.json' ||
      url.pathname === '/.well-known/resolveroom-agent.json' ||
      url.pathname === '/health'
    ) {
      return createApi(new D1Store(env.DB), apiOptions(env)).fetch(request, env as any, ctx);
    }
    const asset = await env.ASSETS.fetch(request);
    const headers = new Headers(asset.headers);
    headers.set(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self' ws: wss:; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    );
    headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('X-Frame-Options', 'DENY');
    if (env.ENVIRONMENT === 'production')
      headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    return new Response(asset.body, {
      status: asset.status,
      statusText: asset.statusText,
      headers,
    });
  },
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    const due = await env.DB.prepare(
      "SELECT id FROM conflicts WHERE deadline_at IS NOT NULL AND deadline_at <= ? AND status IN ('inviting','briefing','active') LIMIT 100",
    )
      .bind(new Date().toISOString())
      .all<{ id: string }>();
    for (const row of due.results) {
      const stub = env.CONFLICT_ROOMS.get(env.CONFLICT_ROOMS.idFromName(row.id));
      ctx.waitUntil(
        stub.fetch(
          `https://resolveroom.internal/internal/alarm?conflict_id=${encodeURIComponent(row.id)}`,
        ),
      );
    }
  },
} satisfies ExportedHandler<Env>;
