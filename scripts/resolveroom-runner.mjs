import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { homedir, hostname } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import process from 'node:process';

const runnerVersion = '2.2.0';

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function safeLine(message, fields = {}) {
  process.stdout.write(`${JSON.stringify({ at: new Date().toISOString(), message, ...fields })}\n`);
}

function runnerRoot() {
  if (process.platform === 'darwin')
    return join(homedir(), 'Library', 'Application Support', 'ResolveRoom', 'runner');
  if (process.platform === 'win32')
    return join(
      process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'),
      'ResolveRoom',
      'runner',
    );
  return join(
    process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share'),
    'resolveroom',
    'runner',
  );
}

function threadStatePath() {
  return join(runnerRoot(), 'threads.json');
}

function readThreadState() {
  try {
    const parsed = JSON.parse(readFileSync(threadStatePath(), 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveThreadState(value) {
  mkdirSync(dirname(threadStatePath()), { recursive: true, mode: 0o700 });
  writeFileSync(threadStatePath(), JSON.stringify(value, null, 2), { mode: 0o600 });
}

function parseAgentResponse(value, allowedActions) {
  const parsed = typeof value === 'string' ? JSON.parse(value) : value;
  if (!parsed || typeof parsed !== 'object') throw new Error('Codex returned an invalid response.');
  if (!allowedActions.includes(parsed.action_type))
    throw new Error('Codex selected an action that is not allowed for this turn.');
  const content = String(parsed.content ?? '').trim();
  if (parsed.action_type !== 'concede' && !content)
    throw new Error('Codex returned an empty action.');
  if (content.length > 12_000) throw new Error('Codex response exceeds the action limit.');
  return { action_type: parsed.action_type, content };
}

function mockResponse(context) {
  const action =
    context.task.allowed_actions.find((candidate) => candidate !== 'evidence') ??
    context.task.allowed_actions[0];
  return {
    action_type: action,
    content: `A concise ${String(action).replaceAll('_', ' ')} grounded in the shared case record.`,
  };
}

function codexPrompt(context) {
  return `You are the authorized representative for one party in a ResolveRoom conflict.

Prepare exactly one action for the current turn. Follow these rules:
- Choose only an action_type listed in task.allowed_actions.
- Use the private brief to guide priorities, but never quote, expose, or identify private-only information in the public response unless it already appears in the public case or transcript.
- Address the other side's public arguments directly and remain civil, concrete, and concise.
- Do not use tools, change files, contact people, or perform any action outside this response.
- Return only JSON matching the supplied schema.

Authorized context:
${JSON.stringify(context)}`;
}

async function createProvider(providerName) {
  if (providerName === 'mock')
    return {
      name: 'mock',
      run: async (context) => {
        const milliseconds = Math.max(
          0,
          Math.min(10_000, Number(process.env.RESOLVEROOM_RUNNER_MOCK_DELAY_MS ?? 0)),
        );
        if (milliseconds) await delay(milliseconds);
        return mockResponse(context);
      },
    };
  const { Codex } = await import('@openai/codex-sdk');
  const codex = new Codex();
  const state = readThreadState();
  return {
    name: 'codex',
    async run(context) {
      const savedId = state[context.task.conflict_id];
      const thread = savedId
        ? codex.resumeThread(savedId)
        : codex.startThread({
            workingDirectory: homedir(),
            skipGitRepoCheck: true,
            sandboxMode: 'read-only',
            approvalPolicy: 'never',
            networkAccessEnabled: false,
            modelReasoningEffort: 'medium',
            threadSource: 'resolveroom-runner',
          });
      const result = await thread.run(codexPrompt(context), {
        outputSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['action_type', 'content'],
          properties: {
            action_type: { type: 'string', enum: context.task.allowed_actions },
            content: { type: 'string', maxLength: 12_000 },
          },
        },
      });
      if (thread.id) {
        state[context.task.conflict_id] = thread.id;
        saveThreadState(state);
      }
      return parseAgentResponse(result.finalResponse, context.task.allowed_actions);
    },
  };
}

async function contextForTask(request, conflictId) {
  const tasks = await request('/agent/tasks');
  const task = tasks.tasks.find((candidate) => candidate.conflict_id === conflictId);
  if (!task?.your_turn) return null;
  const [conflict, events, brief] = await Promise.all([
    request(`/conflicts/${conflictId}`),
    request(`/conflicts/${conflictId}/events`),
    request(`/conflicts/${conflictId}/brief`),
  ]);
  return { task, conflict, events, private_brief: brief };
}

export async function startRunner({ baseUrl, token, request, providerName }) {
  const [{ default: WebSocket }, provider] = await Promise.all([
    import('ws'),
    createProvider(providerName ?? process.env.RESOLVEROOM_RUNNER_PROVIDER ?? 'codex'),
  ]);
  const websocketUrl = `${baseUrl.replace(/^http/, 'ws')}/api/v1/agent-runner/connect`;
  let stopped = false;
  let attempt = 0;
  let activeJob = null;
  let currentSocket = null;
  const stop = () => {
    stopped = true;
    if (currentSocket?.readyState === WebSocket.OPEN)
      currentSocket.close(1000, 'Runner stopped locally.');
    else currentSocket?.terminate();
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);

  while (!stopped) {
    let socket;
    let heartbeat;
    try {
      socket = new WebSocket(websocketUrl, { headers: { Authorization: `Bearer ${token}` } });
      currentSocket = socket;
      await new Promise((resolve, reject) => {
        socket.once('open', resolve);
        socket.once('error', reject);
        socket.once('unexpected-response', (_request, response) =>
          reject(new Error(`Runner authorization failed with ${response.statusCode}.`)),
        );
      });
      attempt = 0;
      socket.send(
        JSON.stringify({
          type: 'hello',
          runner_version: runnerVersion,
          device_name: hostname(),
          provider: provider.name,
        }),
      );
      heartbeat = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN)
          socket.send(
            JSON.stringify({
              type: 'heartbeat',
              runner_version: runnerVersion,
              device_name: hostname(),
              provider: provider.name,
              active_job_id: activeJob,
            }),
          );
      }, 25_000);
      safeLine('runner_online', { origin: baseUrl, provider: provider.name });

      let chain = Promise.resolve();
      socket.on('message', (raw) => {
        chain = chain
          .then(async () => {
            const message = JSON.parse(raw.toString());
            if (message.type !== 'task' || !message.job?.id) return;
            const job = message.job;
            activeJob = job.id;
            socket.send(JSON.stringify({ type: 'ack', job_id: job.id }));
            try {
              const context = await contextForTask(request, job.conflict_id);
              if (!context) {
                socket.send(JSON.stringify({ type: 'stale', job_id: job.id }));
                return;
              }
              const response = await provider.run(context);
              if (!context.task.allowed_actions.includes(response.action_type))
                throw new Error('Provider action is no longer allowed.');
              const accepted = await request(`/conflicts/${job.conflict_id}/actions`, {
                method: 'POST',
                body: JSON.stringify({
                  action_type: response.action_type,
                  content: response.content,
                  client_request_id: job.request_id,
                  metadata: {
                    client: 'resolveroom-runner',
                    runner_version: runnerVersion,
                    provider: provider.name,
                  },
                }),
              });
              socket.send(
                JSON.stringify({ type: 'completed', job_id: job.id, event_id: accepted.event_id }),
              );
              safeLine('turn_completed', {
                conflict_id: job.conflict_id,
                action_type: response.action_type,
              });
            } catch (error) {
              socket.send(
                JSON.stringify({
                  type: 'failed',
                  job_id: job.id,
                  error_code: error?.status === 401 ? 'authorization_failed' : 'execution_failed',
                }),
              );
              safeLine('turn_failed', {
                conflict_id: job.conflict_id,
                error_code:
                  typeof error?.status === 'number'
                    ? `http_${error.status}`
                    : error instanceof Error
                      ? error.name
                      : 'unknown_error',
              });
            } finally {
              activeJob = null;
            }
          })
          .catch((error) =>
            safeLine('runner_message_failed', {
              error_code: error instanceof Error ? error.name : 'unknown_error',
            }),
          );
      });

      const close = await new Promise((resolve) =>
        socket.once('close', (code, reason) => resolve({ code, reason: reason.toString() })),
      );
      clearInterval(heartbeat);
      currentSocket = null;
      await chain;
      if (stopped) break;
      safeLine('runner_reconnecting', { code: close.code, reason: close.reason.slice(0, 120) });
    } catch (error) {
      if (heartbeat) clearInterval(heartbeat);
      currentSocket = null;
      if (stopped) break;
      safeLine('runner_reconnecting', {
        error_code: error instanceof Error ? error.name : 'connection_failed',
      });
    }
    const wait = Math.min(30_000, 1_000 * 2 ** Math.min(attempt, 5));
    attempt += 1;
    await delay(wait + Math.floor(Math.random() * 500));
  }
}

function xml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export function resolveRunnerPackageManagerPath({
  configuredPath = process.env.RESOLVEROOM_PACKAGE_MANAGER,
  npmExecPath = process.env.npm_execpath,
  nodeExecutable = process.execPath,
  platform = process.platform,
} = {}) {
  const executableNames = platform === 'win32' ? ['pnpm.cmd', 'pnpm.exe', 'pnpm'] : ['pnpm'];
  const nodeDirectory = dirname(nodeExecutable);
  const candidates = [configuredPath, npmExecPath];
  for (const executableName of executableNames) {
    candidates.push(
      resolve(nodeDirectory, '..', '..', 'bin', 'fallback', executableName),
      resolve(nodeDirectory, '..', 'bin', 'fallback', executableName),
    );
  }
  return candidates.find((candidate) => candidate && existsSync(candidate));
}

export function runnerDependencyInstallInvocation({
  packageManagerPath = resolveRunnerPackageManagerPath(),
  userAgent = process.env.npm_config_user_agent ?? '',
  nodeExecutable = process.execPath,
} = {}) {
  if (!packageManagerPath || !existsSync(packageManagerPath))
    throw new Error('A working npm or pnpm executable is required to install the Runner.');
  const executableName = basename(packageManagerPath).toLowerCase();
  const pnpm =
    userAgent.startsWith('pnpm/') || /^pnpm(?:\.c?js|\.cmd|\.exe)?$/.test(executableName);
  const javascriptCli = /\.(?:c?js|mjs)$/.test(executableName);
  return pnpm
    ? {
        command: javascriptCli ? nodeExecutable : packageManagerPath,
        args: [
          ...(javascriptCli ? [packageManagerPath] : []),
          'install',
          '--prod',
          '--no-frozen-lockfile',
        ],
      }
    : {
        command: javascriptCli ? nodeExecutable : packageManagerPath,
        args: [
          ...(javascriptCli ? [packageManagerPath] : []),
          'install',
          '--omit=dev',
          '--no-audit',
          '--no-fund',
        ],
      };
}

export function installRunnerDependencies(root) {
  const packageJson = {
    private: true,
    type: 'module',
    dependencies: {
      '@openai/codex-sdk': '0.149.1',
      ws: '8.21.3',
    },
  };
  writeFileSync(join(root, 'package.json'), JSON.stringify(packageJson, null, 2), { mode: 0o600 });
  const cache = join(root, 'npm-cache');
  mkdirSync(cache, { recursive: true, mode: 0o700 });
  const invocation = runnerDependencyInstallInvocation();
  execFileSync(invocation.command, invocation.args, {
    cwd: root,
    env: {
      ...process.env,
      npm_config_cache: cache,
      XDG_CACHE_HOME: cache,
      PNPM_HOME: join(root, 'pnpm-home'),
    },
    stdio: 'ignore',
  });
}

function installRuntime(root) {
  const runtimeDirectory = join(root, 'runtime');
  const installedNode = join(runtimeDirectory, process.platform === 'win32' ? 'node.exe' : 'node');
  mkdirSync(runtimeDirectory, { recursive: true, mode: 0o700 });
  if (!existsSync(installedNode)) copyFileSync(process.execPath, installedNode);
  if (process.platform !== 'win32') chmodSync(installedNode, 0o700);
  return installedNode;
}

function serviceId(baseUrl) {
  return createHash('sha256').update(baseUrl).digest('hex').slice(0, 12);
}

export function prepareRunnerInstall({ mainScript, runnerScript, root = runnerRoot() }) {
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const installedMain = join(root, 'resolveroom-agent.mjs');
  const installedRunner = join(root, 'resolveroom-runner.mjs');
  copyFileSync(mainScript, installedMain);
  copyFileSync(runnerScript, installedRunner);
  installRunnerDependencies(root);
  const installedNode = installRuntime(root);
  return { root, installedMain, installedRunner, installedNode };
}

export function installRunner({ baseUrl, mainScript, runnerScript, prepared }) {
  const installation =
    prepared ?? prepareRunnerInstall({ mainScript, runnerScript, root: runnerRoot() });
  const { root, installedMain, installedNode } = installation;
  const logPath = join(root, 'runner.log');

  if (process.platform === 'darwin') {
    const label = `dev.resolveroom.agent-runner.${serviceId(baseUrl)}`;
    const plistPath = join(homedir(), 'Library', 'LaunchAgents', `${label}.plist`);
    mkdirSync(dirname(plistPath), { recursive: true, mode: 0o700 });
    const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${xml(label)}</string>
<key>ProgramArguments</key><array><string>${xml(installedNode)}</string><string>${xml(installedMain)}</string><string>runner</string><string>start</string><string>--origin</string><string>${xml(baseUrl)}</string></array>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
<key>StandardOutPath</key><string>${xml(logPath)}</string>
<key>StandardErrorPath</key><string>${xml(logPath)}</string>
</dict></plist>\n`;
    writeFileSync(plistPath, plist, { mode: 0o600 });
    const domain = `gui/${process.getuid()}`;
    try {
      execFileSync('launchctl', ['bootout', domain, plistPath], { stdio: 'ignore' });
    } catch {
      // A first install has no existing service to remove.
    }
    execFileSync('launchctl', ['bootstrap', domain, plistPath], { stdio: 'ignore' });
    execFileSync('launchctl', ['enable', `${domain}/${label}`], { stdio: 'ignore' });
    return { managed: true, service: label, log_path: logPath, runtime: installedNode };
  }

  if (process.platform === 'linux') {
    const unit = `resolveroom-runner-${serviceId(baseUrl)}.service`;
    const unitPath = join(homedir(), '.config', 'systemd', 'user', unit);
    mkdirSync(dirname(unitPath), { recursive: true, mode: 0o700 });
    writeFileSync(
      unitPath,
      `[Unit]\nDescription=ResolveRoom Agent Runner\nAfter=network-online.target\n\n[Service]\nExecStart=${systemdQuote(installedNode)} ${systemdQuote(installedMain)} runner start --origin ${systemdQuote(baseUrl)}\nRestart=always\nRestartSec=3\n\n[Install]\nWantedBy=default.target\n`,
      { mode: 0o600 },
    );
    execFileSync('systemctl', ['--user', 'daemon-reload'], { stdio: 'ignore' });
    execFileSync('systemctl', ['--user', 'enable', '--now', unit], { stdio: 'ignore' });
    return { managed: true, service: unit, log_path: null, runtime: installedNode };
  }

  if (process.platform === 'win32') {
    const task = `ResolveRoom Agent Runner ${serviceId(baseUrl)}`;
    const launcher = join(root, `runner-${serviceId(baseUrl)}.cmd`);
    writeFileSync(
      launcher,
      `@echo off\r\n${cmdQuote(installedNode)} ${cmdQuote(installedMain)} runner start --origin ${cmdQuote(baseUrl)}\r\n`,
      { mode: 0o600 },
    );
    execFileSync(
      'schtasks.exe',
      ['/Create', '/F', '/SC', 'ONLOGON', '/RL', 'LIMITED', '/TN', task, '/TR', launcher],
      { stdio: 'ignore' },
    );
    execFileSync('schtasks.exe', ['/Run', '/TN', task], { stdio: 'ignore' });
    return { managed: true, service: task, log_path: logPath, runtime: installedNode };
  }

  const child = spawn(installedNode, [installedMain, 'runner', 'start', '--origin', baseUrl], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  return {
    managed: false,
    service: `pid:${child.pid}`,
    log_path: logPath,
    runtime: installedNode,
  };
}

function systemdQuote(value) {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

function cmdQuote(value) {
  if (/[\r\n]/.test(value)) throw new Error('Runner service arguments cannot contain newlines.');
  return `"${value.replaceAll('%', '%%').replaceAll('"', '""')}"`;
}

export async function waitUntilOnline(request, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await request('/agent/runner');
    if (value.runner?.online) return value.runner;
    await delay(500);
  }
  throw new Error('The Runner service was installed but did not come online in time.');
}

export async function runRunnerCommand({ args, baseUrl, token, request, mainScript }) {
  const [subcommand = 'status'] = args;
  if (subcommand === 'start') {
    await startRunner({ baseUrl, token, request });
    return null;
  }
  if (subcommand === 'status') return request('/agent/runner');
  if (subcommand === 'install' || subcommand === 'reconnect') {
    const installed = installRunner({
      baseUrl,
      mainScript,
      runnerScript: new URL(import.meta.url).pathname,
    });
    const status = await waitUntilOnline(request);
    return { installed, runner: status };
  }
  throw new Error(`Unknown runner command: ${subcommand}`);
}
