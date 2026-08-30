import { beforeEach, describe, expect, it } from 'vitest';
import { createApi } from '@/api/app';
import { MemoryDatabase } from '@/persistence/memory';
import { MockJudgeProvider } from '@/judge/providers';

describe('headless two-agent acceptance flow', () => {
  let db: MemoryDatabase;
  let app: ReturnType<typeof createApi>;
  beforeEach(() => {
    db = new MemoryDatabase();
    app = createApi(db, { allowDevelopmentAuth: true, appUrl: 'http://resolveroom.test' });
  });
  const call = async (path: string, init: RequestInit = {}) =>
    app.request(`http://resolveroom.test${path}`, init);
  const json = async (path: string, init: RequestInit = {}) => {
    const response = await call(path, {
      ...init,
      headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
    });
    return { response, body: response.status === 204 ? null : ((await response.json()) as any) };
  };

  it.each([
    { rounds: 3, failJudge: false },
    { rounds: 5, failJudge: false },
    { rounds: 10, failJudge: false },
    { rounds: 5, failJudge: true },
  ])(
    'runs $rounds rounds with Judge failure=$failJudge, sharing and revocation',
    async ({ rounds, failJudge }) => {
      let providerUnavailable = failJudge;
      let judgeAttempts = 0;
      app = createApi(db, {
        allowDevelopmentAuth: true,
        appUrl: 'http://resolveroom.test',
        judgeProvider: {
          name: 'recoverable-mock',
          async evaluate(input) {
            judgeAttempts += 1;
            if (providerUnavailable) throw new Error('quota exceeded');
            return new MockJudgeProvider().evaluate(input);
          },
        },
      });
      const alice = (
        await json('/api/v1/auth/development', {
          method: 'POST',
          body: JSON.stringify({ email: 'alice@example.test', display_name: 'Alice' }),
        })
      ).body.user;
      const bob = (
        await json('/api/v1/auth/development', {
          method: 'POST',
          body: JSON.stringify({ email: 'bob@example.test', display_name: 'Bob' }),
        })
      ).body.user;
      const ah = { 'x-dev-user-id': alice.id };
      const bh = { 'x-dev-user-id': bob.id };
      const created = await json('/api/v1/conflicts', {
        method: 'POST',
        headers: ah,
        body: JSON.stringify({
          title: 'Tokyo vs Vancouver',
          description: 'Where should the team hold its next offsite?',
          protocol_type: 'debate',
          max_rounds: rounds,
          resolution_mode: 'judge',
        }),
      });
      expect(created.response.status).toBe(201);
      const conflictId = created.body.conflict.id;
      const invitation = await json(`/api/v1/conflicts/${conflictId}/invite`, {
        method: 'POST',
        headers: ah,
        body: '{}',
      });
      const inviteToken = invitation.body.invite.url.split('/').at(-1);
      expect(
        (
          await json(`/api/v1/invites/${inviteToken}/accept`, {
            method: 'POST',
            headers: bh,
            body: '{}',
          })
        ).response.status,
      ).toBe(200);
      const agentA = (
        await json('/api/v1/agents', {
          method: 'POST',
          headers: ah,
          body: JSON.stringify({ name: 'Alice Agent' }),
        })
      ).body.agent;
      const agentB = (
        await json('/api/v1/agents', {
          method: 'POST',
          headers: bh,
          body: JSON.stringify({ name: 'Bob Agent' }),
        })
      ).body.agent;
      const tokenA = (
        await json(`/api/v1/agents/${agentA.id}/tokens`, {
          method: 'POST',
          headers: ah,
          body: '{}',
        })
      ).body.token;
      const tokenB = (
        await json(`/api/v1/agents/${agentB.id}/tokens`, {
          method: 'POST',
          headers: bh,
          body: '{}',
        })
      ).body.token;
      await json(`/api/v1/conflicts/${conflictId}/agent`, {
        method: 'POST',
        headers: ah,
        body: JSON.stringify({ agent_id: agentA.id }),
      });
      await json(`/api/v1/conflicts/${conflictId}/agent`, {
        method: 'POST',
        headers: bh,
        body: JSON.stringify({ agent_id: agentB.id }),
      });
      await json(`/api/v1/conflicts/${conflictId}/brief`, {
        method: 'PUT',
        headers: ah,
        body: JSON.stringify({
          goal: 'Advocate Tokyo',
          priorities: ['Participation'],
          acceptableCompromises: ['Vancouver if 40% cheaper'],
          privateNotes: 'Alice-only note',
        }),
      });
      await json(`/api/v1/conflicts/${conflictId}/brief`, {
        method: 'PUT',
        headers: bh,
        body: JSON.stringify({
          goal: 'Advocate Vancouver',
          priorities: ['Budget'],
          acceptableCompromises: [],
          privateNotes: 'Bob-only note',
        }),
      });
      await json(`/api/v1/conflicts/${conflictId}/ready`, {
        method: 'POST',
        headers: ah,
        body: '{"ready":true}',
      });
      const ready = await json(`/api/v1/conflicts/${conflictId}/ready`, {
        method: 'POST',
        headers: bh,
        body: '{"ready":true}',
      });
      expect(ready.body.started).toBe(true);

      const authA = { Authorization: `Bearer ${tokenA.value}` };
      const authB = { Authorization: `Bearer ${tokenB.value}` };
      const briefA = (await json(`/api/v1/conflicts/${conflictId}/brief`, { headers: authA })).body
        .brief;
      const briefB = (await json(`/api/v1/conflicts/${conflictId}/brief`, { headers: authB })).body
        .brief;
      expect(briefA.content.privateNotes).toBe('Alice-only note');
      expect(briefB.content.privateNotes).toBe('Bob-only note');
      for (let turn = 0; turn < rounds * 2; turn += 1) {
        const tasksA = (await json('/api/v1/agent/tasks', { headers: authA })).body.tasks;
        const tasksB = (await json('/api/v1/agent/tasks', { headers: authB })).body.tasks;
        const a = tasksA.find((t: any) => t.conflict_id === conflictId);
        const b = tasksB.find((t: any) => t.conflict_id === conflictId);
        const mine = a.your_turn
          ? { task: a, headers: authA, label: 'A' }
          : { task: b, headers: authB, label: 'B' };
        expect(mine.task.your_turn).toBe(true);
        const action = mine.task.allowed_actions[0];
        expect(mine.task.round).toBe(Math.floor(turn / 2) + 1);
        expect(mine.task.max_rounds).toBe(rounds);
        expect(action).toBe(
          turn < 2 ? 'argument' : turn >= (rounds - 1) * 2 ? 'closing_statement' : 'rebuttal',
        );
        for (const headers of [authA, authB]) {
          const context = (await json(`/api/v1/conflicts/${conflictId}`, { headers })).body;
          expect(context.description).toBe('Where should the team hold its next offsite?');
          const history = (await json(`/api/v1/conflicts/${conflictId}/events`, { headers })).body
            .events;
          expect(history.filter((event: any) => event.actorType === 'agent')).toHaveLength(turn);
          expect(JSON.stringify(history)).not.toContain('only note');
        }
        const submitted = await json(`/api/v1/conflicts/${conflictId}/actions`, {
          method: 'POST',
          headers: mine.headers,
          body: JSON.stringify({
            action_type: action,
            content: `${mine.label} ${action} ${turn}: a concrete and reasoned case.`,
            client_request_id: `headless-turn-${turn}`,
          }),
        });
        expect(submitted.response.status).toBe(200);
      }
      if (failJudge) {
        // The last accepted statement must still return 200, with no fake verdict.
        expect(judgeAttempts).toBe(2);
        expect((await db.getConflict(conflictId))?.status).toBe('judging');
        expect(await db.getVerdict(conflictId)).toBeNull();
        expect(
          (await db.listEvents(conflictId)).filter(
            (e) => e.eventType === 'closing_statement_submitted',
          ),
        ).toHaveLength(2);
        providerUnavailable = false;
        const retry = await json(`/api/v1/conflicts/${conflictId}/judge`, {
          method: 'POST',
          headers: ah,
          body: '{}',
        });
        expect(retry.response.status).toBe(200);
        expect(judgeAttempts).toBe(3);
      }
      const state = (await json(`/api/v1/conflicts/${conflictId}`, { headers: ah })).body;
      expect(state.status).toBe('resolved');
      const verdict = (await json(`/api/v1/conflicts/${conflictId}/verdict`, { headers: ah })).body
        .verdict.verdict;
      expect(verdict.protocolType).toBe('debate');
      expect(verdict.confidence).toBeGreaterThan(0);
      const aliceNotifications = (await json('/api/v1/notifications', { headers: ah })).body
        .notifications;
      const bobNotifications = (await json('/api/v1/notifications', { headers: bh })).body
        .notifications;
      expect(aliceNotifications.some((item: any) => item.type === 'conflict_started')).toBe(true);
      expect(aliceNotifications.some((item: any) => item.type === 'verdict_ready')).toBe(true);
      expect(bobNotifications.some((item: any) => item.type === 'verdict_ready')).toBe(true);
      const unread = aliceNotifications.find((item: any) => !item.readAt);
      expect(
        (
          await json(`/api/v1/notifications/${unread.id}/read`, {
            method: 'POST',
            headers: ah,
            body: '{}',
          })
        ).body.read,
      ).toBe(true);
      const events = (await json(`/api/v1/conflicts/${conflictId}/events`, { headers: ah })).body
        .events;
      const sequences = events.map((e: any) => e.sequenceNumber);
      expect(sequences).toEqual([...sequences].sort((a: number, b: number) => a - b));
      expect(new Set(sequences).size).toBe(sequences.length);
      expect(JSON.stringify(events)).not.toContain('Bob-only note');
      const shared = await json(`/api/v1/conflicts/${conflictId}/share-links`, {
        method: 'POST',
        headers: ah,
        body: '{}',
      });
      const shareId = shared.body.share_link.id;
      const shareToken = shared.body.share_link.url.split('/').at(-1);
      const observer = await json(`/api/v1/share/${shareToken}`);
      expect(observer.response.status).toBe(200);
      expect(observer.body.read_only).toBe(true);
      expect(JSON.stringify(observer.body)).not.toContain('Alice-only note');
      expect(JSON.stringify(observer.body)).not.toContain('Bob-only note');
      expect(JSON.stringify(observer.body)).not.toContain('rr_agent_');
      const mutate = await json(`/api/v1/conflicts/${conflictId}/pause`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${shareToken}` },
        body: '{}',
      });
      expect(mutate.response.status).toBe(401);
      expect(
        (
          await call(`/api/v1/conflicts/${conflictId}/share-links/${shareId}`, {
            method: 'DELETE',
            headers: ah,
          })
        ).status,
      ).toBe(204);
      expect((await call(`/api/v1/share/${shareToken}`)).status).toBe(404);
    },
  );

  it('runs the persuasion protocol end-to-end and returns a persuasion verdict', async () => {
    const owner = (
      await json('/api/v1/auth/development', {
        method: 'POST',
        body: JSON.stringify({ email: 'casey@example.test', display_name: 'Casey' }),
      })
    ).body.user;
    const target = (
      await json('/api/v1/auth/development', {
        method: 'POST',
        body: JSON.stringify({ email: 'drew@example.test', display_name: 'Drew' }),
      })
    ).body.user;
    const ownerHeaders = { 'x-dev-user-id': owner.id };
    const targetHeaders = { 'x-dev-user-id': target.id };
    const created = await json('/api/v1/conflicts', {
      method: 'POST',
      headers: ownerHeaders,
      body: JSON.stringify({
        title: 'Adopt a four-day pilot',
        description: 'Should the operations group try a six-week four-day-workweek pilot?',
        protocol_type: 'persuasion',
        persuader_party: 'party_a',
        max_rounds: 3,
        resolution_mode: 'judge',
      }),
    });
    const conflictId = created.body.conflict.id;
    const invitation = await json(`/api/v1/conflicts/${conflictId}/invite`, {
      method: 'POST',
      headers: ownerHeaders,
      body: '{}',
    });
    await json(`/api/v1/invites/${invitation.body.invite.url.split('/').at(-1)}/accept`, {
      method: 'POST',
      headers: targetHeaders,
      body: '{}',
    });
    const credentials: Array<{ headers: Record<string, string>; token: string }> = [];
    for (const [name, headers] of [
      ['Casey Agent', ownerHeaders],
      ['Drew Agent', targetHeaders],
    ] as const) {
      const ag = (
        await json('/api/v1/agents', {
          method: 'POST',
          headers,
          body: JSON.stringify({ name }),
        })
      ).body.agent;
      const token = (
        await json(`/api/v1/agents/${ag.id}/tokens`, {
          method: 'POST',
          headers,
          body: '{}',
        })
      ).body.token.value;
      await json(`/api/v1/conflicts/${conflictId}/agent`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ agent_id: ag.id }),
      });
      credentials.push({ headers: { Authorization: `Bearer ${token}` }, token });
    }
    await json(`/api/v1/conflicts/${conflictId}/ready`, {
      method: 'POST',
      headers: ownerHeaders,
      body: '{}',
    });
    await json(`/api/v1/conflicts/${conflictId}/ready`, {
      method: 'POST',
      headers: targetHeaders,
      body: '{}',
    });
    for (let turn = 0; turn < 6; turn += 1) {
      let acting: (typeof credentials)[number] | undefined;
      let task: any;
      for (const credential of credentials) {
        const tasks = (await json('/api/v1/agent/tasks', { headers: credential.headers })).body
          .tasks;
        const candidate = tasks.find((item: any) => item.conflict_id === conflictId);
        if (candidate?.your_turn) {
          acting = credential;
          task = candidate;
          break;
        }
      }
      expect(acting).toBeDefined();
      const action = task.allowed_actions[0];
      const response = await json(`/api/v1/conflicts/${conflictId}/actions`, {
        method: 'POST',
        headers: acting!.headers,
        body: JSON.stringify({
          action_type: action,
          content: `Persuasion turn ${turn}: respond directly with a measurable proposal.`,
          client_request_id: `persuasion-turn-${turn}`,
        }),
      });
      expect(response.response.status).toBe(200);
    }
    const verdict = (
      await json(`/api/v1/conflicts/${conflictId}/verdict`, { headers: ownerHeaders })
    ).body.verdict.verdict;
    expect(verdict.protocolType).toBe('persuasion');
    expect(verdict.persuasionScore).toBeGreaterThan(0);
    expect(verdict.strongestArguments.length).toBeGreaterThan(0);
  });
});
