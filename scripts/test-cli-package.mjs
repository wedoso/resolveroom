#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import process from 'node:process';

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
for (const installerOnlyDependency of ['@openai/codex-sdk', 'ws']) {
  if (manifest.dependencies?.[installerOnlyDependency]) {
    throw new Error(
      `${installerOnlyDependency} must not be a top-level production dependency; the Runner installer owns it.`,
    );
  }
}

const npmCli = process.env.npm_execpath;
if (!npmCli || !existsSync(npmCli)) throw new Error('Run this gate through npm.');

const root = mkdtempSync(join(tmpdir(), 'resolveroom-cli-package-'));
const packageDirectory = join(root, 'package');
const consumerDirectory = join(root, 'consumer');
mkdirSync(packageDirectory);
mkdirSync(consumerDirectory);

try {
  const packed = JSON.parse(
    execFileSync(
      process.execPath,
      [npmCli, 'pack', '--json', '--pack-destination', packageDirectory],
      { encoding: 'utf8' },
    ),
  );
  const tarball = join(packageDirectory, packed[0].filename);
  writeFileSync(
    join(consumerDirectory, 'package.json'),
    JSON.stringify({ private: true, dependencies: { resolveroom: `file:${tarball}` } }),
  );
  execFileSync(process.execPath, [npmCli, 'install', '--omit=dev', '--no-audit', '--no-fund'], {
    cwd: consumerDirectory,
    env: { ...process.env, npm_config_cache: join(root, 'npm-cache') },
    stdio: 'ignore',
  });

  for (const installerOnlyDependency of ['@openai/codex-sdk', 'ws']) {
    if (existsSync(join(consumerDirectory, 'node_modules', installerOnlyDependency))) {
      throw new Error(`${installerOnlyDependency} leaked into the first-run CLI package.`);
    }
  }

  const output = execFileSync(
    process.execPath,
    [
      join(consumerDirectory, 'node_modules', 'resolveroom', 'scripts', 'resolveroom-agent.mjs'),
      '--help',
    ],
    { encoding: 'utf8' },
  );
  if (!output.includes('ResolveRoom agent CLI'))
    throw new Error('The packed ResolveRoom CLI did not start successfully.');

  const installedRunner = join(
    consumerDirectory,
    'node_modules',
    'resolveroom',
    'scripts',
    'resolveroom-runner.mjs',
  );
  const {
    launchAgentPlist,
    prepareRunnerInstall,
    resolveRunnerPackageManagerPath,
    runnerDependencyInstallInvocation,
  } = await import(pathToFileURL(installedRunner).href);
  const npmInvocation = runnerDependencyInstallInvocation({
    packageManagerPath: npmCli,
    userAgent: 'npm/11.0.0 node/v22.0.0',
    nodeExecutable: process.execPath,
  });
  if (npmInvocation.command !== process.execPath || !npmInvocation.args.includes('--omit=dev'))
    throw new Error('The Runner did not preserve npm installation support.');

  const bundledPnpm = join(root, 'pnpm');
  writeFileSync(
    bundledPnpm,
    '#!/usr/bin/env sh\nprintf \'%s\\n\' "$@" > "$FAKE_PNPM_ARGS_FILE"\nexit 0\n',
    { mode: 0o700 },
  );
  const isolatedStore = join(root, 'isolated-store');
  const pnpmInvocation = runnerDependencyInstallInvocation({
    packageManagerPath: bundledPnpm,
    userAgent: 'pnpm/11.0.0 npm/? node/v24.0.0',
    nodeExecutable: process.execPath,
    storeDirectory: isolatedStore,
  });
  if (
    pnpmInvocation.command !== bundledPnpm ||
    !pnpmInvocation.args.includes('--prod') ||
    !pnpmInvocation.args.includes('--store-dir') ||
    !pnpmInvocation.args.includes(isolatedStore)
  )
    throw new Error('The Runner did not recognize the Codex-bundled pnpm executable.');

  const bundledDependencies = join(root, 'bundled-runtime', 'dependencies');
  const bundledNode = join(bundledDependencies, 'node', 'bin', 'node');
  const discoveredPnpm = join(bundledDependencies, 'bin', 'fallback', 'pnpm');
  mkdirSync(join(bundledDependencies, 'node', 'bin'), { recursive: true });
  mkdirSync(join(bundledDependencies, 'bin', 'fallback'), { recursive: true });
  writeFileSync(bundledNode, '', { mode: 0o700 });
  writeFileSync(discoveredPnpm, '#!/usr/bin/env sh\nexit 0\n', { mode: 0o700 });
  const resolvedPnpm = resolveRunnerPackageManagerPath({
    configuredPath: '',
    npmExecPath: '',
    nodeExecutable: bundledNode,
    platform: 'darwin',
  });
  if (resolvedPnpm !== discoveredPnpm)
    throw new Error('The Runner could not discover pnpm beside the Codex-bundled Node runtime.');

  const preparedRoot = join(root, 'prepared-runner');
  const fakePnpmArguments = join(root, 'fake-pnpm-arguments.txt');
  mkdirSync(join(preparedRoot, 'runtime'), { recursive: true });
  writeFileSync(join(preparedRoot, 'runtime', 'node'), '#!/usr/bin/env sh\nexit 99\n', {
    mode: 0o700,
  });
  const previousPackageManager = process.env.RESOLVEROOM_PACKAGE_MANAGER;
  const previousArgumentsFile = process.env.FAKE_PNPM_ARGS_FILE;
  process.env.RESOLVEROOM_PACKAGE_MANAGER = bundledPnpm;
  process.env.FAKE_PNPM_ARGS_FILE = fakePnpmArguments;
  try {
    const prepared = prepareRunnerInstall({
      mainScript: join(
        consumerDirectory,
        'node_modules',
        'resolveroom',
        'scripts',
        'resolveroom-agent.mjs',
      ),
      runnerScript: installedRunner,
      root: preparedRoot,
    });
    const installedVersion = execFileSync(prepared.installedNode, ['--version'], {
      encoding: 'utf8',
    }).trim();
    if (installedVersion !== process.version)
      throw new Error('The Runner did not replace and validate a stale copied Node runtime.');
    const installArguments = readFileSync(fakePnpmArguments, 'utf8');
    if (!installArguments.includes('--store-dir') || !installArguments.includes('pnpm-store'))
      throw new Error('The Runner dependency install did not isolate the pnpm store.');
  } finally {
    if (previousPackageManager === undefined) delete process.env.RESOLVEROOM_PACKAGE_MANAGER;
    else process.env.RESOLVEROOM_PACKAGE_MANAGER = previousPackageManager;
    if (previousArgumentsFile === undefined) delete process.env.FAKE_PNPM_ARGS_FILE;
    else process.env.FAKE_PNPM_ARGS_FILE = previousArgumentsFile;
  }

  const plist = launchAgentPlist({
    label: 'dev.resolveroom.test',
    installedNode: '/private/runtime/node',
    installedMain: '/private/runner.mjs',
    baseUrl: 'https://resolveroom.example',
    logPath: '/private/runner.log',
  });
  if (!plist.includes('RESOLVEROOM_CREDENTIAL_STORE') || !plist.includes('<string>file</string>'))
    throw new Error('The macOS service did not force the private Runner credential store.');
  process.stdout.write(
    'Packed CLI isolates pnpm, replaces stale runtimes, and configures safe Runner recovery.\n',
  );
} finally {
  rmSync(root, { recursive: true, force: true });
}
