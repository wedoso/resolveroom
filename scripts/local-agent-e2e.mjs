#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';

const repository = resolve(import.meta.dirname, '..');
const wrangler = join(repository, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const agentCli = join(repository, 'scripts', 'resolveroom-agent.mjs');
const temporaryRoot = mkdtempSync(join(tmpdir(), 'resolveroom-agent-e2e-'));
const persistence = join(temporaryRoot, 'wrangler-state');
const clientAConfig = join(temporaryRoot, 'client-a');
const clientBConfig = join(temporaryRoot, 'client-b');
let worker;
let workerLog = '';
const runners = [];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repository,
    encoding: 'utf8',
    ...options,
  });
  if (result.status !== 0) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    throw new Error(`${command} exited with ${result.status}${detail ? `:\n${detail}` : ''}`);
  }
  return result.stdout;
}

async function availablePort() {
  const server = createServer();
  await new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolvePromise);
  });
  const address = server.address();
  assert(address && typeof address === 'object', 'Could not allocate a local port.');
  const port = address.port;
  await new Promise((resolvePromise, reject) =>
    server.close((error) => (error ? reject(error) : resolvePromise())),
  );
  return port;
}

function clientEnvironment(configRoot) {
  return {
    ...process.env,
    XDG_CONFIG_HOME: configRoot,
    RESOLVEROOM_CREDENTIAL_STORE: 'file',
  };
}

function runAgent(configRoot, origin, args, input) {
  const output = run(process.execPath, [agentCli, ...args, '--origin', origin], {
    env: clientEnvironment(configRoot),
    input,
  });
  return JSON.parse(output);
}

function startAgentRunner(configRoot, origin, label) {
  const child = spawn(process.execPath, [agentCli, 'runner', 'start', '--origin', origin], {
    cwd: repository,
    detached: process.platform !== 'win32',
    env: {
      ...clientEnvironment(configRoot),
      RESOLVEROOM_RUNNER_PROVIDER: 'mock',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const value = { child, label, log: '' };
  for (const stream of [child.stdout, child.stderr])
    stream.on('data', (chunk) => {
      value.log = `${value.log}${chunk.toString()}`.slice(-8_000);
    });
  runners.push(value);
  return value;
}

async function waitForRunnerOnline(origin, headers, agentId) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const agents = await json(origin, '/agents', { headers });
    const agent = agents.agents.find((candidate) => candidate.id === agentId);
    if (agent?.runner?.online) return agent.runner;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 200));
  }
  const logs = runners.map((runner) => `${runner.label}:\n${runner.log}`).join('\n');
  throw new Error(`Runners did not report online.\n${logs}`);
}

async function waitForRunnerOffline(origin, headers, agentId) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const agents = await json(origin, '/agents', { headers });
    const agent = agents.agents.find((candidate) => candidate.id === agentId);
    if (agent?.runner && !agent.runner.online) return agent.runner;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 200));
  }
  throw new Error('The stopped Runner continued to report online.');
}

async function json(origin, path, init = {}) {
  const response = await fetch(`${origin}/api/v1${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok)
    throw new Error(`${init.method ?? 'GET'} ${path} returned ${response.status}: ${text}`);
  return body;
}

async function waitForWorker(origin) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${origin}/health`);
      if (response.ok) return;
    } catch {
      // Wrangler may not have opened its listening socket yet.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 150));
  }
  throw new Error(`Local Worker did not become healthy.\n${workerLog.slice(-4_000)}`);
}

function signalWorker(signal) {
  if (!worker?.pid) return;
  try {
    if (process.platform === 'win32') worker.kill(signal);
    else process.kill(-worker.pid, signal);
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error;
  }
}

async function waitForWorkerExit(timeoutMs) {
  if (!worker || worker.exitCode !== null || worker.signalCode !== null) return true;
  return new Promise((resolvePromise) => {
    const timer = setTimeout(() => {
      worker.off('exit', exited);
      resolvePromise(false);
    }, timeoutMs);
    const exited = () => {
      clearTimeout(timer);
      resolvePromise(true);
    };
    worker.once('exit', exited);
  });
}

async function stopWorker() {
  if (!worker || worker.exitCode !== null || worker.signalCode !== null) return;
  signalWorker('SIGTERM');
  if (await waitForWorkerExit(5_000)) return;
  signalWorker('SIGKILL');
  await waitForWorkerExit(2_000);
}

async function stopRunners() {
  for (const runner of runners) await stopRunner(runner);
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 200));
}

async function stopRunner({ child }) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolvePromise) => child.once('exit', resolvePromise));
  try {
    if (process.platform === 'win32') child.kill('SIGTERM');
    else process.kill(-child.pid, 'SIGTERM');
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error;
    return;
  }
  await Promise.race([exited, new Promise((resolvePromise) => setTimeout(resolvePromise, 3_000))]);
}

async function main() {
  const port = await availablePort();
  const origin = `http://localhost:${port}`;
  run(process.execPath, [
    wrangler,
    'd1',
    'migrations',
    'apply',
    'resolveroom',
    '--local',
    '--persist-to',
    persistence,
  ]);

  worker = spawn(
    process.execPath,
    [
      wrangler,
      'dev',
      '--local',
      '--ip',
      '127.0.0.1',
      '--port',
      String(port),
      '--persist-to',
      persistence,
      '--log-level',
      'error',
      '--var',
      'ENVIRONMENT:development',
      '--var',
      `PUBLIC_APP_URL:${origin}`,
      '--var',
      'JUDGE_PROVIDER:mock',
      '--var',
      'EMAIL_PROVIDER:console',
    ],
    { cwd: repository, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  for (const stream of [worker.stdout, worker.stderr])
    stream.on('data', (chunk) => {
      workerLog = `${workerLog}${chunk.toString()}`.slice(-12_000);
    });
  await waitForWorker(origin);

  const suffix = randomUUID();
  const alice = (
    await json(origin, '/auth/development', {
      method: 'POST',
      body: JSON.stringify({ email: `alice.${suffix}@example.test`, display_name: 'Alice' }),
    })
  ).user;
  const bob = (
    await json(origin, '/auth/development', {
      method: 'POST',
      body: JSON.stringify({ email: `bob.${suffix}@example.test`, display_name: 'Bob' }),
    })
  ).user;
  const aliceHeaders = { 'x-dev-user-id': alice.id };
  const bobHeaders = { 'x-dev-user-id': bob.id };
  const conflict = (
    await json(origin, '/conflicts', {
      method: 'POST',
      headers: aliceHeaders,
      body: JSON.stringify({
        title: 'Complete local Codex debate',
        description: 'Verify the real pairing CLI, private context, turn-taking, and resolution.',
        protocol_type: 'debate',
        max_rounds: 3,
      }),
    })
  ).conflict;
  const invitation = await json(origin, `/conflicts/${conflict.id}/invite`, {
    method: 'POST',
    headers: aliceHeaders,
    body: '{}',
  });
  const inviteToken = invitation.invite.url.split('/').at(-1);
  await json(origin, `/invites/${inviteToken}/accept`, {
    method: 'POST',
    headers: bobHeaders,
    body: '{}',
  });

  const aliceSecret = `ALICE_PRIVATE_${suffix}`;
  const bobSecret = `BOB_PRIVATE_${suffix}`;
  await json(origin, `/conflicts/${conflict.id}/brief`, {
    method: 'PUT',
    headers: aliceHeaders,
    body: JSON.stringify({
      goal: 'Recommend Tokyo',
      priorities: ['Team participation'],
      acceptableCompromises: ['Vancouver with a material cost advantage'],
      privateNotes: aliceSecret,
    }),
  });
  await json(origin, `/conflicts/${conflict.id}/brief`, {
    method: 'PUT',
    headers: bobHeaders,
    body: JSON.stringify({
      goal: 'Recommend Vancouver',
      priorities: ['Budget discipline'],
      acceptableCompromises: ['Tokyo if attendance is measurably higher'],
      privateNotes: bobSecret,
    }),
  });

  const pairingA = await json(origin, `/conflicts/${conflict.id}/agent/pairings`, {
    method: 'POST',
    headers: aliceHeaders,
    body: JSON.stringify({ agent_name: 'Alice local Codex' }),
  });
  const pairingB = await json(origin, `/conflicts/${conflict.id}/agent/pairings`, {
    method: 'POST',
    headers: bobHeaders,
    body: JSON.stringify({ agent_name: 'Bob local Codex' }),
  });
  const pairedA = runAgent(clientAConfig, origin, ['pair', pairingA.code]);
  const pairedB = runAgent(clientBConfig, origin, ['pair', pairingB.code]);
  assert(pairedA.connected && pairedA.task_assigned, 'Alice CLI pairing was not confirmed.');
  assert(pairedB.connected && pairedB.task_assigned, 'Bob CLI pairing was not confirmed.');
  assert(pairedA.conflict_id === conflict.id, 'Alice pairing returned the wrong conflict.');
  assert(pairedB.conflict_id === conflict.id, 'Bob pairing returned the wrong conflict.');

  const aliceRunnerProcess = startAgentRunner(clientAConfig, origin, 'Alice Runner');
  startAgentRunner(clientBConfig, origin, 'Bob Runner');
  const runnerA = await waitForRunnerOnline(origin, aliceHeaders, pairedA.agent.id);
  const runnerB = await waitForRunnerOnline(origin, bobHeaders, pairedB.agent.id);
  assert(runnerA.state === 'online', `Alice Runner state is ${runnerA.state}.`);
  assert(runnerB.state === 'online', `Bob Runner state is ${runnerB.state}.`);

  const tasksA = runAgent(clientAConfig, origin, ['tasks']);
  const tasksB = runAgent(clientBConfig, origin, ['tasks']);
  assert(
    tasksA.tasks.some((task) => task.conflict_id === conflict.id),
    'Alice task is missing.',
  );
  assert(
    tasksB.tasks.some((task) => task.conflict_id === conflict.id),
    'Bob task is missing.',
  );

  const initialContextA = runAgent(clientAConfig, origin, ['context', conflict.id]);
  const initialContextB = runAgent(clientBConfig, origin, ['context', conflict.id]);
  const serializedA = JSON.stringify(initialContextA);
  const serializedB = JSON.stringify(initialContextB);
  assert(serializedA.includes(aliceSecret), 'Alice could not access her private brief.');
  assert(!serializedA.includes(bobSecret), 'Alice received Bob private brief data.');
  assert(serializedB.includes(bobSecret), 'Bob could not access his private brief.');
  assert(!serializedB.includes(aliceSecret), 'Bob received Alice private brief data.');

  await stopRunner(aliceRunnerProcess);
  const disconnected = await waitForRunnerOffline(origin, aliceHeaders, pairedA.agent.id);
  assert(
    ['reconnecting', 'reconnect_required'].includes(disconnected.state),
    `Alice Runner did not expose a recovery state after disconnect (${disconnected.state}).`,
  );

  await json(origin, `/conflicts/${conflict.id}/ready`, {
    method: 'POST',
    headers: aliceHeaders,
    body: JSON.stringify({ ready: true }),
  });
  const started = await json(origin, `/conflicts/${conflict.id}/ready`, {
    method: 'POST',
    headers: bobHeaders,
    body: JSON.stringify({ ready: true }),
  });
  assert(started.started === true, 'The conflict did not start after both parties became ready.');

  startAgentRunner(clientAConfig, origin, 'Alice reconnected Runner');
  await waitForRunnerOnline(origin, aliceHeaders, pairedA.agent.id);

  const resolutionDeadline = Date.now() + 30_000;
  let finalState;
  while (Date.now() < resolutionDeadline) {
    finalState = await json(origin, `/conflicts/${conflict.id}`, { headers: aliceHeaders });
    if (finalState.status === 'resolved') break;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 200));
  }

  assert(finalState, 'The final conflict state was not loaded.');
  assert(finalState.status === 'resolved', `Expected resolved, received ${finalState.status}.`);
  const verdict = await json(origin, `/conflicts/${conflict.id}/verdict`, {
    headers: aliceHeaders,
  });
  assert(verdict.verdict?.verdict?.protocolType === 'debate', 'The mock Judge verdict is missing.');
  const finalContextA = runAgent(clientAConfig, origin, ['context', conflict.id]);
  const finalContextB = runAgent(clientBConfig, origin, ['context', conflict.id]);
  assert(finalContextA.task?.status === 'resolved', 'Alice did not receive resolved task state.');
  assert(finalContextB.task?.status === 'resolved', 'Bob did not receive resolved task state.');
  const transcript = JSON.stringify(finalContextA.events);
  assert(!transcript.includes(aliceSecret), 'Alice private brief leaked into the transcript.');
  assert(!transcript.includes(bobSecret), 'Bob private brief leaked into the transcript.');
  const actions = finalContextA.events.events.filter((event) =>
    ['argument_submitted', 'rebuttal_submitted', 'closing_statement_submitted'].includes(
      event.eventType ?? event.event_type,
    ),
  );
  assert(actions.length === 6, `Expected six debate actions, received ${actions.length}.`);

  process.stdout.write(
    `${JSON.stringify({ passed: true, runners: 2, server_triggered: true, offline_queue_recovered: true, private_briefs_verified: 2, debate_turns: 6, final_status: finalState.status, judge: 'mock' }, null, 2)}\n`,
  );
}

try {
  await main();
} finally {
  await stopRunners();
  await stopWorker();
  rmSync(temporaryRoot, { recursive: true, force: true });
}
