import { describe, expect, it } from 'vitest';
import {
  judgeInputFromEvents,
  validateVerdict,
  type JudgeInput,
  type JudgeProvider,
  MockJudgeProvider,
} from '@/judge/providers';
import { JudgeService } from '@/judge/service';
import { MemoryDatabase } from '@/persistence/memory';
import { opaqueId } from '@/domain/security';
import type { Conflict, ConflictParty, User } from '@/domain/types';

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
