import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  judgeInputFromEvents,
  validateVerdict,
  type JudgeInput,
  type JudgeProvider,
  MockJudgeProvider,
  WorkersAIJudgeProvider,
  LLMJudgeProvider,
  judgeMessages,
  workersAIJudgeModel,
} from '@/judge/providers';
import { JudgeService } from '@/judge/service';
import { isDailyQuotaError, JudgeQuotaError, nextDailyReset } from '@/judge/quota';
import { MemoryDatabase } from '@/persistence/memory';
import { opaqueId } from '@/domain/security';
import type { Conflict, ConflictParty, User } from '@/domain/types';
import { createApi } from '@/api/app';

const input: JudgeInput = {
  conflictId: 'con_test',
  title: 'Tokyo vs Vancouver',
  description: 'Choose one.',
  protocolType: 'debate',
  events: [{ id: 'evt_valid', party: 'party_a', type: 'argument_submitted', content: 'A case.' }],
  concededBy: null,
};
const valid = {
  protocolType: 'debate' as const,
  winner: 'party_a' as const,
  confidence: 0.8,
  scores: {
    partyA: { logic: 80, evidence: 80, rebuttal: 80, responsiveness: 80, overall: 80 },
    partyB: { logic: 70, evidence: 70, rebuttal: 70, responsiveness: 70, overall: 70 },
  },
  summary: 'Party A made the stronger case.',
  decidingPoints: ['Reason'],
  partyAStrengths: ['Clear'],
  partyBStrengths: ['Focused'],
  partyAWeaknesses: ['Short'],
  partyBWeaknesses: ['Incomplete'],
  unresolvedQuestions: ['Cost?'],
  citedEventIds: ['evt_valid'],
};

describe('external Judge contracts', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
  it.each([
    [new Error('3036: daily limit PRIVATE_UPSTREAM_TEXT'), true],
    [{ internalCode: 3036 }, true],
    [{ code: 3036 }, true],
    [new Error('3040: Out of capacity'), false],
    [{ status: 429, message: 'rate limited' }, false],
    [new Error('invalid output: 3036: quoted text'), false],
    [new Error('quota exceeded'), false],
  ])('recognizes only the documented daily quota code: %j', (error, expected) => {
    expect(isDailyQuotaError(error)).toBe(expected);
  });
  it('redacts upstream quota errors and anchors a request crossing midnight to its original day', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-08-29T23:59:59Z'));
    const run = vi.fn(async () => {
      vi.setSystemTime(new Date('2026-08-30T00:00:01Z'));
      throw new Error('3036: PRIVATE_UPSTREAM_TEXT');
    });
    const provider = new WorkersAIJudgeProvider({ run } as unknown as Pick<Ai, 'run'>);
    const error = await provider.evaluate(input).catch((value: unknown) => value);
    expect(error).toMatchObject({
      code: 'JUDGE_QUOTA_EXHAUSTED',
      retryAt: '2026-08-30T00:00:00.000Z',
    });
    expect(String(error)).not.toContain('PRIVATE_UPSTREAM_TEXT');
    expect(run).toHaveBeenCalledTimes(1);
  });
  it.each([false, true])(
    'accepts Workers AI structured output (text=%s) and supplies schema and deadline',
    async (asText) => {
      const run = vi.fn(async () => ({ response: asText ? JSON.stringify(valid) : valid }));
      const value = await new WorkersAIJudgeProvider({ run } as unknown as Pick<
        Ai,
        'run'
      >).evaluate(input);
      expect(validateVerdict(value, input)).toEqual(valid);
      const [model, body, options] = (run.mock.calls as unknown as [string, any, any][])[0];
      expect(model).toBe(workersAIJudgeModel);
      expect(body.response_format.type).toBe('json_schema');
      expect(body.response_format.json_schema.required).toContain('winner');
      expect(body.max_tokens).toBe(2400);
      expect(options.signal).toBeInstanceOf(AbortSignal);
      expect(body.messages[0].content).toContain('untrusted case DATA');
    },
  );
  it('sends the protocol schema to the existing external Responses endpoint', async () => {
    const fetcher = vi.fn(async () => Response.json({ output_text: JSON.stringify(valid) }));
    vi.stubGlobal('fetch', fetcher);
    const result = await new LLMJudgeProvider(
      'https://judge.example/responses',
      'test-secret',
      'test-model',
    ).evaluate(input);
    expect(validateVerdict(result, input)).toEqual(valid);
    const init = (fetcher.mock.calls as unknown as [string, RequestInit][])[0][1];
    const request = JSON.parse(String(init.body));
    expect(request.text.format.schema.required).toContain('citedEventIds');
    expect(request.input[0].content).toContain('neutral ResolveRoom Judge');
  });
  it('rejects oversized case records without silently truncating either side', () => {
    expect(() => judgeMessages({ ...input, description: 'x'.repeat(240_001) })).toThrow(
      /context budget/,
    );
  });
  it('does not invent a verdict when Workers AI returns no usable response', async () => {
    const run = vi.fn(async () => ({}));
    await expect(
      new WorkersAIJudgeProvider({ run } as unknown as Pick<Ai, 'run'>).evaluate(input),
    ).rejects.toThrow(/no structured/);
  });
  it('keeps quota/provider errors recoverable without disclosing upstream text', async () => {
    const db = await judgingDb();
    const run = vi.fn(async () => {
      throw new Error('quota exceeded UPSTREAM_PRIVATE_TEXT');
    });
    const provider = new WorkersAIJudgeProvider({ run } as unknown as Pick<Ai, 'run'>);
    await expect(new JudgeService(db, provider).run(input.conflictId)).rejects.toThrow(
      /after retry/,
    );
    expect(run).toHaveBeenCalledTimes(2);
    expect(await db.getVerdict(input.conflictId)).toBeNull();
    expect((await db.getConflict(input.conflictId))?.status).toBe('judging');
  });
  it('identifies the persuasion target correctly when Party B is the persuader', async () => {
    const verdict = await new MockJudgeProvider().evaluate({
      ...input,
      protocolType: 'persuasion',
      persuaderParty: 'party_b',
      concededBy: 'party_a',
    });
    expect(verdict).toMatchObject({ outcome: 'target_conceded' });
  });
  it('does not send record-only cases to any provider', async () => {
    const db = await judgingDb();
    await db.updateConflict({
      ...(await db.getConflict(input.conflictId))!,
      resolutionMode: 'record_only',
    });
    const evaluate = vi.fn();
    await expect(
      new JudgeService(db, { name: 'spy', evaluate }).run(input.conflictId),
    ).rejects.toThrow(/does not authorize/);
    expect(evaluate).not.toHaveBeenCalled();
  });
});

describe('judge validation', () => {
  it('accepts a valid structured verdict', () =>
    expect(validateVerdict(valid, input)).toEqual(valid));
  it.each([
    ['invalid JSON-like output', 'not json'],
    ['invalid enum', { ...valid, winner: 'absolute_truth' }],
    [
      'out-of-range score',
      { ...valid, scores: { ...valid.scores, partyA: { ...valid.scores.partyA, logic: 101 } } },
    ],
    ['unknown citation', { ...valid, citedEventIds: ['evt_unknown'] }],
  ])('rejects %s', (_label, value) => expect(() => validateVerdict(value, input)).toThrow());
});

async function judgingDb() {
  const db = new MemoryDatabase();
  const user: User = {
    id: opaqueId('usr'),
    email: 'judge@example.test',
    displayName: 'Judge Test',
    avatarUrl: null,
    createdAt: new Date().toISOString(),
    deletedAt: null,
  };
  await db.createUser(user);
  const conflict: Conflict = {
    id: input.conflictId,
    title: input.title,
    description: input.description,
    protocolType: 'debate',
    status: 'judging',
    createdByUserId: user.id,
    currentPhase: 'closing',
    currentRound: 3,
    firstSpeakerPartyId: 'pty_a',
    maxRounds: 3,
    resolutionMode: 'judge',
    deadlineAt: null,
    turnTimeoutSeconds: null,
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    resolvedAt: null,
    persuaderParty: null,
  };
  const a: ConflictParty = {
    id: 'pty_a',
    conflictId: conflict.id,
    role: 'party_a',
    userId: user.id,
    displayName: 'Party A',
    agentId: null,
    ready: true,
    persuasionRole: null,
    joinedAt: new Date().toISOString(),
  };
  const b: ConflictParty = {
    ...a,
    id: 'pty_b',
    role: 'party_b',
    userId: null,
    displayName: 'Party B',
  };
  await db.createConflict(conflict, [a, b]);
  await db.appendEvent({
    conflictId: conflict.id,
    eventType: 'argument_submitted',
    actorType: 'agent',
    actorId: 'agt_a',
    partyId: a.id,
    partyRole: 'party_a',
    visibility: 'case',
    payload: { content: 'A case.' },
  });
  return db;
}

describe('JudgeService retries', () => {
  afterEach(() => vi.useRealTimers());
  it('persists daily exhaustion across services and rooms, stops retries, and recovers at UTC midnight', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-08-29T12:00:00Z'));
    const db = await judgingDb();
    const evaluate = vi.fn(async () => {
      throw new JudgeQuotaError(nextDailyReset(Date.now()));
    });
    const provider = { name: 'workers_ai:test', quotaScope: 'workers_ai', evaluate };
    await expect(new JudgeService(db, provider).run(input.conflictId)).rejects.toMatchObject({
      code: 'JUDGE_QUOTA_EXHAUSTED',
      retryAt: '2026-08-30T00:00:00.000Z',
    });
    await expect(new JudgeService(db, provider).run(input.conflictId)).rejects.toBeInstanceOf(
      JudgeQuotaError,
    );
    const conflict = (await db.getConflict(input.conflictId))!;
    const parties = await db.getParties(input.conflictId);
    await db.createConflict({ ...conflict, id: 'con_other' }, [
      { ...parties[0], id: 'pty_other_a', conflictId: 'con_other' },
      { ...parties[1], id: 'pty_other_b', conflictId: 'con_other' },
    ]);
    await expect(new JudgeService(db, provider).run('con_other')).rejects.toBeInstanceOf(
      JudgeQuotaError,
    );
    expect(evaluate).toHaveBeenCalledTimes(1);
    expect(conflict.status).toBe('judging');
    expect(await db.getVerdict(input.conflictId)).toBeNull();
    expect(await new JudgeService(db, new MockJudgeProvider()).quotaStatus()).toBeNull();
    vi.setSystemTime(new Date('2026-08-30T00:00:00Z'));
    const recovered = new JudgeService(db, {
      ...provider,
      evaluate: (value) => new MockJudgeProvider().evaluate(value),
    });
    expect(await recovered.quotaStatus()).toBeNull();
    await recovered.run(input.conflictId);
    expect((await db.getConflict(input.conflictId))?.status).toBe('resolved');
  });
  it('finishes a partially persisted assessment without repeating inference or verdict events', async () => {
    const db = await judgingDb();
    const evaluate = vi.fn((value: JudgeInput) => new MockJudgeProvider().evaluate(value));
    const service = new JudgeService(db, { name: 'mock', quotaScope: 'workers_ai', evaluate });
    const update = vi
      .spyOn(db, 'updateConflict')
      .mockRejectedValueOnce(new Error('D1 unavailable'));
    await expect(service.run(input.conflictId)).rejects.toThrow('D1 unavailable');
    expect(evaluate).toHaveBeenCalledTimes(1);
    expect(await db.getVerdict(input.conflictId)).not.toBeNull();
    expect((await db.getConflict(input.conflictId))?.status).toBe('judging');
    await db.saveJudgeCooldown('workers_ai', nextDailyReset(Date.now()));
    expect(await service.quotaStatus()).not.toBeNull();
    expect(await service.quotaStatus(input.conflictId)).toBeNull();
    const result = await service.run(input.conflictId);
    expect(result.verdict.protocolType).toBe('debate');
    expect(evaluate).toHaveBeenCalledTimes(1);
    expect((await db.getConflict(input.conflictId))?.status).toBe('resolved');
    expect(
      (await db.listEvents(input.conflictId)).filter(
        (event) => event.eventType === 'verdict_issued',
      ),
    ).toHaveLength(1);
    update.mockRestore();
  });
  it('retries once after invalid output and persists the valid retry', async () => {
    const db = await judgingDb();
    let calls = 0;
    const provider: JudgeProvider = {
      name: 'sequence',
      async evaluate(i) {
        calls += 1;
        if (calls === 1) return { ...valid, winner: 'invalid' };
        const event = (await db.listEvents(i.conflictId))[0];
        return { ...valid, citedEventIds: [event.id] };
      },
    };
    const result = await new JudgeService(db, provider).run(input.conflictId);
    expect(calls).toBe(2);
    expect(result.verdict.protocolType).toBe('debate');
    expect((await db.getConflict(input.conflictId))?.status).toBe('resolved');
  });
  it('preserves judging state after provider timeout/failure twice', async () => {
    const db = await judgingDb();
    let calls = 0;
    const provider: JudgeProvider = {
      name: 'failure',
      async evaluate() {
        calls += 1;
        throw new Error('provider timeout');
      },
    };
    await expect(new JudgeService(db, provider).run(input.conflictId)).rejects.toThrow(
      /after retry/i,
    );
    expect(calls).toBe(2);
    expect((await db.getConflict(input.conflictId))?.status).toBe('judging');
    expect(await db.getVerdict(input.conflictId)).toBeNull();
  });
  it('mock provider is deterministic and structured', async () => {
    const value = await new MockJudgeProvider().evaluate(input);
    expect(value.protocolType).toBe('debate');
    expect(value.confidence).toBe(0.78);
  });
  it('never includes party-private brief content in Judge input', async () => {
    const db = await judgingDb();
    await db.appendEvent({
      conflictId: input.conflictId,
      eventType: 'private_brief_updated',
      actorType: 'user',
      actorId: 'usr_private',
      partyId: 'pty_a',
      partyRole: 'party_a',
      visibility: 'party_private',
      payload: { content: 'JUDGE_MUST_NOT_SEE_THIS' },
    });
    const conflict = (await db.getConflict(input.conflictId))!;
    const judgeInput = judgeInputFromEvents(conflict, await db.listEvents(input.conflictId));
    expect(JSON.stringify(judgeInput)).not.toContain('JUDGE_MUST_NOT_SEE_THIS');
  });
});

describe('Judge deployment capability', () => {
  it('returns a safe retry time, exposes persisted waiting state, and preserves accepted concessions', async () => {
    const db = await judgingDb();
    const conflict = (await db.getConflict(input.conflictId))!;
    await db.updateConflict({ ...conflict, status: 'active' });
    const run = vi.fn(async () => {
      throw new Error('3036: PRIVATE_UPSTREAM_TEXT');
    });
    const app = createApi(db, {
      allowDevelopmentAuth: true,
      appUrl: 'http://judge.test',
      judgeEnabled: true,
      judgeProvider: new WorkersAIJudgeProvider({ run } as unknown as Pick<Ai, 'run'>),
    });
    const headers = { 'x-dev-user-id': [...db.users.keys()][0] };
    const url = `http://judge.test/api/v1/conflicts/${input.conflictId}`;
    const accepted = await app.request(`${url}/concede`, { method: 'POST', headers });
    expect(accepted.status).toBe(200);
    const response = await app.request(`${url}/judge`, { method: 'POST', headers });
    expect(response.status).toBe(429);
    expect(Number(response.headers.get('retry-after'))).toBeGreaterThan(0);
    const body = (await response.json()) as any;
    expect(body.error).toMatchObject({
      code: 'JUDGE_QUOTA_EXHAUSTED',
      retry_at: nextDailyReset(Date.now()),
    });
    expect(JSON.stringify(body)).not.toContain('PRIVATE_UPSTREAM_TEXT');
    const room = await app.request(url, { headers });
    expect(await room.json()).toMatchObject({
      status: 'judging',
      judge_quota: { reason: 'daily_quota_exhausted', retry_at: body.error.retry_at },
    });
    expect(run).toHaveBeenCalledTimes(1);
    expect(await db.getVerdict(input.conflictId)).toBeNull();
    expect(
      (await db.listEvents(input.conflictId)).some((event) => event.eventType === 'party_conceded'),
    ).toBe(true);
  });
  it('keeps Judge unavailable to users when no external provider is configured', async () => {
    const db = await judgingDb();
    const app = createApi(db, {
      allowDevelopmentAuth: true,
      appUrl: 'http://judge.test',
      judgeEnabled: false,
    });
    const capabilities = await app.request('http://judge.test/api/v1/capabilities');
    expect(await capabilities.json()).toEqual({
      judge: { available: false, mode: 'disabled' },
    });
    const response = await app.request(
      `http://judge.test/api/v1/conflicts/${input.conflictId}/judge`,
      {
        method: 'POST',
        headers: { 'x-dev-user-id': [...db.users.values()][0].id },
      },
    );
    expect(response.status).toBe(503);
    expect(((await response.json()) as any).error.code).toBe('JUDGE_UNAVAILABLE');
    expect(await db.getVerdict(input.conflictId)).toBeNull();
  });

  it('lets participants finalize legacy judging records without a verdict', async () => {
    const db = await judgingDb();
    const app = createApi(db, {
      allowDevelopmentAuth: true,
      appUrl: 'http://judge.test',
      judgeEnabled: false,
    });
    const userId = [...db.users.values()][0].id;
    const response = await app.request(
      `http://judge.test/api/v1/conflicts/${input.conflictId}/complete`,
      { method: 'POST', headers: { 'x-dev-user-id': userId } },
    );
    expect(response.status).toBe(200);
    expect((await response.json()) as any).toMatchObject({
      conflict: { status: 'resolved' },
    });
    expect(await db.getVerdict(input.conflictId)).toBeNull();
    expect((await db.listEvents(input.conflictId)).at(-1)?.eventType).toBe('conflict_resolved');
  });
});
