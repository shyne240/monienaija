import { NotificationWorkerService } from './notification-worker.service';

const FAILED_PHONE_DELIVERY = {
  id: 'delivery-id',
  event_type: 'cash_to_cash.created',
  event_key: 'cash_to_cash.created:transfer-id',
  recipient_type: 'PHONE' as const,
  recipient_id: '8012345678',
  channel: 'SMS' as const,
  destination: '8012345678',
  message: 'Cash-to-Cash: A MonieNaija customer sent you NGN 20.00.',
  payload: { senderDisplayName: 'A MonieNaija customer', amountMinor: '2000', currency: 'NGN' },
  correlation_id: null,
  attempts: 1,
};

type RetryResult = {
  claimed: unknown[];
  retriesSent: number;
  retriesFailed: number;
  retriesOptedOut: number;
};

function retryFailedDeliveries(
  worker: NotificationWorkerService,
  limit: number,
): Promise<RetryResult> {
  return (
    worker as unknown as {
      retryFailedDeliveries: (batchLimit: number) => Promise<RetryResult>;
    }
  ).retryFailedDeliveries(limit);
}

describe('Notification worker phone-recipient retries', () => {
  it('honors a verified registered phone owner’s SMS opt-out before retrying', async () => {
    const manager = { query: jest.fn().mockResolvedValue([FAILED_PHONE_DELIVERY]) };
    const dataSource = {
      transaction: jest.fn((callback: (manager: unknown) => Promise<unknown>) => callback(manager)),
      query: jest
        .fn()
        .mockResolvedValueOnce([{ customer_id: 'customer-id' }])
        .mockResolvedValueOnce([{ sms_enabled: false }])
        .mockResolvedValueOnce([]),
    };
    const provider = { name: 'test', send: jest.fn() };
    const worker = new NotificationWorkerService(
      dataSource as never,
      {} as never,
      { get: jest.fn().mockReturnValue(undefined) } as never,
      provider as never,
    );

    const result = await retryFailedDeliveries(worker, 10);

    expect(result).toMatchObject({
      claimed: [FAILED_PHONE_DELIVERY],
      retriesSent: 0,
      retriesFailed: 0,
      retriesOptedOut: 1,
    });
    expect(provider.send).not.toHaveBeenCalled();
  });

  it('retries an unregistered beneficiary directly to the canonical phone without a customer UUID', async () => {
    const manager = { query: jest.fn().mockResolvedValue([FAILED_PHONE_DELIVERY]) };
    const dataSource = {
      transaction: jest.fn((callback: (manager: unknown) => Promise<unknown>) => callback(manager)),
      query: jest.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([]),
    };
    const provider = {
      name: 'test',
      send: jest.fn().mockResolvedValue({ success: true, providerRef: 'provider-ref' }),
    };
    const worker = new NotificationWorkerService(
      dataSource as never,
      {} as never,
      { get: jest.fn().mockReturnValue(undefined) } as never,
      provider as never,
    );

    const result = await retryFailedDeliveries(worker, 10);

    expect(result).toMatchObject({
      claimed: [FAILED_PHONE_DELIVERY],
      retriesSent: 1,
      retriesFailed: 0,
      retriesOptedOut: 0,
    });
    expect(provider.send).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientType: 'PHONE',
        recipientId: '8012345678',
        destination: '8012345678',
      }),
    );
  });
});
