import { describe, expect, it } from 'vitest';
import { createApi } from '@/api/app';
import { MemoryDatabase } from '@/persistence/memory';

async function harness() {
  const db = new MemoryDatabase();
  const app = createApi(db, { allowDevelopmentAuth: true, appUrl: 'http://test' });
  const request = async (path: string, init: RequestInit = {}) => {
    const response = await app.request(`http://test${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
    });
    return { response, body: response.status === 204 ? null : ((await response.json()) as any) };
  };
  const makeUser = async (name: string) =>
    (
      await request('/api/v1/auth/development', {
        method: 'POST',
        body: JSON.stringify({ email: `${name}@test`, display_name: name }),
      })
    ).body.user;
  const alice = await makeUser('alice'),
    bob = await makeUser('bob'),
    mallory = await makeUser('mallory');
  const ah = { 'x-dev-user-id': alice.id },
    bh = { 'x-dev-user-id': bob.id },
    mh = { 'x-dev-user-id': mallory.id };
  const created = await request('/api/v1/conflicts', {
    method: 'POST',
    headers: ah,
    body: JSON.stringify({
      title: 'Private case',
      description: 'A private disagreement.',
      protocol_type: 'debate',
      max_rounds: 3,
    }),
  });
  const id = created.body.conflict.id;
  const invite = await request(`/api/v1/conflicts/${id}/invite`, {
    method: 'POST',
    headers: ah,
    body: '{}',
  });
  await request(`/api/v1/invites/${invite.body.invite.url.split('/').at(-1)}/accept`, {
    method: 'POST',
    headers: bh,
    body: '{}',
  });
  const a = (
    await request('/api/v1/agents', { method: 'POST', headers: ah, body: '{"name":"A Agent"}' })
  ).body.agent;
  const b = (
    await request('/api/v1/agents', { method: 'POST', headers: bh, body: '{"name":"B Agent"}' })
  ).body.agent;
  const ta = (
    await request(`/api/v1/agents/${a.id}/tokens`, { method: 'POST', headers: ah, body: '{}' })
  ).body.token;
  const tb = (
    await request(`/api/v1/agents/${b.id}/tokens`, { method: 'POST', headers: bh, body: '{}' })
  ).body.token;
  await request(`/api/v1/conflicts/${id}/agent`, {
    method: 'POST',
    headers: ah,
    body: JSON.stringify({ agent_id: a.id }),
  });
  await request(`/api/v1/conflicts/${id}/agent`, {
    method: 'POST',
    headers: bh,
    body: JSON.stringify({ agent_id: b.id }),
  });
  await request(`/api/v1/conflicts/${id}/brief`, {
    method: 'PUT',
    headers: ah,
    body: JSON.stringify({
      goal: 'A goal',
      priorities: [],
      acceptableCompromises: [],
      privateNotes: 'SECRET_A',
    }),
  });
  await request(`/api/v1/conflicts/${id}/brief`, {
    method: 'PUT',
    headers: bh,
    body: JSON.stringify({
      goal: 'B goal',
      priorities: [],
      acceptableCompromises: [],
      privateNotes: 'SECRET_B',
    }),
  });
  return { db, request, alice, bob, mallory, ah, bh, mh, id, a, b, ta, tb };
}

describe('privacy and authorization', () => {
  it('allows only the owner to edit setup, resets readiness, and locks after starting', async () => {
    const h = await harness();
    const settings = {
      max_rounds: 5,
      description: 'Shared constraints for both agents.',
      resolution_mode: 'judge',
    };
    for (const [headers, status] of [
      [h.bh, 403],
      [h.mh, 404],
      [{ Authorization: `Bearer ${h.ta.value}` }, 401],
    ] as const) {
      expect(
        (
          await h.request(`/api/v1/conflicts/${h.id}/settings`, {
            method: 'PUT',
            headers,
            body: JSON.stringify(settings),
          })
        ).response.status,
      ).toBe(status);
    }
    await h.request(`/api/v1/conflicts/${h.id}/ready`, {
      method: 'POST',
      headers: h.ah,
      body: '{}',
    });
    const changed = await h.request(`/api/v1/conflicts/${h.id}/settings`, {
      method: 'PUT',
      headers: h.ah,
      body: JSON.stringify(settings),
    });
    expect(changed.response.status).toBe(200);
    expect(changed.body.conflict.maxRounds).toBe(5);
    expect((await h.db.getParties(h.id)).every((party) => !party.ready)).toBe(true);
    for (const headers of [
      h.ah,
      h.bh,
      { Authorization: `Bearer ${h.ta.value}` },
      { Authorization: `Bearer ${h.tb.value}` },
    ]) {
      const response = await h.request(`/api/v1/conflicts/${h.id}`, { headers });
      expect(response.body.description).toBe(settings.description);
      expect(response.body.max_rounds).toBe(5);
      expect(JSON.stringify(response.body)).not.toContain('SECRET_');
    }
    for (const headers of [h.ah, h.bh])
      await h.request(`/api/v1/conflicts/${h.id}/ready`, { method: 'POST', headers, body: '{}' });
    expect(
      (
        await h.request(`/api/v1/conflicts/${h.id}/settings`, {
          method: 'PUT',
          headers: h.ah,
          body: JSON.stringify({ ...settings, max_rounds: 10 }),
        })
      ).response.status,
    ).toBe(409);
  });
  it.each([2, 11, 4.5, '5'])(
    'rejects invalid round count %s at the HTTP boundary',
    async (rounds) => {
      const h = await harness();
      expect(
        (
          await h.request('/api/v1/conflicts', {
            method: 'POST',
            headers: h.ah,
            body: JSON.stringify({
              title: 'Invalid rounds',
              description: 'Shared background',
              protocol_type: 'debate',
              max_rounds: rounds,
            }),
          })
        ).response.status,
      ).toBe(422);
    },
  );
  it('never returns an opponent brief even when a party_id query is supplied', async () => {
    const h = await harness();
    const a = await h.request(`/api/v1/conflicts/${h.id}/brief?party_id=party_b`, {
      headers: h.ah,
    });
    const b = await h.request(`/api/v1/conflicts/${h.id}/brief?party_id=party_a`, {
      headers: h.bh,
    });
    expect(JSON.stringify(a.body)).toContain('SECRET_A');
    expect(JSON.stringify(a.body)).not.toContain('SECRET_B');
    expect(JSON.stringify(b.body)).toContain('SECRET_B');
    expect(JSON.stringify(b.body)).not.toContain('SECRET_A');
  });
  it('isolates agents, observers and unrelated participants', async () => {
    const h = await harness();
    const agentA = await h.request(`/api/v1/conflicts/${h.id}/brief?party_id=party_b`, {
      headers: { Authorization: `Bearer ${h.ta.value}` },
    });
    expect(JSON.stringify(agentA.body)).toContain('SECRET_A');
    expect(JSON.stringify(agentA.body)).not.toContain('SECRET_B');
    expect((await h.request(`/api/v1/conflicts/${h.id}`, { headers: h.mh })).response.status).toBe(
      404,
    );
    const shared = await h.request(`/api/v1/conflicts/${h.id}/share-links`, {
      method: 'POST',
      headers: h.ah,
      body: '{}',
    });
    const shareToken = shared.body.share_link.url.split('/').at(-1);
    expect(
      (
        await h.request(`/api/v1/conflicts/${h.id}/brief`, {
          headers: { Authorization: `Bearer ${shareToken}` },
        })
      ).response.status,
    ).toBe(401);
    expect(JSON.stringify((await h.request(`/api/v1/share/${shareToken}`)).body)).not.toMatch(
      /SECRET_A|SECRET_B/,
    );
  });
  it('revokes an agent token immediately', async () => {
    const h = await harness();
    expect(
      (
        await h.request('/api/v1/agent/tasks', {
          headers: { Authorization: `Bearer ${h.ta.value}` },
        })
      ).response.status,
    ).toBe(200);
    expect(
      (
        await h.request(`/api/v1/agents/${h.a.id}/tokens/${h.ta.id}`, {
          method: 'DELETE',
          headers: h.ah,
        })
      ).response.status,
    ).toBe(204);
    expect(
      (
        await h.request('/api/v1/agent/tasks', {
          headers: { Authorization: `Bearer ${h.ta.value}` },
        })
      ).response.status,
    ).toBe(401);
  });
  it('prevents one bound agent from acting for the other party', async () => {
    const h = await harness();
    await h.request(`/api/v1/conflicts/${h.id}/ready`, {
      method: 'POST',
      headers: h.ah,
      body: '{"ready":true}',
    });
    await h.request(`/api/v1/conflicts/${h.id}/ready`, {
      method: 'POST',
      headers: h.bh,
      body: '{"ready":true}',
    });
    const tasks = (
      await h.request('/api/v1/agent/tasks', { headers: { Authorization: `Bearer ${h.ta.value}` } })
    ).body.tasks;
    const task = tasks.find((t: any) => t.conflict_id === h.id);
    if (task.your_turn) {
      await h.request(`/api/v1/conflicts/${h.id}/actions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${h.ta.value}` },
        body: '{"action_type":"argument","content":"A","client_request_id":"authz-turn-a"}',
      });
    }
    const wrong = await h.request(`/api/v1/conflicts/${h.id}/actions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${h.ta.value}` },
      body: '{"action_type":"argument","content":"Pretend B","client_request_id":"authz-wrong-party"}',
    });
    expect(wrong.response.status).toBe(409);
    expect(wrong.body.error.code).toBe('NOT_YOUR_TURN');
  });
  it('revokes an unused invitation immediately', async () => {
    const h = await harness();
    const created = await h.request('/api/v1/conflicts', {
      method: 'POST',
      headers: h.ah,
      body: JSON.stringify({
        title: 'Revocable invite',
        description: 'Verify invitation lifecycle revocation.',
        protocol_type: 'debate',
        max_rounds: 3,
      }),
    });
    const conflictId = created.body.conflict.id;
    const createdInvite = await h.request(`/api/v1/conflicts/${conflictId}/invite`, {
      method: 'POST',
      headers: h.ah,
      body: '{}',
    });
    const inviteId = createdInvite.body.invite.id;
    const token = createdInvite.body.invite.url.split('/').at(-1);
    expect(
      (
        await h.request(`/api/v1/conflicts/${conflictId}/invites/${inviteId}`, {
          method: 'DELETE',
          headers: h.ah,
        })
      ).response.status,
    ).toBe(204);
    const accepted = await h.request(`/api/v1/invites/${token}/accept`, {
      method: 'POST',
      headers: h.bh,
      body: '{}',
    });
    expect(accepted.response.status).toBe(410);
    expect(accepted.body.error.code).toBe('INVITE_EXPIRED');
  });
  it('anonymizes a deleted principal without corrupting the shared case record', async () => {
    const h = await harness();
    await h.db.anonymizeUser(h.alice.id);
    const deleted = await h.db.getUser(h.alice.id);
    expect(deleted?.displayName).toBe('Deleted participant');
    expect(deleted?.deletedAt).not.toBeNull();
    expect((await h.db.getConflict(h.id))?.id).toBe(h.id);
    expect(
      (await h.db.getParties(h.id)).find((party) => party.userId === h.alice.id),
    ).toBeDefined();
    expect(h.db.tokens.get(h.ta.id)?.revokedAt).not.toBeNull();
  });
  it('allows only one concurrent acceptance of a single-use invitation', async () => {
    const h = await harness();
    const created = await h.request('/api/v1/conflicts', {
      method: 'POST',
      headers: h.ah,
      body: JSON.stringify({
        title: 'Single-use invite',
        description: 'Only one participant may claim this invitation.',
        protocol_type: 'debate',
        max_rounds: 3,
      }),
    });
    const conflictId = created.body.conflict.id;
    const invitation = await h.request(`/api/v1/conflicts/${conflictId}/invite`, {
      method: 'POST',
      headers: h.ah,
      body: '{}',
    });
    const token = invitation.body.invite.url.split('/').at(-1);
    const attempts = await Promise.all([
      h.request(`/api/v1/invites/${token}/accept`, { method: 'POST', headers: h.bh, body: '{}' }),
      h.request(`/api/v1/invites/${token}/accept`, { method: 'POST', headers: h.mh, body: '{}' }),
    ]);
    expect(attempts.map((value) => value.response.status).sort()).toEqual([200, 409]);
  });
});
