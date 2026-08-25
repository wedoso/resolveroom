# ResolveRoom V0 Design System

## Product context

ResolveRoom is private disagreement infrastructure: two human principals authorize separate external agents to exchange structured arguments under a neutral protocol, observe an append-only case record, and receive an advisory AI-generated verdict. The browser is a calm control plane and observation interface, never a chat toy or adversarial arena.

Primary jobs:

- Create a private debate or persuasion conflict in under two minutes.
- Invite the second participant and clearly explain privacy and participation.
- Bind, rotate, and revoke an external agent credential safely.
- Privately brief an authorized agent without leaking context.
- Understand phase, turn, progress, agent status, and live connection state at a glance.
- Read a long-form transcript and a reasoned, non-game-like verdict.
- Share only an explicitly safe observer record through a revocable unlisted link.

Core surfaces: landing, sign in/error, dashboard, conflict creation, invitation join states, agent management and one-time token reveal, conflict room with Live/Transcript/Private Brief/Verdict/Settings, notification center, and safe shared observer view.

## Visual thesis: Calm Technical Forum

Use the Mosaic Grid Architecture style as the single visual source, adapted away from harsh industrialism toward a warm, premium civic-document character. The system should feel like a well-made mediation room, a precise case file, and intelligent infrastructure.

Never use combat metaphors, neon AI gradients, game-score visuals, speech-bubble chat layouts, glassmorphism, generic dashboard chrome, or excessive rounded cards.

## Color

- `paper-0` #F8F7F3: application canvas.
- `paper-1` #FFFEFA: raised working surfaces and inputs.
- `paper-2` #F1F0EA: muted panels, selected rows, transcript metadata.
- `ink-900` #17211D: primary text.
- `ink-700` #35443D: secondary text.
- `ink-500` #5F6E67: quiet metadata with WCAG AA contrast on paper.
- `forest-800` #173F32: primary brand, primary buttons, focus emphasis.
- `forest-700` #235745: hover and active controls.
- `sage-200` #CFE1D4: Party A soft identity and success background.
- `blue-200` #D7E3EA: Party B soft identity; neutral, never partisan red/blue.
- `gold-200` #F0E4B8: judging and advisory states.
- `coral-200` #F1D2C6: destructive-warning background only.
- `danger-700` #9B3B32; `warning-700` #806213; `success-700` #28704E.
- Hairlines: rgba(23, 33, 29, .14); strong borders rgba(23, 33, 29, .28).

All text and interactive combinations must meet WCAG AA. Status never relies on color alone.

## Typography

- Display and headings: `Space Grotesk`, fallback `Inter`, system sans. Tight but readable: -0.035em for display, -0.02em for headings.
- Body and UI: `Inter`, system sans, 15–17px with 1.55–1.7 line height.
- Metadata, labels, protocol steps, tokens, API examples: `JetBrains Mono`, system monospace, 11–13px, modest tracking. Never set long prose in mono.
- Display scale: 64/62 desktop, 48/48 tablet, 38/42 mobile.
- H1 40/46; H2 28/34; H3 20/26; body 16/26; compact 14/21; label 12/16.

## Layout

- Max app width 1440px; content frame 1240px; reading measure 720px.
- 12-column desktop grid, 8-column tablet, 4-column mobile.
- Persistent top bar 64px. Conflict room uses a 8/4 split above 1100px; contextual rail moves below or into sheets on narrower screens.
- Background may use a very subtle rectangular mosaic/hairline field only on landing and empty states. Product work surfaces remain quiet.
- Explicit section dividers and aligned baselines are preferred over nested cards.
- Breakpoints: 390, 768, 1024, 1280, 1440.

## Spacing, radius, borders, depth

- Base spacing unit 4px; common sequence 4, 8, 12, 16, 20, 24, 32, 40, 56, 72, 96.
- Radius: 0 for structural dividers, 6px controls, 10px panels/dialogs, 999px only for compact badges/avatars.
- Border: 1px hairline. Use double-border/corner-marker details sparingly for credentials and verdict artifacts.
- Shadows are rare: dialogs and floating menus only, `0 16px 48px rgba(23,33,29,.14)`; no shadows on normal cards.

## Component language

- Brand mark: a restrained two-sided room/gate glyph, not initials and not a chat bubble.
- Buttons: 40–44px height, sentence case, forest solid primary, paper secondary with strong hairline, text tertiary. Destructive actions use danger text and confirmation dialog, never bright filled red by default.
- Inputs: 44px minimum, paper surface, visible label, helper/error below, 2px forest focus ring with 2px offset.
- Status badge: compact mono label, square 7px status mark plus text; outlined, low-radius.
- Conflict cards: broad horizontal records with status/protocol metadata, meaningful next action, and subtle phase track; avoid tile-wall admin styling.
- Transcript: case-record timeline. Party entries use a slim left identity rail (sage for A, blue for B), readable prose, phase/action label, event reference, and timestamp. System events are centered rule annotations. Evidence is inset with a document icon. Judge output uses gold paper and explicit advisory label.
- Protocol progress: Opening → Rebuttal → Closing → Verdict on an aligned horizontal line; on mobile use compact step labels or a vertical rail.
- Verdict: editorial document hierarchy, side-by-side score bars without competitive celebration, cited event links, confidence explained in prose.
- Private Brief: visually separated paper with a lock/privacy callout and persistent save state; never visually adjacent as if part of the transcript.
- Notifications: grouped by attention, clear unread marker and action, no noisy badge storms.
- Dialogs: accessible focus trap, title/description, explicit action labels, escape and close affordance.

## Interaction and motion

- Motion is quiet and purposeful: 120ms color/focus, 180ms panel transitions, 240ms new-event reveal. Standard ease-out; no bouncing.
- Respect `prefers-reduced-motion`.
- Live transcript auto-scrolls only when the reader is near the bottom; otherwise show a “New activity” control.
- Realtime connection state appears as concise status text and is announced politely to assistive technology.
- All controls have hover, active, focus-visible, disabled, loading, success, and error states.

## Required responsive and accessibility behavior

- Full keyboard navigation, visible focus, semantic landmarks, logical headings, named icon buttons, labelled fields, and accessible custom dialogs.
- Minimum 44px touch targets on mobile.
- No horizontal overflow at 390px; tables become stacked records; tabs become scrollable with visible selection; fixed controls respect safe areas.
- Long tokens and arguments wrap safely. Token secrets are masked except in the one-time reveal.

## Voice and content

Calm, direct, and precise. Say “verdict,” “assessment,” and “advisory,” never “truth,” “champion,” or “defeated.” Prefer “Waiting for Jordan,” “Your agent can respond,” and “Only you and your authorized agent can see this.” Technical detail appears progressively where it helps agent developers.

Primary landing statement: “Give your side to your agent. Let them work it out.”

## State completeness

Every route intentionally covers loading, empty, error, success, disabled, unauthorized, expired, revoked, not found, and offline/reconnecting states where applicable. No raw JSON appears in ordinary participant flows. Shared pages always communicate unlisted/read-only status and include noindex/nofollow metadata.
