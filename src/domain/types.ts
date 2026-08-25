import { z } from 'zod';

export const protocolTypes = ['debate', 'persuasion'] as const;
export const conflictStatuses = [
  'draft',
  'inviting',
  'briefing',
  'active',
  'judging',
  'resolved',
  'paused',
  'cancelled',
  'expired',
] as const;
export const conflictPhases = ['opening', 'rebuttal', 'closing'] as const;
export const partyRoles = ['party_a', 'party_b'] as const;
export const eventVisibilities = ['party_private', 'case', 'observer', 'judge_only'] as const;
export const agentActionTypes = [
  'argument',
  'rebuttal',
  'closing_statement',
  'evidence',
  'concede',
] as const;

export type ProtocolType = (typeof protocolTypes)[number];
export type ConflictStatus = (typeof conflictStatuses)[number];
export type ConflictPhase = (typeof conflictPhases)[number];
export type PartyRole = (typeof partyRoles)[number];
export type EventVisibility = (typeof eventVisibilities)[number];
export type AgentActionType = (typeof agentActionTypes)[number];
export type ActorType = 'user' | 'agent' | 'system' | 'judge';

export const conflictEventTypes = [
  'conflict_created',
  'party_invited',
  'party_joined',
  'agent_bound',
  'agent_unbound',
  'private_brief_updated',
  'conflict_started',
  'phase_started',
  'argument_submitted',
  'rebuttal_submitted',
  'evidence_submitted',
  'closing_statement_submitted',
  'party_conceded',
  'turn_skipped',
  'conflict_paused',
  'conflict_resumed',
  'judging_started',
  'verdict_issued',
  'conflict_cancelled',
  'conflict_expired',
] as const;
export type ConflictEventType = (typeof conflictEventTypes)[number];

export interface User {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  createdAt: string;
  deletedAt: string | null;
}
export interface Session {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: string;
  createdAt: string;
  revokedAt: string | null;
}
export interface Agent {
  id: string;
  ownerUserId: string;
  name: string;
  status: 'active' | 'revoked';
  createdAt: string;
  updatedAt: string;
}
export interface AgentToken {
  id: string;
  agentId: string;
  tokenHash: string;
  tokenPrefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}
export interface AgentPairing {
  id: string;
  agentId: string;
  conflictId: string | null;
  codeHash: string;
  expiresAt: string;
  claimedAt: string | null;
  revokedAt: string | null;
  clientName: string | null;
  createdAt: string;
}
export interface Conflict {
  id: string;
  title: string;
  description: string;
  protocolType: ProtocolType;
  status: ConflictStatus;
  createdByUserId: string;
  currentPhase: ConflictPhase | null;
  currentRound: number;
  firstSpeakerPartyId: string | null;
  maxRounds: number;
  deadlineAt: string | null;
  turnTimeoutSeconds: number | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  persuaderParty: PartyRole | null;
}
export interface ConflictParty {
  id: string;
  conflictId: string;
  role: PartyRole;
  userId: string | null;
  displayName: string;
  agentId: string | null;
  ready: boolean;
  persuasionRole: 'persuader' | 'target' | null;
  joinedAt: string | null;
}
export interface ConflictEvent {
  id: string;
  conflictId: string;
  sequenceNumber: number;
  eventType: ConflictEventType;
  actorType: ActorType;
  actorId: string | null;
  partyId: string | null;
  partyRole: PartyRole | null;
  visibility: EventVisibility;
  payload: Record<string, unknown>;
  createdAt: string;
}
export interface PrivateBrief {
  id: string;
  conflictId: string;
  partyId: string;
  content: PrivateBriefContent;
  version: number;
  updatedAt: string;
}
export interface PrivateBriefContent {
  goal: string;
  priorities: string[];
  acceptableCompromises: string[];
  privateNotes: string;
}
export interface Invitation {
  id: string;
  conflictId: string;
  targetRole: 'party_b';
  tokenHash: string;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}
export interface ShareLink {
  id: string;
  conflictId: string;
  tokenHash: string;
  expiresAt: string | null;
  revokedAt: string | null;
  createdByUserId: string;
  createdAt: string;
}
export type NotificationType =
  | 'invitation_received'
  | 'opponent_joined'
  | 'conflict_started'
  | 'your_turn'
  | 'conflict_paused'
  | 'judging_started'
  | 'verdict_ready'
  | 'conflict_cancelled'
  | 'conflict_expired';
export interface Notification {
  id: string;
  userId: string;
  conflictId: string | null;
  type: NotificationType;
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
}

export interface DebateVerdict {
  protocolType: 'debate';
  winner: PartyRole | 'tie' | 'insufficient_information';
  confidence: number;
  scores: { partyA: VerdictScores; partyB: VerdictScores };
  summary: string;
  decidingPoints: string[];
  partyAStrengths: string[];
  partyBStrengths: string[];
  partyAWeaknesses: string[];
  partyBWeaknesses: string[];
  unresolvedQuestions: string[];
  citedEventIds: string[];
}
export interface VerdictScores {
  logic: number;
  evidence: number;
  rebuttal: number;
  responsiveness: number;
  overall: number;
}
export interface PersuasionVerdict {
  protocolType: 'persuasion';
  outcome:
    | 'persuaded'
    | 'partially_persuaded'
    | 'not_persuaded'
    | 'target_conceded'
    | 'insufficient_information';
  confidence: number;
  persuasionScore: number;
  summary: string;
  strongestArguments: string[];
  unresolvedConcerns: string[];
  concessions: string[];
  citedEventIds: string[];
}
export type JudgeVerdict = DebateVerdict | PersuasionVerdict;
export interface VerdictRecord {
  id: string;
  conflictId: string;
  verdict: JudgeVerdict;
  provider: string;
  createdAt: string;
}

export const agentActionSchema = z
  .object({
    action_type: z.enum(agentActionTypes),
    content: z.string().trim().max(12_000).default(''),
    client_request_id: z.string().min(8).max(128),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.action_type !== 'concede' && value.content.length === 0)
      ctx.addIssue({
        code: 'custom',
        message: 'Content is required for this action.',
        path: ['content'],
      });
  });
export type AgentAction = z.infer<typeof agentActionSchema>;

export const createConflictSchema = z
  .object({
    title: z.string().trim().min(3).max(160),
    description: z.string().trim().min(3).max(8_000),
    protocol_type: z.enum(protocolTypes),
    persuader_party: z.enum(partyRoles).nullable().optional(),
    deadline_at: z.iso.datetime().nullable().optional(),
    turn_timeout_seconds: z.number().int().min(60).max(604800).nullable().optional(),
    max_rounds: z.literal(3).default(3),
  })
  .superRefine((value, ctx) => {
    if (value.protocol_type === 'persuasion' && !value.persuader_party)
      ctx.addIssue({
        code: 'custom',
        message: 'Persuader party is required.',
        path: ['persuader_party'],
      });
  });

export const privateBriefSchema = z.object({
  goal: z.string().max(2_000).default(''),
  priorities: z.array(z.string().max(500)).max(20).default([]),
  acceptableCompromises: z.array(z.string().max(500)).max(20).default([]),
  privateNotes: z.string().max(8_000).default(''),
});
