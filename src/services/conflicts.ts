import { DomainError } from '@/domain/errors';
import { opaqueId, secureToken, sha256 } from '@/domain/security';
import type {
  AgentAction,
  Conflict,
  ConflictEvent,
  ConflictParty,
  Invitation,
  PartyRole,
  PrivateBriefContent,
} from '@/domain/types';
import { privateBriefSchema, conflictSettingsSchema, roundsSchema } from '@/domain/types';
import { protocolFor, type ProtocolSnapshot } from '@/protocol/engine';
import type { Database } from '@/persistence/database';
import { NotificationService } from '@/notifications/service';

const now = () => new Date().toISOString();
const actionEvent = {
  argument: 'argument_submitted',
  rebuttal: 'rebuttal_submitted',
  closing_statement: 'closing_statement_submitted',
  evidence: 'evidence_submitted',
  concede: 'party_conceded',
} as const;

export class ConflictService {
  private locks = new Map<string, Promise<unknown>>();
  constructor(
    readonly db: Database,
    private readonly notifications = new NotificationService(db),
    private readonly judgeEnabled = true,
  ) {}

  usesJudge(conflict: Conflict): boolean {
    return this.judgeEnabled && conflict.resolutionMode === 'judge';
  }

  private async resolveWithoutJudge(conflict: Conflict, reason: string): Promise<Conflict> {
    const timestamp = now();
    const resolved: Conflict = {
      ...conflict,
      status: 'resolved',
      resolvedAt: timestamp,
      updatedAt: timestamp,
      version: conflict.version + 1,
    };
    await this.db.updateConflict(resolved);
    await this.db.appendEvent({
      conflictId: conflict.id,
      eventType: 'conflict_resolved',
      actorType: 'system',
      actorId: null,
      partyId: null,
      partyRole: null,
      visibility: 'case',
      payload: { reason, verdict_available: false },
    });
    await this.notifications.forConflict(
      conflict.id,
      'conflict_resolved',
      'The structured exchange is complete',
      'Both sides finished the protocol. The record is closed without an advisory assessment.',
    );
    await this.db.recordAnalytics('conflict_resolved', null, conflict.id, {
      judge: 'disabled',
      reason,
    });
    return resolved;
  }

  async completeWithoutJudge(conflictId: string, userId: string) {
    return this.serialize(conflictId, async () => {
      const { conflict } = await this.requireParticipant(conflictId, userId);
      if (this.usesJudge(conflict))
        throw new DomainError('INVALID_STATE', 'This deployment uses the Judge workflow.', 409);
      if (conflict.status !== 'judging')
        throw new DomainError('INVALID_STATE', 'This conflict is not awaiting completion.', 409);
      return this.resolveWithoutJudge(conflict, 'judge_unavailable');
    });
  }

  private async serialize<T>(conflictId: string, work: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(conflictId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queued = previous.then(() => current);
    this.locks.set(conflictId, queued);
    await previous;
    try {
      return await work();
    } finally {
      release();
      if (this.locks.get(conflictId) === queued) this.locks.delete(conflictId);
    }
  }

  async createConflict(
    userId: string,
    input: {
      title: string;
      description: string;
      protocol_type: 'debate' | 'persuasion';
      persuader_party?: PartyRole | null;
      deadline_at?: string | null;
      turn_timeout_seconds?: number | null;
      max_rounds: number;
      resolution_mode?: 'record_only' | 'judge';
    },
  ): Promise<{ conflict: Conflict; parties: ConflictParty[] }> {
    roundsSchema.parse(input.max_rounds);
    if (input.resolution_mode === 'judge' && !this.judgeEnabled)
      throw new DomainError(
        'JUDGE_UNAVAILABLE',
        'AI Judge is not configured. Choose record only.',
        503,
      );
    const user = await this.db.getUser(userId);
    if (!user) throw new DomainError('UNAUTHORIZED', 'Sign in is required.', 401);
    const timestamp = now();
    const conflictId = opaqueId('con');
    const conflict: Conflict = {
      id: conflictId,
      title: input.title,
      description: input.description,
      protocolType: input.protocol_type,
      status: 'inviting',
      createdByUserId: userId,
      currentPhase: null,
      currentRound: 0,
      firstSpeakerPartyId: null,
      maxRounds: input.max_rounds,
      resolutionMode: input.resolution_mode ?? 'record_only',
      deadlineAt: input.deadline_at ?? null,
      turnTimeoutSeconds: input.turn_timeout_seconds ?? null,
      version: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      resolvedAt: null,
      persuaderParty: input.persuader_party ?? null,
    };
    const partyA: ConflictParty = {
      id: opaqueId('pty'),
      conflictId,
      role: 'party_a',
      userId,
      displayName: user.displayName,
      agentId: null,
      ready: false,
      persuasionRole:
        input.protocol_type === 'persuasion'
          ? input.persuader_party === 'party_a'
            ? 'persuader'
            : 'target'
          : null,
      joinedAt: timestamp,
    };
    const partyB: ConflictParty = {
      id: opaqueId('pty'),
      conflictId,
      role: 'party_b',
      userId: null,
      displayName: 'Invited participant',
      agentId: null,
      ready: false,
      persuasionRole:
        input.protocol_type === 'persuasion'
          ? input.persuader_party === 'party_b'
            ? 'persuader'
            : 'target'
          : null,
      joinedAt: null,
    };
    await this.db.createConflict(conflict, [partyA, partyB]);
    await this.db.appendEvent({
      conflictId,
      eventType: 'conflict_created',
      actorType: 'user',
      actorId: userId,
      partyId: partyA.id,
      partyRole: 'party_a',
      visibility: 'case',
      payload: { title: conflict.title, protocol_type: conflict.protocolType },
    });
    await this.db.recordAnalytics('conflict_created', userId, conflictId, {
      protocol_type: conflict.protocolType,
    });
    return { conflict, parties: [partyA, partyB] };
  }

  async requireParticipant(conflictId: string, userId: string) {
    const conflict = await this.db.getConflict(conflictId);
    if (!conflict) throw new DomainError('NOT_FOUND', 'Conflict not found.', 404);
    const party = await this.db.findPartyForUser(conflictId, userId);
    if (!party) throw new DomainError('NOT_FOUND', 'Conflict not found.', 404);
    return { conflict, party, parties: await this.db.getParties(conflictId) };
  }
  async requireOwner(conflictId: string, userId: string) {
    const value = await this.requireParticipant(conflictId, userId);
    if (value.conflict.createdByUserId !== userId)
      throw new DomainError('FORBIDDEN', 'Only the conflict owner can perform this action.', 403);
    return value;
  }

  async updateSettings(conflictId: string, userId: string, input: unknown) {
    const parsed = conflictSettingsSchema.safeParse(input);
    if (!parsed.success)
      throw new DomainError(
        'VALIDATION_ERROR',
        parsed.error.issues[0]?.message ?? 'Invalid settings.',
        422,
      );
    return this.serialize(conflictId, async () => {
      const { conflict, party, parties } = await this.requireOwner(conflictId, userId);
      if (!['draft', 'inviting', 'briefing'].includes(conflict.status))
        throw new DomainError(
          'INVALID_STATE',
          'Round count, shared context and completion mode are locked after the exchange starts.',
          409,
        );
      if (parsed.data.resolution_mode === 'judge' && !this.judgeEnabled)
        throw new DomainError(
          'JUDGE_UNAVAILABLE',
          'AI Judge is not configured. Choose record only.',
          503,
        );
      const { max_rounds, description, resolution_mode } = parsed.data;
      if (
        max_rounds === conflict.maxRounds &&
        description === conflict.description &&
        resolution_mode === conflict.resolutionMode
      )
        return conflict;
      // A changed agreement must be acknowledged by both people before starting.
      for (const participant of parties)
        await this.db.updateParty({ ...participant, ready: false });
      const updated = {
        ...conflict,
        maxRounds: max_rounds,
        description,
        resolutionMode: resolution_mode,
        updatedAt: now(),
        version: conflict.version + 1,
      };
      await this.db.updateConflict(updated);
      await this.db.appendEvent({
        conflictId,
        eventType: 'conflict_settings_updated',
        actorType: 'user',
        actorId: userId,
        partyId: party.id,
        partyRole: party.role,
        visibility: 'case',
        payload: { max_rounds, description, resolution_mode, readiness_reset: true },
      });
      return updated;
    });
  }

  async createInvite(conflictId: string, userId: string) {
    return this.serialize(conflictId, async () => {
      const { conflict, party } = await this.requireOwner(conflictId, userId);
      if (!['draft', 'inviting', 'briefing'].includes(conflict.status))
        throw new DomainError('INVALID_STATE', 'This conflict no longer accepts invitations.', 409);
      const rawToken = secureToken('rr_inv_');
      const timestamp = now();
      const invitation: Invitation = {
        id: opaqueId('inv'),
        conflictId,
        targetRole: 'party_b',
        tokenHash: await sha256(rawToken),
        expiresAt: new Date(Date.now() + 7 * 86400_000).toISOString(),
        acceptedAt: null,
        revokedAt: null,
        createdAt: timestamp,
      };
      await this.db.createInvitation(invitation);
      await this.db.appendEvent({
        conflictId,
        eventType: 'party_invited',
        actorType: 'user',
        actorId: userId,
        partyId: party.id,
        partyRole: 'party_a',
        visibility: 'case',
        payload: { invite_id: invitation.id, expires_at: invitation.expiresAt },
      });
      await this.db.recordAnalytics('invite_sent', userId, conflictId);
      return { invitation, token: rawToken };
    });
  }

  async revokeInvite(conflictId: string, invitationId: string, userId: string) {
    return this.serialize(conflictId, async () => {
      await this.requireOwner(conflictId, userId);
      const invitation = (await this.db.listInvitations(conflictId)).find(
        (value) => value.id === invitationId,
      );
      if (!invitation || invitation.acceptedAt)
        throw new DomainError('NOT_FOUND', 'Active invitation not found.', 404);
      if (!invitation.revokedAt)
        await this.db.updateInvitation({ ...invitation, revokedAt: now() });
      await this.db.recordAnalytics('invite_revoked', userId, conflictId, {
        invite_id: invitationId,
      });
    });
  }

  async acceptInvite(rawToken: string, userId: string) {
    const tokenHash = await sha256(rawToken);
    const invitation = await this.db.findInvitation(tokenHash);
    if (!invitation) throw new DomainError('NOT_FOUND', 'Invitation not found.', 404);
    return this.serialize(invitation.conflictId, async () => {
      const fresh = await this.db.findInvitation(tokenHash);
      if (!fresh) throw new DomainError('NOT_FOUND', 'Invitation not found.', 404);
      if (fresh.revokedAt)
        throw new DomainError('INVITE_EXPIRED', 'This invitation was revoked.', 410);
      if (fresh.acceptedAt)
        throw new DomainError('INVITE_ALREADY_USED', 'This invitation has already been used.', 409);
      if (new Date(fresh.expiresAt) <= new Date())
        throw new DomainError('INVITE_EXPIRED', 'This invitation has expired.', 410);
      const user = await this.db.getUser(userId);
      if (!user) throw new DomainError('UNAUTHORIZED', 'Sign in is required.', 401);
      const parties = await this.db.getParties(fresh.conflictId);
      const target = parties.find((p) => p.role === 'party_b')!;
      if (parties.some((p) => p.userId === userId))
        throw new DomainError('FORBIDDEN', 'The owner cannot join as the opposing party.', 403);
      const joined = { ...target, userId, displayName: user.displayName, joinedAt: now() };
      await this.db.updateParty(joined);
      await this.db.updateInvitation({ ...fresh, acceptedAt: now() });
      const conflict = await this.db.getConflict(fresh.conflictId);
      if (conflict) {
        await this.db.updateConflict({
          ...conflict,
          status: 'briefing',
          updatedAt: now(),
          version: conflict.version + 1,
        });
      }
      await this.db.appendEvent({
        conflictId: fresh.conflictId,
        eventType: 'party_joined',
        actorType: 'user',
        actorId: userId,
        partyId: joined.id,
        partyRole: 'party_b',
        visibility: 'case',
        payload: { display_name: joined.displayName },
      });
      await this.notifications.forConflict(
        fresh.conflictId,
        'opponent_joined',
        'Your opponent joined',
        `${user.displayName} joined the conflict.`,
        userId,
      );
      await this.db.recordAnalytics('invite_accepted', userId, fresh.conflictId);
      return { conflict_id: fresh.conflictId, party: joined };
    });
  }

  async bindAgent(conflictId: string, userId: string, agentId: string) {
    return this.serialize(conflictId, async () => {
      const { party } = await this.requireParticipant(conflictId, userId);
      const agent = await this.db.getAgent(agentId);
      if (!agent || agent.ownerUserId !== userId || agent.status !== 'active')
        throw new DomainError('FORBIDDEN', 'Agent is unavailable.', 403);
      const updated = { ...party, agentId, ready: false };
      await this.db.updateParty(updated);
      await this.db.appendEvent({
        conflictId,
        eventType: 'agent_bound',
        actorType: 'user',
        actorId: userId,
        partyId: party.id,
        partyRole: party.role,
        visibility: 'case',
        payload: { agent_id: agentId, agent_name: agent.name },
      });
      await this.db.recordAnalytics('agent_bound', userId, conflictId, { agent_id: agentId });
      return updated;
    });
  }
  async unbindAgent(conflictId: string, userId: string) {
    return this.serialize(conflictId, async () => {
      const { party } = await this.requireParticipant(conflictId, userId);
      const updated = { ...party, agentId: null, ready: false };
      await this.db.updateParty(updated);
      await this.db.appendEvent({
        conflictId,
        eventType: 'agent_unbound',
        actorType: 'user',
        actorId: userId,
        partyId: party.id,
        partyRole: party.role,
        visibility: 'case',
        payload: {},
      });
      return updated;
    });
  }

  async setReady(conflictId: string, userId: string, ready = true) {
    return this.serialize(conflictId, async () => {
      const { conflict, party } = await this.requireParticipant(conflictId, userId);
      if (!['briefing', 'inviting'].includes(conflict.status))
        throw new DomainError('INVALID_STATE', 'Readiness can only change during briefing.', 409);
      if (!party.agentId)
        throw new DomainError(
          'AGENT_NOT_BOUND',
          'Bind an active agent before becoming ready.',
          409,
        );
      await this.db.updateParty({ ...party, ready });
      const parties = await this.db.getParties(conflictId);
      const allReady = parties.every((p) => p.userId && p.agentId && p.ready);
      if (!allReady) return { started: false, conflict: await this.db.getConflict(conflictId) };
      const firstRole: PartyRole =
        crypto.getRandomValues(new Uint8Array(1))[0] % 2 === 0 ? 'party_a' : 'party_b';
      const firstParty = parties.find((p) => p.role === firstRole)!;
      const started = {
        ...conflict,
        status: 'active' as const,
        currentPhase: 'opening' as const,
        currentRound: 1,
        firstSpeakerPartyId: firstParty.id,
        updatedAt: now(),
        version: conflict.version + 1,
      };
      await this.db.updateConflict(started);
      await this.db.appendEvent({
        conflictId,
        eventType: 'conflict_started',
        actorType: 'system',
        actorId: null,
        partyId: null,
        partyRole: null,
        visibility: 'case',
        payload: { first_speaker: firstRole },
      });
      await this.db.appendEvent({
        conflictId,
        eventType: 'phase_started',
        actorType: 'system',
        actorId: null,
        partyId: null,
        partyRole: null,
        visibility: 'case',
        payload: { phase: 'opening', round: 1 },
      });
      await this.notifications.forConflict(
        conflictId,
        'conflict_started',
        'Conflict started',
        'Both participants are ready. The agents can begin.',
      );
      await this.db.recordAnalytics('both_parties_ready', userId, conflictId);
      if (firstParty.userId)
        await this.notifications.forUser(
          firstParty.userId,
          conflictId,
          'your_turn',
          'Your agent has the first turn',
          'The opening phase is ready for your agent.',
        );
      return { started: true, conflict: started };
    });
  }

  async saveBrief(conflictId: string, userId: string, content: PrivateBriefContent) {
    const parsed = privateBriefSchema.parse(content);
    const { party } = await this.requireParticipant(conflictId, userId);
    const existing = await this.db.getBrief(conflictId, party.id);
    const brief = {
      id: existing?.id ?? opaqueId('brf'),
      conflictId,
      partyId: party.id,
      content: parsed,
      version: (existing?.version ?? 0) + 1,
      updatedAt: now(),
    };
    await this.db.saveBrief(brief);
    await this.db.appendEvent({
      conflictId,
      eventType: 'private_brief_updated',
      actorType: 'user',
      actorId: userId,
      partyId: party.id,
      partyRole: party.role,
      visibility: 'party_private',
      payload: { version: brief.version },
    });
    return brief;
  }

  private async snapshot(
    conflict: Conflict,
    parties: ConflictParty[],
    events: ConflictEvent[],
  ): Promise<ProtocolSnapshot> {
    const first = parties.find((p) => p.id === conflict.firstSpeakerPartyId)?.role ?? 'party_a';
    const phaseIndex = Math.max(0, conflict.currentRound - 1);
    const lastPhase = events.findLastIndex((e) => e.eventType === 'phase_started');
    const primary = events
      .slice(lastPhase + 1)
      .filter((e) =>
        [
          'argument_submitted',
          'rebuttal_submitted',
          'closing_statement_submitted',
          'turn_skipped',
        ].includes(e.eventType),
      ).length;
    const conceded = events.findLast((e) => e.eventType === 'party_conceded')?.partyRole ?? null;
    return {
      protocolType: conflict.protocolType,
      status: conflict.status,
      phase: conflict.currentPhase ?? 'opening',
      phaseIndex,
      maxRounds: conflict.maxRounds,
      turnIndex: Math.min(primary, 1),
      firstSpeaker: first,
      persuaderParty: conflict.persuaderParty,
      concededBy: conceded,
    };
  }

  async submitAction(conflictId: string, agentId: string, action: AgentAction) {
    return this.serialize(conflictId, async () => {
      const conflict = await this.db.getConflict(conflictId);
      if (!conflict) throw new DomainError('NOT_FOUND', 'Conflict not found.', 404);
      const parties = await this.db.getParties(conflictId);
      const party = parties.find((p) => p.agentId === agentId);
      if (!party)
        throw new DomainError('AGENT_NOT_BOUND', 'This agent is not bound to the conflict.', 403);
      const events = await this.db.listEvents(conflictId);
      const existing = events.find((e) => e.payload.client_request_id === action.client_request_id);
      if (existing) return { event: existing, duplicate: true, conflict };
      const protocol = protocolFor(conflict.protocolType);
      const state = await this.snapshot(conflict, parties, events);
      const transition = protocol.applyAction(state, party.role, action.action_type);
      const appended = await this.db.appendEvent({
        conflictId,
        eventType: actionEvent[action.action_type],
        actorType: 'agent',
        actorId: agentId,
        partyId: party.id,
        partyRole: party.role,
        visibility: 'case',
        payload: {
          action_type: action.action_type,
          content: action.content,
          metadata: action.metadata ?? {},
        },
        clientRequestId: action.client_request_id,
      });
      if (appended.duplicate) return { event: appended.event, duplicate: true, conflict };
      if (
        action.action_type === 'argument' &&
        !events.some((event) => event.eventType === 'argument_submitted')
      )
        await this.db.recordAnalytics('first_argument_submitted', null, conflictId, {
          agent_id: agentId,
        });
      let updated: Conflict = {
        ...conflict,
        status: transition.state.status,
        currentPhase: transition.state.phase,
        currentRound: transition.state.phaseIndex + 1,
        updatedAt: now(),
        version: conflict.version + 1,
      };
      await this.db.updateConflict(updated);
      if (transition.phaseChanged)
        await this.db.appendEvent({
          conflictId,
          eventType: 'phase_started',
          actorType: 'system',
          actorId: null,
          partyId: null,
          partyRole: null,
          visibility: 'case',
          payload: { phase: transition.state.phase, round: transition.state.phaseIndex + 1 },
        });
      if (transition.completed) {
        if (this.usesJudge(conflict)) {
          await this.db.appendEvent({
            conflictId,
            eventType: 'judging_started',
            actorType: 'system',
            actorId: null,
            partyId: null,
            partyRole: null,
            visibility: 'case',
            payload: {
              reason: action.action_type === 'concede' ? 'concession' : 'protocol_complete',
            },
          });
          updated = { ...updated, status: 'judging' };
          await this.db.updateConflict(updated);
          await this.notifications.forConflict(
            conflictId,
            'judging_started',
            'The Judge is evaluating the case',
            'The structured exchange is complete. A verdict is being prepared.',
          );
        } else {
          updated = await this.resolveWithoutJudge(
            updated,
            action.action_type === 'concede' ? 'concession' : 'protocol_complete',
          );
        }
      } else {
        const next = protocol.getCurrentSpeaker(transition.state);
        const nextParty = parties.find((p) => p.role === next);
        if (nextParty?.userId)
          await this.notifications.forUser(
            nextParty.userId,
            conflictId,
            'your_turn',
            'Your agent can respond',
            `The ${transition.state.phase} phase is waiting for your agent.`,
          );
      }
      return {
        event: appended.event,
        duplicate: false,
        conflict: updated,
        needsJudging: transition.completed && this.usesJudge(conflict),
      };
    });
  }

  async pause(conflictId: string, userId: string) {
    return this.serialize(conflictId, async () => {
      const { conflict, party } = await this.requireParticipant(conflictId, userId);
      const state = {
        ...conflict,
        status: 'paused' as const,
        updatedAt: now(),
        version: conflict.version + 1,
      };
      if (conflict.status !== 'active')
        throw new DomainError('INVALID_STATE', 'Only an active conflict can be paused.', 409);
      await this.db.updateConflict(state);
      await this.db.appendEvent({
        conflictId,
        eventType: 'conflict_paused',
        actorType: 'user',
        actorId: userId,
        partyId: party.id,
        partyRole: party.role,
        visibility: 'case',
        payload: {},
      });
      await this.notifications.forConflict(
        conflictId,
        'conflict_paused',
        'Conflict paused',
        `${party.displayName} paused the conflict.`,
      );
      return state;
    });
  }
  async resume(conflictId: string, userId: string) {
    return this.serialize(conflictId, async () => {
      const { conflict, party } = await this.requireParticipant(conflictId, userId);
      if (conflict.status !== 'paused')
        throw new DomainError('INVALID_STATE', 'Only a paused conflict can be resumed.', 409);
      const state = {
        ...conflict,
        status: 'active' as const,
        updatedAt: now(),
        version: conflict.version + 1,
      };
      await this.db.updateConflict(state);
      await this.db.appendEvent({
        conflictId,
        eventType: 'conflict_resumed',
        actorType: 'user',
        actorId: userId,
        partyId: party.id,
        partyRole: party.role,
        visibility: 'case',
        payload: {},
      });
      return state;
    });
  }
  async concede(conflictId: string, userId: string) {
    return this.serialize(conflictId, async () => {
      const { conflict, party } = await this.requireParticipant(conflictId, userId);
      if (conflict.status !== 'active')
        throw new DomainError('INVALID_STATE', 'Only an active conflict can be conceded.', 409);
      let updated: Conflict = {
        ...conflict,
        status: 'judging' as const,
        updatedAt: now(),
        version: conflict.version + 1,
      };
      await this.db.appendEvent({
        conflictId,
        eventType: 'party_conceded',
        actorType: 'user',
        actorId: userId,
        partyId: party.id,
        partyRole: party.role,
        visibility: 'case',
        payload: { action_type: 'concede', content: '' },
      });
      await this.db.updateConflict(updated);
      if (this.usesJudge(conflict)) {
        await this.db.appendEvent({
          conflictId,
          eventType: 'judging_started',
          actorType: 'system',
          actorId: null,
          partyId: null,
          partyRole: null,
          visibility: 'case',
          payload: { reason: 'human_concession' },
        });
        await this.notifications.forConflict(
          conflictId,
          'judging_started',
          'The conflict was conceded',
          `${party.displayName} conceded. The Judge is preparing a short assessment.`,
        );
      } else updated = await this.resolveWithoutJudge(updated, 'human_concession');
      return updated;
    });
  }
  async handleAlarm(conflictId: string) {
    return this.serialize(conflictId, async () => {
      const conflict = await this.db.getConflict(conflictId);
      if (!conflict) return { changed: false, needsJudging: false };
      if (
        conflict.deadlineAt &&
        new Date(conflict.deadlineAt) <= new Date() &&
        ['inviting', 'briefing', 'active'].includes(conflict.status)
      ) {
        const expired = {
          ...conflict,
          status: 'expired' as const,
          updatedAt: now(),
          version: conflict.version + 1,
        };
        await this.db.updateConflict(expired);
        await this.db.appendEvent({
          conflictId,
          eventType: 'conflict_expired',
          actorType: 'system',
          actorId: null,
          partyId: null,
          partyRole: null,
          visibility: 'case',
          payload: { deadline_at: conflict.deadlineAt },
        });
        await this.notifications.forConflict(
          conflictId,
          'conflict_expired',
          'Conflict expired',
          'The conflict deadline passed. The existing case record remains available.',
        );
        return { changed: true, needsJudging: false };
      }
      if (conflict.status !== 'active' || !conflict.turnTimeoutSeconds)
        return { changed: false, needsJudging: false };
      const parties = await this.db.getParties(conflictId);
      const events = await this.db.listEvents(conflictId);
      const protocol = protocolFor(conflict.protocolType);
      const snapshot = await this.snapshot(conflict, parties, events);
      const speaker = protocol.getCurrentSpeaker(snapshot);
      if (!speaker) return { changed: false, needsJudging: false };
      const primary =
        snapshot.phase === 'opening'
          ? 'argument'
          : snapshot.phase === 'rebuttal'
            ? 'rebuttal'
            : 'closing_statement';
      const transition = protocol.applyAction(snapshot, speaker, primary);
      const party = parties.find((value) => value.role === speaker)!;
      await this.db.appendEvent({
        conflictId,
        eventType: 'turn_skipped',
        actorType: 'system',
        actorId: null,
        partyId: party.id,
        partyRole: party.role,
        visibility: 'case',
        payload: { reason: 'turn_timeout', phase: snapshot.phase },
      });
      let updated: Conflict = {
        ...conflict,
        status: transition.state.status,
        currentPhase: transition.state.phase,
        currentRound: transition.state.phaseIndex + 1,
        updatedAt: now(),
        version: conflict.version + 1,
      };
      await this.db.updateConflict(updated);
      if (transition.phaseChanged)
        await this.db.appendEvent({
          conflictId,
          eventType: 'phase_started',
          actorType: 'system',
          actorId: null,
          partyId: null,
          partyRole: null,
          visibility: 'case',
          payload: { phase: transition.state.phase, round: transition.state.phaseIndex + 1 },
        });
      if (transition.completed) {
        if (this.usesJudge(conflict))
          await this.db.appendEvent({
            conflictId,
            eventType: 'judging_started',
            actorType: 'system',
            actorId: null,
            partyId: null,
            partyRole: null,
            visibility: 'case',
            payload: { reason: 'protocol_complete_after_timeout' },
          });
        else updated = await this.resolveWithoutJudge(updated, 'protocol_complete_after_timeout');
      }
      return { changed: true, needsJudging: transition.completed && this.usesJudge(conflict) };
    });
  }
  async cancel(conflictId: string, userId: string) {
    return this.serialize(conflictId, async () => {
      const { conflict, party } = await this.requireOwner(conflictId, userId);
      if (['resolved', 'cancelled', 'expired'].includes(conflict.status))
        throw new DomainError('INVALID_STATE', 'This conflict cannot be cancelled.', 409);
      const state = {
        ...conflict,
        status: 'cancelled' as const,
        updatedAt: now(),
        version: conflict.version + 1,
      };
      await this.db.updateConflict(state);
      await this.db.appendEvent({
        conflictId,
        eventType: 'conflict_cancelled',
        actorType: 'user',
        actorId: userId,
        partyId: party.id,
        partyRole: party.role,
        visibility: 'case',
        payload: {},
      });
      await this.notifications.forConflict(
        conflictId,
        'conflict_cancelled',
        'Conflict cancelled',
        `${party.displayName} cancelled the conflict.`,
      );
      return state;
    });
  }
}

export function filterEvents(
  events: ConflictEvent[],
  viewer: { kind: 'participant'; partyId: string } | { kind: 'observer' } | { kind: 'judge' },
): ConflictEvent[] {
  return events.filter((event) => {
    if (viewer.kind === 'judge') return event.visibility !== 'party_private';
    if (viewer.kind === 'observer')
      return event.visibility === 'case' || event.visibility === 'observer';
    if (event.visibility === 'case' || event.visibility === 'observer') return true;
    return (
      (event.visibility === 'party_private' || event.visibility === 'judge_only') &&
      event.partyId === viewer.partyId
    );
  });
}
