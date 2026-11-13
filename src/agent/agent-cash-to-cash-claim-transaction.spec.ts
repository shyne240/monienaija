import { AgentCashToCashClaimService } from './agent-cash-to-cash-claim.service';

const transferId = '11111111-1111-4111-8111-111111111111';
const customerId = '22222222-2222-4222-8222-222222222222';
const challengeId = '33333333-3333-4333-8333-333333333333';
const sessionId = '44444444-4444-4444-8444-444444444444';
const credentialId = '55555555-5555-4555-8555-555555555555';

function harness(verified: boolean) {
  const transfer = {
    id: transferId,
    status: 'UNCLAIMED',
    beneficiary_phone: '8012345678',
    principal_minor: '100',
    currency: 'NGN',
    transfer_code_hash: 'fixture',
    is_locked: false,
  };
  const customer = { id: customerId, status: 'ACTIVE', kyc_status: 'APPROVED', deleted_at: null };
  const manager = {
    query: jest.fn((sql: string) => {
      if (sql.includes('FOR UPDATE')) return Promise.resolve([transfer]);
      if (sql.includes('AS is_expired')) return Promise.resolve([{ is_expired: false }]);
      if (sql.includes('FROM customers')) return Promise.resolve([customer]);
      return Promise.resolve([]);
    }),
  };
  const ds = {
    query: jest.fn((sql: string) => {
      if (sql.includes('FROM cash_to_cash_transfers')) return Promise.resolve([transfer]);
      if (sql.includes('FROM customers')) return Promise.resolve([customer]);
      if (sql.includes('FROM mfa_challenges'))
        return Promise.resolve([{ customer_id: customerId, session_id: sessionId }]);
      if (sql.includes('FROM authentication_sessions'))
        return Promise.resolve([{ credential_id: credentialId }]);
      return Promise.resolve([]);
    }),
    transaction: jest.fn(async (_isolation: string, callback: (m: unknown) => Promise<unknown>) =>
      callback(manager),
    ),
  };
  const ledger = {
    postJournalInTransaction: jest.fn().mockRejectedValue(new Error('injected posting failure')),
  };
  const idem = {
    reserve: jest.fn().mockResolvedValue({ kind: 'NEW', record: { id: 'reservation' } }),
  };
  const mfa = {
    verifyChallengeInManager: jest
      .fn()
      .mockResolvedValue(
        verified ? { verified: true } : { verified: false, failureReason: 'MISMATCH' },
      ),
  };
  const service = new AgentCashToCashClaimService(
    ds as never,
    ledger as never,
    {} as never,
    idem as never,
    {} as never,
    {} as never,
    mfa as never,
    { require: jest.fn().mockResolvedValue(undefined) } as never,
  );
  const internal = service as unknown as Record<string, jest.Mock>;
  internal.requireSafeClaimExecution = jest.fn(); // controlled test only; production remains contained
  internal.getUnclaimedAccount = jest.fn().mockResolvedValue({ id: 'unclaimed' });
  internal.assertClaimantOwnsBeneficiaryPhone = jest.fn().mockResolvedValue(undefined);
  internal.assertWalletAssessmentUnexpired = jest.fn().mockResolvedValue(undefined);
  internal.verifyTransferCode = jest.fn().mockReturnValue(true);
  internal.ensureWalletAccountExists = jest.fn().mockResolvedValue(undefined);
  internal.resolveWalletAccount = jest.fn().mockResolvedValue({ ledgerAccountId: 'wallet' });
  const input = {
    transferId,
    beneficiaryPhone: '8012345678',
    transferCode: '12345678',
    customerId,
    mfaChallengeId: challengeId,
    otp: '123456',
    idempotencyKey: 'operation',
    redemptionMethod: 'CUSTOMER_WALLET' as const,
  };
  return { service, input, manager, mfa, idem, ledger };
}

describe('contained Cash-to-Cash claim transaction wiring', () => {
  it('returns a failed OTP from the transaction without reserving or posting', async () => {
    const h = harness(false);
    await expect(h.service.execute(h.input)).rejects.toThrow('OTP verification failed: MISMATCH');
    expect(h.mfa.verifyChallengeInManager).toHaveBeenCalledWith(
      h.manager,
      expect.objectContaining({ challengeId }),
    );
    expect(h.idem.reserve).not.toHaveBeenCalled();
    expect(h.ledger.postJournalInTransaction).not.toHaveBeenCalled();
  });
  it('uses the posting manager to verify and propagates a financial failure', async () => {
    const h = harness(true);
    await expect(h.service.execute(h.input)).rejects.toThrow('injected posting failure');
    expect(h.mfa.verifyChallengeInManager).toHaveBeenCalledWith(
      h.manager,
      expect.objectContaining({ challengeId }),
    );
    expect(h.ledger.postJournalInTransaction).toHaveBeenCalledWith(h.manager, expect.anything());
  });
});
