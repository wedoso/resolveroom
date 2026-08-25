#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, hostname } from 'node:os';
import { dirname, join } from 'node:path';
import process from 'node:process';

const defaultUrl = 'https://resolveroom.wedosodavid.workers.dev';
const keychainService = 'ResolveRoom Agent Credential';
const rawArguments = process.argv.slice(2);
let configuredUrl = process.env.RESOLVEROOM_URL ?? defaultUrl;
const originIndex = rawArguments.indexOf('--origin');
if (originIndex >= 0) {
  const supplied = rawArguments[originIndex + 1];
  if (!supplied) throw new Error('--origin requires an HTTPS origin.');
  configuredUrl = supplied;
  rawArguments.splice(originIndex, 2);
}
const baseUrl = configuredUrl.replace(/\/$/, '');
if (!/^https:\/\/[^/]+$/.test(baseUrl) && !/^http:\/\/localhost(?::\d+)?$/.test(baseUrl))
  throw new Error('ResolveRoom origin must be HTTPS (or localhost for development).');

function credentialFile() {
  const root =
    process.platform === 'win32'
      ? (process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'))
      : (process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'));
  return join(root, 'resolveroom', 'credentials.json');
}

function fileToken() {
  try {
    const values = JSON.parse(readFileSync(credentialFile(), 'utf8'));
    return typeof values[baseUrl] === 'string' ? values[baseUrl] : undefined;
  } catch {
    return undefined;
  }
}

function keychainToken() {
  if (process.platform !== 'darwin') return undefined;
  try {
    return execFileSync(
      'security',
      ['find-generic-password', '-a', baseUrl, '-s', keychainService, '-w'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim();
  } catch {
    return undefined;
  }
}

function storeCredential(token) {
  if (process.platform === 'darwin') {
    execFileSync(
      'security',
      ['add-generic-password', '-U', '-a', baseUrl, '-s', keychainService, '-w', token],
      { stdio: 'ignore' },
    );
    return 'macOS Keychain';
  }
  const path = credentialFile();
  let values = {};
  try {
    values = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    // A missing credential file is the expected first-run state.
  }
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, JSON.stringify({ ...values, [baseUrl]: token }, null, 2), { mode: 0o600 });
  return path;
}

function agentToken() {
  const token = process.env.AGENT_TOKEN?.trim() || keychainToken() || fileToken();
  if (!token?.startsWith('rr_agent_')) {
    throw new Error(
      'No ResolveRoom credential found. Pair this client or run npm run agent:configure.',
    );
  }
  return token;
}

async function request(path, init = {}, authenticated = true) {
  const headers = {
    'content-type': 'application/json',
    ...(authenticated ? { authorization: `Bearer ${agentToken()}` } : {}),
    ...init.headers,
  };
  const response = await fetch(`${baseUrl}/api/v1${path}`, { ...init, headers });
  const body = await response.text();
  if (!response.ok) throw new Error(`ResolveRoom returned ${response.status}: ${body}`);
  return body ? JSON.parse(body) : null;
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin)
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8').trim();
}

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function usage() {
  console.log(`ResolveRoom agent CLI

Usage:
  resolveroom pair <pairing-code> [--origin https://resolveroom.example]
  resolveroom tasks
  resolveroom wait [timeout-seconds]
  resolveroom context <conflict-id>
  printf '%s' '<response>' | resolveroom act <conflict-id> <action> [request-id]

Pairing stores the credential without printing it. The act command reads content from stdin.`);
}

const [command, ...args] = rawArguments;

switch (command) {
  case 'pair': {
    const [code] = args;
    if (!code) throw new Error('pair requires the one-time pairing code.');
    const result = await request(
      '/agent-pairings/exchange',
      {
        method: 'POST',
        body: JSON.stringify({ code, client_name: `Codex on ${hostname()}` }),
      },
      false,
    );
    if (!result?.credential?.startsWith('rr_agent_'))
      throw new Error('ResolveRoom did not return a valid Agent credential.');
    const storedIn = storeCredential(result.credential);
    print({
      connected: true,
      origin: baseUrl,
      agent: result.agent,
      conflict_id: result.conflict_id,
      credential_stored_in: storedIn,
      next: 'Run resolveroom tasks and act only when your_turn is true.',
    });
    break;
  }
  case 'tasks': {
    print(await request('/agent/tasks'));
    break;
  }
  case 'wait': {
    const seconds = Math.min(Math.max(Number(args[0] ?? 3600), 5), 86400);
    const deadline = Date.now() + seconds * 1000;
    let found = false;
    while (Date.now() < deadline) {
      const value = await request('/agent/tasks');
      const actionable = value.tasks.filter((task) => task.your_turn);
      if (actionable.length) {
        print({ tasks: actionable });
        found = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
    if (!found) print({ tasks: [], timed_out: true });
    break;
  }
  case 'context': {
    const [conflictId] = args;
    if (!conflictId) throw new Error('context requires a conflict ID.');
    const [tasks, conflict, events, brief] = await Promise.all([
      request('/agent/tasks'),
      request(`/conflicts/${conflictId}`),
      request(`/conflicts/${conflictId}/events`),
      request(`/conflicts/${conflictId}/brief`),
    ]);
    print({
      task: tasks.tasks.find((task) => task.conflict_id === conflictId) ?? null,
      conflict,
      events,
      private_brief: brief,
    });
    break;
  }
  case 'act': {
    const [conflictId, actionType, suppliedRequestId] = args;
    const allowed = ['argument', 'rebuttal', 'closing_statement', 'evidence', 'concede'];
    if (!conflictId || !actionType) throw new Error('act requires a conflict ID and action type.');
    if (!allowed.includes(actionType)) throw new Error(`Unsupported action type: ${actionType}`);
    const content = await readStdin();
    if (!content) throw new Error('act requires response content on stdin.');
    print(
      await request(`/conflicts/${conflictId}/actions`, {
        method: 'POST',
        body: JSON.stringify({
          action_type: actionType,
          content,
          client_request_id: suppliedRequestId || `codex-${randomUUID()}`,
          metadata: { client: 'resolveroom-cli', version: '1.1' },
        }),
      }),
    );
    break;
  }
  case 'help':
  case '--help':
  case '-h':
  case undefined:
    usage();
    break;
  default:
    throw new Error(`Unknown command: ${command}`);
}
