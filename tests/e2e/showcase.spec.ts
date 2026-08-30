import { spawn, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import { expect, test, type APIRequestContext } from '@playwright/test';

const origin = 'http://127.0.0.1:4199';
const agentCli = resolve('scripts/resolveroom-agent.mjs');
const runners: ChildProcess[] = [];
const headers = (id: string) => ({ 'x-dev-user-id': id });

async function body(response: any) {
  expect(response.ok(), `${response.status()} ${await response.text()}`).toBeTruthy();
  return response.json();
}

async function user(request: APIRequestContext, name: string, suffix: string) {
  return (
    await body(
      await request.post('/api/v1/auth/development', {
        data: { email: `${name}.${suffix}@example.test`, display_name: name },
      }),
    )
  ).user;
}

function startRunner(token: string) {
  const child = spawn(process.execPath, [agentCli, 'runner', 'start', '--origin', origin], {
    detached: process.platform !== 'win32',
    env: {
      ...process.env,
      AGENT_TOKEN: token,
      RESOLVEROOM_RUNNER_PROVIDER: 'mock',
      RESOLVEROOM_RUNNER_MOCK_DELAY_MS: '1150',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (process.env.DEBUG_RUNNER === '1') {
    child.stdout?.on('data', (chunk) => process.stdout.write(`[runner] ${chunk}`));
    child.stderr?.on('data', (chunk) => process.stderr.write(`[runner] ${chunk}`));
  }
  runners.push(child);
}

async function stopRunners() {
  for (const child of runners) {
    if (!child.pid || child.exitCode !== null || child.signalCode !== null) continue;
    try {
      if (process.platform === 'win32') child.kill('SIGTERM');
      else process.kill(-child.pid, 'SIGTERM');
    } catch (error: any) {
      if (error?.code !== 'ESRCH') throw error;
    }
  }
}

test.afterEach(async () => stopRunners());

test('two online Runners complete a server-triggered debate while the browser observes', async ({
  browser,
  browserName,
  request,
}) => {
  test.skip(browserName !== 'chromium', 'The recorded showcase uses one deterministic browser.');
  const suffix = `showcase-${Date.now()}-${crypto.randomUUID()}`;
  const alice = await user(request, 'Alice', suffix);
  const bob = await user(request, 'Bob', suffix);
  const created = await body(
    await request.post('/api/v1/conflicts', {
      headers: headers(alice.id),
      data: {
        title: 'Tokyo or Vancouver for the team offsite?',
        description:
          'Balance participation, travel time, budget, and a decision the whole team can support.',
        protocol_type: 'debate',
        max_rounds: 3,
        resolution_mode: 'judge',
      },
    }),
  );
  const conflictId = created.conflict.id;
  const invitation = await body(
    await request.post(`/api/v1/conflicts/${conflictId}/invite`, {
      headers: headers(alice.id),
      data: {},
    }),
  );
  await body(
    await request.post(`/api/v1/invites/${invitation.invite.url.split('/').at(-1)}/accept`, {
      headers: headers(bob.id),
      data: {},
    }),
  );
  await body(
    await request.put(`/api/v1/conflicts/${conflictId}/brief`, {
      headers: headers(alice.id),
      data: {
        goal: 'Recommend Tokyo while acknowledging cost tradeoffs.',
        priorities: ['Participation', 'Team energy'],
        acceptableCompromises: ['Vancouver if the budget difference is material'],
        privateNotes: 'Do not reveal this private recording marker.',
      },
    }),
  );
  await body(
    await request.put(`/api/v1/conflicts/${conflictId}/brief`, {
      headers: headers(bob.id),
      data: {
        goal: 'Recommend Vancouver with concrete budget reasoning.',
        priorities: ['Budget', 'Travel simplicity'],
        acceptableCompromises: ['Tokyo if attendance is measurably higher'],
        privateNotes: 'Do not reveal this private recording marker either.',
      },
    }),
  );

  const pairingA = await body(
    await request.post(`/api/v1/conflicts/${conflictId}/agent/pairings`, {
      headers: headers(alice.id),
      data: { agent_name: 'Alice local Codex' },
    }),
  );
  const pairingB = await body(
    await request.post(`/api/v1/conflicts/${conflictId}/agent/pairings`, {
      headers: headers(bob.id),
      data: { agent_name: 'Bob local Codex' },
    }),
  );
  const credentialA = await body(
    await request.post('/api/v1/agent-pairings/exchange', {
      data: { code: pairingA.code, client_name: 'Alice showcase Runner' },
    }),
  );
  const credentialB = await body(
    await request.post('/api/v1/agent-pairings/exchange', {
      data: { code: pairingB.code, client_name: 'Bob showcase Runner' },
    }),
  );
  startRunner(credentialA.credential);
  startRunner(credentialB.credential);

  await expect
    .poll(
      async () => {
        const agents = await body(
          await request.get('/api/v1/agents', { headers: headers(alice.id) }),
        );
        return agents.agents.find((agent: any) => agent.id === credentialA.agent.id)?.runner?.state;
      },
      { timeout: 20_000 },
    )
    .toBe('online');
  await expect
    .poll(
      async () => {
        const agents = await body(
          await request.get('/api/v1/agents', { headers: headers(bob.id) }),
        );
        return agents.agents.find((agent: any) => agent.id === credentialB.agent.id)?.runner?.state;
      },
      { timeout: 20_000 },
    )
    .toBe('online');

  const record = process.env.RECORD_SHOWCASE === '1';
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    ...(record
      ? { recordVideo: { dir: test.info().outputDir, size: { width: 1440, height: 900 } } }
      : {}),
  });
  const page = await context.newPage();
  await page.request.post('/api/v1/auth/development', {
    data: { email: alice.email, display_name: alice.displayName },
  });
  await page.goto(`/conflicts/${conflictId}`);
  await expect(page.getByText('RUNNER ONLINE')).toBeVisible();
  await page.waitForTimeout(1_200);
  await page.getByRole('button', { name: 'I’m ready' }).click();
  await body(
    await request.post(`/api/v1/conflicts/${conflictId}/ready`, {
      headers: headers(bob.id),
      data: { ready: true },
    }),
  );
  await expect(page.getByText('Runner is working')).toBeVisible({ timeout: 10_000 });
  await expect(
    page.getByText(/A concise argument grounded in the shared case record/).first(),
  ).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(1_000);
  await expect(page.getByText('resolved', { exact: true })).toBeVisible({ timeout: 25_000 });
  await page.getByRole('tab', { name: 'verdict' }).click();
  await expect(page.getByText('AI-GENERATED ADVISORY ASSESSMENT')).toBeVisible();
  await page.waitForTimeout(1_800);

  const video = page.video();
  await context.close();
  if (record && video) await video.saveAs(resolve('docs/assets/resolveroom-e2e-recording.webm'));
});
