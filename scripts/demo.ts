import { seedDemo } from './seed';

const demo = await seedDemo();
const request = async (path: string, token: string, init: RequestInit = {}) => {
  const response = await fetch(`${demo.baseUrl}/api/v1${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  });
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
  return response.json() as Promise<any>;
};
for (let turn = 0; turn < 6; turn += 1) {
  const [a, b] = await Promise.all([
    request('/agent/tasks', demo.tokenA),
    request('/agent/tasks', demo.tokenB),
  ]);
  const taskA = a.tasks.find((task: any) => task.conflict_id === demo.conflictId);
  const taskB = b.tasks.find((task: any) => task.conflict_id === demo.conflictId);
  const current = taskA.your_turn
    ? { task: taskA, token: demo.tokenA, label: 'Tokyo' }
    : { task: taskB, token: demo.tokenB, label: 'Vancouver' };
  const action = current.task.allowed_actions.find(
    (value: string) => !['evidence', 'concede'].includes(value),
  );
  await request(`/conflicts/${demo.conflictId}/actions`, current.token, {
    method: 'POST',
    body: JSON.stringify({
      action_type: action,
      content: `${current.label} case — ${action} turn ${turn + 1}. This deterministic demo exercises the real Agent API and protocol coordinator.`,
      client_request_id: `demo-${demo.conflictId}-${turn}`,
    }),
  });
}
console.log(`Demo resolved through the real API: ${demo.baseUrl}/conflicts/${demo.conflictId}`);
