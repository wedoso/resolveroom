import { describe, expect, it, vi } from 'vitest';
import worker, { type Env } from '@/worker/index';

describe('Worker conflict coordination routing', () => {
  it('routes every conflict-scoped API path through the same Durable Object', async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 204 }));
    const idFromName = vi.fn((value: string) => value as never);
    const env = {
      CONFLICT_ROOMS: {
        idFromName,
        get: vi.fn(() => ({ fetch })),
      },
    } as unknown as Env;
    const context = {} as ExecutionContext;
    const conflictId = 'con_coordination_test';
    const paths = [
      `/api/v1/conflicts/${conflictId}`,
      `/api/v1/conflicts/${conflictId}/events`,
      `/api/v1/conflicts/${conflictId}/brief`,
      `/api/v1/conflicts/${conflictId}/actions`,
      `/api/v1/conflicts/${conflictId}/agent/pairings`,
      `/api/v1/conflicts/${conflictId}/share-links/link_1`,
    ];

    for (const path of paths)
      expect(
        (await worker.fetch(new Request(`https://resolveroom.test${path}`), env, context)).status,
      ).toBe(204);

    expect(idFromName).toHaveBeenCalledTimes(paths.length);
    expect(idFromName).toHaveBeenCalledWith(conflictId);
    expect(fetch).toHaveBeenCalledTimes(paths.length);
  });
});
