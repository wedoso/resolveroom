#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import process from 'node:process';

const repository = resolve(import.meta.dirname, '..');
const bundle = join(repository, 'public', 'agent', 'resolveroom.mjs');
const manifest = JSON.parse(
  readFileSync(join(repository, 'public', 'agent', 'manifest.json'), 'utf8'),
);
if (!existsSync(bundle)) throw new Error('Run npm run agent:bundle before this gate.');

const source = readFileSync(bundle);
const bootstrapSource = readFileSync(join(repository, 'public', 'agent', 'bootstrap.mjs'));
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
for (const forbidden of ['github.com', 'registry.npmjs.org', '@openai/codex-sdk']) {
  if (source.includes(Buffer.from(forbidden)))
    throw new Error(`The self-contained CLI references forbidden installer host ${forbidden}.`);
}
if (!/^[a-f0-9]{64}$/.test(manifest.bootstrap.sha256))
  throw new Error('The bootstrap SHA-256 is invalid.');
if (!/^[a-f0-9]{64}$/.test(manifest.bundle.sha256))
  throw new Error('The CLI bundle SHA-256 is invalid.');
if (sha256(bootstrapSource) !== manifest.bootstrap.sha256)
  throw new Error('The bootstrap file does not match its published SHA-256.');
if (sha256(source) !== manifest.bundle.sha256)
  throw new Error('The CLI bundle does not match its published SHA-256.');

const root = mkdtempSync(join(tmpdir(), 'resolveroom-self-contained-cli-'));
const forbiddenTools = join(root, 'forbidden-tools');
const forbiddenMarker = join(root, 'forbidden-called');
mkdirSync(forbiddenTools);

try {
  if (process.platform !== 'win32') {
    for (const tool of ['curl', 'git', 'npm', 'npx', 'pnpm'])
      writeFileSync(
        join(forbiddenTools, tool),
        `#!/bin/sh\nprintf '%s\\n' '${tool}' >> '${forbiddenMarker}'\nexit 97\n`,
        { mode: 0o700 },
      );
  }
  const output = execFileSync(process.execPath, [bundle, '--help'], {
    encoding: 'utf8',
    env: { ...process.env, PATH: forbiddenTools, npm_config_offline: 'true' },
  });
  if (!output.includes('ResolveRoom agent CLI'))
    throw new Error('The self-contained ResolveRoom CLI did not start.');
  if (existsSync(forbiddenMarker))
    throw new Error('CLI startup invoked an external installer tool.');

  const sourceRunner = join(repository, 'scripts', 'resolveroom-runner.mjs');
  const { launchAgentPlist, prepareRunnerInstall, resolveCodexExecutable } = await import(
    pathToFileURL(sourceRunner).href
  );
  const fakeCodex = join(root, process.platform === 'win32' ? 'codex.cmd' : 'codex');
  writeFileSync(
    fakeCodex,
    process.platform === 'win32'
      ? '@echo off\r\necho codex-test\r\n'
      : '#!/bin/sh\necho codex-test\n',
    { mode: 0o700 },
  );
  const previousCodex = process.env.RESOLVEROOM_CODEX_EXECUTABLE;
  const previousProvider = process.env.RESOLVEROOM_RUNNER_PROVIDER;
  process.env.RESOLVEROOM_CODEX_EXECUTABLE = fakeCodex;
  process.env.RESOLVEROOM_RUNNER_PROVIDER = 'codex';
  try {
    if (resolveCodexExecutable() !== fakeCodex)
      throw new Error('The Runner did not validate the configured Codex executable.');
    const prepared = prepareRunnerInstall({
      mainScript: bundle,
      runnerScript: bundle,
      root: join(root, 'installed-runner'),
    });
    const installedVersion = execFileSync(prepared.installedNode, ['--version'], {
      encoding: 'utf8',
    }).trim();
    if (installedVersion !== process.version)
      throw new Error('The Runner did not copy and validate the bundled Node runtime.');
    if (prepared.codexExecutable !== fakeCodex)
      throw new Error('The installed Runner did not preserve the validated Codex executable.');
  } finally {
    if (previousCodex === undefined) delete process.env.RESOLVEROOM_CODEX_EXECUTABLE;
    else process.env.RESOLVEROOM_CODEX_EXECUTABLE = previousCodex;
    if (previousProvider === undefined) delete process.env.RESOLVEROOM_RUNNER_PROVIDER;
    else process.env.RESOLVEROOM_RUNNER_PROVIDER = previousProvider;
  }

  const plist = launchAgentPlist({
    label: 'dev.resolveroom.test',
    installedNode: '/private/runtime/node',
    installedMain: '/private/runner.mjs',
    baseUrl: 'https://resolveroom.example',
    logPath: '/private/runner.log',
    codexExecutable: '/Applications/ChatGPT.app/Contents/Resources/codex',
  });
  if (!plist.includes('RESOLVEROOM_CREDENTIAL_STORE'))
    throw new Error('The macOS service did not force the private credential store.');
  if (!plist.includes('RESOLVEROOM_CODEX_EXECUTABLE'))
    throw new Error('The macOS service did not preserve the validated Codex executable.');

  const cleanupRoot = join(root, 'cleanup-runner');
  const configRoot = join(root, 'cleanup-config');
  const credentialPath = join(configRoot, 'resolveroom', 'credentials.json');
  mkdirSync(cleanupRoot, { recursive: true });
  mkdirSync(join(configRoot, 'resolveroom'), { recursive: true });
  writeFileSync(join(cleanupRoot, 'runner.log'), 'local test log');
  writeFileSync(
    credentialPath,
    JSON.stringify({
      'https://resolveroom.example': 'rr_agent_cleanup_test',
      'https://other.example': 'rr_agent_other_test',
    }),
    { mode: 0o600 },
  );
  const cleanupEnvironment = {
    ...process.env,
    RESOLVEROOM_RUNNER_ROOT: cleanupRoot,
    RESOLVEROOM_RUNNER_SERVICE_MODE: 'detached',
    RESOLVEROOM_CREDENTIAL_STORE: 'file',
    XDG_CONFIG_HOME: configRoot,
  };
  const cleaned = JSON.parse(
    execFileSync(
      process.execPath,
      [bundle, 'runner', 'uninstall', '--origin', 'https://resolveroom.example'],
      { encoding: 'utf8', env: cleanupEnvironment },
    ),
  );
  if (!cleaned.cleaned || existsSync(cleanupRoot))
    throw new Error('Runner cleanup did not remove the private runtime.');
  const remainingCredentials = JSON.parse(readFileSync(credentialPath, 'utf8'));
  if (remainingCredentials['https://resolveroom.example'])
    throw new Error('Runner cleanup did not remove the selected origin credential.');
  if (remainingCredentials['https://other.example'] !== 'rr_agent_other_test')
    throw new Error('Runner cleanup changed an unrelated origin credential.');
  const repeated = JSON.parse(
    execFileSync(
      process.execPath,
      [bundle, 'runner', 'uninstall', '--origin', 'https://resolveroom.example'],
      { encoding: 'utf8', env: cleanupEnvironment },
    ),
  );
  if (!repeated.already_clean) throw new Error('Runner cleanup is not idempotent.');

  process.stdout.write(
    'Self-contained CLI starts offline, installs without package managers, and cleans Runner state idempotently.\n',
  );
} finally {
  rmSync(root, { recursive: true, force: true });
}
