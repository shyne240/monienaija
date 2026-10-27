import {
  NOTIFICATION_DEFAULTS_V1,
  NOTIFICATION_SECURITY_DEFAULTS_V1,
} from '../src/notification/notification-defaults-v1';
import { SECURITY_CRITICAL_NOTIFICATION_EVENT_TYPES } from '../src/notification/notification-security.constants';
import { mapEventToIntents } from '../src/notification/notification-event-map';
import {
  NotificationTemplateService,
  canonicalNotificationEvent,
} from '../src/notification/notification-template.service';

describe('notification template security boundary', () => {
  const service = new NotificationTemplateService();

  it('validates and previews every frozen SMS and email default with code-owned sample data', () => {
    for (const item of NOTIFICATION_DEFAULTS_V1) {
      const sms = service.preview(item.eventType, 'SMS', { subject: null, body: item.body });
      const email = service.preview(item.eventType, 'EMAIL', {
        subject: 'MonieNaija account update',
        body: item.body,
      });
      expect(sms.body).not.toContain('{{');
      expect(email.subject).toBe('MonieNaija account update');
      expect(
        sms.variablesUsed.every((name) => (item.variables as readonly string[]).includes(name)),
      ).toBe(true);
      expect(sms.body).not.toMatch(/pin|otp|password|secret|token/i);
    }
  });

  it('blocks unknown variables, expressions, nested paths, malformed braces and sensitive literals', () => {
    for (const value of [
      '{{payload.password}}',
      '{{password}}',
      '{{transferNumber}}',
      '{{sender_phone}}',
      '{{reference.toString()}}',
      '{{#if reference}}x{{/if}}',
      '{{__proto__}}',
      '{{constructor}}',
      '{{{reference}}}',
      '{reference}',
      'Use your OTP',
      'Password: 1234',
      '<script>alert(1)</script>',
      'Call 08031234567',
      'Your verification code is ready',
    ]) {
      expect(() =>
        service.validateTemplate('customer.funding.approved', 'SMS', {
          subject: null,
          body: value,
        }),
      ).toThrow();
    }
    expect(() => service.assertSafe('Your PIN is 1234')).toThrow();
    expect(() => service.assertSafe('Enter your password')).toThrow();
    expect(() => service.assertSafe('Your ledger account')).toThrow();
    expect(() => service.assertSafe('Shopping update')).not.toThrow();
  });

  it('uses only safe code-defined derivations, not arbitrary payload properties or raw invalid values', () => {
    const content = { subject: null, body: '{{reference}}{{amount_clause}}' };
    const result = service.render('customer.funding.approved', 'SMS', content, {
      reference: 'password',
      amountMinor: 'secret-not-a-number',
      password: 'P@ssword123',
      transferCode: '123456',
      secret: 'sk-private',
      nested: { reference: 'should-not-render' },
    });
    expect(result.body).toBe('your request');
    expect(JSON.stringify(result)).not.toMatch(/P@ssword123|123456|sk-private|nested/i);
    expect(service.formatNgn('not-a-number')).toBe('');
    expect(service.formatNgn('123456')).toBe('NGN 1234.56');
    expect(service.formatNgn('999999999999999')).toBe('NGN 9999999999999.99');
    expect(
      service.render(
        'support.ticket.status_changed',
        'SMS',
        { subject: null, body: '{{status}}' },
        { status: 'secret content' },
      ).body,
    ).toBe('updated');
  });

  it('rejects email header injection, wrong channel subjects, expansion overflow and unknown events', () => {
    expect(() =>
      service.preview('transfer.completed', 'SMS', { subject: 'subject', body: 'ok' }),
    ).toThrow();
    expect(() =>
      service.preview('transfer.completed', 'EMAIL', { subject: 'hello\nBcc: other', body: 'ok' }),
    ).toThrow();
    // Even a short synthetic preview cannot approve a template whose maximum safe values overflow.
    expect(() =>
      service.validateTemplate('customer.funding.approved', 'SMS', {
        subject: null,
        body: '{{reference}}'.repeat(60),
      }),
    ).toThrow();
    expect(() =>
      service.render(
        'customer.funding.approved',
        'SMS',
        { subject: null, body: '{{reference}}'.repeat(75) },
        { reference: 'FUND-ABCDEFGHIJKLMNO' },
      ),
    ).toThrow();
    expect(service.buildMessage('unknown.internal.event', { reference: 'ABC' })).toBe(
      'You have a new update. Please check your account.',
    );
    expect(() =>
      service.preview('unknown.internal.event', 'SMS', { subject: null, body: 'ok' }),
    ).toThrow();
  });

  it('never makes the SECURITY taxonomy editable, and normalizes legacy aliases', () => {
    expect([...SECURITY_CRITICAL_NOTIFICATION_EVENT_TYPES].sort()).toEqual(
      [...NOTIFICATION_SECURITY_DEFAULTS_V1].sort(),
    );
    for (const eventType of NOTIFICATION_SECURITY_DEFAULTS_V1) {
      expect(service.definition(eventType)).toBeUndefined();
      expect(() => service.buildMessage(eventType, { otp: '123456' })).toThrow();
      expect(() =>
        service.preview(eventType, 'EMAIL', { subject: 'Notice', body: 'Hello' }),
      ).toThrow();
    }
    expect(canonicalNotificationEvent('cash-to-cash.claimed')).toBe('cash_to_cash.claimed');
    expect(canonicalNotificationEvent('transfer.unknown')).toBe('transfer.failed');
    expect(
      mapEventToIntents(
        'cash-to-cash.claimed',
        { claimantCustomerId: 'customer-id' },
        {
          correlationId: null,
          causationId: null,
        },
      )[0]?.templateKey,
    ).toBe('cash_to_cash.claimed');
  });
});
