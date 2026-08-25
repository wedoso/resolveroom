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

export interface NewEvent extends Omit<ConflictEvent, 'id' | 'sequenceNumber' | 'createdAt'> {
  clientRequestId?: string;
}

export interface Database {
  createUser(user: User): Promise<User>;
  getUser(id: string): Promise<User | null>;
  findUserByEmail(email: string): Promise<User | null>;
  findUserByAuthIdentity(provider: string, subject: string): Promise<User | null>;
  createAuthIdentity(
    id: string,
    userId: string,
    provider: string,
    subject: string,
    createdAt: string,
  ): Promise<void>;
  anonymizeUser(id: string): Promise<void>;
  createSession(session: Session): Promise<Session>;
  findSession(tokenHash: string): Promise<Session | null>;
  revokeSession(tokenHash: string): Promise<void>;

  createConflict(conflict: Conflict, parties: [ConflictParty, ConflictParty]): Promise<Conflict>;
  getConflict(id: string): Promise<Conflict | null>;
  updateConflict(conflict: Conflict): Promise<void>;
  listConflictsForUser(userId: string): Promise<Conflict[]>;
  getParties(conflictId: string): Promise<ConflictParty[]>;
  updateParty(party: ConflictParty): Promise<void>;
  findPartyForUser(conflictId: string, userId: string): Promise<ConflictParty | null>;
  findPartyForAgent(conflictId: string, agentId: string): Promise<ConflictParty | null>;

  appendEvent(event: NewEvent): Promise<{ event: ConflictEvent; duplicate: boolean }>;
  listEvents(conflictId: string): Promise<ConflictEvent[]>;

  getBrief(conflictId: string, partyId: string): Promise<PrivateBrief | null>;
  saveBrief(brief: PrivateBrief): Promise<PrivateBrief>;

  createAgent(agent: Agent): Promise<Agent>;
  getAgent(id: string): Promise<Agent | null>;
  listAgents(userId: string): Promise<Agent[]>;
  createAgentToken(token: AgentToken): Promise<AgentToken>;
  findAgentToken(tokenHash: string): Promise<AgentToken | null>;
  revokeAgentToken(tokenId: string, ownerUserId: string): Promise<boolean>;
  revokeAllAgentTokens(agentId: string): Promise<void>;

  createInvitation(invitation: Invitation): Promise<Invitation>;
  findInvitation(tokenHash: string): Promise<Invitation | null>;
  updateInvitation(invitation: Invitation): Promise<void>;
  listInvitations(conflictId: string): Promise<Invitation[]>;

  saveVerdict(verdict: VerdictRecord): Promise<VerdictRecord>;
  getVerdict(conflictId: string): Promise<VerdictRecord | null>;

  createShareLink(link: ShareLink): Promise<ShareLink>;
  listShareLinks(conflictId: string): Promise<ShareLink[]>;
  findShareLink(tokenHash: string): Promise<ShareLink | null>;
  revokeShareLink(id: string, conflictId: string): Promise<boolean>;

  createNotification(notification: Notification): Promise<Notification>;
  listNotifications(userId: string): Promise<Notification[]>;
  markNotificationRead(id: string, userId: string): Promise<boolean>;
  recordAnalytics(
    eventName: string,
    userId: string | null,
    conflictId: string | null,
    properties?: Record<string, unknown>,
  ): Promise<void>;
}
