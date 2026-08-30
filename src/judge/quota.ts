import { DomainError } from '@/domain/errors';

export interface JudgeQuotaWait {
  reason: 'daily_quota_exhausted';
  retry_at: string;
}

export function nextDailyReset(now: number): string {
  const date = new Date(now);
  date.setUTCHours(24, 0, 0, 0);
  return date.toISOString();
}

// Workers AI binding errors encode the internal code as "3036: description".
// HTTP 429 alone also covers temporary capacity limits, NOT the daily allowance.
export function isDailyQuotaError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const value = error as { internalCode?: unknown; code?: unknown; message?: unknown };
  return (
    value.internalCode === 3036 ||
    value.code === 3036 ||
    (typeof value.message === 'string' && /^\s*3036:/.test(value.message))
  );
}

export class JudgeQuotaError extends DomainError {
  constructor(public readonly retryAt: string) {
    super(
      'JUDGE_QUOTA_EXHAUSTED',
      'Today’s free AI Judge allowance is used up. Your conversation is saved. Please wait for the next daily reset at 00:00 UTC, then retry the assessment.',
      429,
    );
  }
}
