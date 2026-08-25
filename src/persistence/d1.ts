import type {
  Agent,
  AgentPairing,
  AgentToken,
  Conflict,
  ConflictEvent,
  ConflictParty,
  Invitation,
  Notification,
  PrivateBrief,
  ShareLink,
  User,
  VerdictRecord,
} from '@/domain/types';
import { opaqueId } from '@/domain/security';
import type { Database, NewEvent } from './database';

const bool = (value: unknown) => Boolean(value);
const conflictFrom = (r: any): Conflict => ({
  id: r.id,
  title: r.title,
  description: r.description,
  protocolType: r.protocol_type,
  status: r.status,
  createdByUserId: r.created_by_user_id,
  currentPhase: r.current_phase,
  currentRound: r.current_round,
  firstSpeakerPartyId: r.first_speaker_party_id,
  maxRounds: r.max_rounds,
  deadlineAt: r.deadline_at,
  turnTimeoutSeconds: r.turn_timeout_seconds,
  version: r.version,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  resolvedAt: r.resolved_at,
  persuaderParty: r.persuader_party,
});
const partyFrom = (r: any): ConflictParty => ({
  id: r.id,
  conflictId: r.conflict_id,
  role: r.role,
  userId: r.user_id,
  displayName: r.display_name,
  agentId: r.agent_id,
  ready: bool(r.ready),
  persuasionRole: r.persuasion_role,
  joinedAt: r.joined_at,
});
const userFrom = (r: any): User => ({
  id: r.id,
  email: r.email,
  displayName: r.display_name,
  avatarUrl: r.avatar_url,
  createdAt: r.created_at,
  deletedAt: r.deleted_at,
});
const agentFrom = (r: any): Agent => ({
  id: r.id,
  ownerUserId: r.owner_user_id,
  name: r.name,
  status: r.status,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});
const tokenFrom = (r: any): AgentToken => ({
  id: r.id,
  agentId: r.agent_id,
  tokenHash: r.token_hash,
  tokenPrefix: r.token_prefix,
  createdAt: r.created_at,
  lastUsedAt: r.last_used_at,
  revokedAt: r.revoked_at,
});
const pairingFrom = (r: any): AgentPairing => ({
  id: r.id,
  agentId: r.agent_id,
  conflictId: r.conflict_id,
  codeHash: r.code_hash,
  expiresAt: r.expires_at,
  claimedAt: r.claimed_at,
  revokedAt: r.revoked_at,
  clientName: r.client_name,
  createdAt: r.created_at,
});
const eventFrom = (r: any): ConflictEvent => ({
  id: r.id,
  conflictId: r.conflict_id,
  sequenceNumber: r.sequence_number,
  eventType: r.event_type,
  actorType: r.actor_type,
  actorId: r.actor_id,
  partyId: r.party_id,
  partyRole: r.party_role,
  visibility: r.visibility,
  payload: JSON.parse(r.payload_json),
  createdAt: r.created_at,
});
const inviteFrom = (r: any): Invitation => ({
  id: r.id,
  conflictId: r.conflict_id,
  targetRole: r.target_role,
  tokenHash: r.token_hash,
  expiresAt: r.expires_at,
  acceptedAt: r.accepted_at,
  revokedAt: r.revoked_at,
  createdAt: r.created_at,
});
const shareFrom = (r: any): ShareLink => ({
  id: r.id,
  conflictId: r.conflict_id,
  tokenHash: r.token_hash,
  expiresAt: r.expires_at,
  revokedAt: r.revoked_at,
  createdByUserId: r.created_by_user_id,
  createdAt: r.created_at,
});

export class D1Store implements Database {
  constructor(private readonly db: D1Database) {}
  async createUser(u: User) {
    await this.db
      .prepare('INSERT INTO users VALUES (?,?,?,?,?,?)')
      .bind(u.id, u.email, u.displayName, u.avatarUrl, u.createdAt, u.deletedAt)
      .run();
    return u;
  }
  async getUser(id: string) {
    const r = await this.db.prepare('SELECT * FROM users WHERE id=?').bind(id).first();
    return r ? userFrom(r) : null;
  }
  async findUserByEmail(email: string) {
    const r = await this.db
      .prepare('SELECT * FROM users WHERE lower(email)=lower(?)')
      .bind(email)
      .first();
    return r ? userFrom(r) : null;
  }
  async findUserByAuthIdentity(provider: string, subject: string) {
    const r = await this.db
      .prepare(
        'SELECT u.* FROM users u JOIN auth_identities a ON a.user_id=u.id WHERE a.provider=? AND a.provider_subject=?',
      )
      .bind(provider, subject)
      .first();
    return r ? userFrom(r) : null;
  }
  async createAuthIdentity(
    id: string,
    userId: string,
    provider: string,
    subject: string,
    createdAt: string,
  ) {
    await this.db
      .prepare('INSERT OR IGNORE INTO auth_identities VALUES (?,?,?,?,?)')
      .bind(id, userId, provider, subject, createdAt)
      .run();
  }
  async anonymizeUser(id: string) {
    const timestamp = new Date().toISOString();
    await this.db.batch([
      this.db
        .prepare(
          "UPDATE users SET email='deleted+'||id||'@invalid.local',display_name='Deleted participant',avatar_url=NULL,deleted_at=? WHERE id=?",
        )
        .bind(timestamp, id),
      this.db.prepare('DELETE FROM auth_identities WHERE user_id=?').bind(id),
      this.db
        .prepare('UPDATE sessions SET revoked_at=COALESCE(revoked_at,?) WHERE user_id=?')
        .bind(timestamp, id),
      this.db
        .prepare("UPDATE agents SET status='revoked',updated_at=? WHERE owner_user_id=?")
        .bind(timestamp, id),
      this.db
        .prepare(
          'UPDATE agent_tokens SET revoked_at=COALESCE(revoked_at,?) WHERE agent_id IN (SELECT id FROM agents WHERE owner_user_id=?)',
        )
        .bind(timestamp, id),
      this.db
        .prepare(
          'UPDATE agent_pairings SET revoked_at=COALESCE(revoked_at,?) WHERE agent_id IN (SELECT id FROM agents WHERE owner_user_id=?)',
        )
        .bind(timestamp, id),
    ]);
  }
  async createSession(s: any) {
    await this.db
      .prepare('INSERT INTO sessions VALUES (?,?,?,?,?,?)')
      .bind(s.id, s.userId, s.tokenHash, s.expiresAt, s.createdAt, s.revokedAt)
      .run();
    return s;
  }
  async findSession(hash: string) {
    const r: any = await this.db
      .prepare('SELECT * FROM sessions WHERE token_hash=?')
      .bind(hash)
      .first();
    return r
      ? {
          id: r.id,
          userId: r.user_id,
          tokenHash: r.token_hash,
          expiresAt: r.expires_at,
          createdAt: r.created_at,
          revokedAt: r.revoked_at,
        }
      : null;
  }
  async revokeSession(hash: string) {
    await this.db
      .prepare('UPDATE sessions SET revoked_at=? WHERE token_hash=?')
      .bind(new Date().toISOString(), hash)
      .run();
  }
  async createConflict(c: Conflict, ps: [ConflictParty, ConflictParty]) {
    await this.db.batch([
      this.db
        .prepare('INSERT INTO conflicts VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .bind(
          c.id,
          c.title,
          c.description,
          c.protocolType,
          c.status,
          c.createdByUserId,
          c.currentPhase,
          c.currentRound,
          c.firstSpeakerPartyId,
          c.maxRounds,
          c.deadlineAt,
          c.turnTimeoutSeconds,
          c.version,
          c.persuaderParty,
          c.createdAt,
          c.updatedAt,
          c.resolvedAt,
        ),
      ...ps.map((p) =>
        this.db
          .prepare('INSERT INTO conflict_parties VALUES (?,?,?,?,?,?,?,?,?)')
          .bind(
            p.id,
            p.conflictId,
            p.role,
            p.userId,
            p.displayName,
            p.agentId,
            p.ready ? 1 : 0,
            p.persuasionRole,
            p.joinedAt,
          ),
      ),
    ]);
    return c;
  }
  async getConflict(id: string) {
    const r = await this.db.prepare('SELECT * FROM conflicts WHERE id=?').bind(id).first();
    return r ? conflictFrom(r) : null;
  }
  async updateConflict(c: Conflict) {
    await this.db
      .prepare(
        'UPDATE conflicts SET title=?,description=?,status=?,current_phase=?,current_round=?,first_speaker_party_id=?,max_rounds=?,deadline_at=?,turn_timeout_seconds=?,version=?,updated_at=?,resolved_at=? WHERE id=?',
      )
      .bind(
        c.title,
        c.description,
        c.status,
        c.currentPhase,
        c.currentRound,
        c.firstSpeakerPartyId,
        c.maxRounds,
        c.deadlineAt,
        c.turnTimeoutSeconds,
        c.version,
        c.updatedAt,
        c.resolvedAt,
        c.id,
      )
      .run();
  }
  async listConflictsForUser(uid: string) {
    const r = await this.db
      .prepare(
        'SELECT c.* FROM conflicts c JOIN conflict_parties p ON p.conflict_id=c.id WHERE p.user_id=? ORDER BY c.updated_at DESC',
      )
      .bind(uid)
      .all();
    return r.results.map(conflictFrom);
  }
  async listConflictsForAgent(aid: string) {
    const r = await this.db
      .prepare(
        'SELECT c.* FROM conflicts c JOIN conflict_parties p ON p.conflict_id=c.id WHERE p.agent_id=? ORDER BY c.updated_at DESC',
      )
      .bind(aid)
      .all();
    return r.results.map(conflictFrom);
  }
  async getParties(cid: string) {
    const r = await this.db
      .prepare('SELECT * FROM conflict_parties WHERE conflict_id=? ORDER BY role')
      .bind(cid)
      .all();
    return r.results.map(partyFrom);
  }
  async updateParty(p: ConflictParty) {
    await this.db
      .prepare(
        'UPDATE conflict_parties SET user_id=?,display_name=?,agent_id=?,ready=?,persuasion_role=?,joined_at=? WHERE id=?',
      )
      .bind(p.userId, p.displayName, p.agentId, p.ready ? 1 : 0, p.persuasionRole, p.joinedAt, p.id)
      .run();
  }
  async findPartyForUser(cid: string, uid: string) {
    const r = await this.db
      .prepare('SELECT * FROM conflict_parties WHERE conflict_id=? AND user_id=?')
      .bind(cid, uid)
      .first();
    return r ? partyFrom(r) : null;
  }
  async findPartyForAgent(cid: string, aid: string) {
    const r = await this.db
      .prepare('SELECT * FROM conflict_parties WHERE conflict_id=? AND agent_id=?')
      .bind(cid, aid)
      .first();
    return r ? partyFrom(r) : null;
  }
  async appendEvent(input: NewEvent) {
    if (input.clientRequestId) {
      const x = await this.db
        .prepare('SELECT * FROM conflict_events WHERE conflict_id=? AND client_request_id=?')
        .bind(input.conflictId, input.clientRequestId)
        .first();
      if (x) return { event: eventFrom(x), duplicate: true };
    }
    const sequence =
      (await this.db
        .prepare(
          'SELECT COALESCE(MAX(sequence_number),0)+1 next FROM conflict_events WHERE conflict_id=?',
        )
        .bind(input.conflictId)
        .first<number>('next')) ?? 1;
    const event: ConflictEvent = {
      ...input,
      id: opaqueId('evt'),
      sequenceNumber: sequence,
      createdAt: new Date().toISOString(),
      payload: {
        ...input.payload,
        ...(input.clientRequestId ? { client_request_id: input.clientRequestId } : {}),
      },
    };
    try {
      await this.db
        .prepare('INSERT INTO conflict_events VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
        .bind(
          event.id,
          event.conflictId,
          event.sequenceNumber,
          event.eventType,
          event.actorType,
          event.actorId,
          event.partyId,
          event.partyRole,
          event.visibility,
          JSON.stringify(event.payload),
          input.clientRequestId ?? null,
          event.createdAt,
        )
        .run();
      return { event, duplicate: false };
    } catch (error) {
      if (input.clientRequestId) {
        const x = await this.db
          .prepare('SELECT * FROM conflict_events WHERE conflict_id=? AND client_request_id=?')
          .bind(input.conflictId, input.clientRequestId)
          .first();
        if (x) return { event: eventFrom(x), duplicate: true };
      }
      throw error;
    }
  }
  async listEvents(cid: string) {
    const r = await this.db
      .prepare('SELECT * FROM conflict_events WHERE conflict_id=? ORDER BY sequence_number')
      .bind(cid)
      .all();
    return r.results.map(eventFrom);
  }
  async getBrief(cid: string, pid: string) {
    const r: any = await this.db
      .prepare('SELECT * FROM private_briefs WHERE conflict_id=? AND party_id=?')
      .bind(cid, pid)
      .first();
    return r
      ? {
          id: r.id,
          conflictId: r.conflict_id,
          partyId: r.party_id,
          content: JSON.parse(r.content_json),
          version: r.version,
          updatedAt: r.updated_at,
        }
      : null;
  }
  async saveBrief(b: PrivateBrief) {
    await this.db
      .prepare(
        'INSERT INTO private_briefs VALUES (?,?,?,?,?,?) ON CONFLICT(conflict_id,party_id) DO UPDATE SET content_json=excluded.content_json,version=private_briefs.version+1,updated_at=excluded.updated_at',
      )
      .bind(b.id, b.conflictId, b.partyId, JSON.stringify(b.content), b.version, b.updatedAt)
      .run();
    return b;
  }
  async createAgent(a: Agent) {
    await this.db
      .prepare('INSERT INTO agents VALUES (?,?,?,?,?,?)')
      .bind(a.id, a.ownerUserId, a.name, a.status, a.createdAt, a.updatedAt)
      .run();
    return a;
  }
  async getAgent(id: string) {
    const r = await this.db.prepare('SELECT * FROM agents WHERE id=?').bind(id).first();
    return r ? agentFrom(r) : null;
  }
  async listAgents(uid: string) {
    const r = await this.db
      .prepare(
        "SELECT * FROM agents WHERE owner_user_id=? AND status='active' ORDER BY created_at DESC",
      )
      .bind(uid)
      .all();
    return r.results.map(agentFrom);
  }
  async revokeAgent(agentId: string, ownerUserId: string) {
    const boundRows = await this.db
      .prepare('SELECT * FROM conflict_parties WHERE agent_id=?')
      .bind(agentId)
      .all();
    const unboundParties = boundRows.results.map(partyFrom);
    const inUse = await this.db
      .prepare(
        "SELECT c.id FROM conflicts c JOIN conflict_parties p ON p.conflict_id=c.id WHERE p.agent_id=? AND c.status IN ('active','paused','judging') LIMIT 1",
      )
      .bind(agentId)
      .first<string>('id');
    if (inUse) return { status: 'in_use', conflictId: inUse } as const;
    const revokedAt = new Date().toISOString();
    const results = await this.db.batch([
      this.db
        .prepare(
          "UPDATE agents SET status='revoked',updated_at=? WHERE id=? AND owner_user_id=? AND status='active' AND NOT EXISTS (SELECT 1 FROM conflict_parties p JOIN conflicts c ON c.id=p.conflict_id WHERE p.agent_id=agents.id AND c.status IN ('active','paused','judging'))",
        )
        .bind(revokedAt, agentId, ownerUserId),
      this.db
        .prepare(
          "UPDATE conflict_parties SET agent_id=NULL,ready=0 WHERE agent_id=? AND EXISTS (SELECT 1 FROM agents WHERE id=? AND status='revoked' AND updated_at=?)",
        )
        .bind(agentId, agentId, revokedAt),
      this.db
        .prepare(
          "UPDATE agent_tokens SET revoked_at=COALESCE(revoked_at,?) WHERE agent_id=? AND EXISTS (SELECT 1 FROM agents WHERE id=? AND status='revoked' AND updated_at=?)",
        )
        .bind(revokedAt, agentId, agentId, revokedAt),
      this.db
        .prepare(
          "UPDATE agent_pairings SET revoked_at=? WHERE agent_id=? AND claimed_at IS NULL AND revoked_at IS NULL AND EXISTS (SELECT 1 FROM agents WHERE id=? AND status='revoked' AND updated_at=?)",
        )
        .bind(revokedAt, agentId, agentId, revokedAt),
    ]);
    if (results[0].meta.changes === 1) return { status: 'revoked', unboundParties } as const;
    const agent = await this.getAgent(agentId);
    if (!agent || agent.ownerUserId !== ownerUserId || agent.status !== 'active')
      return { status: 'not_found' } as const;
    const racedConflict = await this.db
      .prepare(
        "SELECT c.id FROM conflicts c JOIN conflict_parties p ON p.conflict_id=c.id WHERE p.agent_id=? AND c.status IN ('active','paused','judging') LIMIT 1",
      )
      .bind(agentId)
      .first<string>('id');
    return racedConflict
      ? ({ status: 'in_use', conflictId: racedConflict } as const)
      : ({ status: 'not_found' } as const);
  }
  async createAgentToken(t: AgentToken) {
    await this.db
      .prepare('INSERT INTO agent_tokens VALUES (?,?,?,?,?,?,?)')
      .bind(t.id, t.agentId, t.tokenHash, t.tokenPrefix, t.createdAt, t.lastUsedAt, t.revokedAt)
      .run();
    return t;
  }
  async findAgentToken(hash: string) {
    const r = await this.db
      .prepare('SELECT * FROM agent_tokens WHERE token_hash=?')
      .bind(hash)
      .first();
    return r ? tokenFrom(r) : null;
  }
  async revokeAgentToken(id: string, uid: string) {
    const r = await this.db
      .prepare(
        'UPDATE agent_tokens SET revoked_at=? WHERE id=? AND agent_id IN (SELECT id FROM agents WHERE owner_user_id=?)',
      )
      .bind(new Date().toISOString(), id, uid)
      .run();
    return r.meta.changes > 0;
  }
  async revokeAllAgentTokens(aid: string) {
    await this.db
      .prepare('UPDATE agent_tokens SET revoked_at=COALESCE(revoked_at,?) WHERE agent_id=?')
      .bind(new Date().toISOString(), aid)
      .run();
  }
  async hasActiveAgentToken(agentId: string) {
    const count = await this.db
      .prepare('SELECT COUNT(*) AS count FROM agent_tokens WHERE agent_id=? AND revoked_at IS NULL')
      .bind(agentId)
      .first<number>('count');
    return (count ?? 0) > 0;
  }
  async createAgentPairing(pairing: AgentPairing) {
    await this.db
      .prepare('INSERT INTO agent_pairings VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
      .bind(
        pairing.id,
        pairing.agentId,
        pairing.conflictId,
        pairing.codeHash,
        pairing.expiresAt,
        pairing.claimedAt,
        pairing.revokedAt,
        pairing.clientName,
        null,
        null,
        null,
        pairing.createdAt,
      )
      .run();
    return pairing;
  }
  async getAgentPairing(id: string) {
    const row = await this.db.prepare('SELECT * FROM agent_pairings WHERE id=?').bind(id).first();
    return row ? pairingFrom(row) : null;
  }
  async revokeOpenAgentPairings(agentId: string) {
    await this.db
      .prepare(
        'UPDATE agent_pairings SET revoked_at=? WHERE agent_id=? AND claimed_at IS NULL AND revoked_at IS NULL',
      )
      .bind(new Date().toISOString(), agentId)
      .run();
  }
  async claimAgentPairing(codeHash: string, clientName: string, token: AgentToken) {
    const claimedAt = new Date().toISOString();
    const results = await this.db.batch([
      this.db
        .prepare(
          'UPDATE conflict_parties SET agent_id=(SELECT agent_id FROM agent_pairings WHERE code_hash=?),ready=0 WHERE conflict_id=(SELECT conflict_id FROM agent_pairings WHERE code_hash=?) AND user_id=(SELECT owner_user_id FROM agents WHERE id=(SELECT agent_id FROM agent_pairings WHERE code_hash=?)) AND (agent_id IS NULL OR agent_id=(SELECT agent_id FROM agent_pairings WHERE code_hash=?))',
        )
        .bind(codeHash, codeHash, codeHash, codeHash),
      this.db
        .prepare(
          "UPDATE agent_pairings SET claimed_at=?,client_name=?,credential_id=?,credential_hash=?,credential_prefix=? WHERE code_hash=? AND claimed_at IS NULL AND revoked_at IS NULL AND expires_at>? AND agent_id IN (SELECT id FROM agents WHERE status='active') AND EXISTS (SELECT 1 FROM conflict_parties p JOIN agents a ON a.id=agent_pairings.agent_id WHERE p.conflict_id=agent_pairings.conflict_id AND p.user_id=a.owner_user_id AND p.agent_id=agent_pairings.agent_id)",
        )
        .bind(
          claimedAt,
          clientName,
          token.id,
          token.tokenHash,
          token.tokenPrefix,
          codeHash,
          claimedAt,
        ),
      this.db
        .prepare(
          'INSERT INTO agent_tokens (id,agent_id,token_hash,token_prefix,created_at,last_used_at,revoked_at) SELECT credential_id,agent_id,credential_hash,credential_prefix,?,NULL,NULL FROM agent_pairings WHERE code_hash=? AND credential_id=?',
        )
        .bind(token.createdAt, codeHash, token.id),
      this.db
        .prepare(
          'UPDATE agent_pairings SET credential_hash=NULL,credential_prefix=NULL WHERE code_hash=? AND credential_id=?',
        )
        .bind(codeHash, token.id),
    ]);
    if (results[1].meta.changes !== 1 || results[2].meta.changes !== 1) return null;
    const row = await this.db
      .prepare('SELECT * FROM agent_pairings WHERE code_hash=?')
      .bind(codeHash)
      .first();
    return row ? pairingFrom(row) : null;
  }
  async createInvitation(i: Invitation) {
    await this.db
      .prepare('INSERT INTO conflict_invites VALUES (?,?,?,?,?,?,?,?)')
      .bind(
        i.id,
        i.conflictId,
        i.targetRole,
        i.tokenHash,
        i.expiresAt,
        i.acceptedAt,
        i.revokedAt,
        i.createdAt,
      )
      .run();
    return i;
  }
  async findInvitation(hash: string) {
    const r = await this.db
      .prepare('SELECT * FROM conflict_invites WHERE token_hash=?')
      .bind(hash)
      .first();
    return r ? inviteFrom(r) : null;
  }
  async updateInvitation(i: Invitation) {
    await this.db
      .prepare('UPDATE conflict_invites SET accepted_at=?,revoked_at=? WHERE id=?')
      .bind(i.acceptedAt, i.revokedAt, i.id)
      .run();
  }
  async listInvitations(cid: string) {
    const r = await this.db
      .prepare('SELECT * FROM conflict_invites WHERE conflict_id=?')
      .bind(cid)
      .all();
    return r.results.map(inviteFrom);
  }
  async saveVerdict(v: VerdictRecord) {
    await this.db
      .prepare('INSERT OR REPLACE INTO verdicts VALUES (?,?,?,?,?)')
      .bind(v.id, v.conflictId, JSON.stringify(v.verdict), v.provider, v.createdAt)
      .run();
    return v;
  }
  async getVerdict(cid: string) {
    const r: any = await this.db
      .prepare('SELECT * FROM verdicts WHERE conflict_id=?')
      .bind(cid)
      .first();
    return r
      ? {
          id: r.id,
          conflictId: r.conflict_id,
          verdict: JSON.parse(r.verdict_json),
          provider: r.provider,
          createdAt: r.created_at,
        }
      : null;
  }
  async createShareLink(s: ShareLink) {
    await this.db
      .prepare('INSERT INTO share_links VALUES (?,?,?,?,?,?,?)')
      .bind(
        s.id,
        s.conflictId,
        s.tokenHash,
        s.expiresAt,
        s.revokedAt,
        s.createdByUserId,
        s.createdAt,
      )
      .run();
    return s;
  }
  async listShareLinks(cid: string) {
    const r = await this.db
      .prepare('SELECT * FROM share_links WHERE conflict_id=?')
      .bind(cid)
      .all();
    return r.results.map(shareFrom);
  }
  async findShareLink(hash: string) {
    const r = await this.db
      .prepare('SELECT * FROM share_links WHERE token_hash=?')
      .bind(hash)
      .first();
    return r ? shareFrom(r) : null;
  }
  async revokeShareLink(id: string, cid: string) {
    const r = await this.db
      .prepare('UPDATE share_links SET revoked_at=? WHERE id=? AND conflict_id=?')
      .bind(new Date().toISOString(), id, cid)
      .run();
    return r.meta.changes > 0;
  }
  async createNotification(n: Notification) {
    await this.db
      .prepare('INSERT INTO notifications VALUES (?,?,?,?,?,?,?,?)')
      .bind(n.id, n.userId, n.conflictId, n.type, n.title, n.body, n.readAt, n.createdAt)
      .run();
    return n;
  }
  async listNotifications(uid: string) {
    const r: any = await this.db
      .prepare('SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC')
      .bind(uid)
      .all();
    return r.results.map((n: any) => ({
      id: n.id,
      userId: n.user_id,
      conflictId: n.conflict_id,
      type: n.type,
      title: n.title,
      body: n.body,
      readAt: n.read_at,
      createdAt: n.created_at,
    }));
  }
  async markNotificationRead(id: string, uid: string) {
    const r = await this.db
      .prepare('UPDATE notifications SET read_at=? WHERE id=? AND user_id=?')
      .bind(new Date().toISOString(), id, uid)
      .run();
    return r.meta.changes > 0;
  }
  async recordAnalytics(
    eventName: string,
    userId: string | null,
    conflictId: string | null,
    properties: Record<string, unknown> = {},
  ) {
    await this.db
      .prepare('INSERT INTO analytics_events VALUES (?,?,?,?,?,?)')
      .bind(
        `anl_${crypto.randomUUID().replaceAll('-', '')}`,
        eventName,
        userId,
        conflictId,
        JSON.stringify(properties),
        new Date().toISOString(),
      )
      .run();
  }
}
