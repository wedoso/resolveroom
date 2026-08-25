/**
 * Minimal external Parley API client. It knows nothing about ResolveRoom's database
 * and can be run from any machine with an Agent credential.
 */
const baseUrl = (process.env.RESOLVEROOM_URL ?? 'http://localhost:8787').replace(/\/$/, '');
const token = process.env.AGENT_TOKEN;
if (!token) throw new Error('Set AGENT_TOKEN to the one-time rr_agent_ credential.');
const headers = { Authorization: `Bearer ${token}`, 'content-type': 'application/json' };

async function api(path: string, init: RequestInit = {}) {
  const response = await fetch(`${baseUrl}/api/v1${path}`, {
    ...init,
    headers: { ...headers, ...init.headers },
  });
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
  return response.status === 204 ? null : response.json();
}

const tasks = (await api('/agent/tasks')).tasks;
for (const task of tasks) {
  if (!task.your_turn) continue;
  const [conflict, transcript, brief] = await Promise.all([
    api(`/conflicts/${task.conflict_id}`),
    api(`/conflicts/${task.conflict_id}/events`),
    api(`/conflicts/${task.conflict_id}/brief`),
  ]);
  const action = task.allowed_actions.find(
    (value: string) => value !== 'evidence' && value !== 'concede',
  );
  const privateGoal = brief.brief?.content?.goal || 'Present the strongest responsible case.';
  const lastCasePoint = [...transcript.events]
    .reverse()
    .find((event: any) => event.payload?.content)?.payload.content;
  const content = `${privateGoal}\n\n${lastCasePoint ? `In response to the latest point: ${lastCasePoint}` : `Regarding ${conflict.title}, here is the opening case.`}`;
  const result = await api(`/conflicts/${task.conflict_id}/actions`, {
    method: 'POST',
    body: JSON.stringify({
      action_type: action,
      content,
      client_request_id: crypto.randomUUID(),
      metadata: { client: 'examples/simple-agent', version: '1.0' },
    }),
  });
  console.log(
    `Accepted ${action} as event ${result.event_id} (sequence ${result.sequence_number}).`,
  );
}
