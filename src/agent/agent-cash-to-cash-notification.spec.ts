import { AgentCashToCashService } from './agent-cash-to-cash.service';

const AGENT_ID = '11111111-1111-4111-8111-111111111111';
const BENEFICIARY_PHONE = '8012345678';

function createHarness(verifiedSenderName: string | null = null, locatorUrl?: string) {
  let storedResponse: Record<string, unknown> | null = null;
  const outboxCalls: Array<{
    eventType: string;
    eventKey: string;
    payload: Record<string, unknown>;
  }> = [];
  const manager = {
    query: jest.fn((sql: string) =>
      Promise.resolve(
        sql.includes('SELECT cp.legal_name') && verifiedSenderName
          ? [{ legal_name: verifiedSenderName }]
          : [],
      ),
    ),
    getRepository: jest.fn().mockReturnValue({
      findOne: jest.fn().mockResolvedValue({
        customerId: AGENT_ID,
        currency: 'NGN',
        ledgerAccountId: 'wallet-ledger-id',
      }),
    }),
  };
  const dataSource = {
    query: jest.fn().mockResolvedValue([]),
    transaction: jest.fn(
      (_isolation: string, callback: (transactionManager: unknown) => Promise<unknown>) =>
        callback(manager),
    ),
  };
  const authorizationService = {
    authorize: jest.fn().mockResolvedValue({ allowed: true, context: { agentId: AGENT_ID } }),
  };
  const ledgerService = {
    postJournalInTransaction: jest.fn().mockResolvedValue('journal-id'),
  };
  const idempotencyService = {
    reserve: jest.fn().mockImplementation(() => {
      if (storedResponse) {
        return Promise.resolve({
          kind: 'REPLAY',
          record: { id: 'reservation-id', responseBody: storedResponse },
        });
      }
      return Promise.resolve({ kind: 'NEW', record: { id: 'reservation-id' } });
    }),
    complete: jest
      .fn()
      .mockImplementation(
        (_manager: unknown, _id: string, command: { responseBody: Record<string, unknown> }) => {
          storedResponse = command.responseBody;
          return Promise.resolve();
        },
      ),
  };
  const auditService = { record: jest.fn().mockResolvedValue(undefined) };
  const outboxService = {
    enqueueOnce: jest
      .fn()
      .mockImplementation(
        (
          _manager: unknown,
          event: { eventType: string; eventKey: string; payload: Record<string, unknown> },
        ) => {
          outboxCalls.push(event);
          return Promise.resolve({});
        },
      ),
  };
  const service = new AgentCashToCashService(
    dataSource as never,
    authorizationService as never,
    ledgerService as never,
    idempotencyService as never,
    auditService as never,
    outboxService as never,
    locatorUrl
      ? ({
          get: (key: string) => (key === 'CASH_TO_CASH_LOCATOR_URL' ? locatorUrl : undefined),
        } as never)
      : undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
  );
  jest
    .spyOn(service as never, 'getUnclaimedAccount' as never)
    .mockResolvedValue({ id: 'unclaimed-id' } as never);
  jest
    .spyOn(service as never, 'ensureWalletAccount' as never)
    .mockResolvedValue({ ledgerAccountId: 'wallet-ledger-id' } as never);
  jest.spyOn(service as never, 'allocateLocator' as never).mockResolvedValue('123456' as never);

  return {
    service,
    dataSource,
    ledgerService,
    idempotencyService,
    outboxService,
    outboxCalls,
    manager,
  };
}

const input = {
  agentId: AGENT_ID,
  agentPrincipal: { type: 'AGENT', principalId: AGENT_ID, agentId: AGENT_ID } as never,
  agentPin: '1234',
  beneficiaryPhone: BENEFICIARY_PHONE,
  amountMinor: '250000',
  currency: 'NGN',
  idempotencyKey: 'c2c-initiation-1',
};

describe('Cash-to-Cash initiation notification outbox', () => {
  it('enqueues one safe event in the initiation transaction and replay creates no journal or event', async () => {
    const harness = createHarness('Ada Example', 'https://locator.example.ng/agents');
    const initiation = { ...input, senderPhone: '8011111111' };

    const created = await harness.service.execute(initiation);
    const replay = await harness.service.execute(initiation);

    expect(created.status).toBe('COMPLETED');
    expect(replay.status).toBe('REPLAYED');
    expect(harness.outboxService.enqueueOnce).toHaveBeenCalledTimes(1);
    expect(harness.ledgerService.postJournalInTransaction).toHaveBeenCalledTimes(1);
    const transferInserts = harness.manager.query.mock.calls.filter(
      ([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO cash_to_cash_transfers'),
    );
    expect(transferInserts).toHaveLength(1);
    expect(harness.outboxCalls[0]).toMatchObject({
      eventType: 'cash_to_cash.created',
      eventKey: `cash_to_cash.created:${created.transferId}`,
      aggregateType: 'CASH_TO_CASH_TRANSFER',
      aggregateId: created.transferId,
      payload: {
        transferId: created.transferId,
        beneficiaryPhone: BENEFICIARY_PHONE,
        amountMinor: '250000',
        currency: 'NGN',
        senderDisplayName: 'Ada Example',
        locatorUrl: 'https://locator.example.ng/agents',
      },
    });
    for (const forbidden of ['transferNumber', 'senderPhone', 'transferCode']) {
      expect(harness.outboxCalls[0]?.payload).not.toHaveProperty(forbidden);
    }
  });

  it('does not enqueue when initiation fails after journal posting but before commit', async () => {
    const harness = createHarness();
    await expect(
      harness.service.execute({ ...input, _simulateFailureAfterJournal: true }),
    ).rejects.toThrow('Simulated failure after journal');
    expect(harness.ledgerService.postJournalInTransaction).toHaveBeenCalledTimes(1);
    expect(harness.outboxService.enqueueOnce).not.toHaveBeenCalled();
  });
});
