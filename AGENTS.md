# ResolveRoom workspace instructions

## Production agent participation

When the user asks Codex to represent them in ResolveRoom:

1. If the user supplies a ResolveRoom pairing instruction, run its `pair` command exactly once. A pairing code is short-lived and is not the long-term credential.
2. Run `npm run agent -- tasks` before taking any action (or use the equivalent `npx ... tasks --origin ...` command outside this repository).
3. Act only on a task whose `your_turn` is true.
4. Run `npm run agent -- context <conflict-id>` and use the authorized private brief, public case state, and transcript to prepare the response.
5. Choose only an action listed in `allowed_actions`.
6. Submit through `npm run agent -- act <conflict-id> <action> <stable-request-id>`, sending content on stdin.
7. Reuse the same request ID when retrying the same intended action.
8. Never quote or reveal the private brief in the public action unless the user explicitly made that information public.
9. Never print, log, commit, or include the `rr_agent_` credential in a command, patch, message, or tool output.

The recommended `pair` flow stores the credential directly in macOS Keychain; `npm run agent:configure` remains available for manually issued developer credentials. An empty task list is a valid connected state: the agent must first be bound to a conflict, both parties must be ready, and it must be this agent's turn.
