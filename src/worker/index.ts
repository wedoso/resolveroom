import { createApi } from '@/api/app';
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
  };
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

export class ConflictRoom implements DurableObject {
  private sockets = new Set<WebSocket>();
  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env,
  ) {}
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/internal/alarm') {
      const conflictId = url.searchParams.get('conflict_id');
      if (!conflictId) return new Response('Bad request', { status: 400 });
      await this.state.storage.put('conflictId', conflictId);
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
      this.state.acceptWebSocket(server);
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
      this.broadcast();
    }
    return response;
  }
  async alarm() {
    const db = new D1Store(this.env.DB);
    const conflicts = new ConflictService(db);
    const conflictId = await this.state.storage.get<string>('conflictId');
    if (!conflictId) return;
    const result = await conflicts.handleAlarm(conflictId);
    if (judgeEnabled(this.env) && result.needsJudging)
      await new JudgeService(
        db,
        provider(this.env),
        new NotificationService(db, emailProvider(this.env)),
      ).run(conflictId);
    await this.scheduleAlarm(conflictId);
    if (result.changed) this.broadcast();
  }
  private async scheduleAlarm(conflictId: string) {
    await this.state.storage.put('conflictId', conflictId);
    const conflict = await new D1Store(this.env.DB).getConflict(conflictId);
    if (!conflict || conflict.status !== 'active') {
      await this.state.storage.deleteAlarm();
      return;
    }
    const candidates = [
      conflict.deadlineAt ? new Date(conflict.deadlineAt).getTime() : Number.POSITIVE_INFINITY,
      conflict.turnTimeoutSeconds
        ? Date.now() + conflict.turnTimeoutSeconds * 1000
        : Number.POSITIVE_INFINITY,
    ];
    const next = Math.min(...candidates);
    if (Number.isFinite(next)) await this.state.storage.setAlarm(Math.max(Date.now() + 1000, next));
    else await this.state.storage.deleteAlarm();
  }
  private broadcast() {
    const message = JSON.stringify({ type: 'state_changed', at: new Date().toISOString() });
    for (const socket of this.state.getWebSockets()) {
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
    const coordinated = url.pathname.match(
      /^\/api\/v1\/conflicts\/([^/]+)\/(ready|pause|resume|cancel|concede|actions|judge|stream|agent(?:\/pairings)?|brief|invite)$/,
    );
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
