import { NotificationChannelResolverService } from './notification-channel-resolver.service';
import { mapEventToIntents } from './notification-event-map';
import { NotificationTemplateService } from './notification-template.service';

describe('Cash-to-Cash beneficiary notification contract', () => {
  const outbox = { correlationId: 'corr-1', causationId: null };

  it('resolves a phone recipient without requiring a customer UUID', () => {
    const intents = mapEventToIntents(
      'cash_to_cash.created',
      { beneficiaryPhone: '8012345678' },
      outbox,
    );

    expect(intents).toEqual([
      {
        recipientType: 'PHONE',
        recipientId: '8012345678',
        channel: 'SMS',
        templateKey: 'cash_to_cash.created',
        correlationId: 'corr-1',
        causationId: null,
      },
    ]);
    expect(
      mapEventToIntents('cash_to_cash.created', { beneficiaryPhone: '12345' }, outbox),
    ).toEqual([]);
  });

  it('renders only the safe sender, amount and configured locator; never transfer credentials', () => {
    const template = new NotificationTemplateService();
    const message = template.buildMessage('cash_to_cash.created', {
      senderDisplayName: 'Ada Example',
      amountMinor: '250000',
      currency: 'NGN',
      locatorUrl: 'https://locator.example.ng/agents',
      transferId: 'transfer-id-must-not-appear',
      transferNumber: '123456',
      senderPhone: '8012345678',
      transferCode: '87654321',
      reference: 'private-reference',
    });

    expect(message).toContain('Ada Example');
    expect(message).toContain('NGN 2500.00');
    expect(message).toContain('https://locator.example.ng/agents');
    for (const forbidden of [
      'transfer-id-must-not-appear',
      '123456',
      '8012345678',
      '87654321',
      'private-reference',
    ]) {
      expect(message).not.toContain(forbidden);
    }
  });

  it('ARENA 3 CLOSURE (Defect B): fails closed when the committed principal is missing or invalid — never renders an empty amount, never fabricates one', () => {
    const template = new NotificationTemplateService();
    // Missing amountMinor entirely
    expect(() =>
      template.buildMessage('cash_to_cash.created', {
        senderDisplayName: 'Ada Example',
        currency: 'NGN',
      }),
    ).toThrow(/amount unavailable/i);
    // Zero principal is not a valid positive committed amount
    expect(() =>
      template.buildMessage('cash_to_cash.created', { amountMinor: '0', currency: 'NGN' }),
    ).toThrow(/amount unavailable/i);
    // Non-numeric / negative / decimal payload shapes are refused (no fabrication, no echo)
    for (const invalid of ['not-a-number', '-2500', '2500.50', ' 2500', '002500', '1e3']) {
      expect(() =>
        template.buildMessage('cash_to_cash.created', { amountMinor: invalid, currency: 'NGN' }),
      ).toThrow(/amount unavailable/i);
    }
    // A valid committed principal still renders exactly (minor units -> major, 2dp)
    const message = template.buildMessage('cash_to_cash.created', {
      senderDisplayName: 'Ada Example',
      amountMinor: '250000',
      currency: 'NGN',
    });
    expect(message).toContain('NGN 2500.00');
    expect(message).not.toContain('sent you .');
  });

  it('uses a generic sender name and refuses a non-HTTPS locator URL', () => {
    const template = new NotificationTemplateService();
    const message = template.buildMessage('cash_to_cash.created', {
      amountMinor: '100',
      locatorUrl: 'http://unsafe.example.ng',
    });
    expect(message).toContain('A MonieNaija customer');
    expect(message).toContain('NGN 1.00');
    expect(message).not.toContain('unsafe.example.ng');
  });

  it('allowlists provider/delivery template variables for Cash-to-Cash created events', () => {
    const template = new NotificationTemplateService();
    expect(
      template.redactPayload(
        {
          transferId: 'transfer-id',
          transferNumber: '123456',
          senderPhone: '8012345678',
          beneficiaryPhone: '8098765432',
          transferCode: '87654321',
          senderDisplayName: 'Ada Example',
          amountMinor: '250000',
          currency: 'NGN',
          locatorUrl: 'https://locator.example.ng/agents',
        },
        'cash_to_cash.created',
      ),
    ).toEqual({
      senderDisplayName: 'Ada Example',
      amountMinor: '250000',
      currency: 'NGN',
      locatorUrl: 'https://locator.example.ng/agents',
    });
  });

  it('resolves a canonical phone directly and honors a registered beneficiary SMS opt-out', async () => {
    const phone = '8012345678';
    const query = jest
      .fn()
      .mockResolvedValueOnce([{ customer_id: 'customer-uuid', verified_at: new Date() }])
      .mockResolvedValueOnce([{ enabled: false }]);
    const resolver = new NotificationChannelResolverService({ query } as never);

    await expect(
      resolver.resolve('PHONE', phone, 'SMS', undefined, 'cash_to_cash.created'),
    ).resolves.toEqual({
      channel: 'SMS',
      destination: null,
      reason: 'SMS_OPT_OUT',
    });
    expect(query).toHaveBeenCalledTimes(2);

    const unregisteredResolver = new NotificationChannelResolverService({
      query: jest.fn().mockResolvedValueOnce([]),
    } as never);
    await expect(
      unregisteredResolver.resolve('PHONE', phone, 'SMS', undefined, 'cash_to_cash.created'),
    ).resolves.toEqual({
      channel: 'SMS',
      destination: phone,
    });
  });
});
