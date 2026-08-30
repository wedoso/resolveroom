import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const temporaryDirectories: string[] = [];
afterEach(() => {
  for (const path of temporaryDirectories.splice(0)) rmSync(path, { recursive: true });
});

function generate(provider: string) {
  const directory = mkdtempSync(join(tmpdir(), 'resolveroom-config-test-'));
  temporaryDirectories.push(directory);
  const output = join(directory, 'wrangler.toml');
  execFileSync(process.execPath, [resolve('scripts/prepare-deploy-config.mjs')], {
    stdio: 'pipe',
    env: {
      ...process.env,
      CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32),
      CLOUDFLARE_D1_DATABASE_ID: 'b'.repeat(32),
      CLOUDFLARE_API_TOKEN: 'synthetic-test-secret',
      PUBLIC_APP_URL: 'https://resolveroom.example',
      GITHUB_CLIENT_ID: 'synthetic-client-id',
      GITHUB_CLIENT_SECRET: 'synthetic-oauth-secret',
      GOOGLE_CLIENT_ID: '',
      GOOGLE_CLIENT_SECRET: '',
      JUDGE_API_URL: '',
      JUDGE_API_KEY: '',
      JUDGE_MODEL: '',
      JUDGE_PROVIDER: provider,
      EMAIL_PROVIDER: 'console',
      WRANGLER_SOURCE_CONFIG: resolve('wrangler.toml'),
      WRANGLER_DEPLOY_CONFIG: output,
    },
  });
  return readFileSync(output, 'utf8');
}

describe('Judge deployment configuration', () => {
  it('binds Workers AI without a new API key or embedded secrets', () => {
    const config = generate('workers_ai');
    expect(config).toContain('JUDGE_PROVIDER = "workers_ai"');
    expect(config).toContain('[ai]\nbinding = "AI"');
    expect(config).not.toContain('synthetic-test-secret');
    expect(config).not.toContain('synthetic-oauth-secret');
  });
  it('keeps production disabled unless explicitly configured', () => {
    expect(generate('disabled')).not.toContain('[ai]');
  });
  it('rejects mock in production and incomplete paid-provider configuration', () => {
    expect(() => generate('mock')).toThrow(/JUDGE_PROVIDER must/);
    expect(() => generate('llm')).toThrow(/JUDGE_API_URL/);
  });
});
