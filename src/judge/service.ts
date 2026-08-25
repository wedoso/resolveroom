import { DomainError } from '@/domain/errors';
import { opaqueId } from '@/domain/security';
import type { Database } from '@/persistence/database';
import type { JudgeProvider } from './providers';
import { judgeInputFromEvents, validateVerdict } from './providers';
import { NotificationService } from '@/notifications/service';

export class JudgeService {
  constructor(
    private readonly db: Database,
    private readonly provider: JudgeProvider,
    private readonly notifications = new NotificationService(db),
  ) {}
  async run(conflictId: string) {
    const conflict = await this.db.getConflict(conflictId);
    if (!conflict) throw new DomainError('NOT_FOUND', 'Conflict not found.', 404);
    const existing = await this.db.getVerdict(conflictId);
    if (existing) return existing;
    if (conflict.status !== 'judging')
      throw new DomainError('INVALID_STATE', 'Conflict is not ready for judging.', 409);
    const events = await this.db.listEvents(conflictId);
    const input = judgeInputFromEvents(conflict, events);
    let value: unknown;
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        value = await this.provider.evaluate(input);
        const verdict = validateVerdict(value, input);
        const record = {
          id: opaqueId('ver'),
          conflictId,
          verdict,
          provider: this.provider.name,
          createdAt: new Date().toISOString(),
        };
        await this.db.saveVerdict(record);
        await this.db.appendEvent({
          conflictId,
          eventType: 'verdict_issued',
          actorType: 'judge',
          actorId: null,
          partyId: null,
          partyRole: null,
          visibility: 'case',
          payload: { verdict_id: record.id, protocol_type: verdict.protocolType },
        });
        await this.db.updateConflict({
          ...conflict,
          status: 'resolved',
          resolvedAt: record.createdAt,
          updatedAt: record.createdAt,
          version: conflict.version + 1,
        });
        await this.notifications.forConflict(
          conflictId,
          'verdict_ready',
          'Your verdict is ready',
          'The Judge has completed an advisory assessment of the case.',
        );
        await this.db.recordAnalytics('conflict_resolved', null, conflictId, {
          protocol_type: verdict.protocolType,
        });
        return record;
      } catch (error) {
        lastError = error;
      }
    }
    throw new DomainError(
      'JUDGE_FAILED',
      lastError instanceof Error
        ? `Judge failed after retry: ${lastError.message}`
        : 'Judge failed after retry.',
      502,
    );
  }
}
