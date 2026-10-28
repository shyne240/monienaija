/* eslint-disable @typescript-eslint/require-await */
import type { NotificationProvider, NotificationSendRequest, NotificationSendResult } from './notification.types';

/**
 * ARENA3-NOTIFICATION-EMAIL — email provider adapters, mirroring the SMS provider posture
 * (notification-provider.interface.ts): provider-neutral seam, no invented credentials,
 * honest GENERATED vs DISPATCHED vs PROVIDER-ACCEPTED distinctions.
 *
 * `SENT` for email strictly means "accepted by the provider API" — confirmed recipient
 * delivery (bounce/open/delivered webhooks or status polling) is a documented future
 * enhancement, exactly like the Robase SMS posture.
 */

/**
 * Dark-posture provider: the default. Email is NOT configured, so no EMAIL delivery can
 * be attempted. The dispatcher does not create EMAIL intents while this provider is selected;
 * send() also fails closed for any direct caller (e.g. a pending delivery after a
 * configuration rollback).
 */
export class NoneEmailProvider implements NotificationProvider {
  readonly name = 'none';

  async send(): Promise<NotificationSendResult> {
    return { success: false, error: 'EMAIL_PROVIDER_NOT_CONFIGURED' };
  }
}

/**
 * Console/Test adapter for dev+test — logs and stores in memory. NOT a fake delivery:
 * no invented provider credentials/API keys (same contract as ConsoleNotificationProvider).
 */
export class ConsoleEmailProvider implements NotificationProvider {
  readonly name = 'console';
  public readonly sent: Array<{ providerRef: string; sentAt: Date }> = [];

  async send(request: NotificationSendRequest): Promise<NotificationSendResult> {
    if (request.channel !== 'EMAIL') {
      return { success: false, error: 'CONSOLE_EMAIL_UNSUPPORTED_CHANNEL' };
    }
    const providerRef = `console-email-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.sent.push({ providerRef, sentAt: new Date() });
    console.log(JSON.stringify({ event: 'notification.console_simulated', channel: 'EMAIL' }));
    return { success: true, providerRef };
  }

  clear(): void {
    this.sent.length = 0;
  }
}

/**
 * Test provider that can simulate failure for isolation tests (mirrors TestNotificationProvider).
 */
export class TestEmailProvider implements NotificationProvider {
  readonly name = 'test';
  public readonly sent: Array<NotificationSendRequest & { providerRef: string; sentAt: Date }> = [];
  public shouldFail = false;
  public failMessage = 'Simulated email provider failure';

  async send(request: NotificationSendRequest): Promise<NotificationSendResult> {
    if (request.channel !== 'EMAIL') {
      return { success: false, error: 'TEST_EMAIL_UNSUPPORTED_CHANNEL' };
    }
    if (this.shouldFail) {
      return { success: false, error: this.failMessage, failureDisposition: 'RETRYABLE' };
    }
    const providerRef = `test-email-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.sent.push({ ...request, providerRef, sentAt: new Date() });
    return { success: true, providerRef };
  }

  clear(): void {
    this.sent.length = 0;
    this.shouldFail = false;
  }
}
