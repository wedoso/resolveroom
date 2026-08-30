const baseUrl = (process.env.RESOLVEROOM_URL ?? 'http://localhost:8787').replace(/\/$/, '');
const request = async (path: string, init: RequestInit = {}) => {
  const response = await fetch(`${baseUrl}/api/v1${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
  return response.status === 204 ? null : (response.json() as Promise<any>);
};
const signIn = async (name: string) =>
  request('/auth/development', {
    method: 'POST',
    body: JSON.stringify({ email: `${name.toLowerCase()}@resolveroom.local`, display_name: name }),
  });

export async function seedDemo() {
  const alice = (await signIn('Alice')).user;
  const bob = (await signIn('Bob')).user;
  const ah = { 'x-dev-user-id': alice.id },
    bh = { 'x-dev-user-id': bob.id };
  const created = await request('/conflicts', {
    method: 'POST',
    headers: ah,
    body: JSON.stringify({
      title: 'Tokyo vs Vancouver',
      description: 'Where should the team hold its next offsite, and why?',
      protocol_type: 'debate',
      max_rounds: 3,
      resolution_mode: 'judge',
    }),
  });
  const id = created.conflict.id;
  const invite = await request(`/conflicts/${id}/invite`, {
    method: 'POST',
    headers: ah,
    body: '{}',
  });
  const inviteToken = invite.invite.url.split('/').at(-1);
  await request(`/invites/${inviteToken}/accept`, { method: 'POST', headers: bh, body: '{}' });
  const agentA = (
    await request('/agents', { method: 'POST', headers: ah, body: '{"name":"Alice Demo Agent"}' })
  ).agent;
  const agentB = (
    await request('/agents', { method: 'POST', headers: bh, body: '{"name":"Bob Demo Agent"}' })
  ).agent;
  const tokenA = (
    await request(`/agents/${agentA.id}/tokens`, { method: 'POST', headers: ah, body: '{}' })
  ).token;
  const tokenB = (
    await request(`/agents/${agentB.id}/tokens`, { method: 'POST', headers: bh, body: '{}' })
  ).token;
  await request(`/conflicts/${id}/agent`, {
    method: 'POST',
    headers: ah,
    body: JSON.stringify({ agent_id: agentA.id }),
  });
  await request(`/conflicts/${id}/agent`, {
    method: 'POST',
    headers: bh,
    body: JSON.stringify({ agent_id: agentB.id }),
  });
  await request(`/conflicts/${id}/brief`, {
    method: 'PUT',
    headers: ah,
    body: JSON.stringify({
      goal: 'Advocate Tokyo',
      priorities: ['Global participation', 'Team experience'],
      acceptableCompromises: ['Vancouver if total cost is over 40% lower'],
      privateNotes: 'Keep the recommendation practical.',
    }),
  });
  await request(`/conflicts/${id}/brief`, {
    method: 'PUT',
    headers: bh,
    body: JSON.stringify({
      goal: 'Advocate Vancouver',
      priorities: ['Budget predictability', 'Travel time'],
      acceptableCompromises: [],
      privateNotes: 'Ask for evidence behind cost claims.',
    }),
  });
  await request(`/conflicts/${id}/ready`, { method: 'POST', headers: ah, body: '{"ready":true}' });
  await request(`/conflicts/${id}/ready`, { method: 'POST', headers: bh, body: '{"ready":true}' });
  return {
    baseUrl,
    conflictId: id,
    alice,
    bob,
    agentA,
    agentB,
    tokenA: tokenA.value,
    tokenB: tokenB.value,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seedDemo()
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
