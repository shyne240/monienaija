/* eslint-disable @typescript-eslint/require-await */
import type { ConfigurableSmsNotificationProvider } from '../src/notification/notification-provider-config.service';
import { NormalizingSmsNotificationProvider } from '../src/notification/normalizing-sms-notification-provider';
import { RobaseNotificationProvider } from '../src/notification/robase-notification-provider';
import { NotificationChannelResolverService } from '../src/notification/notification-channel-resolver.service';
import { NotificationTemplateService } from '../src/notification/notification-template.service';
import { mapEventToIntents } from '../src/notification/notification-event-map';
import { ConsoleNotificationProvider } from '../src/notification/notification-provider.interface';
import { ConsoleEmailProvider } from '../src/notification/email-provider.interface';
import type { NotificationSendRequest } from '../src/notification/notification.types';

const request = (destination: string, eventType = 'transfer.completed'): NotificationSendRequest => ({
  channel: 'SMS', destination, message: 'Synthetic notification', payload: {}, eventType,
  eventKey: 'synthetic-event', recipientType: 'CUSTOMER', recipientId: 'synthetic-recipient',
});

describe('notification reliability and privacy boundaries', () => {
  it('normalizes Nigerian phones exactly once before a real Robase adapter with a fake transport', async () => {
    const bodies: Array<{ phone_number: string }> = [];
    const realAdapter = new RobaseNotificationProvider({
      baseUrl: 'https://api.robase.dev', apiKey: 'robe_' + 'a'.repeat(64), requestTimeoutMs: 1000,
    }, async (_url, init) => {
      bodies.push(JSON.parse(init.body) as { phone_number: string });
      return { ok: true, status: 200, json: async () => ({ id: 'synthetic-provider-id' }) };
    });
    const provider = new NormalizingSmsNotificationProvider(realAdapter as unknown as ConfigurableSmsNotificationProvider);
    for (const [number, event] of [
      ['8012345678', 'transfer.completed'],
      ['08012345678', 'cash_to_cash.created'],
      ['2348012345678', 'customer.registration.phone_verification'],
      ['+2348012345678', 'agent.desk.customer_otp'],
      ['+234 (801) 234-5678', 'notification.test_send'],
    ]) expect((await provider.send(request(number!, event))).success).toBe(true);
    expect(bodies.map((body) => body.phone_number)).toEqual(Array(5).fill('+2348012345678'));
    for (const invalid of ['+14155552671', '12345', '+23408012345678', '2342348012345678', '0012345678', 'SKIPPED:X']) {
      const result = await provider.send(request(invalid));
      expect(result).toEqual({ success: false, error: 'SMS_INVALID_DESTINATION', failureDisposition: 'PERMANENT' });
    }
    expect(bodies).toHaveLength(5); // no vendor call for invalid/unsupported forms
    for (const number of ['8012345678', '08012345678', '2348012345678', '+2348012345678']) {
      expect(mapEventToIntents('cash_to_cash.created', { beneficiaryPhone: number }, { correlationId: null, causationId: null })[0]?.recipientId)
        .toBe('8012345678');
    }
  });

  it('requires verified contacts and explicit preferences; lookup failures cannot fail open', async () => {
    const missingPreference = new NotificationChannelResolverService({ query: jest.fn().mockResolvedValue([]) } as never);
    await expect(missingPreference.resolve('CUSTOMER', 'customer-id', 'SMS')).resolves.toMatchObject({ reason: 'SMS_PREFERENCE_UNAVAILABLE' });
    const missingVerifiedContact = new NotificationChannelResolverService({
      query: jest.fn().mockResolvedValueOnce([{ enabled: true }]).mockResolvedValueOnce([]),
    } as never);
    await expect(missingVerifiedContact.resolve('CUSTOMER', 'customer-id', 'EMAIL')).resolves.toMatchObject({ reason: 'CUSTOMER_EMAIL_VERIFIED_MISSING' });
    const outage = new NotificationChannelResolverService({ query: jest.fn().mockRejectedValue(new Error('PRIVATE_SENTINEL')) } as never);
    await expect(outage.resolve('CUSTOMER', 'customer-id', 'SMS')).rejects.toThrow();
    const verified = new NotificationChannelResolverService({
      query: jest.fn().mockResolvedValueOnce([{ enabled: true }]).mockResolvedValueOnce([{ normalized_value: '08012345678' }]),
    } as never);
    await expect(verified.resolve('CUSTOMER', 'customer-id', 'SMS')).resolves.toMatchObject({ destination: '8012345678' });
  });

  it('allows only the C2C unregistered-phone exception and protects registered unverified or opted-out contacts', async () => {
    const unregistered = new NotificationChannelResolverService({ query: jest.fn().mockResolvedValue([]) } as never);
    await expect(unregistered.resolve('PHONE', '8012345678', 'SMS', undefined, 'cash_to_cash.created'))
      .resolves.toMatchObject({ destination: '8012345678' });
    await expect(unregistered.resolve('PHONE', '8012345678', 'SMS', undefined, 'transfer.completed'))
      .resolves.toMatchObject({ reason: 'UNSUPPORTED_RECIPIENT' });
    const unverified = new NotificationChannelResolverService({
      query: jest.fn().mockResolvedValue([{ customer_id: 'c', verified_at: null }]),
    } as never);
    await expect(unverified.resolve('PHONE', '8012345678', 'SMS', undefined, 'cash_to_cash.created'))
      .resolves.toMatchObject({ reason: 'PHONE_RECIPIENT_UNVERIFIED' });
    const optedOut = new NotificationChannelResolverService({
      query: jest.fn().mockResolvedValueOnce([{ customer_id: 'c', verified_at: new Date() }]).mockResolvedValueOnce([{ enabled: false }]),
    } as never);
    await expect(optedOut.resolve('PHONE', '8012345678', 'SMS', undefined, 'cash_to_cash.created'))
      .resolves.toMatchObject({ reason: 'SMS_OPT_OUT' });
  });

  it('projects only event-specific financial variables, never ledger ids, prose or secrets', () => {
    const service = new NotificationTemplateService();
    const input = { amountMinor: '25000', reference: 'FUND-OK', journalId: 'JOURNAL_SENTINEL',
      ledgerAccountId: 'LEDGER_SENTINEL', rejectionReason: 'private free text', nested: { otp: 'SENTINEL_OTP' },
      password: 'PASSWORD_SENTINEL', destination: 'PHONE_SENTINEL', unused: 'UNKNOWN_SENTINEL' };
    expect(service.redactPayload(input, 'customer.funding.rejected')).toEqual({ amountMinor: '25000', reference: 'FUND-OK' });
    expect(service.redactPayload(input, 'support.ticket.created')).toEqual({ reference: 'FUND-OK' });
    expect(service.redactPayload(input, 'unknown.event')).toEqual({});
    const c2c = service.redactPayload({ ...input, senderDisplayName: 'Ada Example', transferCode: 'C2C_SECRET',
      beneficiaryPhone: '8012345678', currency: 'NGN', locatorUrl: 'https://locator.example.ng/agents' }, 'cash_to_cash.created');
    expect(c2c).toEqual({ senderDisplayName: 'Ada Example', amountMinor: '25000', currency: 'NGN', locatorUrl: 'https://locator.example.ng/agents' });
    expect(JSON.stringify(c2c)).not.toMatch(/SENTINEL|C2C_SECRET|8012345678/);
  });

  it('never logs or retains the destination, body, OTP or subject in console providers', async () => {
    const spy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      const sms = new ConsoleNotificationProvider();
      const email = new ConsoleEmailProvider();
      await sms.send({ ...request('PHONE_SENTINEL', 'customer.registration.phone_verification'),
        message: 'OTP_SENTINEL', payload: { credential: 'CREDENTIAL_SENTINEL' } });
      await email.send({ ...request('EMAIL_SENTINEL'), channel: 'EMAIL', message: 'BODY_SENTINEL', subject: 'SUBJECT_SENTINEL' });
      const output = JSON.stringify({ logs: spy.mock.calls, sms: sms.sent, email: email.sent });
      expect(output).not.toMatch(/PHONE_SENTINEL|EMAIL_SENTINEL|OTP_SENTINEL|CREDENTIAL_SENTINEL|BODY_SENTINEL|SUBJECT_SENTINEL/);
      expect(spy).toHaveBeenCalledTimes(2);
    } finally { spy.mockRestore(); }
  });
});
