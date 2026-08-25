import { describe, expect, it } from 'vitest';
import { createApi } from '@/api/app';
import { MemoryDatabase } from '@/persistence/memory';

async function harness() {
  const db = new MemoryDatabase();
  const app = createApi(db, { allowDevelopmentAuth: true, appUrl: 'http://agents.test' });
  const request = async (path: string, init: RequestInit = {}) => {
    const response = await app.request(`http://agents.test${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
    });
    return { response, body: response.status === 204 ? null : ((await response.json()) as any) };
  };
  const user = (
    await request('/api/v1/auth/development', {
      method: 'POST',
      body: JSON.stringify({ email: 'owner@agents.test', display_name: 'Owner' }),
    })
  ).body.user;
  const headers = { 'x-dev-user-id': user.id };
  return { db, request, headers };
}

describe('agent lifecycle', () => {
  it('deletes an idle agent, revokes its token, and removes it from the list', async () => {
    const h = await harness();
    const agent = (
      await h.request('/api/v1/agents', {
        method: 'POST',
        headers: h.headers,
        body: JSON.stringify({ name: 'Disposable Agent' }),
      })
    ).body.agent;
    const token = (
      await h.request(`/api/v1/agents/${agent.id}/tokens`, {
        method: 'POST',
        headers: h.headers,
        body: '{}',
      })
    ).body.token;
    expect(
      (
        await h.request(`/api/v1/agents/${agent.id}`, {
          method: 'DELETE',
          headers: h.headers,
        })
      ).response.status,
    ).toBe(204);
    expect((await h.request('/api/v1/agents', { headers: h.headers })).body.agents).toEqual([]);
    expect(
      (
        await h.request('/api/v1/agent/tasks', {
          headers: { authorization: `Bearer ${token.value}` },
        })
      ).response.status,
    ).toBe(401);
  });

  it('blocks deletion while the agent is assigned to an active conflict', async () => {
    const h = await harness();
    const conflict = (
      await h.request('/api/v1/conflicts', {
        method: 'POST',
        headers: h.headers,
        body: JSON.stringify({
          title: 'Protected assignment',
          description: 'An active conflict must retain its representative.',
          protocol_type: 'debate',
          max_rounds: 3,
        }),
      })
    ).body.conflict;
    const agent = (
      await h.request('/api/v1/agents', {
        method: 'POST',
        headers: h.headers,
        body: JSON.stringify({ name: 'Busy Agent' }),
      })
    ).body.agent;
    await h.request(`/api/v1/conflicts/${conflict.id}/agent`, {
      method: 'POST',
      headers: h.headers,
      body: JSON.stringify({ agent_id: agent.id }),
    });
    const stored = (await h.db.getConflict(conflict.id))!;
    await h.db.updateConflict({ ...stored, status: 'active' });

    const listed = await h.request('/api/v1/agents', { headers: h.headers });
    expect(listed.body.agents[0].deletion_blocked).toBe(true);
    const deleted = await h.request(`/api/v1/agents/${agent.id}`, {
      method: 'DELETE',
      headers: h.headers,
    });
    expect(deleted.response.status).toBe(409);
    expect(deleted.body.error.code).toBe('INVALID_STATE');
    expect((await h.db.getAgent(agent.id))?.status).toBe('active');
  });
});
