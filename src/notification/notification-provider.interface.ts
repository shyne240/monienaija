/* eslint-disable @typescript-eslint/require-await */
import type {
  NotificationProvider,
  NotificationSendRequest,
  NotificationSendResult,
} from './notification.types';

/**
 * Console/Test adapter — provider-neutral foundation.
 * Logs to console and stores deliveries in-memory for tests.
 * NOT a fake delivery: no invented provider credentials/API keys.
 * Distinguishes GENERATED vs DISPATCHED vs PROVIDER DELIVERY via providerRef.
 */
export class ConsoleNotificationProvider implements NotificationProvider {
  readonly name = 'console';
  public readonly sent: Array<{ providerRef: string; sentAt: Date }> = [];

  async send(request: NotificationSendRequest): Promise<NotificationSendResult> {
    void request;
    const providerRef = `console-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    // No destination, recipient, body, credential, event payload, or subject in logs or memory.
    this.sent.push({ providerRef, sentAt: new Date() });
    console.log(JSON.stringify({ event: 'notification.console_simulated', channel: 'SMS' }));
    return { success: true, providerRef };
  }

  clear(): void {
    this.sent.length = 0;
  }
}

/**
 * Test provider that can simulate failure for isolation tests.
 */
export class TestNotificationProvider implements NotificationProvider {
  readonly name = 'test';
  public readonly sent: Array<NotificationSendRequest & { providerRef: string; sentAt: Date }> = [];
  public shouldFail = false;
  public failMessage = 'Simulated provider failure';

  async send(request: NotificationSendRequest): Promise<NotificationSendResult> {
    if (this.shouldFail) {
      return { success: false, error: this.failMessage, failureDisposition: 'RETRYABLE' };
    }
    const providerRef = `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.sent.push({ ...request, providerRef, sentAt: new Date() });
    return { success: true, providerRef };
  }

  clear(): void {
    this.sent.length = 0;
    this.shouldFail = false;
  }
}
