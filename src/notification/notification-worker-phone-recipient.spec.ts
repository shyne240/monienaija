import { NotificationChannelResolverService } from './notification-channel-resolver.service';

describe('PHONE-recipient pre-send resolution', () => {
  // Worker ownership/lease/actual provider behavior is tested against PostgreSQL in
  // notification-reliability.integration.spec.ts. These unit tests cover its shared resolver.
  it('honors the verified registered beneficiary owner’s SMS opt-out', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([{ customer_id: 'customer-id', verified_at: new Date() }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ enabled: false }]);
    const resolver = new NotificationChannelResolverService({ query } as never);
    await expect(
      resolver.resolve('PHONE', '8012345678', 'SMS', undefined, 'cash_to_cash.created'),
    ).resolves.toEqual({ channel: 'SMS', destination: null, reason: 'SMS_OPT_OUT' });
  });

  it('fails closed when customer and verified agent contacts collide', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([{ customer_id: 'customer-id', verified_at: new Date() }])
      .mockResolvedValueOnce([{ agent_id: 'agent-id', status: 'ACTIVE', sms_enabled: true }]);
    const resolver = new NotificationChannelResolverService({ query } as never);
    await expect(
      resolver.resolve('PHONE', '8012345678', 'SMS', undefined, 'cash_to_cash.created'),
    ).resolves.toEqual({ channel: 'SMS', destination: null, reason: 'PHONE_RECIPIENT_AMBIGUOUS' });
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('allows the documented unregistered C2C beneficiary, but not other ordinary events', async () => {
    const query = jest.fn().mockResolvedValue([]);
    const resolver = new NotificationChannelResolverService({ query } as never);
    await expect(
      resolver.resolve('PHONE', '8012345678', 'SMS', undefined, 'cash_to_cash.created'),
    ).resolves.toEqual({ channel: 'SMS', destination: '8012345678' });
    await expect(
      resolver.resolve('PHONE', '8012345678', 'SMS', undefined, 'transfer.completed'),
    ).resolves.toEqual({ channel: 'SMS', destination: null, reason: 'UNSUPPORTED_RECIPIENT' });
  });

  it('does not interpret a contact lookup failure as an unregistered recipient', async () => {
    const query = jest.fn().mockRejectedValue(new Error('contact store unavailable'));
    const resolver = new NotificationChannelResolverService({ query } as never);
    await expect(
      resolver.resolve('PHONE', '8012345678', 'SMS', undefined, 'cash_to_cash.created'),
    ).rejects.toThrow('contact store unavailable');
  });
});
