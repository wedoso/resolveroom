import { opaqueId } from '@/domain/security';
import type { NotificationType } from '@/domain/types';
import type { Database } from '@/persistence/database';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}
export interface EmailProvider {
  readonly name: string;
  send(message: EmailMessage): Promise<void>;
}
export class ConsoleEmailProvider implements EmailProvider {
  readonly name = 'console';
  async send(message: EmailMessage) {
    void message; /* Development intentionally relies on persisted in-app delivery. */
  }
}
export class HttpEmailProvider implements EmailProvider {
  readonly name = 'http';
  constructor(
    private readonly url: string,
    private readonly key: string,
    private readonly from: string,
  ) {}
  async send(message: EmailMessage) {
    const response = await fetch(this.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: this.from, ...message }),
    });
    if (!response.ok) throw new Error(`Email provider returned ${response.status}.`);
  }
}

export class NotificationService {
  constructor(
    private readonly db: Database,
    private readonly email: EmailProvider = new ConsoleEmailProvider(),
  ) {}
  async forConflict(
    conflictId: string,
    type: NotificationType,
    title: string,
    body: string,
    excludeUserId?: string,
  ) {
    const parties = await this.db.getParties(conflictId);
    await Promise.all(
      parties.flatMap((party) =>
        party.userId && party.userId !== excludeUserId
          ? [this.forUser(party.userId, conflictId, type, title, body)]
          : [],
      ),
    );
  }
  async forUser(
    userId: string,
    conflictId: string | null,
    type: NotificationType,
    title: string,
    body: string,
  ) {
    const item = {
      id: opaqueId('ntf'),
      userId,
      conflictId,
      type,
      title,
      body,
      readAt: null,
      createdAt: new Date().toISOString(),
    };
    await this.db.createNotification(item);
    const user = await this.db.getUser(userId);
    if (user) {
      try {
        await this.email.send({ to: user.email, subject: title, text: body });
      } catch {
        /* Delivery failure must never interrupt conflict execution. */
      }
    }
    return item;
  }
}
