import { describe, expect, it } from 'vitest';
import { MemoryDatabase } from '@/persistence/memory';
import { authoritativeTurn } from '@/api/app';
import { ConflictService } from '@/services/conflicts';
import { opaqueId } from '@/domain/security';
import type { Agent, User } from '@/domain/types';

const user = (name: string): User => ({
  id: opaqueId('usr'),
  email: `${name.toLowerCase()}@example.test`,
  displayName: name,
  avatarUrl: null,
  createdAt: new Date().toISOString(),
  deletedAt: null,
});
const agent = (owner: string, name: string): Agent => ({
  id: opaqueId('agt'),
  ownerUserId: owner,
  name,
  status: 'active',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

async function setup(judgeEnabled = true) {
  const db = new MemoryDatabase();
  const service = new ConflictService(db, undefined, judgeEnabled);
  const alice = user('Alice');
  const bob = user('Bob');
  await db.createUser(alice);
  await db.createUser(bob);
  const created = await service.createConflict(alice.id, {
    title: 'Tokyo vs Vancouver',
    description: 'Choose the next team offsite.',
    protocol_type: 'debate',
    max_rounds: 3,
  });
  const invite = await service.createInvite(created.conflict.id, alice.id);
  await service.acceptInvite(invite.token, bob.id);
  const a = agent(alice.id, 'Alice Agent');
  const b = agent(bob.id, 'Bob Agent');
  await db.createAgent(a);
  await db.createAgent(b);
  await service.bindAgent(created.conflict.id, alice.id, a.id);
  await service.bindAgent(created.conflict.id, bob.id, b.id);
  await service.setReady(created.conflict.id, alice.id);
  await service.setReady(created.conflict.id, bob.id);
  return { db, service, alice, bob, a, b, conflictId: created.conflict.id };
}

describe('ConflictService coordination', () => {
  it('advances all timed-out turns through a five-round exchange', async () => {
    const x = await setup(false);
    await x.db.updateConflict({
      ...(await x.db.getConflict(x.conflictId))!,
      maxRounds: 5,
      turnTimeoutSeconds: 60,
    });
    const parties = await x.db.getParties(x.conflictId);
    for (let i = 0; i < 10; i += 1) {
      const conflict = (await x.db.getConflict(x.conflictId))!;
      expect(conflict.currentRound).toBe(Math.floor(i / 2) + 1);
      const turn = authoritativeTurn(conflict, parties, await x.db.listEvents(x.conflictId));
      expect(turn).not.toBeNull();
      await x.service.handleAlarm(x.conflictId);
      const skipped = (await x.db.listEvents(x.conflictId)).filter(
        (event) => event.eventType === 'turn_skipped',
      );
      expect(skipped.at(-1)?.partyId).toBe(turn?.party_id);
    }
    expect((await x.db.getConflict(x.conflictId))?.status).toBe('resolved');
  });
  it('makes duplicate client requests idempotent', async () => {
    const x = await setup();
    const parties = await x.db.getParties(x.conflictId);
    const conflict = await x.db.getConflict(x.conflictId);
    const first = parties.find((p) => p.id === conflict!.firstSpeakerPartyId)!;
    const ag = first.agentId === x.a.id ? x.a : x.b;
    const action = {
      action_type: 'argument' as const,
      content: 'A reasoned opening.',
      client_request_id: 'request-12345',
    };
    const one = await x.service.submitAction(x.conflictId, ag.id, action);
    const two = await x.service.submitAction(x.conflictId, ag.id, action);
    expect(two.duplicate).toBe(true);
    expect(two.event.id).toBe(one.event.id);
    expect(
      (await x.db.listEvents(x.conflictId)).filter(
        (e) => e.payload.client_request_id === action.client_request_id,
      ),
    ).toHaveLength(1);
  });
  it('serializes simultaneous writers so only the correct party succeeds', async () => {
    const x = await setup();
    const parties = await x.db.getParties(x.conflictId);
    const conflict = await x.db.getConflict(x.conflictId);
    const first = parties.find((p) => p.id === conflict!.firstSpeakerPartyId)!;
    const other = parties.find((p) => p.id !== first.id)!;
    const results = await Promise.allSettled([
      x.service.submitAction(x.conflictId, first.agentId!, {
        action_type: 'argument',
        content: 'First.',
        client_request_id: 'concurrent-first',
      }),
      x.service.submitAction(x.conflictId, other.agentId!, {
        action_type: 'argument',
        content: 'Second.',
        client_request_id: 'concurrent-second',
      }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(2);
    const events = await x.db.listEvents(x.conflictId);
    expect(events.filter((e) => e.eventType === 'argument_submitted')).toHaveLength(2);
    expect(new Set(events.map((e) => e.sequenceNumber)).size).toBe(events.length);
  });

  it('advances a timed-out turn when the coordinator alarm fires', async () => {
    const x = await setup();
    const conflict = (await x.db.getConflict(x.conflictId))!;
    await x.db.updateConflict({ ...conflict, turnTimeoutSeconds: 60 });
    const result = await x.service.handleAlarm(x.conflictId);
    expect(result).toEqual({ changed: true, needsJudging: false });
    const events = await x.db.listEvents(x.conflictId);
    expect(events.at(-1)?.eventType).toBe('turn_skipped');
    expect(events.at(-1)?.payload.reason).toBe('turn_timeout');
  });

  it('expires an unfinished conflict at its deadline and notifies both parties', async () => {
    const x = await setup();
    const conflict = (await x.db.getConflict(x.conflictId))!;
    await x.db.updateConflict({
      ...conflict,
      deadlineAt: new Date(Date.now() - 1_000).toISOString(),
    });
    const result = await x.service.handleAlarm(x.conflictId);
    expect(result).toEqual({ changed: true, needsJudging: false });
    expect((await x.db.getConflict(x.conflictId))?.status).toBe('expired');
    expect((await x.db.listEvents(x.conflictId)).at(-1)?.eventType).toBe('conflict_expired');
    expect(
      (await x.db.listNotifications(x.alice.id)).some((n) => n.type === 'conflict_expired'),
    ).toBe(true);
    expect(
      (await x.db.listNotifications(x.bob.id)).some((n) => n.type === 'conflict_expired'),
    ).toBe(true);
  });

  it('closes the six-turn record immediately when Judge is unavailable', async () => {
    const x = await setup(false);
    for (let turn = 0; turn < 6; turn += 1) {
      const conflict = (await x.db.getConflict(x.conflictId))!;
      const parties = await x.db.getParties(x.conflictId);
      const events = await x.db.listEvents(x.conflictId);
      const submittedInPhase = events.filter(
        (event) =>
          ['argument_submitted', 'rebuttal_submitted', 'closing_statement_submitted'].includes(
            event.eventType,
          ) &&
          event.eventType ===
            (conflict.currentPhase === 'opening'
              ? 'argument_submitted'
              : conflict.currentPhase === 'rebuttal'
                ? 'rebuttal_submitted'
                : 'closing_statement_submitted'),
      ).length;
      const openingFirst = parties.find((value) => value.id === conflict.firstSpeakerPartyId)!;
      const phaseFirst =
        conflict.currentPhase === 'rebuttal'
          ? parties.find((value) => value.id !== openingFirst.id)!
          : openingFirst;
      const party =
        submittedInPhase === 0 ? phaseFirst : parties.find((value) => value.id !== phaseFirst.id)!;
      const action =
        conflict.currentPhase === 'opening'
          ? 'argument'
          : conflict.currentPhase === 'rebuttal'
            ? 'rebuttal'
            : 'closing_statement';
      const result = await x.service.submitAction(x.conflictId, party.agentId!, {
        action_type: action,
        content: `Turn ${turn + 1}`,
        client_request_id: `record-only-${turn + 1}`,
      });
      expect(result.needsJudging).toBe(false);
    }
    const conflict = await x.db.getConflict(x.conflictId);
    const events = await x.db.listEvents(x.conflictId);
    expect(conflict?.status).toBe('resolved');
    expect(conflict?.resolvedAt).not.toBeNull();
    expect(events.filter((event) => event.eventType === 'conflict_resolved')).toHaveLength(1);
    expect(events.some((event) => event.eventType === 'judging_started')).toBe(false);
    expect(await x.db.getVerdict(x.conflictId)).toBeNull();
  });
});
