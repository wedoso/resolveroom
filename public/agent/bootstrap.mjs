import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';

const bootstrapUrl = process.env.RESOLVEROOM_BOOTSTRAP_URL;
const expectedBundleHash = process.env.RESOLVEROOM_BUNDLE_SHA256;
const argumentOffset = Number(process.env.RESOLVEROOM_BOOTSTRAP_ARGUMENT_OFFSET ?? 0);
if (!bootstrapUrl || !expectedBundleHash || !Number.isSafeInteger(argumentOffset))
  throw new Error('ResolveRoom bootstrap metadata is incomplete.');

const origin = new URL(bootstrapUrl).origin;
if (!/^https:\/\//.test(origin) && !/^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(origin))
  throw new Error('ResolveRoom bootstrap requires HTTPS or a local development origin.');

const bundleUrl = `${origin}/agent/resolveroom.mjs`;
const response = await fetch(bundleUrl, {
  headers: { accept: 'text/javascript' },
  redirect: 'error',
});
if (!response.ok) throw new Error(`ResolveRoom bootstrap download failed (${response.status}).`);
const bytes = Buffer.from(await response.arrayBuffer());
const actualHash = createHash('sha256').update(bytes).digest('hex');
if (actualHash !== expectedBundleHash)
  throw new Error('ResolveRoom CLI integrity verification failed.');

const root = mkdtempSync(join(tmpdir(), 'resolveroom-bootstrap-'));
const bundlePath = join(root, 'resolveroom.mjs');
try {
  writeFileSync(bundlePath, bytes, { mode: 0o700 });
  chmodSync(bundlePath, 0o700);
  const result = spawnSync(process.execPath, [bundlePath, ...process.argv.slice(argumentOffset)], {
    env: { ...process.env, RESOLVEROOM_BOOTSTRAP_ORIGIN: origin },
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  rmSync(root, { recursive: true, force: true });
}
