#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  accessSync,
  chmodSync,
  constants,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { homedir, hostname } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const selfContainedBundle = globalThis.__RESOLVEROOM_BUNDLED__ === true;
const defaultUrl = 'https://resolveroom.wedosodavid.workers.dev';
const keychainService = 'ResolveRoom Agent Credential';
const useFileCredentialStore = process.env.RESOLVEROOM_CREDENTIAL_STORE === 'file';
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
if (
  !/^https:\/\/[^/]+$/.test(baseUrl) &&
  !/^http:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(baseUrl)
)
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
  if (process.platform !== 'darwin' || useFileCredentialStore) return undefined;
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
  const path = credentialFile();
  const temporaryPath = `${path}.${process.pid}.new`;
  let values = {};
  try {
    values = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    // A missing credential file is the expected first-run state.
  }
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(temporaryPath, JSON.stringify({ ...values, [baseUrl]: token }, null, 2), {
    mode: 0o600,
  });
  chmodSync(temporaryPath, 0o600);
  renameSync(temporaryPath, path);
  chmodSync(path, 0o600);
  if (process.platform === 'darwin' && !useFileCredentialStore) {
    try {
      execFileSync(
        'security',
        ['add-generic-password', '-U', '-a', baseUrl, '-s', keychainService, '-w', token],
        { stdio: 'ignore' },
      );
      return 'macOS Keychain with a private Runner recovery copy';
    } catch {
      // A managed or locked Keychain must not prevent the already-protected local Runner file.
    }
  }
  return path;
}

function removeCredential() {
  const path = credentialFile();
  let fileCredentialRemoved = false;
  if (existsSync(path)) {
    let values;
    try {
      values = JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      const error = new Error(
        'ResolveRoom could not safely read the local credential store. Repair or remove that file manually, then retry cleanup.',
      );
      error.code = 'CREDENTIAL_CLEANUP_FAILED';
      throw error;
    }
    try {
      if (typeof values[baseUrl] === 'string') {
        delete values[baseUrl];
        fileCredentialRemoved = true;
        if (Object.keys(values).length === 0) rmSync(path, { force: true });
        else {
          const temporaryPath = `${path}.${process.pid}.new`;
          writeFileSync(temporaryPath, JSON.stringify(values, null, 2), { mode: 0o600 });
          chmodSync(temporaryPath, 0o600);
          renameSync(temporaryPath, path);
          chmodSync(path, 0o600);
        }
      }
    } catch {
      const error = new Error(
        'ResolveRoom could not remove this origin from the local credential store. Check file permissions, then retry cleanup.',
      );
      error.code = 'CREDENTIAL_CLEANUP_FAILED';
      throw error;
    }
  }
  let keychainCredentialRemoved = false;
  if (process.platform === 'darwin' && !useFileCredentialStore) {
    try {
      execFileSync('security', ['delete-generic-password', '-a', baseUrl, '-s', keychainService], {
        stdio: 'ignore',
      });
      keychainCredentialRemoved = true;
    } catch {
      // A missing Keychain item is an idempotent already-clean result.
    }
  }
  return { fileCredentialRemoved, keychainCredentialRemoved };
}

function validateCredentialStore() {
  const directory = dirname(credentialFile());
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  accessSync(directory, constants.R_OK | constants.W_OK);
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

class ResolveRoomHttpError extends Error {
  constructor(status, body) {
    super(`ResolveRoom returned ${status}: ${body}`);
    this.status = status;
  }
}

async function request(path, init = {}, authenticated = true) {
  const headers = {
    'content-type': 'application/json',
    ...(authenticated ? { authorization: `Bearer ${agentToken()}` } : {}),
    ...init.headers,
  };
  const response = await fetch(`${baseUrl}/api/v1${path}`, { ...init, headers });
  const body = await response.text();
  if (!response.ok) throw new ResolveRoomHttpError(response.status, body);
  return body ? JSON.parse(body) : null;
}

async function requestWithConsistencyRetry(path) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await request(path);
    } catch (error) {
      if (!(error instanceof ResolveRoomHttpError) || error.status !== 404 || attempt >= 4)
        throw error;
      await new Promise((resolve) => setTimeout(resolve, 150 * 2 ** attempt));
    }
  }
}

async function waitForAssignedTask(conflictId) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const tasks = await request('/agent/tasks');
    const task = tasks?.tasks?.find((candidate) => candidate.conflict_id === conflictId);
    if (task) return { tasks, task };
    if (attempt < 4) await new Promise((resolve) => setTimeout(resolve, 150 * 2 ** attempt));
  }
  return { tasks: await request('/agent/tasks'), task: null };
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
  resolveroom connect <pairing-code> [--origin https://resolveroom.example]
  resolveroom pair <pairing-code> [--origin https://resolveroom.example]
  resolveroom runner <start|status|install|reconnect|uninstall>
  resolveroom tasks
  resolveroom wait [timeout-seconds]
  resolveroom context <conflict-id>
  printf '%s' '<response>' | resolveroom act <conflict-id> <action> [request-id]

Connect stores the credential, installs an always-on local Runner, and verifies it is online.
Pair stores only the credential for custom/manual workflows. Runner uninstall removes the local
service, private runtime, logs, and this origin's stored credential. The act command reads content
from stdin.`);
}

async function exchangePairing(code) {
  if (!code) throw new Error('pairing requires the one-time pairing code.');
  const result = await request(
    '/agent-pairings/exchange',
    {
      method: 'POST',
      body: JSON.stringify({ code, client_name: `ResolveRoom Runner on ${hostname()}` }),
    },
    false,
  );
  if (!result?.credential?.startsWith('rr_agent_'))
    throw new Error('ResolveRoom did not return a valid Agent credential.');
  pairingConsumed = true;
  const storedIn = storeCredential(result.credential);
  const assignment = await waitForAssignedTask(result.conflict_id);
  if (!assignment.task)
    throw new Error(
      'The credential was stored securely, but ResolveRoom did not confirm the conflict assignment. Generate a fresh pairing instruction from the conflict room and reconnect.',
    );
  return { result, storedIn };
}

let connectionStage = null;
let pairingConsumed = false;

function safeFailure(error) {
  const rawCode = typeof error?.code === 'string' ? error.code : 'COMMAND_FAILED';
  const code = /^[A-Z0-9_]+$/.test(rawCode) ? rawCode : 'COMMAND_FAILED';
  const message = (error instanceof Error ? error.message : 'ResolveRoom command failed.')
    .replace(/rr_agent_[A-Za-z0-9_-]+/g, '[redacted]')
    .replace(/\b[A-HJ-NP-Z2-9]{4}(?:-[A-HJ-NP-Z2-9]{4}){2}\b/g, '[redacted]')
    .slice(0, 500);
  return {
    connected: false,
    error: { code, stage: connectionStage ?? 'command', message },
    pairing_consumed: pairingConsumed,
    credential_stored: pairingConsumed,
    recovery: pairingConsumed
      ? 'Run resolveroom runner reconnect with the same ResolveRoom origin; no new pairing code is required.'
      : 'Correct the reported local prerequisite, then generate a fresh pairing instruction if the code expires.',
  };
}

async function main() {
  const [command, ...args] = rawArguments;
  switch (command) {
    case 'connect': {
      connectionStage = 'local_preflight';
      validateCredentialStore();
      const runnerModule = await import('./resolveroom-runner.mjs');
      const mainScript = fileURLToPath(import.meta.url);
      const runnerScript = selfContainedBundle
        ? mainScript
        : fileURLToPath(new URL('./resolveroom-runner.mjs', import.meta.url));
      const prepared = runnerModule.prepareRunnerInstall({ mainScript, runnerScript });
      connectionStage = 'pairing_exchange';
      const { result, storedIn } = await exchangePairing(args[0]);
      connectionStage = 'service_install';
      const installed = runnerModule.installRunner({
        baseUrl,
        mainScript,
        runnerScript,
        prepared,
      });
      connectionStage = 'runner_startup';
      const runner = await runnerModule.waitUntilOnline((path, init) => request(path, init));
      connectionStage = null;
      print({
        connected: true,
        runner_online: true,
        origin: baseUrl,
        agent: result.agent,
        conflict_id: result.conflict_id,
        credential_stored_in: storedIn,
        service: installed.service,
        runner,
        next: 'ResolveRoom will now push authorized turns to this Runner automatically.',
      });
      break;
    }
    case 'pair': {
      connectionStage = 'local_preflight';
      validateCredentialStore();
      connectionStage = 'pairing_exchange';
      const { result, storedIn } = await exchangePairing(args[0]);
      connectionStage = null;
      print({
        connected: true,
        task_assigned: true,
        origin: baseUrl,
        agent: result.agent,
        conflict_id: result.conflict_id,
        credential_stored_in: storedIn,
        next: 'Run resolveroom tasks and act only when your_turn is true.',
      });
      break;
    }
    case 'runner': {
      const [runnerCommand = 'status'] = args;
      connectionStage = runnerCommand === 'uninstall' ? 'runner_cleanup' : 'runner_recovery';
      const { runRunnerCommand } = await import('./resolveroom-runner.mjs');
      const value = await runRunnerCommand({
        args,
        baseUrl,
        token: runnerCommand === 'uninstall' ? null : agentToken(),
        request: (path, init) => request(path, init),
        mainScript: fileURLToPath(import.meta.url),
        runnerScript: selfContainedBundle
          ? fileURLToPath(import.meta.url)
          : fileURLToPath(new URL('./resolveroom-runner.mjs', import.meta.url)),
      });
      const credentials = runnerCommand === 'uninstall' ? removeCredential() : null;
      connectionStage = null;
      if (value)
        print(
          runnerCommand === 'uninstall'
            ? {
                cleaned: true,
                origin: baseUrl,
                service_removed: value.service_removed,
                runtime_removed: value.runtime_removed,
                credential_removed:
                  credentials.fileCredentialRemoved || credentials.keychainCredentialRemoved,
                already_clean:
                  value.already_clean &&
                  !credentials.fileCredentialRemoved &&
                  !credentials.keychainCredentialRemoved,
              }
            : value,
        );
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
      const { task } = await waitForAssignedTask(conflictId);
      if (!task)
        throw new Error(
          `Conflict ${conflictId} is not assigned to this Agent. Run resolveroom tasks and use the exact conflict_id returned there.`,
        );
      const [conflict, events, brief] = await Promise.all([
        requestWithConsistencyRetry(`/conflicts/${conflictId}`),
        requestWithConsistencyRetry(`/conflicts/${conflictId}/events`),
        requestWithConsistencyRetry(`/conflicts/${conflictId}/brief`),
      ]);
      print({ task, conflict, events, private_brief: brief });
      break;
    }
    case 'act': {
      const [conflictId, actionType, suppliedRequestId] = args;
      const allowed = ['argument', 'rebuttal', 'closing_statement', 'evidence', 'concede'];
      if (!conflictId || !actionType)
        throw new Error('act requires a conflict ID and action type.');
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
            metadata: { client: 'resolveroom-cli', version: '1.2' },
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
}

try {
  await main();
} catch (error) {
  print(safeFailure(error));
  process.exitCode = 1;
}
