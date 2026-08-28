import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  accessSync,
  chmodSync,
  closeSync,
  constants,
  copyFileSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { homedir, hostname, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';

const runnerVersion = '2.4.0';

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function safeLine(message, fields = {}) {
  process.stdout.write(`${JSON.stringify({ at: new Date().toISOString(), message, ...fields })}\n`);
}

function runnerRoot() {
  if (process.env.RESOLVEROOM_RUNNER_ROOT) return resolve(process.env.RESOLVEROOM_RUNNER_ROOT);
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
  const codexExecutable = resolveCodexExecutable();
  return {
    name: 'codex',
    async run(context) {
      const root = mkdtempSync(join(tmpdir(), 'resolveroom-codex-turn-'));
      const schemaPath = join(root, 'schema.json');
      const outputPath = join(root, 'response.json');
      writeFileSync(
        schemaPath,
        JSON.stringify({
          type: 'object',
          additionalProperties: false,
          required: ['action_type', 'content'],
          properties: {
            action_type: { type: 'string', enum: context.task.allowed_actions },
            content: { type: 'string', maxLength: 12_000 },
          },
        }),
        { mode: 0o600 },
      );
      try {
        await runCodexTurn({
          codexExecutable,
          prompt: codexPrompt(context),
          schemaPath,
          outputPath,
        });
        return parseAgentResponse(readFileSync(outputPath, 'utf8'), context.task.allowed_actions);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  };
}

function executableCandidates() {
  const names = process.platform === 'win32' ? ['codex.exe', 'codex.cmd', 'codex'] : ['codex'];
  const pathCandidates = (process.env.PATH ?? '')
    .split(process.platform === 'win32' ? ';' : ':')
    .filter(Boolean)
    .flatMap((directory) => names.map((name) => join(directory, name)));
  return [
    process.env.RESOLVEROOM_CODEX_EXECUTABLE,
    process.platform === 'darwin'
      ? '/Applications/ChatGPT.app/Contents/Resources/codex'
      : undefined,
    process.platform === 'darwin'
      ? join(homedir(), 'Applications', 'ChatGPT.app', 'Contents', 'Resources', 'codex')
      : undefined,
    ...pathCandidates,
  ].filter(Boolean);
}

export function resolveCodexExecutable() {
  for (const candidate of executableCandidates()) {
    try {
      accessSync(candidate, constants.X_OK);
      const result = spawnSync(candidate, ['--version'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      if (result.status === 0) return candidate;
    } catch {
      // Try the next stable Codex app/CLI location.
    }
  }
  const error = new Error(
    'A working Codex executable was not found. Install or update the ChatGPT Codex app, then retry before the pairing code expires.',
  );
  error.code = 'CODEX_EXECUTABLE_NOT_FOUND';
  throw error;
}

async function runCodexTurn({ codexExecutable, prompt, schemaPath, outputPath }) {
  const child = spawn(
    codexExecutable,
    [
      'exec',
      '--ephemeral',
      '--sandbox',
      'read-only',
      '--skip-git-repo-check',
      '--ignore-rules',
      '--thread-source',
      'resolveroom-runner',
      '--output-schema',
      schemaPath,
      '--output-last-message',
      outputPath,
      '--color',
      'never',
      '-',
    ],
    {
      cwd: homedir(),
      env: { ...process.env, RESOLVEROOM_AGENT_TURN: '1' },
      stdio: ['pipe', 'ignore', 'pipe'],
    },
  );
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr = `${stderr}${chunk.toString()}`.slice(-8_000);
  });
  child.stdin.end(prompt);
  const result = await new Promise((resolvePromise, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolvePromise({ code, signal }));
  });
  if (result.code === 0 && existsSync(outputPath)) return;
  const errorCode = /(?:not logged in|authentication|unauthorized)/i.test(stderr)
    ? 'CODEX_AUTHENTICATION_REQUIRED'
    : 'CODEX_EXECUTION_FAILED';
  const error = new Error(
    errorCode === 'CODEX_AUTHENTICATION_REQUIRED'
      ? 'The local Codex executable is not signed in. Open Codex, sign in, and reconnect the Runner.'
      : `The local Codex turn failed${result.signal ? ` (${result.signal})` : ''}.`,
  );
  error.code = errorCode;
  throw error;
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

function installRuntime(root) {
  const runtimeDirectory = join(root, 'runtime');
  const installedNode = join(runtimeDirectory, process.platform === 'win32' ? 'node.exe' : 'node');
  const temporaryNode = `${installedNode}.new`;
  mkdirSync(runtimeDirectory, { recursive: true, mode: 0o700 });
  copyFileSync(process.execPath, temporaryNode);
  if (process.platform !== 'win32') chmodSync(temporaryNode, 0o700);
  renameSync(temporaryNode, installedNode);
  try {
    execFileSync(installedNode, ['--version'], { stdio: 'ignore' });
  } catch {
    const error = new Error('The copied bundled Node runtime could not start.');
    error.code = 'RUNNER_RUNTIME_INVALID';
    throw error;
  }
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
  if (runnerScript && resolve(runnerScript) !== resolve(mainScript))
    copyFileSync(runnerScript, installedRunner);
  const installedNode = installRuntime(root);
  const codexExecutable =
    process.env.RESOLVEROOM_RUNNER_PROVIDER === 'mock' ? null : resolveCodexExecutable();
  return { root, installedMain, installedRunner, installedNode, codexExecutable };
}

export function launchAgentPlist({
  label,
  installedNode,
  installedMain,
  baseUrl,
  logPath,
  codexExecutable,
}) {
  const codexEnvironment = codexExecutable
    ? `<key>RESOLVEROOM_CODEX_EXECUTABLE</key><string>${xml(codexExecutable)}</string>`
    : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${xml(label)}</string>
<key>ProgramArguments</key><array><string>${xml(installedNode)}</string><string>${xml(installedMain)}</string><string>runner</string><string>start</string><string>--origin</string><string>${xml(baseUrl)}</string></array>
<key>EnvironmentVariables</key><dict><key>RESOLVEROOM_CREDENTIAL_STORE</key><string>file</string>${codexEnvironment}</dict>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ProcessType</key><string>Background</string>
<key>StandardOutPath</key><string>${xml(logPath)}</string>
<key>StandardErrorPath</key><string>${xml(logPath)}</string>
</dict></plist>\n`;
}

export function installRunner({ baseUrl, mainScript, runnerScript, prepared }) {
  const installation =
    prepared ?? prepareRunnerInstall({ mainScript, runnerScript, root: runnerRoot() });
  const { root, installedMain, installedNode, codexExecutable } = installation;
  const logPath = join(root, 'runner.log');

  if (process.env.RESOLVEROOM_RUNNER_SERVICE_MODE === 'detached') {
    const log = openSync(logPath, 'a', 0o600);
    const child = spawn(installedNode, [installedMain, 'runner', 'start', '--origin', baseUrl], {
      detached: process.platform !== 'win32',
      env: {
        ...process.env,
        RESOLVEROOM_CREDENTIAL_STORE: 'file',
        ...(codexExecutable ? { RESOLVEROOM_CODEX_EXECUTABLE: codexExecutable } : {}),
      },
      stdio: ['ignore', log, log],
    });
    closeSync(log);
    writeFileSync(join(root, 'service.pid'), String(child.pid), { mode: 0o600 });
    child.unref();
    return {
      managed: false,
      service: `pid:${child.pid}`,
      log_path: logPath,
      runtime: installedNode,
    };
  }

  if (process.platform === 'darwin') {
    const label = `dev.resolveroom.agent-runner.${serviceId(baseUrl)}`;
    const plistPath = join(homedir(), 'Library', 'LaunchAgents', `${label}.plist`);
    mkdirSync(dirname(plistPath), { recursive: true, mode: 0o700 });
    const plist = launchAgentPlist({
      label,
      installedNode,
      installedMain,
      baseUrl,
      logPath,
      codexExecutable,
    });
    writeFileSync(plistPath, plist, { mode: 0o600 });
    const domain = `gui/${process.getuid()}`;
    try {
      execFileSync('launchctl', ['bootout', `${domain}/${label}`], { stdio: 'ignore' });
    } catch {
      // A first install has no existing service to remove.
    }
    try {
      execFileSync('launchctl', ['bootstrap', domain, plistPath], { stdio: 'ignore' });
      execFileSync('launchctl', ['enable', `${domain}/${label}`], { stdio: 'ignore' });
      execFileSync('launchctl', ['kickstart', '-k', `${domain}/${label}`], { stdio: 'ignore' });
    } catch {
      const error = new Error('macOS could not register or start the ResolveRoom LaunchAgent.');
      error.code = 'RUNNER_SERVICE_INSTALL_FAILED';
      throw error;
    }
    return { managed: true, service: label, log_path: logPath, runtime: installedNode };
  }

  if (process.platform === 'linux') {
    const unit = `resolveroom-runner-${serviceId(baseUrl)}.service`;
    const unitPath = join(homedir(), '.config', 'systemd', 'user', unit);
    mkdirSync(dirname(unitPath), { recursive: true, mode: 0o700 });
    writeFileSync(
      unitPath,
      `[Unit]\nDescription=ResolveRoom Agent Runner\nAfter=network-online.target\n\n[Service]\n${codexExecutable ? `Environment=RESOLVEROOM_CODEX_EXECUTABLE=${systemdQuote(codexExecutable)}\n` : ''}ExecStart=${systemdQuote(installedNode)} ${systemdQuote(installedMain)} runner start --origin ${systemdQuote(baseUrl)}\nRestart=always\nRestartSec=3\n\n[Install]\nWantedBy=default.target\n`,
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
      `@echo off\r\n${codexExecutable ? `set "RESOLVEROOM_CODEX_EXECUTABLE=${codexExecutable.replaceAll('%', '%%')}"\r\n` : ''}${cmdQuote(installedNode)} ${cmdQuote(installedMain)} runner start --origin ${cmdQuote(baseUrl)}\r\n`,
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

export async function runRunnerCommand({
  args,
  baseUrl,
  token,
  request,
  mainScript,
  runnerScript,
}) {
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
      runnerScript: runnerScript ?? new URL(import.meta.url).pathname,
    });
    const status = await waitUntilOnline(request);
    return { installed, runner: status };
  }
  throw new Error(`Unknown runner command: ${subcommand}`);
}
