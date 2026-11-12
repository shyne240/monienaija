/* eslint-disable @typescript-eslint/require-await */
import { randomUUID } from 'node:crypto';
import { ForbiddenException, Logger } from '@nestjs/common';
import type { DataSource } from 'typeorm';

import { AdminCustomerCredentialsController } from '../src/admin/admin-customer-credentials.controller';
import { AdminNotificationController } from '../src/admin/admin-notification.controller';
import type { AuthorizationService } from '../src/authorization/authorization.service';
import { sanitizeDiagnosticIdentifier } from '../src/common/sensitive-data-redaction';
import { BrevoEmailProvider, type BrevoFetchFn } from '../src/notification/brevo-email-provider';
import { mapEventToIntents } from '../src/notification/notification-event-map';
import { NotificationTemplateService } from '../src/notification/notification-template.service';
import type { NotificationSendRequest } from '../src/notification/notification.types';

describe('Mission 25C: diagnostic identifiers and honest response boundaries', () => {
  it.each([
    'phone:+2348012345678',
    'email:person@example.test',
    'NIN:12345678901',
    'otp=123456',
    'PIN:1234',
    'verification_code=123456',
    'phone%3A%2B2348012345678',
    'phone:+234 (801) 234-5678',
    'NIN:123-4567-8901',
    'Bearer abcdefgh123456',
    'password=SECRET_SENTINEL_25C',
  ])('masks the sensitive identifier %s', (value) => {
    const safe = sanitizeDiagnosticIdentifier(value);
    expect(safe).toBeDefined();
    expect(safe).not.toContain(value);
  });

  it('preserves safe UUIDs, prefixed UUIDs and short diagnostic ids byte-for-byte', () => {
    const uuid = randomUUID();
    for (const value of [uuid, `support-ticket:${uuid}`, 'corr-42', 'transfer.completed:req-1']) {
      expect(sanitizeDiagnosticIdentifier(value)).toBe(value);
      expect(sanitizeDiagnosticIdentifier(sanitizeDiagnosticIdentifier(value))).toBe(value);
    }
    expect(sanitizeDiagnosticIdentifier('[REDACTED]')).toBe('[REDACTED]');
  });

  it('masks historical delivery correlation, causation and other identifiers for authorized readers; denies unauthorized readers before querying', async () => {
    const principal = {
      type: 'OPERATOR',
      principalId: 'operator-1',
      roles: [],
      scopes: ['notification.view_deliveries'],
    } as never;
    const query = jest
      .fn()
      .mockResolvedValueOnce([{ count: '1' }])
      .mockResolvedValueOnce([
        {
          id: randomUUID(),
          event_type: 'transfer.completed',
          event_key: 'otp=123456',
          aggregate_type: 'TRANSFER',
          aggregate_id: 'phone:+2348012345678',
          recipient_type: 'CUSTOMER',
          recipient_id: randomUUID(),
          channel: 'SMS',
          status: 'SENT',
          attempts: 1,
          provider_ref: null,
          correlation_id: 'email:person@example.test',
          causation_id: 'password=SECRET_SENTINEL_25C',
          last_error: 'Bearer SECRET_SENTINEL_25C',
          created_at: new Date(),
          updated_at: new Date(),
          sent_at: new Date(),
          failed_at: null,
        },
      ]);
    const auth = { requireFunction: jest.fn().mockResolvedValue('operator-1') };
    const controller = new AdminNotificationController(
      { query } as unknown as DataSource,
      auth as unknown as AuthorizationService,
    );
    const response = await controller.listDeliveries({
      headers: {},
      authorizationPrincipal: principal,
    });
    const text = JSON.stringify(response);
    for (const secret of ['123456', '+2348012345678', 'person@example.test', 'SECRET_SENTINEL_25C'])
      expect(text).not.toContain(secret);
    expect(response.data[0]).toMatchObject({
      eventType: 'transfer.completed',
      eventKey: '[REDACTED]',
      aggregateId: '[REDACTED]',
      correlationId: '[REDACTED]',
    });
    auth.requireFunction.mockRejectedValueOnce(new ForbiddenException());
    query.mockClear();
    await expect(
      controller.listDeliveries({ headers: {}, authorizationPrincipal: principal }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(query).not.toHaveBeenCalled();
  });

  it('masks causation at the intent boundary, and never maps an unknown or internal support visibility marker', () => {
    const customerId = randomUUID();
    const trace = { correlationId: 'corr-1', causationId: 'otp=123456' };
    const intents = mapEventToIntents('customer.funding.approved', { customerId }, trace);
    expect(intents[0]).toMatchObject({ correlationId: 'corr-1', causationId: '[REDACTED]' });
    expect(mapEventToIntents('support.ticket.message_added', { customerId }, trace)).toEqual([]);
    expect(
      mapEventToIntents('support.ticket.message_added', { customerId, isInternal: true }, trace),
    ).toEqual([]);
  });

  it('renders the existing support status producer fields with only safe status and reference values', () => {
    const templates = new NotificationTemplateService();
    const result = templates.buildMessage('support.ticket.status_changed', {
      ticketId: 'ab12cd34-0000-4000-8000-000000000000',
      to: 'IN_PROGRESS',
      from: 'OPEN',
      body: 'SECRET_SUPPORT_BODY',
      actor: 'SECRET_ACTOR',
    });
    expect(result).toContain('ab12cd34');
    expect(result).toContain('IN_PROGRESS');
    expect(result).not.toContain('SECRET');
    const unsafe = templates.buildMessage('support.ticket.status_changed', {
      ticketId: 'password=123456',
      to: 'CLOSED; SECRET',
    });
    expect(unsafe).toContain('your request');
    expect(unsafe).toContain('updated');
    expect(unsafe).not.toContain('123456');
  });

  it.each([
    [false, 'robase', 'NOT_CONFIRMED', /not confirmed/i],
    [true, 'robase', 'PROVIDER_ACCEPTED', /provider accepted.*not confirmed/i],
    [true, 'console', 'SIMULATED', /simulated/i],
    [true, 'test', 'SIMULATED', /simulated/i],
  ])(
    'credential response reports delivery=%s and provider=%s as %s',
    (delivered, provider, status, notice) => {
      const controller = new AdminCustomerCredentialsController(
        undefined as never,
        undefined as never,
        undefined as never,
        undefined as never,
        undefined as never,
        undefined as never,
      );
      const view = (
        controller as unknown as { issuanceView: (...args: unknown[]) => Record<string, unknown> }
      ).issuanceView(
        randomUUID(),
        randomUUID(),
        null,
        { channel: 'SMS', delivered, destination: null, provider },
        false,
      );
      expect(view.deliveryStatus).toBe(status);
      expect(view.deliveryNotice).toMatch(notice);
      expect(view.deliveryNotice).not.toMatch(/credential delivered/i);
    },
  );

  it('never misreports a console result as vendor acceptance when the cached name is stale', () => {
    const controller = new AdminCustomerCredentialsController(
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
    );
    const view = (
      controller as unknown as { issuanceView: (...args: unknown[]) => Record<string, unknown> }
    ).issuanceView(
      randomUUID(),
      randomUUID(),
      null,
      { channel: 'SMS', delivered: true, destination: null, provider: 'robase', simulated: true },
      false,
    );
    expect(view.deliveryStatus).toBe('SIMULATED');
    expect(view.delivery).toEqual({
      channel: 'SMS',
      delivered: true,
      destination: null,
      provider: 'robase',
    });
    expect(view.deliveryNotice).toMatch(/simulated/i);
  });

  it.each(['success', 'rejected', 'exception'] as const)(
    'sanitizes Brevo diagnostic log identifiers on %s without changing the request identity',
    async (mode) => {
      const logs: string[] = [];
      const log = jest.spyOn(Logger.prototype, 'log').mockImplementation((...args: unknown[]) => {
        logs.push(JSON.stringify(args));
      });
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation((...args: unknown[]) => {
        logs.push(JSON.stringify(args));
      });
      const fetch = jest.fn(async () => {
        if (mode === 'exception') throw new Error('UPSTREAM_SECRET_25C');
        return {
          ok: mode === 'success',
          status: mode === 'success' ? 201 : 400,
          json: async () =>
            mode === 'success'
              ? { messageId: 'fake-provider-ref' }
              : { code: 'invalid_parameter', message: 'UPSTREAM_SECRET_25C' },
        };
      }) as unknown as BrevoFetchFn;
      const adapter = new BrevoEmailProvider(
        {
          baseUrl: 'https://api.brevo.com',
          apiKey: `xkeysib-${'a'.repeat(20)}`,
          fromEmail: 'sender@example.test',
          requestTimeoutMs: 1000,
        },
        fetch,
      );
      const req: NotificationSendRequest = {
        channel: 'EMAIL',
        destination: 'customer@example.test',
        subject: 'Synthetic',
        message: 'Hello',
        payload: {},
        eventType: 'transfer.completed',
        eventKey: 'otp=123456',
        correlationId: 'phone:+2348012345678',
        recipientType: 'CUSTOMER',
        recipientId: randomUUID(),
      };
      try {
        await adapter.send(req);
        expect(logs.length).toBeGreaterThan(0);
        expect(logs.join('\n')).toContain('transfer.completed');
        expect(logs.join('\n')).not.toContain('123456');
        expect(logs.join('\n')).not.toContain('+2348012345678');
        expect(logs.join('\n')).not.toContain('UPSTREAM_SECRET_25C');
        expect(req.eventKey).toBe('otp=123456'); // diagnostic masking must not alter idempotency input
      } finally {
        log.mockRestore();
        warn.mockRestore();
      }
    },
  );
});
