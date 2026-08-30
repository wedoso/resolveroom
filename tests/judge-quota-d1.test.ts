import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getPlatformProxy } from 'wrangler';
import { D1Store } from '@/persistence/d1';

describe('Judge quota persistence on local D1', () => {
  it('applies the migration and retains the newest reset across store instances', async () => {
    const proxy = await getPlatformProxy<{ DB: D1Database }>({
      persist: false,
      remoteBindings: false,
    });
    try {
      const migration = readFileSync(
        new URL('../migrations/0004_judge_cooldowns.sql', import.meta.url),
        'utf8',
      );
      await proxy.env.DB.exec(migration.replace(/^--.*$/gm, '').replaceAll('\n', ' '));
      const first = new D1Store(proxy.env.DB);
      expect(await first.getJudgeCooldown('workers_ai')).toBeNull();
      await first.saveJudgeCooldown('workers_ai', '2026-08-30T00:00:00.000Z');
      const second = new D1Store(proxy.env.DB);
      expect(await second.getJudgeCooldown('workers_ai')).toBe('2026-08-30T00:00:00.000Z');
      await second.saveJudgeCooldown('workers_ai', '2026-08-31T00:00:00.000Z');
      await first.saveJudgeCooldown('workers_ai', '2026-08-30T00:00:00.000Z');
      expect(await first.getJudgeCooldown('workers_ai')).toBe('2026-08-31T00:00:00.000Z');
      expect(await second.getJudgeCooldown('other_provider')).toBeNull();
    } finally {
      await proxy.dispose();
    }
  }, 60_000);
});
