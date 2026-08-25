import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const defaultUrl = 'https://resolveroom.wedosodavid.workers.dev';
const baseUrl = (process.env.RESOLVEROOM_URL ?? defaultUrl).replace(/\/$/, '');
const keychainService = 'ResolveRoom Agent Credential';

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

function agentToken() {
  const token = process.env.AGENT_TOKEN?.trim() || keychainToken();
  if (!token?.startsWith('rr_agent_')) {
    throw new Error(
      'No ResolveRoom agent credential found. Run npm run agent:configure or set AGENT_TOKEN.',
    );
  }
  return token;
}

async function api<T>(path: string, init: RequestInit = {}) {
  const response = await fetch(`${baseUrl}/api/v1${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${agentToken()}`,
      'content-type': 'application/json',
      ...init.headers,
    },
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`ResolveRoom returned ${response.status}: ${body}`);
  }
  return (body ? JSON.parse(body) : null) as T;
}

async function readStdin() {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8').trim();
}

function print(value: unknown) {
  process.stdout.write(JSON.stringify(value, null, 2) + '\n');
}

function usage() {
  console.log(`ResolveRoom local agent CLI

Usage:
  npm run agent -- tasks
  npm run agent -- context <conflict-id>
  printf '%s' '<response>' | npm run agent -- act <conflict-id> <action> [request-id]

The act command reads response content from stdin. Supply a stable request-id when retrying.`);
}

const [command, ...args] = process.argv.slice(2);

switch (command) {
  case 'tasks': {
    print(await api('/agent/tasks'));
    break;
  }
  case 'context': {
    const [conflictId] = args;
    if (!conflictId) throw new Error('context requires a conflict ID.');
    const [tasks, conflict, events, brief] = await Promise.all([
      api<{ tasks: Array<{ conflict_id: string }> }>('/agent/tasks'),
      api(`/conflicts/${conflictId}`),
      api(`/conflicts/${conflictId}/events`),
      api(`/conflicts/${conflictId}/brief`),
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
    if (!conflictId || !actionType) {
      throw new Error('act requires a conflict ID and action type.');
    }
    if (!allowed.includes(actionType)) {
      throw new Error('Unsupported action type: ' + actionType);
    }
    const content = await readStdin();
    if (!content) throw new Error('act requires response content on stdin.');
    const clientRequestId = suppliedRequestId || `codex-${randomUUID()}`;
    print(
      await api(`/conflicts/${conflictId}/actions`, {
        method: 'POST',
        body: JSON.stringify({
          action_type: actionType,
          content,
          client_request_id: clientRequestId,
          metadata: { client: 'local-codex', version: '1.0' },
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
    throw new Error('Unknown command: ' + command);
}
