#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
  process.stdout.write(
    'Packed CLI installs without Runner-only dependencies and starts successfully.\n',
  );
} finally {
  rmSync(root, { recursive: true, force: true });
}
