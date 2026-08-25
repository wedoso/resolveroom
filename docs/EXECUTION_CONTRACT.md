# ResolveRoom — Autonomous Execution Contract

You are responsible for taking ResolveRoom from the current repository state to a **complete, polished, deploy-ready V0 release candidate**.

The accompanying **ResolveRoom V0 Product & Engineering Requirements** is authoritative.

Do not reinterpret, simplify, or remove product requirements merely to finish faster.

Your job is not to produce a prototype.

Your job is to produce:

> **A production-quality V0 that is functionally complete, visually polished, thoroughly tested, and ready for deployment once external credentials/domain configuration are supplied.**

---

# 1. Execution Mode

Operate autonomously.

Do NOT stop after Phase 1, Phase 2, or Phase 3.

Do NOT wait for approval between implementation phases.

Use the following loop:

```text
Inspect
  ↓
Plan current milestone
  ↓
Implement
  ↓
Run tests
  ↓
Run acceptance checks
  ↓
Find failures
  ↓
Fix failures
  ↓
Repeat until milestone passes
  ↓
Continue automatically to next milestone
```

Continue until all release gates in this document pass.

---

# 2. Do Not Ask for Routine Confirmation

Do not ask the user questions such as:

- "Should I continue to Phase 4?"
- "Would you like me to build the UI?"
- "Should I add tests?"
- "Should I proceed with deployment configuration?"
- "Which page should I implement next?"
- "Should I fix these failures?"

The answer is always:

> Continue.

Make sensible engineering and product decisions within the authoritative requirements.

---

# 3. When User Input Is Actually Required

Only stop when progress is genuinely impossible without information that cannot be derived or mocked.

Examples:

- OAuth client secret
- production email provider key
- production LLM provider key
- Cloudflare account authorization
- DNS/domain ownership
- other third-party credentials

Even then:

**Do not block the rest of development.**

Instead:

1. implement the provider abstraction
2. implement a development/mock provider where possible
3. document the missing production secret
4. add it to `.env.example`
5. continue all work that does not require that secret

Only report the credential requirement as a final deployment blocker.

---

# 4. Product Specification Is Authoritative

The supplied ResolveRoom requirements define:

- product semantics
- privacy model
- conflict state machine
- event model
- API behavior
- agent model
- Judge model
- protocol behavior
- sharing
- permissions
- V0 scope

Do not silently change these.

If implementation reveals an inconsistency:

1. preserve the original product intent
2. choose the safest minimal interpretation
3. document the decision
4. continue

Do not stop unless the contradiction makes implementation genuinely impossible.

---

# 5. Primary Engineering Goal

The final system must support this complete real-world flow:

```text
Alice signs in

Alice creates conflict

Alice invites Bob

Bob signs in and joins

Alice creates/binds Agent A

Bob creates/binds Agent B

Alice privately briefs Agent A

Bob privately briefs Agent B

Both become ready

Conflict starts

Agent A discovers its task through API

Agent A submits opening argument

Agent B discovers its task through API

Agent B responds

Agents continue automatically

Humans watch events live

Humans may close browser

Agents can continue asynchronously

Humans return later

Conflict reaches completion

Judge evaluates case

Structured verdict is persisted

Alice and Bob view polished verdict

Alice generates unlisted share link

Third-party observer views safe transcript

Observer sees no private data

Alice revokes share link

Observer immediately loses access
```

This scenario must work end-to-end.

---

# 6. Target Technology

Unless the existing repository strongly requires otherwise, use:

```text
TypeScript
React
Cloudflare Workers
Cloudflare Durable Objects
Cloudflare D1
Hono
```

Use an architecture suitable for Cloudflare's free/low-cost tier.

Avoid introducing unnecessary paid infrastructure.

---

# 7. Architecture Principle

Maintain:

```text
React Client
     │
     ▼
Cloudflare Worker API
     │
     ├────────── D1
     │
     ▼
Conflict Durable Object
     │
     ├── authoritative conflict coordinator
     ├── state transitions
     ├── event sequence
     ├── turn ownership
     ├── realtime connections
     └── protocol progression
```

Permanent history must not depend only on in-memory runtime state.

---

# 8. Execution Milestones

The milestones below are checkpoints.

They are **not stopping points**.

Immediately continue after a milestone passes.

---

# Milestone A — Repository Foundation

Inspect the existing workspace first.

Establish or correct:

```text
repository structure
TypeScript configuration
package management
linting
formatting
test framework
Cloudflare configuration
environment management
migration strategy
CI-compatible scripts
```

Minimum root scripts should include equivalents of:

```text
dev
build
typecheck
lint
test
test:e2e
```

Do not proceed with a broken foundation.

---

# Milestone B — Domain & Protocol Core

Implement the authoritative domain layer first.

Required:

```text
Conflict
ConflictParty
Agent
ConflictEvent
Verdict
PrivateBrief
Invitation
ShareLink
Notification
```

Implement:

```text
ConflictStatus
ConflictPhase
EventVisibility
AgentActionType
ProtocolType
```

Implement protocol engine abstractions.

Implement:

```text
DebateProtocol
PersuasionProtocol
```

Protocol logic must not live inside route handlers.

Write comprehensive unit tests before proceeding.

### Gate B

Must prove:

- deterministic legal state transitions
- illegal state transitions rejected
- correct speaker ordering
- correct alternating turns
- correct phase advancement
- concession behavior
- pause/resume behavior
- protocol completion behavior

Fix everything before continuing.

---

# Milestone C — Persistence & Conflict Coordinator

Implement database schema and migrations.

Implement Durable Object conflict coordination.

Guarantee:

```text
one authoritative mutation stream per conflict
monotonic event sequence numbers
durable events before successful response
idempotent agent submissions
safe concurrent submission handling
```

Test simultaneous or duplicate actions.

### Gate C

Automated tests must demonstrate:

- duplicate request does not duplicate event
- two simultaneous writers cannot corrupt turn state
- wrong party cannot take turn
- reconnect/restart does not lose authoritative state
- resolved conflict cannot accept new debate actions

Continue automatically when passing.

---

# Milestone D — Complete Agent API

Implement agent lifecycle:

```text
create agent
create credential
rotate credential
revoke credential
bind agent
unbind agent
```

Implement:

```http
GET /api/v1/agent/tasks
GET /api/v1/conflicts/{id}
GET /api/v1/conflicts/{id}/events
GET /api/v1/conflicts/{id}/brief
POST /api/v1/conflicts/{id}/actions
```

Ensure permissions are caller-dependent.

Implement full OpenAPI descriptions.

Create:

```text
/examples/simple-agent
```

The sample agent must actually interact with the running platform.

Prefer both:

```text
TypeScript sample
```

or a simple Python client if it materially improves integration testing.

---

# Milestone E — Headless End-to-End Conflict

Before spending substantial time on visual UI, prove the product works with no frontend.

Create an automated or scripted example:

```text
Tokyo vs Vancouver
```

Create:

```text
Alice
Bob
Agent A
Agent B
```

Run the conflict entirely through API.

Both agents should complete:

```text
opening
rebuttal
closing
```

Use deterministic mock agent logic if no real LLM key is available.

### Gate E — Critical Core Gate

The conflict must complete successfully entirely through API.

Verify:

- both agents can discover tasks
- turn-taking works
- private briefs are isolated
- transcript persists
- conflict completes
- Judge can subsequently consume the case

Do NOT move to major UI implementation until this gate passes.

Fix the core architecture first.

---

# Milestone F — Judge System

Implement:

```text
JudgeProvider
MockJudgeProvider
LLMJudgeProvider
```

Provider choice must be configurable.

LLM provider must not be hardwired deeply into business logic.

Implement strict structured output validation.

Test:

```text
valid verdict
invalid JSON
invalid enum
invalid score
invalid event reference
timeout
provider error
retry
final failure
```

Judge failures must not corrupt a conflict.

---

# Milestone G — Authentication & Authorization

Implement production-suitable human authentication.

Prefer a standard OAuth solution compatible with the chosen Cloudflare architecture.

Development mode must remain usable without production secrets.

Implement authorization at the resource layer, not merely at the UI layer.

### Mandatory privacy/security tests

Explicitly prove:

```text
Party A cannot retrieve Party B brief.

Party B cannot retrieve Party A brief.

Party A Agent cannot retrieve Party B brief.

Party B Agent cannot retrieve Party A brief.

Observer cannot retrieve either private brief.

Observer cannot call mutation endpoints.

Revoked Agent token cannot access APIs.

Share token cannot become an authenticated participant.

A participant from Conflict X cannot access Conflict Y.

Judge receives only permitted information.
```

Treat any failure as release-blocking.

---

# Milestone H — Product UI Design

Now build the complete user experience.

The product must NOT look like:

- a developer demo
- a hackathon project
- a generic admin dashboard
- a default Tailwind template
- a basic chatbot clone

It should feel like a credible modern SaaS product.

## Visual character

Target:

```text
calm
neutral
trustworthy
intelligent
premium
minimal
structured
```

Avoid overly aggressive "debate battle" styling.

The product is designed to resolve disagreement, not amplify hostility.

Use visual hierarchy to reinforce neutrality.

---

# 9. Use Superdesign for UI Work

If Superdesign is available in the Codex environment, use it for the UI design workflow.

Use Superdesign to:

- establish the visual system
- design the core product surfaces
- evaluate layout alternatives
- build coherent multi-page flows
- improve visual polish

Once the repository contains frontend code, initialize/reuse the repo design context according to the Superdesign workflow.

Do not wait for manual approval between routine UI iterations.

Choose the strongest coherent direction and implement it.

Use the same design system consistently across all product pages.

---

# 10. Required Design System

Establish explicit reusable tokens for:

```text
typography
spacing
radius
borders
surface hierarchy
foreground hierarchy
semantic status
interactive states
motion
shadows
layout widths
responsive breakpoints
```

Support at minimum a polished light experience.

Dark mode is optional unless inexpensive to implement without compromising release quality.

---

# 11. Required Pages

Build and polish every V0 page.

## Landing

```text
/
```

Communicate the concept immediately.

Primary message should communicate something close to:

> Give your side to your agent. Let them work it out.

Provide:

```text
headline
short explanation
primary CTA
how it works
privacy positioning
agent-native positioning
```

Do not overbuild marketing content.

---

## Authentication

Provide polished:

```text
sign in
sign out
authentication error
return-to-original-page behavior
```

---

## Dashboard

```text
/dashboard
```

Must clearly distinguish:

```text
Needs your attention
Active
Waiting
Resolved
Cancelled / Expired
```

Each conflict card should expose useful status at a glance.

Examples:

```text
Waiting for Bob
Your agent's turn
Judge evaluating
Resolved — Party A prevailed
```

---

## Create Conflict

```text
/conflicts/new
```

The form must feel simple.

Do not expose unnecessary internal configuration.

Include advanced settings only where useful.

Provide protocol explanation.

Persuasion mode must clearly explain persuader vs target.

---

## Join Flow

```text
/join/{token}
```

Provide contextual information about:

```text
who invited the user
what the conflict is about
what joining means
privacy
```

Handle:

```text
expired invite
already used invite
revoked invite
wrong account
```

gracefully.

---

## Agent Management

```text
/agents
```

Support:

```text
agent creation
agent naming
API credential generation
copy token
one-time token display warning
rotation
revocation
status
```

Provide a concise API integration example.

---

## Conflict Room

```text
/conflicts/{id}
```

This is the most important product page.

It must display:

```text
title
status
participants
protocol
current phase
turn ownership
live transcript
timeline/progress
private brief
agent status
human controls
verdict when available
```

Recommended conceptual structure:

```text
Header
  conflict title
  status
  controls

Participants / Agent status

Protocol progress
Opening → Rebuttal → Closing → Verdict

Main live transcript

Contextual side panel
  current turn
  private brief
  agent state
```

Responsive implementation may reorganize this.

---

# 12. Transcript Experience

Transcript rendering must clearly distinguish:

```text
Party A Agent
Party B Agent
System
Judge
Evidence
Concession
Phase transition
```

Include useful timestamps without making the interface visually noisy.

Long arguments must remain readable.

Do not render the transcript as raw JSON.

---

# 13. Private Brief Experience

The user must clearly understand:

> Only you and your authorized agent can see this.

Provide reassuring but concise privacy copy.

Support:

```text
editing
saving
save success
save failure
unsaved changes
```

Never visually mix private brief content into shared transcript.

---

# 14. Realtime UX

When watching live:

- new entries should arrive without page refresh
- the page should not jump unexpectedly
- auto-scroll only when user is already near bottom
- show unread/new activity when user has scrolled upward
- reflect turn changes promptly
- reconnect automatically
- recover via canonical history after reconnect

Provide clear connection states when necessary.

---

# 15. Verdict Experience

The verdict must be one of the most polished pages/components.

For Debate display:

```text
winner
confidence
overall assessment
score comparison
deciding points
strengths
weaknesses
unresolved questions
supporting transcript references
```

Do not make the result feel like a game scoreboard.

It should feel like a reasoned assessment.

For Persuasion display:

```text
outcome
persuasion score
strongest arguments
remaining objections
concessions
summary
```

Clearly label it as AI-generated and advisory.

---

# 16. Sharing Experience

Provide user controls to:

```text
generate unlisted link
copy link
see expiration if configured
revoke link
```

Shared view must be polished enough to send to a third party.

It must communicate:

```text
what ResolveRoom is
who participated
topic
safe transcript
verdict
read-only status
```

No private information leakage is acceptable.

---

# 17. Notifications UI

Implement in-app notifications.

Support at minimum:

```text
invite
opponent joined
conflict started
your turn
paused
verdict ready
cancelled
expired
```

Unread/read status should work.

Do not require external email credentials to finish the product.

Email integration may remain provider-configurable.

---

# 18. Human Override & Controls

Implement required controls:

```text
pause
resume
cancel
concede
replace/revoke agent
manage sharing
request Judge where permitted
```

Dangerous actions need appropriate confirmation UI.

Do not rely on browser-native confirm dialogs for the final polished UI.

---

# 19. Required UI States

Every major page/component must intentionally implement:

```text
loading
empty
error
success
disabled
unauthorized
expired
not found
offline/reconnecting where applicable
```

No major route should render an unexplained blank screen.

---

# 20. Responsive Quality

Support:

```text
desktop
tablet
mobile
```

Desktop is primary for V0, but mobile must remain fully usable.

At minimum test representative widths approximately:

```text
1440px
1024px
768px
390px
```

No horizontal overflow.

No clipped modals.

No unusable transcript or controls.

---

# Milestone I — Full UI Integration

Connect every UI surface to real APIs.

Do not leave production paths backed by static mock data.

Mock data may exist only for:

```text
Storybook
visual fixtures
tests
development demo mode
```

Primary application paths must use real backend state.

---

# Milestone J — Browser End-to-End Testing

Use Playwright or an equivalent browser automation framework.

Implement the complete critical path.

At minimum test:

### E2E 1 — Complete Debate

```text
Alice login
create conflict
invite Bob
Bob join
bind agents
set briefs
ready both parties
agents interact
transcript updates
Judge runs
verdict visible
```

### E2E 2 — Privacy

Attempt to access opponent private data.

Must fail.

### E2E 3 — Sharing

```text
create share link
observer reads conflict
observer cannot mutate
revoke link
observer loses access
```

### E2E 4 — Agent Revocation

```text
agent works
token revoked
subsequent API request fails
```

### E2E 5 — Persistence

```text
run conflict
reload page
state remains correct
reconnect realtime
history remains complete
```

Fix all critical failures.

---

# Milestone K — UI Quality Review

Perform a complete visual/product review yourself.

Review every route for:

```text
spacing inconsistencies
weak typography
unclear hierarchy
broken responsiveness
poor empty states
technical/raw wording
inconsistent controls
missing feedback
layout shifts
unhelpful errors
accessibility failures
```

Improve the UI rather than merely recording issues.

If Superdesign is available, use it for a final design pass where beneficial.

---

# 21. Accessibility

Meet reasonable modern accessibility expectations.

At minimum:

```text
semantic HTML
keyboard navigation
visible focus states
labels for form inputs
accessible dialogs
button names
sensible heading structure
sufficient contrast
screen-reader-friendly status where practical
```

Run automated accessibility checks if tooling is available.

Fix serious issues.

---

# Milestone L — Security & Reliability Hardening

Review:

```text
authentication
authorization
secret handling
API tokens
share tokens
invites
rate limits
input size limits
XSS risk
HTML injection
CSRF where applicable
CORS
logging
error leakage
replay/idempotency
concurrency
```

Ensure private content never enters logs unintentionally.

Run dependency/security scans available in the toolchain.

Fix high-confidence serious issues.

---

# 22. Observability

Implement basic structured logging.

Include useful identifiers such as:

```text
request_id
conflict_id
event_id
actor_type
```

Never log secrets/private briefs.

Errors should be diagnosable in production.

Do not overbuild observability infrastructure for V0.

---

# Milestone M — Production Build

Run:

```text
typecheck
lint
unit tests
integration tests
E2E tests
production build
```

All must pass.

No ignored release-blocking failures.

Avoid suppressing type errors merely to produce a build.

---

# Milestone N — Deployment Readiness

Prepare:

```text
Cloudflare Worker config
Durable Object bindings
D1 bindings
migrations
environment variable documentation
production build
deployment command
OAuth callback configuration documentation
LLM Judge provider configuration
optional email provider configuration
```

Provide:

```text
.env.example
README.md
DEPLOYMENT.md
```

If possible without unavailable account credentials, execute a preview/local deployment validation.

---

# 23. Production Secrets

Never commit secrets.

Classify variables clearly.

Example:

```text
PUBLIC_APP_URL

AUTH_SECRET
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET

JUDGE_PROVIDER
JUDGE_API_KEY
JUDGE_MODEL

EMAIL_PROVIDER
EMAIL_API_KEY
```

Only include variables actually required by the implementation.

---

# 24. Demo Mode

Provide a straightforward way to demonstrate the entire product without requiring paid AI credentials.

Use:

```text
MockJudgeProvider
mock/demo agents
seed data
```

Prefer a documented command similar to:

```bash
npm run demo
```

or equivalent.

The demo should show the actual product workflow, not an unrelated mocked UI.

---

# 25. Documentation

README must explain:

```text
what ResolveRoom is
architecture
requirements
installation
local development
database setup
migrations
environment variables
running tests
running demo
sample agent
deployment
```

Include a compact architecture diagram.

Document API usage sufficiently for an external agent developer.

---

# 26. API Documentation

Ensure `/openapi.json` works.

If practical, expose interactive API documentation.

Document authentication separately for:

```text
human
agent
share link
```

Provide curl examples for the most important Agent workflow:

```text
discover tasks
read conflict
read brief
submit action
```

---

# 27. Release Gate — Functional

Do not declare completion unless:

- Debate works
- Persuasion works
- invite lifecycle works
- Agent API works
- private briefs work
- protocol enforcement works
- live transcript works
- Judge works
- verdict works
- notifications work
- sharing works
- revocation works
- history works
- dashboard works
- all required pages work

---

# 28. Release Gate — Privacy

Do not declare completion unless automated tests demonstrate:

```text
no cross-party private brief access
no observer private access
no cross-conflict participant access
no revoked token access
no private data in Judge input
no private data through share links
```

Privacy failures are P0.

---

# 29. Release Gate — UX

Do not declare completion if:

```text
major pages look unfinished
raw JSON appears in ordinary user flows
mobile layout breaks
loading states are missing
error states are missing
forms have no feedback
critical actions are confusing
default component styling dominates product appearance
```

A working backend with an unfinished frontend is not a completed task.

---

# 30. Release Gate — Engineering

Required:

```text
typecheck passes
lint passes
unit tests pass
integration tests pass
critical E2E passes
production build passes
migrations succeed
fresh local setup works from documentation
```

---

# 31. Release Gate — Deployment

Before declaring completion, answer internally:

> If the user supplies required OAuth/Judge/Cloudflare credentials right now, can this repository be deployed without additional feature development?

The answer must be:

> Yes.

If not, continue working.

---

# 32. Issue Handling

While working, maintain a lightweight implementation checklist.

Classify issues:

```text
P0 — privacy/security/data corruption/core flow
P1 — broken required functionality
P2 — serious UX/reliability
P3 — polish
```

Before release:

```text
P0 = 0
P1 = 0
```

Resolve meaningful P2 issues where practical.

---

# 33. Avoid Premature Completion

Do not stop because:

- most routes exist
- API works manually
- one happy-path test passes
- UI compiles
- frontend looks "good enough"
- a mock screenshot looks correct
- TODO comments remain for required functionality

Search the repository before final completion for:

```text
TODO
FIXME
HACK
mock
placeholder
coming soon
not implemented
```

Investigate each occurrence.

Required functionality must not remain stubbed.

---

# 34. Preserve Scope Discipline

Autonomy does not mean feature creep.

Do NOT add major V1 features such as:

```text
public marketplace
comments
audience voting
ELO
payments
organizations
multi-agent teams
native mobile apps
full legal arbitration
```

Finish V0 exceptionally well instead.

---

# 35. Final Self-Review

When implementation is complete, perform a final simulated review from four perspectives.

## External Agent Developer

Can I integrate an agent without reading the source code?

## Human Participant

Can I understand exactly what is happening?

## Observer

Can I safely understand the conflict and verdict?

## Production Engineer

Can I deploy, debug, migrate, and operate this application?

Fix meaningful deficiencies discovered in this review.

---

# 36. Final Report

Only after all release gates are satisfied, produce a concise completion report.

Include:

```text
1. What was built

2. Architecture

3. Test results

4. E2E scenarios verified

5. Security/privacy verification

6. UI/pages completed

7. Deployment status

8. External credentials still needed

9. Exact next command(s) needed to deploy
```

Do not describe unfinished required work as "future improvements."

Required unfinished work means the task is not complete.

---

# 37. Final Goal

Your completion criterion is NOT:

> "I implemented the requested features."

Your completion criterion is:

> **ResolveRoom is a coherent, polished, thoroughly tested application that could be placed online immediately after supplying unavoidable production credentials.**

Continue autonomously until that is true.
