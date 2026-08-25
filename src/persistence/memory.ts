import { opaqueId } from '@/domain/security';
import type {
  Agent,
  AgentToken,
  Conflict,
  ConflictEvent,
  ConflictParty,
  Invitation,
  Notification,
  PrivateBrief,
  Session,
  ShareLink,
  User,
  VerdictRecord,
} from '@/domain/types';
import type { Database, NewEvent } from './database';

export class MemoryDatabase implements Database {
  users = new Map<string, User>();
  conflicts = new Map<string, Conflict>();
  parties = new Map<string, ConflictParty>();
  events = new Map<string, ConflictEvent[]>();
  briefs = new Map<string, PrivateBrief>();
  agents = new Map<string, Agent>();
  tokens = new Map<string, AgentToken>();
  invitations = new Map<string, Invitation>();
  verdicts = new Map<string, VerdictRecord>();
  shareLinks = new Map<string, ShareLink>();
  notifications = new Map<string, Notification>();
  sessions = new Map<string, Session>();
  identities = new Map<string, string>();
  analytics: Array<{
    eventName: string;
    userId: string | null;
    conflictId: string | null;
    properties: Record<string, unknown>;
    createdAt: string;
  }> = [];

  async createUser(user: User) {
    this.users.set(user.id, structuredClone(user));
    return structuredClone(user);
  }
  async getUser(id: string) {
    return structuredClone(this.users.get(id) ?? null);
  }
  async findUserByEmail(email: string) {
    return structuredClone(
      [...this.users.values()].find((user) => user.email.toLowerCase() === email.toLowerCase()) ??
        null,
    );
  }
  async findUserByAuthIdentity(provider: string, subject: string) {
    const id = this.identities.get(`${provider}:${subject}`);
    return id ? this.getUser(id) : null;
  }
  async createAuthIdentity(_id: string, userId: string, provider: string, subject: string) {
    this.identities.set(`${provider}:${subject}`, userId);
  }
  async anonymizeUser(id: string) {
    const user = this.users.get(id);
    if (user) {
      const timestamp = new Date().toISOString();
      this.users.set(id, {
        ...user,
        email: `deleted+${id}@invalid.local`,
        displayName: 'Deleted participant',
        avatarUrl: null,
        deletedAt: timestamp,
      });
      for (const [key, userId] of this.identities) if (userId === id) this.identities.delete(key);
      for (const [sessionId, session] of this.sessions)
        if (session.userId === id)
          this.sessions.set(sessionId, { ...session, revokedAt: session.revokedAt ?? timestamp });
      const ownedAgents = new Set(
        [...this.agents.values()]
          .filter((value) => value.ownerUserId === id)
          .map((value) => value.id),
      );
      for (const agentId of ownedAgents) {
        const value = this.agents.get(agentId)!;
        this.agents.set(agentId, { ...value, status: 'revoked', updatedAt: timestamp });
      }
      for (const [tokenId, token] of this.tokens)
        if (ownedAgents.has(token.agentId))
          this.tokens.set(tokenId, { ...token, revokedAt: token.revokedAt ?? timestamp });
    }
  }
  async createSession(session: Session) {
    this.sessions.set(session.id, structuredClone(session));
    return structuredClone(session);
  }
  async findSession(tokenHash: string) {
    return structuredClone(
      [...this.sessions.values()].find((session) => session.tokenHash === tokenHash) ?? null,
    );
  }
  async revokeSession(tokenHash: string) {
    for (const [id, session] of this.sessions)
      if (session.tokenHash === tokenHash)
        this.sessions.set(id, { ...session, revokedAt: new Date().toISOString() });
  }

  async createConflict(conflict: Conflict, parties: [ConflictParty, ConflictParty]) {
    this.conflicts.set(conflict.id, structuredClone(conflict));
    parties.forEach((party) => this.parties.set(party.id, structuredClone(party)));
    return structuredClone(conflict);
  }
  async getConflict(id: string) {
    return structuredClone(this.conflicts.get(id) ?? null);
  }
  async updateConflict(conflict: Conflict) {
    this.conflicts.set(conflict.id, structuredClone(conflict));
  }
  async listConflictsForUser(userId: string) {
    const ids = new Set(
      [...this.parties.values()]
        .filter((party) => party.userId === userId)
        .map((party) => party.conflictId),
    );
    return [...this.conflicts.values()]
      .filter((conflict) => ids.has(conflict.id))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((value) => structuredClone(value));
  }
  async getParties(conflictId: string) {
    return [...this.parties.values()]
      .filter((party) => party.conflictId === conflictId)
      .sort((a, b) => a.role.localeCompare(b.role))
      .map((value) => structuredClone(value));
  }
  async updateParty(party: ConflictParty) {
    this.parties.set(party.id, structuredClone(party));
  }
  async findPartyForUser(conflictId: string, userId: string) {
    return structuredClone(
      [...this.parties.values()].find(
        (party) => party.conflictId === conflictId && party.userId === userId,
      ) ?? null,
    );
  }
  async findPartyForAgent(conflictId: string, agentId: string) {
    return structuredClone(
      [...this.parties.values()].find(
        (party) => party.conflictId === conflictId && party.agentId === agentId,
      ) ?? null,
    );
  }

  async appendEvent(input: NewEvent) {
    const list = this.events.get(input.conflictId) ?? [];
    if (input.clientRequestId) {
      const existing = list.find(
        (event) => event.payload.client_request_id === input.clientRequestId,
      );
      if (existing) return { event: structuredClone(existing), duplicate: true };
    }
    const event: ConflictEvent = {
      ...input,
      id: opaqueId('evt'),
      sequenceNumber: (list.at(-1)?.sequenceNumber ?? 0) + 1,
      createdAt: new Date().toISOString(),
      payload: {
        ...input.payload,
        ...(input.clientRequestId ? { client_request_id: input.clientRequestId } : {}),
      },
    };
    list.push(event);
    this.events.set(input.conflictId, list);
    return { event: structuredClone(event), duplicate: false };
  }
  async listEvents(conflictId: string) {
    return structuredClone(this.events.get(conflictId) ?? []);
  }

  async getBrief(conflictId: string, partyId: string) {
    return structuredClone(this.briefs.get(`${conflictId}:${partyId}`) ?? null);
  }
  async saveBrief(brief: PrivateBrief) {
    this.briefs.set(`${brief.conflictId}:${brief.partyId}`, structuredClone(brief));
    return structuredClone(brief);
  }

  async createAgent(agent: Agent) {
    this.agents.set(agent.id, structuredClone(agent));
    return structuredClone(agent);
  }
  async getAgent(id: string) {
    return structuredClone(this.agents.get(id) ?? null);
  }
  async listAgents(userId: string) {
    return [...this.agents.values()]
      .filter((agent) => agent.ownerUserId === userId)
      .map((value) => structuredClone(value));
  }
  async createAgentToken(token: AgentToken) {
    this.tokens.set(token.id, structuredClone(token));
    return structuredClone(token);
  }
  async findAgentToken(tokenHash: string) {
    return structuredClone(
      [...this.tokens.values()].find((token) => token.tokenHash === tokenHash) ?? null,
    );
  }
  async revokeAgentToken(tokenId: string, ownerUserId: string) {
    const token = this.tokens.get(tokenId);
    const agent = token ? this.agents.get(token.agentId) : null;
    if (!token || agent?.ownerUserId !== ownerUserId) return false;
    this.tokens.set(tokenId, { ...token, revokedAt: new Date().toISOString() });
    return true;
  }
  async revokeAllAgentTokens(agentId: string) {
    for (const [id, token] of this.tokens)
      if (token.agentId === agentId)
        this.tokens.set(id, { ...token, revokedAt: new Date().toISOString() });
  }

  async createInvitation(invitation: Invitation) {
    this.invitations.set(invitation.id, structuredClone(invitation));
    return structuredClone(invitation);
  }
  async findInvitation(tokenHash: string) {
    return structuredClone(
      [...this.invitations.values()].find((invite) => invite.tokenHash === tokenHash) ?? null,
    );
  }
  async updateInvitation(invitation: Invitation) {
    this.invitations.set(invitation.id, structuredClone(invitation));
  }
  async listInvitations(conflictId: string) {
    return [...this.invitations.values()]
      .filter((invite) => invite.conflictId === conflictId)
      .map((value) => structuredClone(value));
  }

  async saveVerdict(verdict: VerdictRecord) {
    this.verdicts.set(verdict.conflictId, structuredClone(verdict));
    return structuredClone(verdict);
  }
  async getVerdict(conflictId: string) {
    return structuredClone(this.verdicts.get(conflictId) ?? null);
  }

  async createShareLink(link: ShareLink) {
    this.shareLinks.set(link.id, structuredClone(link));
    return structuredClone(link);
  }
  async listShareLinks(conflictId: string) {
    return [...this.shareLinks.values()]
      .filter((link) => link.conflictId === conflictId)
      .map((value) => structuredClone(value));
  }
  async findShareLink(tokenHash: string) {
    return structuredClone(
      [...this.shareLinks.values()].find((link) => link.tokenHash === tokenHash) ?? null,
    );
  }
  async revokeShareLink(id: string, conflictId: string) {
    const link = this.shareLinks.get(id);
    if (!link || link.conflictId !== conflictId) return false;
    this.shareLinks.set(id, { ...link, revokedAt: new Date().toISOString() });
    return true;
  }

  async createNotification(notification: Notification) {
    this.notifications.set(notification.id, structuredClone(notification));
    return structuredClone(notification);
  }
  async listNotifications(userId: string) {
    return [...this.notifications.values()]
      .filter((item) => item.userId === userId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((value) => structuredClone(value));
  }
  async markNotificationRead(id: string, userId: string) {
    const item = this.notifications.get(id);
    if (!item || item.userId !== userId) return false;
    this.notifications.set(id, { ...item, readAt: new Date().toISOString() });
    return true;
  }
  async recordAnalytics(
    eventName: string,
    userId: string | null,
    conflictId: string | null,
    properties: Record<string, unknown> = {},
  ) {
    this.analytics.push({
      eventName,
      userId,
      conflictId,
      properties,
      createdAt: new Date().toISOString(),
    });
  }
}
