import { describe, expect, it } from 'vitest';
import { createApi } from '@/api/app';
import { MemoryDatabase } from '@/persistence/memory';

async function setup() {
  const db = new MemoryDatabase();
  const app = createApi(db, {
    allowDevelopmentAuth: true,
    appUrl: 'http://resolveroom.test',
  });
  const request = async (path: string, init: RequestInit = {}) => {
    const response = await app.request(`http://resolveroom.test${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
    });
    return { response, body: (await response.json()) as any };
  };
  const alice = (
    await request('/api/v1/auth/development', {
      method: 'POST',
      body: JSON.stringify({ email: 'alice@pairing.test', display_name: 'Alice' }),
    })
  ).body.user;
  const mallory = (
    await request('/api/v1/auth/development', {
      method: 'POST',
      body: JSON.stringify({ email: 'mallory@pairing.test', display_name: 'Mallory' }),
    })
  ).body.user;
  const aliceHeaders = { 'x-dev-user-id': alice.id };
  const malloryHeaders = { 'x-dev-user-id': mallory.id };
  const created = await request('/api/v1/conflicts', {
    method: 'POST',
    headers: aliceHeaders,
    body: JSON.stringify({
      title: 'Pair Codex safely',
      description: 'Verify the simplified one-instruction connection flow.',
      protocol_type: 'debate',
      max_rounds: 3,
    }),
  });
  return {
    db,
    app,
    request,
    conflictId: created.body.conflict.id as string,
    aliceHeaders,
    malloryHeaders,
  };
}

describe('single-use Codex pairing', () => {
  it('auto-creates and binds an agent, then atomically exchanges the code once', async () => {
    const h = await setup();
    const created = await h.request(`/api/v1/conflicts/${h.conflictId}/agent/pairings`, {
      method: 'POST',
      headers: h.aliceHeaders,
      body: '{}',
    });
    expect(created.response.status).toBe(201);
    expect(created.body.code).toMatch(/^[A-HJ-NP-Z2-9]{4}(?:-[A-HJ-NP-Z2-9]{4}){2}$/);
    expect(created.body.instruction).toContain('load_workspace_dependencies');
    expect(created.body.instruction).toContain('node executable');
    expect(created.body.instruction).toContain('JSON argument array');
    expect(created.body.instruction).toContain('sandbox_permissions: "require_escalated"');
    expect(created.body.instruction).toContain('ENOTFOUND');
    expect(created.body.instruction).toContain('network_access_required');
    expect(created.body.instruction).toContain('/agent/bootstrap.mjs');
    expect(created.body.instruction).toContain('SHA-256');
    expect(created.body.instruction).toContain('Do not use the system Node.js, npm, npx, pnpm');
    expect(created.body.instruction).toContain('Do not wrap, redirect, capture, or parse');
    expect(created.body.instruction).not.toContain('github.com');
    expect(created.body.instruction).not.toContain('registry.npmjs.org');
    expect(created.body.recovery_instruction).toContain('"runner","reconnect"');
    expect(created.body.recovery_instruction).not.toContain(created.body.code);
    expect(created.body.command).toContain('<NODE_EXECUTABLE>');
    expect(created.body.codex_runtime.tool).toBe('load_workspace_dependencies');
    expect(created.body.codex_runtime.execution).toMatchObject({
      tool: 'exec_command',
      sandbox_permissions: 'require_escalated',
      network_access: 'required',
      allowed_origin: 'http://resolveroom.test',
    });
    expect(created.body.codex_runtime.arguments).toContain('connect');
    expect(created.body.codex_runtime.arguments).toContain(created.body.code);
    expect(created.body.codex_runtime.arguments).not.toContain('pnpm');
    expect(created.body.instruction).not.toContain('rr_agent_');

    const before = await h.request(`/api/v1/conflicts/${h.conflictId}`, {
      headers: h.aliceHeaders,
    });
    const ownParty = before.body.parties.find(
      (party: any) => party.role === before.body.your_party,
    );
    expect(ownParty.agent_bound).toBe(true);
    expect(ownParty.agent_connected).toBe(false);

    for (let index = 0; index < 30; index += 1)
      expect((await h.request('/api/v1/auth/providers')).response.status).toBe(200);

    const exchanges = await Promise.all([
      h.request('/api/v1/agent-pairings/exchange', {
        method: 'POST',
        body: JSON.stringify({ code: created.body.code, client_name: 'Codex test client' }),
      }),
      h.request('/api/v1/agent-pairings/exchange', {
        method: 'POST',
        body: JSON.stringify({ code: created.body.code, client_name: 'Racing client' }),
      }),
    ]);
    expect(exchanges.map((value) => value.response.status).sort()).toEqual([200, 404]);
    const success = exchanges.find((value) => value.response.status === 200)!;
    expect(success.body.credential).toMatch(/^rr_agent_/);

    const tasks = await h.request('/api/v1/agent/tasks', {
      headers: { authorization: `Bearer ${success.body.credential}` },
    });
    expect(tasks.response.status).toBe(200);
    expect(tasks.body.tasks[0].conflict_id).toBe(h.conflictId);

    const status = await h.request(`/api/v1/agent-pairings/${created.body.pairing.id}`, {
      headers: h.aliceHeaders,
    });
    expect(status.body.pairing.status).toBe('connected');
    expect(['Codex test client', 'Racing client']).toContain(status.body.pairing.client_name);
    expect(JSON.stringify(status.body)).not.toContain(success.body.credential);
    expect(
      (
        await h.request(`/api/v1/agent-pairings/${created.body.pairing.id}`, {
          headers: h.malloryHeaders,
        })
      ).response.status,
    ).toBe(404);

    const after = await h.request(`/api/v1/conflicts/${h.conflictId}`, {
      headers: h.aliceHeaders,
    });
    const connectedParty = after.body.parties.find(
      (party: any) => party.role === after.body.your_party,
    );
    expect(connectedParty.agent_connected).toBe(false);
    expect(connectedParty.runner.state).toBe('reconnect_required');
    expect(JSON.stringify([...h.db.pairings.values()])).not.toContain(created.body.code);
    expect(JSON.stringify([...h.db.tokens.values()])).not.toContain(success.body.credential);
  });

  it('revokes an older open code and rejects expired codes', async () => {
    const h = await setup();
    const first = await h.request(`/api/v1/conflicts/${h.conflictId}/agent/pairings`, {
      method: 'POST',
      headers: h.aliceHeaders,
      body: '{}',
    });
    const second = await h.request(`/api/v1/conflicts/${h.conflictId}/agent/pairings`, {
      method: 'POST',
      headers: h.aliceHeaders,
      body: '{}',
    });
    expect(
      (
        await h.request('/api/v1/agent-pairings/exchange', {
          method: 'POST',
          body: JSON.stringify({ code: first.body.code, client_name: 'Codex client' }),
        })
      ).response.status,
    ).toBe(404);

    const stored = h.db.pairings.get(second.body.pairing.id)!;
    h.db.pairings.set(stored.id, { ...stored, expiresAt: new Date(0).toISOString() });
    expect(
      (
        await h.request('/api/v1/agent-pairings/exchange', {
          method: 'POST',
          body: JSON.stringify({ code: second.body.code, client_name: 'Codex client' }),
        })
      ).response.status,
    ).toBe(404);
  });

  it('rotates the previous credential when an agent reconnects', async () => {
    const h = await setup();
    const firstPairing = await h.request(`/api/v1/conflicts/${h.conflictId}/agent/pairings`, {
      method: 'POST',
      headers: h.aliceHeaders,
      body: '{}',
    });
    const firstExchange = await h.request('/api/v1/agent-pairings/exchange', {
      method: 'POST',
      body: JSON.stringify({ code: firstPairing.body.code, client_name: 'Original Runner' }),
    });
    expect(firstExchange.response.status).toBe(200);

    const replacementPairing = await h.request(`/api/v1/conflicts/${h.conflictId}/agent/pairings`, {
      method: 'POST',
      headers: h.aliceHeaders,
      body: '{}',
    });
    const replacementExchange = await h.request('/api/v1/agent-pairings/exchange', {
      method: 'POST',
      body: JSON.stringify({
        code: replacementPairing.body.code,
        client_name: 'Replacement Runner',
      }),
    });
    expect(replacementExchange.response.status).toBe(200);

    expect(
      (
        await h.request('/api/v1/agent/tasks', {
          headers: { authorization: `Bearer ${firstExchange.body.credential}` },
        })
      ).response.status,
    ).toBe(401);
    expect(
      (
        await h.request('/api/v1/agent/tasks', {
          headers: { authorization: `Bearer ${replacementExchange.body.credential}` },
        })
      ).response.status,
    ).toBe(200);
  });

  it('repairs a missing party binding before reporting the pairing as connected', async () => {
    const h = await setup();
    const created = await h.request(`/api/v1/conflicts/${h.conflictId}/agent/pairings`, {
      method: 'POST',
      headers: h.aliceHeaders,
      body: '{}',
    });
    const party = [...h.db.parties.values()].find(
      (candidate) => candidate.conflictId === h.conflictId && candidate.userId,
    )!;
    h.db.parties.set(party.id, { ...party, agentId: null });

    const exchange = await h.request('/api/v1/agent-pairings/exchange', {
      method: 'POST',
      body: JSON.stringify({ code: created.body.code, client_name: 'Codex repair test' }),
    });
    expect(exchange.response.status).toBe(200);
    const tasks = await h.request('/api/v1/agent/tasks', {
      headers: { authorization: `Bearer ${exchange.body.credential}` },
    });
    expect(tasks.body.tasks.map((task: any) => task.conflict_id)).toContain(h.conflictId);
    expect((await h.db.findPartyForAgent(h.conflictId, created.body.agent.id))?.id).toBe(party.id);
  });

  it('publishes a vendor-neutral discovery document without secrets', async () => {
    const h = await setup();
    const response = await h.app.request(
      'http://resolveroom.test/.well-known/resolveroom-agent.json',
    );
    expect(response.status).toBe(200);
    const manifest = (await response.json()) as any;
    expect(manifest.pairing).toMatchObject({ single_use: true, code_ttl_seconds: 600 });
    expect(manifest.cli).toMatchObject({
      distribution: 'resolveroom-origin',
      version: '0.1.4',
      bootstrap_url: 'http://resolveroom.test/agent/bootstrap.mjs',
      bundle_url: 'http://resolveroom.test/agent/resolveroom.mjs',
    });
    expect(manifest.cli.bootstrap_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(manifest.cli.bundle_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(manifest.cli.pair).toContain('<NODE_EXECUTABLE>');
    expect(manifest.cli.codex_app).toMatchObject({
      runtime_tool: 'load_workspace_dependencies',
      node_field: 'node executable',
      environment: expect.stringContaining('package registry'),
      execution: {
        tool: 'exec_command',
        sandbox_permissions: 'require_escalated',
        network_access: 'required',
        allowed_origin: 'http://resolveroom.test',
        justification: expect.stringContaining('resolveroom.test'),
      },
    });
    expect(manifest.cli.codex_app.connect_arguments).toContain('connect');
    expect(manifest.cli.codex_app.reconnect_arguments).toContain('runner');
    expect(manifest.cli.codex_app.reconnect_arguments).toContain('reconnect');
    expect(JSON.stringify(manifest)).not.toContain('github.com');
    expect(JSON.stringify(manifest)).not.toContain('registry.npmjs.org');
    expect(JSON.stringify(manifest)).not.toContain('rr_agent_');
  });
});
