import { spawn } from 'node:child_process';

const secretNames = [
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GITHUB_CLIENT_ID',
  'GITHUB_CLIENT_SECRET',
  'JUDGE_API_URL',
  'JUDGE_API_KEY',
  'JUDGE_MODEL',
  'EMAIL_API_URL',
  'EMAIL_API_KEY',
  'EMAIL_FROM',
];

const configuredNames = secretNames.filter((name) => Boolean(process.env[name]));
const removedNames = secretNames.filter((name) => !process.env[name]);
const secretPayload = Object.fromEntries(
  secretNames.map((name) => [name, process.env[name] || null]),
);

if (configuredNames.length === 0) {
  throw new Error('[deploy-secrets] No configured Worker secrets were found.');
}

const configPath = process.env.WRANGLER_DEPLOY_CONFIG || 'wrangler.deploy.toml';
const executable =
  process.env.WRANGLER_EXECUTABLE || (process.platform === 'win32' ? 'npx.cmd' : 'npx');
const wrangler = spawn(executable, ['wrangler', 'secret', 'bulk', '--config', configPath], {
  env: process.env,
  stdio: ['pipe', 'inherit', 'inherit'],
});

wrangler.stdin.on('error', (error) => {
  if (error.code !== 'EPIPE') throw error;
});
wrangler.stdin.end(JSON.stringify(secretPayload));

const exitCode = await new Promise((resolve, reject) => {
  wrangler.once('error', reject);
  wrangler.once('close', resolve);
});

if (exitCode !== 0) {
  throw new Error('[deploy-secrets] Wrangler secret bulk failed with exit code ' + exitCode + '.');
}

console.log(
  '[deploy-secrets] Synced Worker secrets: ' +
    configuredNames.join(', ') +
    '. Removed unused managed secrets: ' +
    removedNames.join(', '),
);
