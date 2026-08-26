import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext } from '@playwright/test';

const headers = (id: string) => ({ 'x-dev-user-id': id });
const unique = () => `${Date.now()}-${crypto.randomUUID()}`;
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
async function completeConflict(request: APIRequestContext, suffix: string, turnCount = 6) {
  const alice = await user(request, 'Alice', suffix);
  const bob = await user(request, 'Bob', suffix);
  const created = await body(
    await request.post('/api/v1/conflicts', {
      headers: headers(alice.id),
      data: {
        title: `Tokyo vs Vancouver ${suffix}`,
        description: 'Where should the team hold its next offsite, and why?',
        protocol_type: 'debate',
        max_rounds: 3,
      },
    }),
  );
  const id = created.conflict.id;
  const invitation = await body(
    await request.post(`/api/v1/conflicts/${id}/invite`, { headers: headers(alice.id), data: {} }),
  );
  const token = invitation.invite.url.split('/').at(-1);
  await body(
    await request.post(`/api/v1/invites/${token}/accept`, { headers: headers(bob.id), data: {} }),
  );
  const agentA = (
    await body(
      await request.post('/api/v1/agents', {
        headers: headers(alice.id),
        data: { name: 'Alice Browser Agent' },
      }),
    )
  ).agent;
  const agentB = (
    await body(
      await request.post('/api/v1/agents', {
        headers: headers(bob.id),
        data: { name: 'Bob Browser Agent' },
      }),
    )
  ).agent;
  const tokenA = (
    await body(
      await request.post(`/api/v1/agents/${agentA.id}/tokens`, {
        headers: headers(alice.id),
        data: {},
      }),
    )
  ).token;
  const tokenB = (
    await body(
      await request.post(`/api/v1/agents/${agentB.id}/tokens`, {
        headers: headers(bob.id),
        data: {},
      }),
    )
  ).token;
  await body(
    await request.post(`/api/v1/conflicts/${id}/agent`, {
      headers: headers(alice.id),
      data: { agent_id: agentA.id },
    }),
  );
  await body(
    await request.post(`/api/v1/conflicts/${id}/agent`, {
      headers: headers(bob.id),
      data: { agent_id: agentB.id },
    }),
  );
  await body(
    await request.put(`/api/v1/conflicts/${id}/brief`, {
      headers: headers(alice.id),
      data: {
        goal: 'Advocate Tokyo',
        priorities: ['Participation'],
        acceptableCompromises: [],
        privateNotes: `ALICE_SECRET_${suffix}`,
      },
    }),
  );
  await body(
    await request.put(`/api/v1/conflicts/${id}/brief`, {
      headers: headers(bob.id),
      data: {
        goal: 'Advocate Vancouver',
        priorities: ['Budget'],
        acceptableCompromises: [],
        privateNotes: `BOB_SECRET_${suffix}`,
      },
    }),
  );
  await body(
    await request.post(`/api/v1/conflicts/${id}/ready`, {
      headers: headers(alice.id),
      data: { ready: true },
    }),
  );
  await body(
    await request.post(`/api/v1/conflicts/${id}/ready`, {
      headers: headers(bob.id),
      data: { ready: true },
    }),
  );
  const authA = { Authorization: `Bearer ${tokenA.value}` };
  const authB = { Authorization: `Bearer ${tokenB.value}` };
  for (let turn = 0; turn < turnCount; turn += 1) {
    const tasksA = await body(await request.get('/api/v1/agent/tasks', { headers: authA }));
    const tasksB = await body(await request.get('/api/v1/agent/tasks', { headers: authB }));
    const a = tasksA.tasks.find((task: any) => task.conflict_id === id);
    const b = tasksB.tasks.find((task: any) => task.conflict_id === id);
    const current = a.your_turn
      ? { task: a, headers: authA, label: 'A' }
      : { task: b, headers: authB, label: 'B' };
    await body(
      await request.post(`/api/v1/conflicts/${id}/actions`, {
        headers: current.headers,
        data: {
          action_type: current.task.allowed_actions[0],
          content: `${current.label} presents a detailed ${current.task.phase} case for the browser release test.`,
          client_request_id: `browser-${suffix}-${turn}`,
        },
      }),
    );
  }
  return {
    alice,
    bob,
    id,
    agentA,
    agentB,
    tokenA,
    tokenB,
    authA,
    authB,
    ah: headers(alice.id),
    bh: headers(bob.id),
    secrets: [`ALICE_SECRET_${suffix}`, `BOB_SECRET_${suffix}`],
  };
}

test('operational endpoints and browser security policy are deployment-ready', async ({
  request,
}) => {
  const health = await request.get('/health');
  expect(await health.json()).toEqual({ status: 'ok', service: 'resolveroom' });
  const specification = await body(await request.get('/openapi.json'));
  expect(specification.openapi).toBe('3.1.0');
  expect(Object.keys(specification.paths).length).toBeGreaterThanOrEqual(30);
  expect(specification.servers).toEqual([{ url: '/api/v1' }]);
  expect(specification.paths['/agent-pairings/exchange']).toBeTruthy();
  const discovery = await body(await request.get('/.well-known/resolveroom-agent.json'));
  expect(discovery.pairing).toMatchObject({ single_use: true, code_ttl_seconds: 600 });
  expect(JSON.stringify(discovery)).not.toContain('rr_agent_');
  const document = await request.get('/');
  const csp = document.headers()['content-security-policy'];
  expect(csp).toContain("default-src 'self'");
  expect(csp).toContain("object-src 'none'");
  expect(csp).not.toContain("'unsafe-inline'");
  expect(document.headers()['x-frame-options']).toBe('DENY');
  expect(await document.text()).toContain('noindex,nofollow');
});

test('landing and conflict creation are polished and functional', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Give your side to your agent/ })).toBeVisible();
  await page.getByRole('link', { name: 'Create a conflict', exact: true }).first().click();
  await page.getByLabel('Display name').fill('Alice UI');
  await page.getByLabel('Email address').fill(`alice.ui.${unique()}@example.test`);
  await page.getByRole('button', { name: 'Continue securely' }).click();
  await page.getByRole('link', { name: 'New conflict' }).click();
  await page.getByLabel('Conflict title').fill('Tokyo vs Vancouver UI');
  await page.getByLabel('Question or context').fill('Where should the team hold its next offsite?');
  await page.getByRole('button', { name: 'Create conflict' }).click();
  await expect(page.getByRole('heading', { name: 'Invite the other participant' })).toBeVisible();
  await expect(page.getByText('Private invitation link')).toBeVisible();
});

test('a participant authorizes the Runner from the conflict with one short-lived instruction', async ({
  page,
  request,
}) => {
  const suffix = unique();
  const signedIn = await body(
    await page.request.post('/api/v1/auth/development', {
      data: { email: `pairing.ui.${suffix}@example.test`, display_name: 'Pairing UI' },
    }),
  );
  const created = await body(
    await page.request.post('/api/v1/conflicts', {
      data: {
        title: `One-instruction pairing ${suffix}`,
        description: 'Connect Codex without copying a long-lived credential.',
        protocol_type: 'debate',
        max_rounds: 3,
      },
    }),
  );

  await page.goto(`/conflicts/${created.conflict.id}`);
  await expect(page.getByText('YOUR REPRESENTATIVE')).toBeVisible();
  await page.getByRole('button', { name: 'Connect Runner' }).click();
  await expect(page.getByRole('heading', { name: 'Connect your Runner' })).toBeVisible();
  await expect(page.getByText('ONE-TIME PAIRING CODE')).toBeVisible();
  const code = (await page.locator('.pairing-code strong').textContent())?.trim();
  expect(code).toMatch(/^[A-HJ-NP-Z2-9]{4}(?:-[A-HJ-NP-Z2-9]{4}){2}$/);
  await expect(
    page.getByRole('button', { name: 'Copy one-time connection instruction' }),
  ).toBeVisible();
  await expect(page.getByText(/works once, expires in ten minutes/)).toBeVisible();
  const accessibility = await new AxeBuilder({ page }).include('.dialog').analyze();
  const serious = accessibility.violations.filter((violation) =>
    ['serious', 'critical'].includes(violation.impact ?? ''),
  );
  expect(serious, serious.map((item) => `${item.id}: ${item.help}`).join('\n')).toEqual([]);

  const exchanged = await body(
    await request.post('/api/v1/agent-pairings/exchange', {
      data: { code, client_name: 'Codex browser E2E' },
    }),
  );
  expect(exchanged.credential).toMatch(/^rr_agent_/);
  expect(
    (
      await request.post('/api/v1/agent-pairings/exchange', {
        data: { code, client_name: 'Replay attempt' },
      })
    ).status(),
  ).toBe(404);

  await expect(page.getByRole('heading', { name: 'Starting local Runner' })).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByText('Authorization complete')).toBeVisible();
  expect(await page.locator('body').textContent()).not.toContain(exchanged.credential);
  expect(signedIn.user.displayName).toBe('Pairing UI');
});

test('an idle agent can be deleted through the guarded developer flow', async ({ page }) => {
  const suffix = unique();
  const signedIn = await body(
    await page.request.post('/api/v1/auth/development', {
      data: { email: `delete.ui.${suffix}@example.test`, display_name: 'Delete UI' },
    }),
  );
  const agent = await body(
    await page.request.post('/api/v1/agents', {
      headers: headers(signedIn.user.id),
      data: { name: `Disposable Agent ${suffix}` },
    }),
  );
  await page.goto('/agents');
  await expect(page.getByRole('heading', { name: agent.agent.name })).toBeVisible();
  await page.getByText('Developer options').click();
  await page.getByRole('button', { name: 'Delete agent' }).click();
  await expect(page.getByRole('heading', { name: `Delete ${agent.agent.name}?` })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete agent' }).click();
  await expect(page.getByRole('heading', { name: agent.agent.name })).toHaveCount(0);
});

test('complete debate persists and renders a polished verdict', async ({ page, request }) => {
  const flow = await completeConflict(request, `debate-${unique()}`);
  await page.request.post('/api/v1/auth/development', {
    data: { email: flow.alice.email, display_name: flow.alice.displayName },
  });
  await page.goto(`/conflicts/${flow.id}`);
  await expect(page.getByRole('heading', { name: new RegExp(`Tokyo vs Vancouver`) })).toBeVisible();
  await expect(page.getByText('resolved', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'verdict' }).click();
  await expect(page.getByText('AI-GENERATED ADVISORY ASSESSMENT')).toBeVisible();
  await expect(page.getByText(/presented the stronger case/)).toBeVisible();
  await expect(page.getByText(/Advisory and non-binding/)).toBeVisible();
  await page.reload();
  await expect(page.getByText('resolved', { exact: true })).toBeVisible();
  await expect(page.getByText(/Connected|Reconnecting/)).toBeVisible();
});

test('realtime mutation reaches the participant and reconnect recovers history', async ({
  page,
  request,
}) => {
  const flow = await completeConflict(request, `realtime-${unique()}`, 0);
  await page.request.post('/api/v1/auth/development', {
    data: { email: flow.alice.email, display_name: flow.alice.displayName },
  });
  await page.goto(`/conflicts/${flow.id}`);
  await expect(page.getByText('Connected', { exact: true })).toBeVisible();
  const tasksA = await body(await request.get('/api/v1/agent/tasks', { headers: flow.authA }));
  const tasksB = await body(await request.get('/api/v1/agent/tasks', { headers: flow.authB }));
  const a = tasksA.tasks.find((task: any) => task.conflict_id === flow.id);
  const b = tasksB.tasks.find((task: any) => task.conflict_id === flow.id);
  const current = a.your_turn ? { task: a, headers: flow.authA } : { task: b, headers: flow.authB };
  await body(
    await request.post(`/api/v1/conflicts/${flow.id}/actions`, {
      headers: current.headers,
      data: {
        action_type: current.task.allowed_actions[0],
        content: 'Realtime event reached the participant without a page refresh.',
        client_request_id: `realtime-action-${unique()}`,
      },
    }),
  );
  await expect(
    page.getByText('Realtime event reached the participant without a page refresh.'),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByText('Realtime event reached the participant without a page refresh.'),
  ).toBeVisible();
});

test('private briefs, observer access and cross-conflict access are isolated', async ({
  request,
}) => {
  const flow = await completeConflict(request, `privacy-${unique()}`);
  const a = await body(
    await request.get(`/api/v1/conflicts/${flow.id}/brief?party_id=party_b`, { headers: flow.ah }),
  );
  const b = await body(
    await request.get(`/api/v1/conflicts/${flow.id}/brief?party_id=party_a`, { headers: flow.bh }),
  );
  expect(JSON.stringify(a)).toContain(flow.secrets[0]);
  expect(JSON.stringify(a)).not.toContain(flow.secrets[1]);
  expect(JSON.stringify(b)).toContain(flow.secrets[1]);
  expect(JSON.stringify(b)).not.toContain(flow.secrets[0]);
  const stranger = await user(request, 'Mallory', `privacy-${unique()}`);
  expect(
    (await request.get(`/api/v1/conflicts/${flow.id}`, { headers: headers(stranger.id) })).status(),
  ).toBe(404);
});

test('unlisted sharing is safe, read-only and immediately revocable', async ({ page, request }) => {
  const flow = await completeConflict(request, `share-${unique()}`);
  const shared = await body(
    await request.post(`/api/v1/conflicts/${flow.id}/share-links`, { headers: flow.ah, data: {} }),
  );
  const shareId = shared.share_link.id;
  const token = shared.share_link.url.split('/').at(-1);
  await page.goto(`/share/${token}`);
  await expect(page.getByText('Unlisted · Read only')).toBeVisible();
  await expect(page.getByText('SHARED CASE RECORD')).toBeVisible();
  for (const secret of flow.secrets) await expect(page.getByText(secret)).toHaveCount(0);
  expect(
    (
      await request.post(`/api/v1/conflicts/${flow.id}/pause`, {
        headers: { Authorization: `Bearer ${token}` },
        data: {},
      })
    ).status(),
  ).toBe(401);
  await request.delete(`/api/v1/conflicts/${flow.id}/share-links/${shareId}`, { headers: flow.ah });
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'This shared record is unavailable' }),
  ).toBeVisible();
});

test('revoked credential fails and mobile layouts do not overflow', async ({ page, request }) => {
  const flow = await completeConflict(request, `revoke-${unique()}`);
  expect(
    (
      await request.get('/api/v1/agent/tasks', {
        headers: { Authorization: `Bearer ${flow.tokenA.value}` },
      })
    ).status(),
  ).toBe(200);
  await request.delete(`/api/v1/agents/${flow.agentA.id}/tokens/${flow.tokenA.id}`, {
    headers: flow.ah,
  });
  expect(
    (
      await request.get('/api/v1/agent/tasks', {
        headers: { Authorization: `Bearer ${flow.tokenA.value}` },
      })
    ).status(),
  ).toBe(401);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(metrics.scrollWidth).toBe(metrics.clientWidth);
  await expect(page.getByRole('heading', { name: /Give your side to your agent/ })).toBeVisible();
});
