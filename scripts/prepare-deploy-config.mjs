import { readFile, writeFile } from 'node:fs/promises';

const fail = (message) => {
  throw new Error('[deploy-config] ' + message);
};

const required = (name) => {
  const value = process.env[name]?.trim();
  if (!value) fail('Missing required environment value: ' + name);
  return value;
};

const optionalPair = (left, right) => {
  const leftValue = process.env[left]?.trim();
  const rightValue = process.env[right]?.trim();
  if (Boolean(leftValue) !== Boolean(rightValue)) {
    fail(left + ' and ' + right + ' must be configured together.');
  }
  return Boolean(leftValue && rightValue);
};

const replaceOnce = (source, expected, replacement) => {
  const first = source.indexOf(expected);
  if (first === -1 || source.indexOf(expected, first + expected.length) !== -1) {
    fail('Expected exactly one config value matching: ' + expected);
  }
  return source.replace(expected, replacement);
};

const accountId = required('CLOUDFLARE_ACCOUNT_ID');
const databaseId = required('CLOUDFLARE_D1_DATABASE_ID');
required('CLOUDFLARE_API_TOKEN');

if (!/^[a-f0-9]{32}$/i.test(accountId)) {
  fail('CLOUDFLARE_ACCOUNT_ID must be a 32-character hexadecimal Cloudflare account ID.');
}
if (
  !/^(?:[a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i.test(
    databaseId,
  )
) {
  fail('CLOUDFLARE_D1_DATABASE_ID must be the complete D1 database ID returned by Cloudflare.');
}

const publicAppUrlValue = required('PUBLIC_APP_URL');
let publicAppUrl;
try {
  publicAppUrl = new URL(publicAppUrlValue);
} catch {
  fail('PUBLIC_APP_URL must be a valid URL.');
}
if (publicAppUrl.protocol !== 'https:' || publicAppUrl.origin !== publicAppUrlValue) {
  fail(
    'PUBLIC_APP_URL must be an HTTPS origin without a path, query, fragment, or trailing slash.',
  );
}

const googleConfigured = optionalPair('GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET');
const githubConfigured = optionalPair('GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET');
if (!googleConfigured && !githubConfigured) {
  fail('Production requires at least one complete OAuth provider pair (Google or GitHub).');
}

const judgeProvider = process.env.JUDGE_PROVIDER?.trim() || 'disabled';
if (!['disabled', 'llm'].includes(judgeProvider)) {
  fail('JUDGE_PROVIDER must be either disabled or llm.');
}
if (judgeProvider === 'llm') {
  required('JUDGE_API_URL');
  required('JUDGE_API_KEY');
  required('JUDGE_MODEL');
}

const emailProvider = process.env.EMAIL_PROVIDER?.trim() || 'console';
if (!['console', 'http'].includes(emailProvider)) {
  fail('EMAIL_PROVIDER must be either console or http.');
}
if (emailProvider === 'http') {
  required('EMAIL_API_URL');
  required('EMAIL_API_KEY');
  required('EMAIL_FROM');
}

const sourcePath = process.env.WRANGLER_SOURCE_CONFIG || 'wrangler.toml';
const outputPath = process.env.WRANGLER_DEPLOY_CONFIG || 'wrangler.deploy.toml';
let config = await readFile(sourcePath, 'utf8');
config = replaceOnce(
  config,
  'database_id = "REPLACE_WITH_PRODUCTION_D1_ID"',
  'database_id = "' + databaseId + '"',
);
config = replaceOnce(
  config,
  'JUDGE_PROVIDER = "disabled"',
  'JUDGE_PROVIDER = "' + judgeProvider + '"',
);
config = replaceOnce(
  config,
  'EMAIL_PROVIDER = "console"',
  'EMAIL_PROVIDER = "' + emailProvider + '"',
);
config = replaceOnce(
  config,
  'PUBLIC_APP_URL = "https://replace-with-production-domain.example"',
  'PUBLIC_APP_URL = "' + publicAppUrl.origin + '"',
);

await writeFile(outputPath, config, { mode: 0o600 });
console.log(
  '[deploy-config] Wrote ' +
    outputPath +
    ' for ' +
    publicAppUrl.origin +
    ' (' +
    judgeProvider +
    ' Judge, ' +
    emailProvider +
    ' email).',
);
