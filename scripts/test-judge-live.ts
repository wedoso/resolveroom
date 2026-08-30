import { unstable_dev } from 'wrangler';

// Exercise the real provider inside workerd (including its runtime AbortSignal).
// Only synthetic case text is submitted. This uses real account inference quota.
const worker = await unstable_dev('scripts/judge-smoke-worker.ts', {
  config: 'scripts/wrangler.judge-smoke.jsonc',
  local: false,
  ip: '127.0.0.1',
  port: 0,
  persist: false,
  envFiles: [],
  experimental: { disableExperimentalWarning: true, watch: false },
});
try {
  const response = await worker.fetch();
  if (!response.ok) throw new Error(`Live Judge smoke failed: HTTP ${response.status}.`);
  console.log(JSON.stringify(await response.json()));
} finally {
  await worker.stop();
}
