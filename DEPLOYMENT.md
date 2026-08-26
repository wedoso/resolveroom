# ResolveRoom deployment

ResolveRoom deploys as one Cloudflare Worker with static assets, a D1 binding named `DB`, and Durable Object namespaces named `CONFLICT_ROOMS` and `AGENT_RUNNERS`. Feature development is complete; deployment requires only account-specific IDs, an application origin, and the production identity/Judge credentials selected by the operator.

The recommended path is the checked-in GitHub Actions pipeline. Follow [docs/CICD_SETUP.zh-CN.md](./docs/CICD_SETUP.zh-CN.md) to configure the `production` GitHub Environment and trigger deployments from GitHub. The steps below remain useful for a local/manual deployment.

## 1. Prepare Cloudflare

Authenticate Wrangler and create the database:

```bash
npx wrangler login
npx wrangler d1 create resolveroom
```

Export the returned values. The deploy preparation script validates them and generates the ignored `wrangler.deploy.toml`; production account IDs are never committed:

```bash
export CLOUDFLARE_ACCOUNT_ID="<32-character-account-id>"
export CLOUDFLARE_D1_DATABASE_ID="<complete-d1-database-id>"
export CLOUDFLARE_API_TOKEN="<scoped-api-token>"
export PUBLIC_APP_URL="https://resolve.example.com"
```

Both Durable Object bindings and their SQLite class migrations are already declared. The `AgentRunner` migration creates the agent-scoped presence and durable-dispatch coordinator; no new secret is required.

Set the selected production-safe modes in the environment before generating the deploy config:

```bash
export JUDGE_PROVIDER="disabled"
export EMAIL_PROVIDER="console"
npm run deploy:config
```

`disabled` is the production-safe default: Judge endpoints and user-facing verdict controls remain unavailable. For an LLM-backed production Judge, set `JUDGE_PROVIDER=llm` and configure all three Judge secrets below. `MockJudgeProvider` remains available only in local development and automated tests.

## 2. Configure production secrets

Set only the providers being enabled:

```bash
npx wrangler secret put GOOGLE_CLIENT_ID --config wrangler.deploy.toml
npx wrangler secret put GOOGLE_CLIENT_SECRET --config wrangler.deploy.toml
npx wrangler secret put GITHUB_CLIENT_ID --config wrangler.deploy.toml
npx wrangler secret put GITHUB_CLIENT_SECRET --config wrangler.deploy.toml

npx wrangler secret put JUDGE_API_URL --config wrangler.deploy.toml
npx wrangler secret put JUDGE_API_KEY --config wrangler.deploy.toml
npx wrangler secret put JUDGE_MODEL --config wrangler.deploy.toml
```

The LLM endpoint must accept an OpenAI Responses-style JSON request and return either `output_text` or an `output[].content[]` `output_text` item containing only the verdict JSON. Judge output is schema-validated, citations must reference known public case events, one retry is attempted, and failure leaves the conflict in `judging` for a safe retry.

Optional HTTP email delivery:

```bash
# First export EMAIL_PROVIDER="http" and rerun npm run deploy:config
npx wrangler secret put EMAIL_API_URL --config wrangler.deploy.toml
npx wrangler secret put EMAIL_API_KEY --config wrangler.deploy.toml
npx wrangler secret put EMAIL_FROM --config wrangler.deploy.toml
```

The endpoint receives `POST` JSON with `from`, `to`, `subject`, and `text` and an `Authorization: Bearer …` header. Email failures do not interrupt the conflict; the durable in-app notification remains available.

## 3. Configure OAuth callbacks

At least one human OAuth provider is required for a normal production deployment. Register the exact callback URLs, with no trailing slash:

```text
Google: https://resolve.example.com/api/v1/auth/oauth/google/callback
GitHub: https://resolve.example.com/api/v1/auth/oauth/github/callback
```

Use the same origin in `PUBLIC_APP_URL`. ResolveRoom validates OAuth state, restricts return paths to the same origin, uses Secure/HttpOnly/SameSite cookies in production, and stores revocable hashed sessions.

## 4. Validate and migrate

From a clean checkout:

```bash
npm ci
npx playwright install chromium webkit
npm run check
npm run test:agent-e2e
npm run test:e2e
npm audit --audit-level=high
npm run db:migrate:remote
npm run deploy:dry-run
```

The scheduled trigger runs once per minute as a safety net for expired case deadlines. Per-turn timeouts use Durable Object alarms. Wrangler notes that cron is not automatic in local development; invoke `curl http://localhost:8787/cdn-cgi/local/scheduled` only when manually testing the cron path.

## 5. Deploy

```bash
npm run deploy
```

Attach the desired custom domain in Cloudflare, update `PUBLIC_APP_URL` if the origin changed, and update the OAuth callbacks to match. The deploy config generator refuses to continue while any required production value is missing or malformed.

## 6. Smoke test

```bash
export PUBLIC_APP_URL="https://resolve.example.com"

npm run deploy:smoke
```

Then verify in a browser:

1. Sign in with each configured provider.
2. Create a conflict and inspect the invitation URL.
3. Join as a second account, use **Connect Codex** in each conflict room, and confirm both status cards say **Runner online**.
4. Save both private briefs, select Ready once per person, and confirm the server triggers the full protocol without further local commands.
5. Complete the protocol and create then revoke a share link. If `JUDGE_PROVIDER=llm`, also confirm the advisory verdict.
6. Confirm a revoked agent token and revoked share link both fail immediately.

The HTML response should include CSP, clickjacking, MIME-sniffing, referrer, permissions, and HSTS protections. Shared routes are globally `noindex,nofollow` and never expose private briefing content.

## 7. Operations

- Structured Worker logs include request ID, method, route, status, duration, conflict ID when present, and actor type. They intentionally exclude bodies, tokens, briefs, and transcript content.
- Use the `x-request-id` response header to correlate a user-visible stable error with logs.
- D1 is authoritative for product records. Browser WebSockets ask clients to refetch; AgentRunner Durable Objects persist pending jobs and replay them with stable request IDs after a Runner reconnects.
- Runner presence is visible in `/agents` and each conflict. A short disconnect shows **Reconnecting**; a stale or missing connection shows **Reconnect required** and links to the replacement pairing flow.
- In-app notifications are always persisted. External email is best-effort.
- Account deletion uses the internal `Database.anonymizeUser` primitive, preserving the audit record while replacing identity fields; a self-service deletion UI is outside V0 scope.

## 8. Rollback and recovery

Use Cloudflare Worker version rollback for application regressions. Database migrations are forward-only, so take a D1 backup before future schema migrations and roll application code forward to a compatible version rather than deleting production data. Revoking a compromised agent or share credential is immediate and does not require a deployment.

## Required external values

For a standard production launch:

- Cloudflare account access and the created D1 database ID
- Final HTTPS application origin/custom domain
- Google and/or GitHub OAuth client credentials
- LLM Judge API URL, API key, and model, only when the Judge feature is enabled
- Optional HTTP email URL/key/from address, only if email delivery is enabled
