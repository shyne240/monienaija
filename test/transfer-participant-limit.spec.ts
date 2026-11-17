import { WalletAccount } from '../src/wallet/wallet-account.entity';
import { transferParticipantLimitInput } from '../src/transfer/transfer-participant-limit';

const wallet = Object.assign(new WalletAccount(), {
  ledgerAccountId: 'wallet-ledger',
  institutionId: 'institution',
});
const facts = {
  direction: 'INCOMING' as const,
  amountMinor: '500',
  currency: 'NGN',
  idempotencyKey: 'key',
  requestHash: 'hash',
  correlationId: 'correlation',
  now: new Date('2026-01-01T00:00:00.000Z'),
};

describe('transfer participant limit input', () => {
  it('uses agent class and strict assignment rules without requiring a customer KYC tier', () => {
    const input = transferParticipantLimitInput(
      { wallet, type: 'AGENT', id: 'agent', agentClassId: 'class' },
      facts,
    );
    expect(input).toMatchObject({
      principalType: 'AGENT',
      principalId: 'agent',
      agentClassId: 'class',
      direction: 'INCOMING',
      strictConfiguredRules: true,
      requireKycTierPolicy: false,
      walletLedgerAccountId: 'wallet-ledger',
      institutionId: 'institution',
    });
  });
  it('keeps customer tier admission and outgoing direction', () => {
    const input = transferParticipantLimitInput(
      { wallet, type: 'CUSTOMER', id: 'customer', agentClassId: null },
      { ...facts, direction: 'OUTGOING' },
    );
    expect(input).toMatchObject({
      principalType: 'CUSTOMER',
      principalId: 'customer',
      agentClassId: null,
      direction: 'OUTGOING',
      strictConfiguredRules: false,
      requireKycTierPolicy: true,
    });
  });
});
