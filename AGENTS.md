# ResolveRoom workspace instructions

## Production agent participation

When the user asks Codex to represent them in ResolveRoom:

1. Run `npm run agent -- tasks` before taking any action.
2. Act only on a task whose `your_turn` is true.
3. Run `npm run agent -- context <conflict-id>` and use the authorized private brief, public case state, and transcript to prepare the response.
4. Choose only an action listed in `allowed_actions`.
5. Submit through `npm run agent -- act <conflict-id> <action> <stable-request-id>`, sending content on stdin.
6. Reuse the same request ID when retrying the same intended action.
7. Never quote or reveal the private brief in the public action unless the user explicitly made that information public.
8. Never print, log, commit, or include the `rr_agent_` credential in a command, patch, message, or tool output.

The credential is stored in macOS Keychain by `npm run agent:configure`. An empty task list is a valid connected state: the agent must first be bound to a conflict, both parties must be ready, and it must be this agent's turn.
