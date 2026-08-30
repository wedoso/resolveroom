import { DomainError } from '@/domain/errors';
import { opaqueId } from '@/domain/security';
import type { Database } from '@/persistence/database';
import type { JudgeProvider } from './providers';
import { judgeInputFromEvents, validateVerdict } from './providers';
import { NotificationService } from '@/notifications/service';
import type { JudgeVerdict } from '@/domain/types';

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
    if (existing && conflict.status === 'resolved') return existing;
    if (conflict.resolutionMode !== 'judge')
      throw new DomainError(
        'INVALID_STATE',
        'This conflict does not authorize AI assessment.',
        409,
      );
    if (conflict.status !== 'judging')
      throw new DomainError('INVALID_STATE', 'Conflict is not ready for judging.', 409);
    const events = await this.db.listEvents(conflictId);
    const input = judgeInputFromEvents(conflict, events);
    let verdict: JudgeVerdict | undefined = existing?.verdict;
    for (let attempt = 0; !verdict && attempt < 2; attempt += 1) {
      try {
        verdict = validateVerdict(await this.provider.evaluate(input), input);
      } catch {
        // Do not expose upstream errors: they can echo confidential request text.
      }
    }
    if (!verdict)
      throw new DomainError(
        'JUDGE_FAILED',
        'Judge failed after retry. The provider may be unavailable, out of quota, or unable to produce a valid assessment. No verdict was saved; you can retry later.',
        502,
      );
    // Persistence failures are not inference failures. Keep a saved verdict on
    // retry, finish its state transition, and never pay for a second assessment.
    const record = existing ?? {
      id: opaqueId('ver'),
      conflictId,
      verdict,
      provider: this.provider.name,
      createdAt: new Date().toISOString(),
    };
    if (!existing) await this.db.saveVerdict(record);
    if (!events.some((event) => event.eventType === 'verdict_issued'))
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
  }
}
