import { buildTypedWalletTransferEvent } from '../src/transfer/transfer-events';
import type { Transfer } from '../src/transfer/transfer.entity';

describe('typed transfer event contract', () => {
  const transfer = {
    id: 'transfer-id',
    sourceWalletId: 'source-wallet',
    destinationWalletId: 'destination-wallet',
    journalId: 'journal-id',
    amountMinor: '1000',
    currency: 'NGN',
    failureCode: null,
  } as unknown as Transfer;
  const recipients = {
    source: { type: 'AGENT' as const, id: 'agent-id' },
    destination: { type: 'CUSTOMER' as const, id: 'customer-id' },
  };
  it('identifies agents without projecting them as customers', () => {
    const completed = buildTypedWalletTransferEvent(
      transfer,
      recipients,
      'completed',
      new Date('2026-01-01T00:00:00Z'),
    );
    expect(completed).toMatchObject({
      eventType: 'wallet_transfer.completed',
      eventKey: 'wallet_transfer.completed:transfer-id:v1',
      sourceParticipant: recipients.source,
      destinationParticipant: recipients.destination,
      journalId: 'journal-id',
    });
    expect(completed.sourceCustomerId).toBeUndefined();
    expect(completed.destinationCustomerId).toBeUndefined();
    const failed = buildTypedWalletTransferEvent(
      { ...transfer, journalId: null } as Transfer,
      recipients,
      'failed',
      new Date('2026-01-01T00:00:00Z'),
    );
    expect(failed).toMatchObject({
      eventType: 'wallet_transfer.failed',
      failureCode: null,
    });
    expect(failed.journalId).toBeUndefined();
    expect(failed.failureMessage).toBeUndefined();
  });
  it('rejects completion without a journal', () => {
    expect(() =>
      buildTypedWalletTransferEvent(
        { ...transfer, journalId: null } as Transfer,
        recipients,
        'completed',
        new Date(),
      ),
    ).toThrow();
  });
});
