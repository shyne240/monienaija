import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';

import { BankingInboundService } from '../src/banking/banking-inbound.service';
import { BankingProviderRegistry, capabilitiesOf } from '../src/banking/banking-provider.registry';
import type {
  BankingProvider,
  BankingProviderResult,
  InboundPaymentVerificationResult,
} from '../src/banking/banking-provider.types';
import { createIntegrationDataSource } from './support/pg-harness';

/**
 * Acceptance for inbound deposits.
 *
 * The threat model is concrete: webhooks are unauthenticated input from the internet, and a replayed
 * or forged one must not become money. So the assertions concentrate on (a) a replay producing no
 * second credit, (b) an unverifiable payment never being treated as received, and (c) the provider's
 * amount winning the argument with the webhook's amount — by refusing, not by silently adjusting.
 */
describe('banking inbound service (real PostgreSQL)', () => {
  let db: DataSource;
  let service: BankingInboundService;
  let institutionId: string;
  let verifyImpl: () => Promise<BankingProviderResult<InboundPaymentVerificationResult>>;
  let verifyCalls: number;

  const CORRELATION = 'corr-inbound-1';

  function command(over: Record<string, unknown> = {}) {
    return {
      institutionId,
      providerKey: 'MONNIFY',
      environment: 'sandbox' as const,
      providerTransactionReference: `MNFY|${randomUUID().slice(0, 12)}`,
      providerPaymentReference: `PAY-${randomUUID().slice(0, 8)}`,
      currency: 'NGN',
      grossAmountMinor: '7800000',
      providerFeeMinor: '40000',
      creditedAmountMinor: '7760000',
      paidAt: new Date().toISOString(),
      ...over,
    };
  }

  beforeAll(async () => {
    db = await createIntegrationDataSource('bkin001');
    institutionId = randomUUID();
    const suffix = institutionId.replace(/-/g, '').slice(0, 8).toUpperCase();
    await db.query(
      `INSERT INTO financial_institutions (id,reference,code,legal_name,institution_type,created_by)
       VALUES ($1,$2,$3,'Inbound service fixture','PARTNER','fixture')`,
      [institutionId, `BKIN-${suffix}`, `BKIN_${suffix}`],
    );

    const provider = {
      descriptor: {
        key: 'MONNIFY',
        displayName: 'Monnify',
        environment: 'sandbox',
        capabilities: capabilitiesOf({ INBOUND_PAYMENT_VERIFICATION: true }),
        descriptors: [],
      },
      verifyInboundPayment: async (reference: string) => {
        verifyCalls += 1;
        expect(reference).toMatch(/^MNFY\|/);
        return verifyImpl();
      },
    } as BankingProvider;
    const registry = new BankingProviderRegistry();
    registry.register(provider);
    service = new BankingInboundService(db, registry);
  }, 120000);

  beforeEach(() => {
    verifyCalls = 0;
    verifyImpl = () =>
      Promise.resolve({
        ok: true,
        value: {
          outcome: 'VERIFIED',
          providerTransactionReference: 'MNFY|X',
          grossAmountMinor: '7800000',
          providerFeeMinor: '40000',
          currency: 'NGN',
          correlationId: CORRELATION,
        },
      } as BankingProviderResult<InboundPaymentVerificationResult>);
  });

  afterAll(async () => {
    if (db?.isInitialized) await db.destroy();
  });

  it('records a claimed payment WITHOUT marking it verified', async () => {
    const { id } = await service.record(command());
    const view = await service.view(id);
    // A webhook claim is not money: it must start unverified.
    expect(view.verification_state).toBe('UNVERIFIED');
    expect(view.ledger_transaction_id).toBeNull();
  });

  it('refuses an amount triple that does not add up', async () => {
    await expect(
      service.record(
        command({ grossAmountMinor: '1000', providerFeeMinor: '50', creditedAmountMinor: '900' }),
      ),
    ).rejects.toThrow(/equal/i);
  });

  it('refuses non-integer minor units', async () => {
    await expect(service.record(command({ grossAmountMinor: '10.50' }))).rejects.toThrow(
      /integer/i,
    );
  });

  it('returns the existing record for a replayed provider reference, without creating a second', async () => {
    const first = await service.record(command());
    const replay = await service.record(
      command({
        providerTransactionReference: (await service.view(first.id)).provider_transaction_reference,
      }),
    );
    expect(replay.alreadyRecorded).toBe(true);
    expect(replay.id).toBe(first.id);
    const [row] = await db.query<Array<{ c: string }>>(
      `SELECT count(*)::text AS c FROM banking_inbound_payments
        WHERE institution_id=$1 AND provider_transaction_reference=$2`,
      [
        institutionId,
        `MNFY|${(await service.view(first.id)).provider_transaction_reference.split('|')[1]}`,
      ],
    );
    expect(row!.c).toBe('1');
  });

  it('does not let a replayed webhook restate the amount already recorded', async () => {
    const reference = `MNFY|${randomUUID().slice(0, 12)}`;
    const first = await service.record(command({ providerTransactionReference: reference }));
    // A second event for the same reference claiming a different amount must not change the record.
    const replay = await service.record(
      command({
        providerTransactionReference: reference,
        grossAmountMinor: '9900000',
        creditedAmountMinor: '9860000',
      }),
    );
    expect(replay.id).toBe(first.id);
    const view = await service.view(first.id);
    expect(view.gross_amount_minor).toBe('7800000');
  });

  it('verifies a payment the provider confirms, at the same amount', async () => {
    const { id } = await service.record(command());
    const result = await service.verify(id, CORRELATION);
    expect(result.state).toBe('VERIFIED');
    expect((await service.view(id)).verification_state).toBe('VERIFIED');
  });

  it('REFUSES to verify when the provider reports a different amount', async () => {
    const { id } = await service.record(command());
    verifyImpl = () =>
      Promise.resolve({
        ok: true,
        value: {
          outcome: 'VERIFIED',
          providerTransactionReference: 'MNFY|X',
          // The provider says more money arrived than the webhook claimed.
          grossAmountMinor: '9900000',
          correlationId: CORRELATION,
        },
      } as BankingProviderResult<InboundPaymentVerificationResult>);
    const result = await service.verify(id, CORRELATION);
    expect(result.state).toBe('REJECTED');
    // And crucially the stored amount is untouched: history is not restated.
    expect((await service.view(id)).gross_amount_minor).toBe('7800000');
  });

  it('leaves a payment UNKNOWN when the provider cannot be reached', async () => {
    const { id } = await service.record(command());
    verifyImpl = () => Promise.reject(new Error('socket hang up'));
    const result = await service.verify(id, CORRELATION);
    expect(result.state).toBe('UNKNOWN');
    const view = await service.view(id);
    expect(view.verification_state).not.toBe('VERIFIED');
  });

  it('leaves a payment UNKNOWN when the provider returns a failure', async () => {
    const { id } = await service.record(command());
    verifyImpl = () =>
      Promise.resolve({
        ok: false,
        error: { category: 'TRANSPORT', code: 'MONNIFY_TRANSPORT_FAILED', detail: 'down' },
      } as BankingProviderResult<InboundPaymentVerificationResult>);
    const result = await service.verify(id, CORRELATION);
    expect(result.state).toBe('UNKNOWN');
  });

  it('does not treat a pending provider status as verified', async () => {
    const { id } = await service.record(command());
    verifyImpl = () =>
      Promise.resolve({
        ok: true,
        value: {
          outcome: 'PENDING',
          providerTransactionReference: 'MNFY|X',
          correlationId: CORRELATION,
        },
      } as BankingProviderResult<InboundPaymentVerificationResult>);
    const result = await service.verify(id, CORRELATION);
    expect(result.state).toBe('UNKNOWN');
    expect(result.state).not.toBe('VERIFIED');
  });

  it('treats a provider conflict as a dispute, not a payment', async () => {
    const { id } = await service.record(command());
    verifyImpl = () =>
      Promise.resolve({
        ok: true,
        value: {
          outcome: 'CONFLICT',
          providerTransactionReference: 'MNFY|X',
          correlationId: CORRELATION,
        },
      } as BankingProviderResult<InboundPaymentVerificationResult>);
    const result = await service.verify(id, CORRELATION);
    expect(result.state).toBe('REJECTED');
  });

  it('does not re-verify an already verified payment', async () => {
    const { id } = await service.record(command());
    await service.verify(id, CORRELATION);
    const callsAfterFirst = verifyCalls;
    const second = await service.verify(id, CORRELATION);
    expect(second.state).toBe('VERIFIED');
    // No second provider call: verification evidence does not need refreshing on every request.
    expect(verifyCalls).toBe(callsAfterFirst);
  });

  it('exposes only verified, unposted payments to the posting path', async () => {
    const pending = await service.record(command());
    // Unverified payments must never appear here, or an unproven webhook becomes money.
    const before = await service.verifiedUnposted(institutionId);
    expect(before.map((p) => p.id)).not.toContain(pending.id);

    await service.verify(pending.id, CORRELATION);
    const after = await service.verifiedUnposted(institutionId);
    expect(after.map((p) => p.id)).toContain(pending.id);
    // Still no ledger entry: posting is a separate, governed operation.
    expect(after.find((p) => p.id === pending.id)!.ledger_transaction_id).toBeNull();
  });

  it('keeps the fee distinct from the credited amount', async () => {
    const { id } = await service.record(command());
    await service.verify(id, CORRELATION);
    const view = await service.view(id);
    expect(view.gross_amount_minor).toBe('7800000');
    expect(view.provider_fee_minor).toBe('40000');
    expect(view.credited_amount_minor).toBe('7760000');
  });
});
