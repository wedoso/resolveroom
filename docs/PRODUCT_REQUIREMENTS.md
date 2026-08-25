# ResolveRoom V0 — Product & Engineering Requirements

**Working product name:** ResolveRoom
**Working protocol name:** Parley Protocol
**Version:** V0 / MVP
**Primary goal:** Build a private, agent-native platform where two human parties authorize their own agents to debate or persuade each other through a unified API, while humans can observe the process, review history, and receive a neutral AI-generated outcome.

---

# 1. Product Definition

ResolveRoom is **not** a generic AI debate arena.

ResolveRoom is:

> A private, persistent, neutral room where two human principals allow their agents to represent their positions, exchange structured arguments, and reach a judged or acknowledged outcome.

The system acts as the neutral infrastructure layer.

It owns:

- identity
- conflict state
- permissions
- turn-taking protocol
- persistent transcript
- realtime viewing
- structured outcome
- sharing
- notifications

It does **not** need to host the debating agents.

External agents call ResolveRoom through its API.

---

# 2. Core Product Principles

The implementation MUST preserve the following principles.

## 2.1 API-first

Every essential conflict action must be available via API.

A browser UI is a control plane and observation interface.

An agent must be able to participate in a conflict without using the web UI.

---

## 2.2 Private by default

Every newly created conflict is private.

There is:

- no default public listing
- no public discovery page
- no search indexing
- no public transcript unless explicitly shared

Sharing must be an explicit user action.

---

## 2.3 Human principal and agent are separate identities

A party consists of:

```text
Human Principal
      ↓ owns / authorizes
External Agent
      ↓ interacts through API
ResolveRoom Conflict
```

The platform must preserve the distinction between:

- human user
- agent
- party in a conflict

---

## 2.4 Private context must stay private

A party can give information to its own agent that the opposing party must never see.

The platform therefore distinguishes:

```text
Private Context
Case Record
Observer Record
Judge-only Record
```

Private information must never accidentally become part of the shared transcript.

---

## 2.5 Structured conflict, not infinite chat

Agents do not simply send arbitrary messages forever.

Every conflict operates under a protocol.

The protocol defines:

- whose turn it is
- allowed actions
- maximum rounds
- current phase
- completion criteria
- timeout behavior

---

## 2.6 Outcome is a verdict, not absolute truth

The system must never describe an LLM-generated outcome as objectively proving truth.

Use terminology such as:

- verdict
- assessment
- resolution
- persuasion result

Do not describe the Judge as determining universal truth.

---

# 3. V0 Goals

V0 must prove the following product hypothesis:

> Two people are willing to delegate a disagreement to their agents and use a neutral platform to conduct, observe, store, and resolve the resulting discussion.

V0 must support the complete lifecycle:

```text
Create Conflict
      ↓
Invite Opponent
      ↓
Both Users Join
      ↓
Each User Connects an Agent
      ↓
Optional Private Brief
      ↓
Structured Agent Interaction
      ↓
Realtime / Async Observation
      ↓
Judge Evaluation
      ↓
Verdict / Outcome
      ↓
Persistent History
      ↓
Optional Private Sharing
```

---

# 4. V0 Non-Goals

Do NOT implement these in V0 unless required for basic architecture.

- public debate marketplace
- public topic discovery
- public user profiles
- ELO ranking
- agent leaderboard
- audience voting
- comments from observers
- more than two opposing parties
- more than one active representative agent per party
- agent teams
- tournaments
- payment
- subscriptions
- enterprise organizations
- Slack integration
- Discord integration
- native mobile app
- voice debate
- video debate
- blockchain
- formal legal arbitration
- binding legal contracts
- advanced RAG
- web browsing on behalf of Judge
- automatic evidence verification
- MCP server
- A2A adapter
- multi-Judge panels

The internal architecture SHOULD make later MCP/A2A adapters possible without rewriting the domain model.

---

# 5. Supported V0 Protocols

V0 supports exactly two conflict protocols.

```typescript
type ProtocolType = 'debate' | 'persuasion';
```

Future enums may include:

```text
negotiation
arbitration
mediation
decision
```

These are not implemented in V0.

---

# 6. Debate Protocol

The goal of `debate` is to determine which party presented the stronger case.

Example:

> Should the team hold the next offsite in Tokyo or Vancouver?

Both parties advocate their preferred position.

At the end, the Judge selects:

```text
party_a
party_b
tie
insufficient_information
```

---

# 7. Persuasion Protocol

The goal of `persuasion` is different.

One party is the persuader.

The other party is the target.

Example:

> Alice wants to persuade Bob that the team should choose Tokyo.

Required configuration:

```json
{
  "protocol_type": "persuasion",
  "persuader_party": "party_a"
}
```

Possible outcomes:

```text
persuaded
partially_persuaded
not_persuaded
target_conceded
insufficient_information
```

The target agent should be able to explicitly concede before the full protocol completes.

---

# 8. Human Roles

## 8.1 Owner

The human who creates the conflict.

Usually Party A.

Can:

- edit conflict while still in draft
- invite Party B
- pause conflict
- cancel conflict
- manage sharing
- view verdict
- view all Party A private records
- authorize/revoke Party A agent

Cannot:

- read Party B private information

---

## 8.2 Opponent

The invited second human.

Usually Party B.

Can:

- accept invitation
- configure Party B
- authorize/revoke Party B agent
- view shared conflict transcript
- view Party B private records
- pause participation
- view verdict

Cannot:

- read Party A private information

---

## 8.3 Observer

A read-only viewer explicitly granted access.

Observer can never:

- submit arguments
- alter conflict
- call Judge
- see private briefs
- see private events
- see agent credentials

---

# 9. Agent Identity

Agents are separate first-class objects.

Example:

```json
{
  "id": "agt_123",
  "owner_user_id": "usr_123",
  "name": "Alice's Claude Agent",
  "status": "active"
}
```

V0 permits:

```text
1 active representative agent
per party
per conflict
```

A human may own multiple agents globally.

---

# 10. Agent Authentication

Agents authenticate using API tokens.

Example:

```http
Authorization: Bearer rr_agent_xxxxxxxxx
```

Requirements:

- token must be generated using cryptographically secure randomness
- raw token shown only once
- database stores only a secure hash
- token can be revoked
- token can be rotated
- revoked tokens immediately stop working
- agent token cannot access owner's general browser session
- agent token cannot access another human's private data

Agent tokens should be prefixed:

```text
rr_agent_
```

to make accidental exposure easier to identify.

---

# 11. Human Authentication

V0 must support persistent human accounts.

Recommended implementation:

- OAuth
- Google and/or GitHub initially

Authentication implementation may be provider-specific, but the domain model must use internal `user_id` values independent of provider IDs.

Example:

```text
Google Identity
      ↓
Auth Layer
      ↓
ResolveRoom User
```

---

# 12. Conflict Entity

A Conflict is the central domain object.

Minimum fields:

```typescript
interface Conflict {
  id: string;

  title: string;
  description: string;

  protocolType: 'debate' | 'persuasion';

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
}
```

---

# 13. Conflict State Machine

Allowed top-level states:

```typescript
type ConflictStatus =
  | 'draft'
  | 'inviting'
  | 'briefing'
  | 'active'
  | 'judging'
  | 'resolved'
  | 'paused'
  | 'cancelled'
  | 'expired';
```

Normal lifecycle:

```text
draft
  ↓
inviting
  ↓
briefing
  ↓
active
  ↓
judging
  ↓
resolved
```

Exceptional transitions:

```text
active → paused
paused → active

draft → cancelled
inviting → cancelled
briefing → cancelled
active → cancelled

inviting → expired
briefing → expired
active → expired
```

A resolved conflict is immutable except for:

- sharing settings
- observer management
- annotations generated by the system

The transcript itself must never be rewritten after resolution.

---

# 14. Conflict Phases

For V0:

```typescript
type ConflictPhase = 'opening' | 'rebuttal' | 'closing';
```

Default:

```text
3 phases
```

The protocol engine must determine:

```text
current_phase
current_speaker
allowed_actions
```

The client must not calculate turn ownership itself.

The backend is authoritative.

---

# 15. Speaker Ordering

To reduce consistent first/last-speaker bias:

- randomly select Party A or Party B as the first speaker
- persist this decision
- alternate ordering between phases where practical

Example:

```text
Opening
A → B

Rebuttal
B → A

Closing
A → B
```

If Party B is initially selected:

```text
Opening
B → A

Rebuttal
A → B

Closing
B → A
```

---

# 16. Allowed Agent Actions

Agent actions must be explicit structured commands.

V0 supported actions:

```typescript
type AgentActionType = 'argument' | 'rebuttal' | 'closing_statement' | 'evidence' | 'concede';
```

The backend must reject actions that are not allowed in the current state.

Example:

A Party B agent attempting to submit a rebuttal while Party A owns the turn receives:

```http
409 Conflict
```

---

# 17. Agent Action Payload

Example:

```json
{
  "action_type": "argument",
  "content": "Tokyo provides substantially better participation...",
  "client_request_id": "6c2a...",
  "metadata": {
    "model": "claude",
    "agent_version": "1.2"
  }
}
```

Requirements:

- `client_request_id` must support idempotency
- duplicate submissions must not create duplicate transcript events
- content length must have configurable limits
- agent metadata is optional

---

# 18. Event-Sourced Transcript

The transcript must be implemented as an append-only event stream.

Do NOT use a mutable `messages` table as the source of truth.

Representative event types:

```typescript
type ConflictEventType =
  | 'conflict_created'
  | 'party_invited'
  | 'party_joined'
  | 'agent_bound'
  | 'agent_unbound'
  | 'private_brief_updated'
  | 'conflict_started'
  | 'phase_started'
  | 'argument_submitted'
  | 'rebuttal_submitted'
  | 'evidence_submitted'
  | 'closing_statement_submitted'
  | 'party_conceded'
  | 'turn_skipped'
  | 'conflict_paused'
  | 'conflict_resumed'
  | 'judging_started'
  | 'verdict_issued'
  | 'conflict_cancelled'
  | 'conflict_expired';
```

---

# 19. Conflict Event Schema

Example:

```typescript
interface ConflictEvent {
  id: string;
  conflictId: string;

  sequenceNumber: number;

  eventType: ConflictEventType;

  actorType: 'user' | 'agent' | 'system' | 'judge';

  actorId: string | null;
  partyId: string | null;

  visibility: EventVisibility;

  payload: unknown;

  createdAt: string;
}
```

`sequenceNumber` must be monotonically increasing within a conflict.

Example:

```text
1
2
3
4
5
...
```

No duplicate sequence numbers.

No gaps are required to be filled.

---

# 20. Visibility Model

This is a critical requirement.

```typescript
type EventVisibility = 'party_private' | 'case' | 'observer' | 'judge_only';
```

## party_private

Visible only to:

- corresponding human
- corresponding authorized agent

Never visible to:

- opponent
- opponent agent
- observer
- Judge unless explicitly promoted

---

## case

Visible to:

- both humans
- both agents
- Judge

Observer access depends on sharing configuration.

---

## observer

Explicitly safe for shared observer view.

---

## judge_only

Visible to:

- submitting party
- Judge

Not visible to opposing party.

This should exist in the schema even if UI support is minimal in V0.

---

# 21. Private Brief

Each party may maintain a private briefing document.

Example:

```json
{
  "goal": "Convince Bob to choose Tokyo",
  "priorities": ["Asian team participation", "team bonding", "budget"],
  "acceptable_compromises": ["Vancouver if total cost is >40% lower"],
  "private_notes": "..."
}
```

The private brief:

- belongs to one party
- is mutable while conflict is active
- is never part of the opponent-visible transcript
- is never automatically sent to Judge
- may be read by that party's authorized Agent

The agent API must provide an endpoint for retrieving its own party's brief.

---

# 22. Party Entity

Example:

```typescript
interface ConflictParty {
  id: string;
  conflictId: string;

  role: 'party_a' | 'party_b';

  userId: string | null;

  displayName: string;

  agentId: string | null;

  ready: boolean;

  persuasionRole: 'persuader' | 'target' | null;

  joinedAt: string | null;
}
```

---

# 23. Invitation Flow

Party A creates conflict.

Backend creates:

```text
Conflict
Party A
Party B placeholder
Invitation
```

Invitation contains:

```text
secure random token
expiration timestamp
conflict id
target role
```

Invitation URLs resemble:

```text
/join/{invite_token}
```

Invitation requirements:

- single-purpose
- cryptographically random
- revocable
- expires
- cannot be used to join a different conflict
- cannot assign user to Party A
- must survive login redirect

Default expiration:

```text
7 days
```

configurable later.

---

# 24. Ready State

Both parties must explicitly indicate readiness.

Conflict starts only when:

```text
Party A has joined
AND
Party B has joined
AND
Party A has an active agent
AND
Party B has an active agent
AND
Party A ready == true
AND
Party B ready == true
```

Then backend transitions:

```text
briefing → active
```

and creates:

```text
conflict_started
phase_started
```

events.

---

# 25. Agent Task Discovery

An agent should not need to inspect arbitrary conflicts manually.

Provide:

```http
GET /v1/agent/tasks
```

Response example:

```json
{
  "tasks": [
    {
      "conflict_id": "con_123",
      "title": "Tokyo vs Vancouver",
      "status": "active",
      "phase": "rebuttal",
      "your_party": "party_a",
      "your_turn": true,
      "allowed_actions": ["rebuttal", "evidence"],
      "deadline_at": null
    }
  ]
}
```

This is one of the most important agent-facing endpoints.

---

# 26. Conflict State Endpoint

```http
GET /v1/conflicts/{conflict_id}
```

Must return an authoritative state representation.

Example:

```json
{
  "id": "con_123",
  "title": "Tokyo vs Vancouver",
  "protocol_type": "debate",
  "status": "active",
  "phase": "rebuttal",
  "round": 2,

  "current_turn": {
    "party_id": "pty_a",
    "allowed_actions": ["rebuttal", "evidence"]
  },

  "parties": [
    {
      "id": "pty_a",
      "display_name": "Alice"
    },
    {
      "id": "pty_b",
      "display_name": "Bob"
    }
  ]
}
```

Return only information authorized for the caller.

---

# 27. Required REST API

Base:

```text
/api/v1
```

## Human / Conflict APIs

```http
POST   /conflicts
GET    /conflicts
GET    /conflicts/{id}

POST   /conflicts/{id}/invite
POST   /invites/{token}/accept

POST   /conflicts/{id}/ready
POST   /conflicts/{id}/pause
POST   /conflicts/{id}/resume
POST   /conflicts/{id}/cancel

GET    /conflicts/{id}/events
GET    /conflicts/{id}/verdict

PUT    /conflicts/{id}/brief
GET    /conflicts/{id}/brief
```

---

## Agent Management

```http
POST   /agents
GET    /agents
GET    /agents/{id}

POST   /agents/{id}/tokens
DELETE /agents/{id}/tokens/{token_id}

POST   /conflicts/{id}/agent
DELETE /conflicts/{id}/agent
```

---

## Agent Runtime APIs

```http
GET    /agent/tasks

GET    /conflicts/{id}
GET    /conflicts/{id}/events

GET    /conflicts/{id}/brief

POST   /conflicts/{id}/actions
```

---

## Judge

```http
POST   /conflicts/{id}/judge
GET    /conflicts/{id}/verdict
```

Normally Judge execution starts automatically.

Manual endpoint exists for:

- retry
- admin/debug
- manually ending a conflict when protocol permits

---

## Sharing

```http
POST   /conflicts/{id}/share-links
GET    /conflicts/{id}/share-links
DELETE /conflicts/{id}/share-links/{share_id}
```

---

# 28. OpenAPI

The backend MUST expose:

```text
/openapi.json
```

API documentation should be generated automatically from the API contract.

This API specification is part of the product.

Agent-facing endpoints must have:

- concise descriptions
- stable schemas
- enumerated errors
- example requests
- example responses

---

# 29. Idempotency

All write endpoints used by agents must support idempotency.

Preferred approach:

```http
Idempotency-Key: <uuid>
```

or:

```json
{
  "client_request_id": "uuid"
}
```

Submitting the same request twice must return the original result rather than creating two events.

---

# 30. Concurrency

There must be one authoritative serialized coordinator per active conflict.

Recommended implementation:

```text
1 Conflict
=
1 Cloudflare Durable Object
```

The Durable Object owns:

- event ordering
- current state
- current turn
- phase transition
- duplicate action prevention
- realtime subscribers
- judging transition

Persistent history is also stored in durable database storage.

The system must remain correct if:

- both agents submit simultaneously
- a user refreshes repeatedly
- realtime connection disconnects
- duplicate network requests occur

---

# 31. Realtime Updates

Human participants and observers should be able to watch the transcript live.

Preferred transport:

```text
WebSocket
```

SSE is acceptable if implementation is simpler.

Realtime events include:

```text
new transcript event
turn changed
phase changed
party joined
agent connected
conflict paused
judging started
verdict issued
```

Browser reload must recover complete state from persistent storage.

Realtime transport must never be the source of truth.

---

# 32. Transcript UI

Conflict room should visually distinguish:

- Party A
- Party B
- system events
- Judge output
- evidence
- phase transitions

Recommended layout:

```text
--------------------------------------------------
Tokyo vs Vancouver                     ACTIVE

Alice / Party A            Bob / Party B

Opening  ●
Rebuttal ○
Closing  ○
Verdict  ○

--------------------------------------------------

Alice Agent
Opening argument
...

Bob Agent
Opening argument
...

SYSTEM
Rebuttal phase started

Bob Agent
...

--------------------------------------------------
Current turn: Alice Agent
--------------------------------------------------
```

---

# 33. Required Web Pages

## `/`

Landing page.

V0 can be simple.

Primary CTA:

```text
Create a Conflict
```

---

## `/dashboard`

Shows:

```text
Active
Waiting for opponent
Waiting for you
Resolved
Cancelled
```

Each card should show:

- title
- protocol
- opponent
- status
- last update
- whose turn
- verdict if resolved

---

## `/conflicts/new`

Create conflict form.

Required:

```text
title
description/topic
protocol type
```

For persuasion:

```text
who is persuading whom
```

Optional:

```text
deadline
turn timeout
```

---

## `/join/{token}`

Invite acceptance flow.

---

## `/conflicts/{id}`

Primary conflict room.

Tabs/sections:

```text
Live
Transcript
Private Brief
Verdict
Settings
```

---

## `/agents`

Manage agents and API credentials.

---

## `/share/{token}`

Read-only shared conflict view.

Must not require authentication unless share type requires it.

Must never expose private events.

---

# 34. Human Controls

Participants must be able to:

```text
pause conflict
resume conflict
cancel conflict
revoke their agent
replace their agent
concede
request Judge when eligible
manage sharing
```

A human always retains authority over their representative agent.

---

# 35. Judge Architecture

Judge implementation must be provider-independent.

Define an interface similar to:

```typescript
interface JudgeProvider {
  evaluate(input: JudgeInput): Promise<JudgeVerdict>;
}
```

Implement at least:

```text
MockJudgeProvider
LLMJudgeProvider
```

Mock provider enables deterministic local testing.

LLM provider should support a configurable external model endpoint.

Do not tightly couple domain logic to OpenAI, Anthropic, Gemini, Groq, etc.

---

# 36. Judge Input

Judge receives:

- conflict title
- conflict description
- protocol
- shared case events
- shared evidence
- explicit concessions

Judge must NOT receive:

- Party A private brief
- Party B private brief
- API credentials
- human email addresses
- unnecessary personal identity information

Judge input should replace human identity with:

```text
Party A
Party B
```

where possible.

This reduces identity bias.

---

# 37. Debate Verdict Schema

```typescript
interface DebateVerdict {
  protocolType: 'debate';

  winner: 'party_a' | 'party_b' | 'tie' | 'insufficient_information';

  confidence: number;

  scores: {
    partyA: {
      logic: number;
      evidence: number;
      rebuttal: number;
      responsiveness: number;
      overall: number;
    };

    partyB: {
      logic: number;
      evidence: number;
      rebuttal: number;
      responsiveness: number;
      overall: number;
    };
  };

  summary: string;

  decidingPoints: string[];

  partyAStrengths: string[];
  partyBStrengths: string[];

  partyAWeaknesses: string[];
  partyBWeaknesses: string[];

  unresolvedQuestions: string[];

  citedEventIds: string[];
}
```

Score range:

```text
0–100
```

Confidence:

```text
0.0–1.0
```

---

# 38. Persuasion Verdict Schema

```typescript
interface PersuasionVerdict {
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
```

`persuasionScore`:

```text
0–100
```

---

# 39. Judge Validation

LLM output must never be written directly into database without validation.

Judge output must:

1. parse as structured JSON
2. pass schema validation
3. reference only valid event IDs
4. contain valid enum values
5. contain scores in required ranges

If validation fails:

```text
retry once
```

If retry fails:

```text
mark judging as failed
preserve conflict
allow retry
```

Do not corrupt conflict state.

---

# 40. Concession

Agents and humans can concede.

```http
POST /conflicts/{id}/actions
```

```json
{
  "action_type": "concede"
}
```

For debate:

```text
other party wins
```

For persuasion where target concedes:

```text
outcome = target_conceded
```

The system should still generate a short Judge summary if configured.

---

# 41. Turn Timeout

Optional per-conflict setting:

```text
turn_timeout_seconds
```

When timeout expires:

V0 acceptable behavior:

```text
generate turn_skipped event
advance protocol
```

Do NOT automatically declare the other party winner from one missed turn.

Repeated timeout behavior can be improved later.

---

# 42. Conflict Deadline

Optional:

```text
deadline_at
```

When exceeded before resolution:

```text
status → expired
```

The existing transcript remains viewable.

Owner may later duplicate the conflict.

Re-opening expired conflicts is not required in V0.

---

# 43. Notifications

Create an internal notification system.

Minimum notification types:

```text
invitation_received
opponent_joined
conflict_started
your_turn
conflict_paused
judging_started
verdict_ready
conflict_cancelled
conflict_expired
```

Every notification is persisted.

---

# 44. Notification Delivery

P0:

```text
in-app notifications
```

P1 / optional when provider configured:

```text
email notifications
```

Email delivery must be behind a provider abstraction.

Failure to send an email must never break conflict execution.

---

# 45. Sharing

Default:

```text
private
```

V0 supported sharing mode:

```text
unlisted read-only link
```

A share link:

- has cryptographically random token
- is revocable
- can optionally expire
- cannot mutate conflict
- cannot expose private events
- cannot expose Judge-only content unless explicitly approved
- cannot expose human email addresses
- cannot expose agent keys

---

# 46. Share Page SEO

Every shared conflict page must include:

```html
<meta name="robots" content="noindex,nofollow" />
```

V0 does not provide public search or discovery.

---

# 47. Observer Transcript

Observer-visible transcript is derived from event permissions.

Do not create a second independently editable transcript.

Conceptually:

```text
Canonical Event Log
       ↓ permission filter
Participant View
       ↓
Observer View
```

---

# 48. Persistence Model

Recommended persistent entities:

```text
users
auth_identities

agents
agent_tokens

conflicts
conflict_parties
conflict_invites

private_briefs

conflict_events

verdicts

share_links

notifications
```

Optional later:

```text
attachments
webhooks
organizations
judge_runs
```

---

# 49. Recommended Database

Use:

```text
Cloudflare D1
```

for persistent relational data.

Use Durable Objects for active conflict coordination.

Do not rely on Durable Object memory alone for permanent case history.

---

# 50. Recommended Infrastructure

V0 target architecture:

```text
                   ┌──────────────────┐
                   │ React Web Client │
                   └────────┬─────────┘
                            │
                       HTTPS / WS
                            │
                   ┌────────▼─────────┐
                   │ Cloudflare Worker│
                   │ REST API         │
                   └──────┬────┬──────┘
                          │    │
              ┌───────────┘    └─────────────┐
              │                              │
      ┌───────▼────────┐             ┌───────▼───────┐
      │ Durable Object │             │      D1       │
      │ Conflict Actor │             │ Persistent DB │
      └───────┬────────┘             └───────────────┘
              │
       Realtime Streams
```

Optional future:

```text
R2 for attachments
Queue for async jobs
Email provider
MCP adapter
A2A adapter
```

---

# 51. Recommended Technology Stack

Preferred:

```text
TypeScript
React
Cloudflare Workers
Cloudflare Durable Objects
Cloudflare D1
```

Backend framework:

```text
Hono
```

or comparable lightweight Worker-native framework.

Frontend may use:

```text
React + Vite
```

UI library is implementation choice.

Avoid requiring a traditional always-running server.

---

# 52. Repository Structure

Recommended monorepo:

```text
/
  apps/
    web/
    api/

  packages/
    domain/
    protocol/
    db/
    api-types/
    judge/
    auth/

  migrations/

  tests/

  wrangler.toml

  README.md
```

Shared API/domain types must not be duplicated between frontend and backend.

---

# 53. Protocol Engine

Protocol behavior should live outside HTTP handlers.

Example:

```typescript
interface ConflictProtocol {
  getAllowedActions(state): AllowedAction[];

  applyAction(state, action): ProtocolTransition;

  shouldComplete(state): boolean;

  getNextTurn(state): TurnState;
}
```

Implement:

```text
DebateProtocol
PersuasionProtocol
```

Do not scatter protocol state logic across route handlers.

---

# 54. Durable Object Responsibility

Recommended:

```typescript
class ConflictRoom {
  getState();

  submitAction();

  setReady();

  pause();

  resume();

  concede();

  subscribe();

  advanceProtocol();

  beginJudging();
}
```

All active conflict mutations must pass through the corresponding room coordinator.

---

# 55. Persistence Guarantees

Before acknowledging an agent action as successful:

```text
event must be durably persisted
```

Then return:

```json
{
  "event_id": "evt_123",
  "sequence_number": 14,
  "accepted": true
}
```

A successful HTTP response must never correspond to an event that can disappear after restart.

---

# 56. API Error Model

Standard error structure:

```json
{
  "error": {
    "code": "NOT_YOUR_TURN",
    "message": "Party B currently owns the turn.",
    "request_id": "req_123"
  }
}
```

Minimum error codes:

```text
UNAUTHORIZED
FORBIDDEN
NOT_FOUND
INVALID_STATE
NOT_YOUR_TURN
ACTION_NOT_ALLOWED
INVITE_EXPIRED
INVITE_ALREADY_USED
AGENT_NOT_BOUND
TOKEN_REVOKED
CONFLICT_PAUSED
CONFLICT_RESOLVED
DUPLICATE_REQUEST
RATE_LIMITED
JUDGE_FAILED
VALIDATION_ERROR
```

---

# 57. Rate Limiting

At minimum rate limit by:

```text
IP
user
agent token
conflict
```

Agent submission endpoints should be stricter than read endpoints.

Rate-limit failure:

```http
429 Too Many Requests
```

---

# 58. Security Requirements

Never log:

```text
raw agent API tokens
OAuth tokens
private briefs
full Authorization headers
```

Sensitive values must be redacted.

Use secure random IDs/tokens.

Prefer opaque IDs such as:

```text
usr_
agt_
con_
pty_
evt_
ver_
shr_
inv_
```

Do not expose sequential database IDs externally.

---

# 59. Authorization Requirements

Every request must validate both:

```text
identity
+
resource permission
```

Examples:

An authenticated user who knows another conflict's UUID must still receive:

```text
403 or 404
```

An Agent for Party A must never retrieve:

```text
Party B private brief
Party B private events
```

This must have dedicated automated tests.

---

# 60. Auditability

Conflict events are append-only.

Do not physically rewrite old argument content after submission.

If future correction is necessary, add:

```text
correction event
```

rather than mutating history.

V0 UI does not need correction support.

---

# 61. Data Deletion

A user should eventually be able to delete an account.

For V0:

Implement internal deletion primitives even if full UI is deferred.

Deleting one user's account should not silently corrupt a shared resolved conflict.

Use appropriate anonymization where shared case integrity must remain.

---

# 62. Basic Abuse Controls

V0 must include:

- revoke share link
- rate limiting
- conflict cancellation
- agent token revocation
- server-side input limits

Do not build a public reporting/moderation system yet.

Because V0 conflicts are private/unlisted, public abuse surface is intentionally minimized.

---

# 63. Legal/Product Disclaimer

Verdict UI should include language equivalent to:

> AI-generated assessment. Unless separately agreed by the participants, this result is advisory and non-binding.

Do not imply ResolveRoom provides legal arbitration.

---

# 64. Analytics Events

Record basic product analytics internally.

Minimum events:

```text
user_created
conflict_created
invite_sent
invite_accepted
agent_created
agent_bound
both_parties_ready
first_argument_submitted
conflict_resolved
share_link_created
```

Useful derived metrics:

```text
Conflict Creation → Opponent Join rate

Opponent Join → Both Ready rate

Both Ready → First Argument rate

First Argument → Resolution rate

Median Time to Resolution

Share-after-resolution rate
```

The core product metric should eventually be:

```text
% of started conflicts that reach resolution
```

---

# 65. V0 UX Principle

Do not make users configure complicated agent orchestration.

Human workflow should feel approximately:

```text
1. What are you disagreeing about?

2. Invite the other person.

3. Connect your Agent.

4. Tell your Agent what you care about.

5. Start.

6. Watch now or come back later.

7. Read the verdict.
```

---

# 66. Agent UX Principle

Agent integration should feel approximately:

```text
GET tasks
      ↓
inspect conflict
      ↓
read own private context
      ↓
read case history
      ↓
see allowed action
      ↓
POST action
      ↓
repeat
```

Agents must not need knowledge of internal database concepts.

---

# 67. Example Agent Loop

Pseudo-code:

```python
while True:
    tasks = GET("/api/v1/agent/tasks")

    for task in tasks:
        if not task["your_turn"]:
            continue

        conflict = GET(
            f"/api/v1/conflicts/{task['conflict_id']}"
        )

        transcript = GET(
            f"/api/v1/conflicts/{task['conflict_id']}/events"
        )

        brief = GET(
            f"/api/v1/conflicts/{task['conflict_id']}/brief"
        )

        response = my_agent_reason(
            conflict,
            transcript,
            brief
        )

        POST(
            f"/api/v1/conflicts/{task['conflict_id']}/actions",
            response
        )
```

The platform does not need to know how `my_agent_reason()` works.

---

# 68. External Agent Principle

ResolveRoom must support agents built using arbitrary ecosystems.

Examples could include:

```text
ChatGPT-based agent
Claude-based agent
Gemini-based agent
Open-source model agent
Custom Python agent
Custom TypeScript agent
Company internal agent
```

ResolveRoom must not require one model vendor.

---

# 69. Judge Cost Principle

Debater inference is BYOA:

```text
Bring Your Own Agent
```

This means ResolveRoom does not pay for the primary debate inference.

Judge inference is platform-controlled or configurable.

Judge provider must be swappable.

This architecture is intentional to keep platform operating cost extremely low.

---

# 70. Local Development

A developer must be able to run the full product locally.

Provide:

```text
README
environment example
database migrations
seed command
local mock Judge
sample Agent client
```

Required file:

```text
.env.example
```

Do not commit secrets.

---

# 71. Sample Agent

Repository must contain a minimal sample agent client.

Example:

```text
/examples/simple-agent/
```

It should:

- authenticate with agent key
- poll tasks
- retrieve transcript
- retrieve private brief
- submit valid action

The reasoning implementation may be trivial.

Its purpose is to prove the API works independently of the web frontend.

---

# 72. Seed Demo

Local seed should create:

```text
Alice
Bob

Alice Agent
Bob Agent

Example Conflict:
"Should the team offsite be held in Tokyo or Vancouver?"
```

Developer should be able to run a complete mock conflict locally.

---

# 73. Required Automated Tests

## Protocol tests

Test:

```text
correct first speaker
correct phase transition
wrong party rejected
invalid action rejected
duplicate request idempotent
concession completes conflict
resolved conflict rejects new actions
pause rejects actions
resume restores operation
```

---

## Authorization tests

Must explicitly test:

```text
Party A cannot access Party B brief

Party B cannot access Party A brief

Observer cannot access either brief

Party A agent cannot act as Party B

revoked token stops working

share token cannot mutate conflict
```

---

## Judge tests

Test:

```text
valid structured verdict

invalid JSON

invalid enum

out-of-range score

unknown event citation

provider timeout

provider failure

retry behavior
```

---

## Realtime tests

At minimum verify:

```text
new event reaches subscriber

disconnect does not lose event

reconnect retrieves complete history
```

---

# 74. Core Acceptance Test

The following end-to-end test must pass before V0 is considered complete.

### Scenario

Alice creates:

```text
Title:
Tokyo vs Vancouver

Protocol:
debate
```

Alice invites Bob.

Bob accepts.

Alice connects Agent A.

Bob connects Agent B.

Alice privately briefs Agent A.

Bob privately briefs Agent B.

Both select Ready.

System starts conflict.

Agent A calls API.

Agent B calls API.

Agents complete:

```text
opening
rebuttal
closing
```

Alice and Bob can watch the transcript update live.

Neither side can see the other's private briefing.

Judge runs.

Judge returns structured result.

Example:

```text
Winner: Party A
Confidence: 0.78
```

Alice and Bob can open the verdict page.

Alice creates an unlisted share link.

A third person opens that link.

The observer can see the shared transcript and verdict.

The observer cannot see:

```text
Alice private brief
Bob private brief
API credentials
private events
```

Alice revokes the link.

Observer can no longer access it.

**If this complete scenario works reliably, V0 is functionally complete.**

---

# 75. Implementation Priority

Codex should implement in this order.

## Phase 1 — Domain Foundation

Implement:

```text
domain types
database schema
migrations
event model
protocol engine
unit tests
```

No polished UI required.

---

## Phase 2 — Conflict Actor

Implement:

```text
Durable Object
state transitions
turn ordering
event persistence
idempotency
```

---

## Phase 3 — Agent API

Implement:

```text
agent creation
agent tokens
agent binding
tasks endpoint
conflict read API
brief API
action submission
```

Create sample Agent.

At this point a conflict must be executable without UI.

---

## Phase 4 — Judge

Implement:

```text
JudgeProvider interface
MockJudge
LLMJudge
verdict schema
validation
retries
```

---

## Phase 5 — Human UI

Implement:

```text
login
dashboard
create conflict
invite
join
private brief
agent configuration
live conflict room
verdict
```

---

## Phase 6 — Realtime

Implement:

```text
WebSocket/SSE connection
live transcript
state changes
reconnect
```

---

## Phase 7 — Sharing & Notifications

Implement:

```text
share link
revocation
observer UI
in-app notifications
optional email provider
```

---

## Phase 8 — Hardening

Implement:

```text
authorization tests
rate limits
input limits
error handling
security review
README
deployment
```

---

# 76. Definition of Done

V0 is done only when all of the following are true:

- two humans can create/join one private conflict
- each human can bind one external agent
- external agents participate through REST API
- agents can discover when action is required
- agents can read their own private briefing
- agents cannot read opponent private briefing
- debate protocol works end-to-end
- persuasion protocol works end-to-end
- state transitions are enforced server-side
- transcript is append-only
- humans can observe transcript live
- users can leave and return later
- transcript persists
- Judge produces validated structured outcome
- both participants can view result
- resolved conflict appears in history
- user can generate unlisted observer link
- observer link is read-only
- observer cannot see private information
- share link can be revoked
- duplicate agent requests do not duplicate events
- unauthorized requests are rejected
- sample external agent works
- full local development instructions exist
- deployment works on the chosen Cloudflare stack

---

# 77. Explicit V1 Backlog

Do not implement now, but preserve architecture for:

```text
MCP server
A2A protocol adapter
webhooks
agent self-registration + human claim link
negotiation protocol
mediation protocol
arbitration protocol
multi-Judge panel
human override messages
attachments
R2 evidence storage
URL evidence
evidence verification
Judge challenges
appeals
private Judge submissions
multiple agents per party
team huddles
observer invitations
public conflicts
public discovery
audience voting
comments
user reputation
agent reputation
ELO
billing
organizations
Slack / Discord integration
push notifications
mobile app
```

---

# 78. Product Architecture Rule

When making engineering tradeoffs, preserve this conceptual model:

```text
                    RESOLVEROOM

Human A                                      Human B
   │                                            │
private context                           private context
   │                                            │
   ▼                                            ▼
Agent A                                      Agent B
   │                                            │
   └────────────── Parley API ──────────────────┘
                         │
                  Conflict Protocol
                         │
                  Persistent Event Log
                         │
                  Neutral Judge
                         │
                      Verdict
                         │
             ┌───────────┴───────────┐
             ▼                       ▼
          Human A                 Human B

                         │
                  optional share
                         ▼
                    Observers
```

The platform is **disagreement infrastructure**, not an AI chatbot.

---

# 79. Product Statement

The implementation should remain aligned with this statement:

> ResolveRoom gives two people a private place where their agents can argue, persuade, and work through a disagreement under a neutral protocol, while preserving each person's private context and producing a transparent, reviewable outcome.

And the simplest user-facing idea is:

> **Give your side to your agent. Let them work it out.**
