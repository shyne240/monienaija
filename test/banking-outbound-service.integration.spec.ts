import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';

import { BankingOutboundService } from '../src/banking/banking-outbound.service';
import { BankingProviderRegistry } from '../src/banking/banking-provider.registry';
import type {
  BankingProvider,
  BankingProviderResult,
  OutboundTransferSubmissionResult,
  TransferStatusResult,
} from '../src/banking/banking-provider.types';
import { capabilitiesOf } from '../src/banking/banking-provider.registry';
import { createIntegrationDataSource } from './support/pg-harness';

/**
 * Acceptance for the outbound execution service.
 *
 * These assertions are about consequences, not code paths. A duplicate transfer is the worst thing
 * this system can do, so the tests deliberately attack it from several directions:
 *
 * - concurrent prepare() calls for the same commitment must yield ONE record and ONE provider call;
 * - a timeout must leave UNKNOWN and must NOT be retried by dispatch();
 * - a provider that never saw the request (NOT_SENT) is the only safe retry;
 * - an enquiry that finds nothing must not be recorded as failure.
 */
describe('banking outbound service (real PostgreSQL)', () => {
  let db: DataSource;
  let service: BankingOutboundService;
  let institutionId: string;
  let walletId: string;

  /** Records every provider call so the tests can assert call *counts*, not just final state. */
  let submissions: string[];
  let enquiries: number;
  let submitImpl: () => Promise<BankingProviderResult<OutboundTransferSubmissionResult>>;
  let statusImpl: () => Promise<BankingProviderResult<TransferStatusResult>>;

  const CORRELATION = 'corr-outbound-1';

  function command(over: Partial<Parameters<BankingOutboundService['prepare']>[0]> = {}) {
    return {
      institutionId,
      walletId,
      providerKey: 'MONNIFY',
      environment: 'sandbox' as const,
      currency: 'NGN',
      amountMinor: '150000',
      destinationBankCode: '058',
      destinationAccountNumber: '0123456789',
      destinationAccountName: 'JOHN DOE',
      narration: 'Vendor settlement',
      correlationId: CORRELATION,
      ...over,
    };
  }

  function accepted(): BankingProviderResult<OutboundTransferSubmissionResult> {
    return {
      ok: true,
      value: {
        outcome: 'ACCEPTED',
        operationReference: 'ignored-by-adapter-fixture',
        providerReference: 'MNFY|ACCEPTED|1',
        correlationId: CORRELATION,
      },
    } as BankingProviderResult<OutboundTransferSubmissionResult>;
  }

  beforeAll(async () => {
    db = await createIntegrationDataSource('bkout001');
    institutionId = randomUUID();
    const suffix = institutionId.replace(/-/g, '').slice(0, 8).toUpperCase();
    await db.query(
      `INSERT INTO financial_institutions (id,reference,code,legal_name,institution_type,created_by)
       VALUES ($1,$2,$3,'Outbound service fixture','PARTNER','fixture')`,
      [institutionId, `BKOUT-${suffix}`, `BKOUT_${suffix}`],
    );
    const ledgerAccountId = randomUUID();
    await db.query(
      `INSERT INTO ledger_accounts (id,code,name,account_type,normal_balance,currency)
       VALUES ($1,$2,'Outbound fixture','LIABILITY','CREDIT','NGN')`,
      [ledgerAccountId, `OUT_FIXTURE_${suffix}`],
    );
    walletId = randomUUID();
    await db.query(
      `INSERT INTO wallet_accounts (id,customer_id,currency,status,ledger_account_id)
       VALUES ($1,$2,'NGN','ACTIVE',$3)`,
      [walletId, `cust-${suffix}`, ledgerAccountId],
    );

    const provider: BankingProvider = {
      descriptor: {
        key: 'MONNIFY',
        displayName: 'Monnify',
        environment: 'sandbox',
        // Only what this fixture actually implements: the registry refuses an adapter that
        // advertises a capability it does not wire, and that check is proving itself here.
        capabilities: capabilitiesOf({ OUTBOUND_TRANSFER_SUBMIT: true }),
        descriptors: [],
      },
      submitOutboundTransfer: async (request) => {
        submissions.push(request.operationReference);
        return submitImpl();
      },
      getTransferStatus: async (reference) => {
        enquiries += 1;
        expect(reference).toMatch(/^OP/);
        return statusImpl();
      },
    } as BankingProvider;
    const registry = new BankingProviderRegistry();
    registry.register(provider);
    service = new BankingOutboundService(db, registry);
  }, 120000);

  beforeEach(() => {
    submissions = [];
    enquiries = 0;
    submitImpl = () => Promise.resolve(accepted());
    statusImpl = () =>
      Promise.resolve({
        ok: true,
        value: {
          outcome: 'SUCCESSFUL',
          operationReference: 'OP',
          providerStatus: 'SUCCESS',
          correlationId: CORRELATION,
        },
      });
  });

  afterAll(async () => {
    if (db?.isInitialized) await db.destroy();
  });

  async function prepared(idempotencyKey: string) {
    return service.prepare(command(), idempotencyKey);
  }

  it('derives a stable reference from the commitment, not from randomness', () => {
    const a = service.operationReference(institutionId, walletId, 'commitment-1');
    const b = service.operationReference(institutionId, walletId, 'commitment-1');
    const c = service.operationReference(institutionId, walletId, 'commitment-2');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^OP[0-9A-F]{30}$/);
  });

  it('refuses malformed destination details before touching the provider', async () => {
    await expect(
      service.prepare(command({ destinationAccountNumber: '12' }), 'bad-account'),
    ).rejects.toThrow(/malformed/i);
    await expect(
      service.prepare(command({ destinationBankCode: 'ab' }), 'bad-bank'),
    ).rejects.toThrow(/malformed/i);
    await expect(service.prepare(command({ amountMinor: '-500' }), 'bad-amount')).rejects.toThrow(
      /positive/i,
    );
    expect(submissions).toHaveLength(0);
  });

  it('produces ONE record and ONE provider call for concurrent prepares of the same commitment', async () => {
    // The duplicate-transfer scenario: a retried request or two racing callers.
    const results = await Promise.all([
      prepared('commitment-race'),
      prepared('commitment-race'),
      prepared('commitment-race'),
    ]);
    const ids = new Set(results.map((r) => r.id));
    expect(ids.size).toBe(1);
    const [row] = await db.query<Array<{ c: string }>>(
      'SELECT count(*)::text AS c FROM banking_outbound_operations WHERE wallet_id=$1',
      [walletId],
    );
    expect(row!.c).toBe('1');

    // And the dispatch of that single record calls the provider exactly once.
    const { id } = results[0] as { id: string };
    await service.dispatch(id, command());
    await service.dispatch(id, command());
    expect(submissions).toHaveLength(1);
  });

  it('records an accepted submission as PENDING_PROVIDER with the provider reference', async () => {
    const { id } = await prepared('commitment-accepted');
    const record = await service.dispatch(id, command());
    expect(record.state).toBe('PENDING_PROVIDER');
    expect(record.provider_transaction_reference).toBe('MNFY|ACCEPTED|1');
  });

  it('records a timeout as UNKNOWN and never retries it', async () => {
    const { id } = await prepared('commitment-timeout');
    submitImpl = () =>
      Promise.resolve({
        ok: false,
        error: { category: 'TIMEOUT', code: 'MONNIFY_TIMEOUT', detail: 'no response' },
      });
    const first = await service.dispatch(id, command());
    expect(first.state).toBe('UNKNOWN');

    // A second dispatch must not call the provider again: the money may already have moved.
    const second = await service.dispatch(id, command());
    expect(second.state).toBe('UNKNOWN');
    expect(submissions).toHaveLength(1);
  });

  it('records an adapter exception as UNKNOWN rather than failure', async () => {
    const { id } = await prepared('commitment-throws');
    submitImpl = () => Promise.reject(new Error('socket hang up after write'));
    const record = await service.dispatch(id, command());
    expect(record.state).toBe('UNKNOWN');
  });

  it('treats an explicit provider rejection as FAILED, because nothing moved', async () => {
    const { id } = await prepared('commitment-rejected');
    submitImpl = () =>
      Promise.resolve({
        ok: false,
        error: {
          category: 'PROVIDER_REJECTED',
          code: 'MONNIFY_REJECTED',
          detail: 'insufficient funds',
        },
      });
    const record = await service.dispatch(id, command());
    expect(record.state).toBe('FAILED');
  });

  it('keeps an OTP challenge out of the accepted path', async () => {
    const { id } = await prepared('commitment-otp');
    submitImpl = () =>
      Promise.resolve({
        ok: true,
        value: {
          outcome: 'PENDING',
          operationReference: 'OP',
          requiresAdditionalAuthorization: true,
          correlationId: CORRELATION,
        },
      } as BankingProviderResult<OutboundTransferSubmissionResult>);
    const record = await service.dispatch(id, command());
    expect(record.state).toBe('PENDING_VERIFICATION');
    expect(record.requires_additional_authorization).toBe(true);
  });

  it('allows a retry only when the provider confirms nothing was sent', async () => {
    const { id } = await prepared('commitment-not-sent');
    submitImpl = () =>
      Promise.resolve({
        ok: true,
        value: { outcome: 'NOT_SENT', operationReference: 'OP', correlationId: CORRELATION },
      } as BankingProviderResult<OutboundTransferSubmissionResult>);
    const first = await service.dispatch(id, command());
    // NOT_SENT is the single safe case: the adapter is certain the request never left.
    expect(first.state).toBe('CREATED');

    submitImpl = () => Promise.resolve(accepted());
    const second = await service.dispatch(id, command());
    expect(second.state).toBe('PENDING_PROVIDER');
    expect(submissions).toHaveLength(2);
  });

  it('resolves UNKNOWN to SUCCESSFUL by enquiry, using the SAME reference', async () => {
    const { id, operationReference } = await prepared('commitment-enquire');
    submitImpl = () =>
      Promise.resolve({
        ok: false,
        error: { category: 'TIMEOUT', code: 'MONNIFY_TIMEOUT', detail: 'no response' },
      });
    await service.dispatch(id, command());
    statusImpl = () =>
      Promise.resolve({
        ok: true,
        value: {
          outcome: 'SUCCESSFUL',
          operationReference,
          providerStatus: 'SUCCESS',
          correlationId: CORRELATION,
        },
      });
    const record = await service.enquire(id, CORRELATION);
    expect(record.state).toBe('SUCCESSFUL');
    // Enquiry must not submit anything, and must actually have asked the provider.
    expect(submissions).toHaveLength(1);
    expect(enquiries).toBe(1);
  });

  it('leaves an operation uncertain when the provider has no record of it', async () => {
    const { id } = await prepared('commitment-notfound');
    submitImpl = () =>
      Promise.resolve({
        ok: false,
        error: { category: 'TIMEOUT', code: 'MONNIFY_TIMEOUT', detail: 'no response' },
      });
    await service.dispatch(id, command());
    statusImpl = () =>
      Promise.resolve({
        ok: true,
        value: { outcome: 'NOT_FOUND', operationReference: 'OP', correlationId: CORRELATION },
      });
    const record = await service.enquire(id, CORRELATION);
    // Absence of a provider record is not proof of failure: the reference may not have propagated.
    expect(record.state).toBe('UNKNOWN');
  });

  it('escalates to manual review without asserting an outcome', async () => {
    const { id } = await prepared('commitment-review');
    submitImpl = () =>
      Promise.resolve({
        ok: false,
        error: {
          category: 'TRANSPORT',
          code: 'MONNIFY_TRANSPORT_FAILED',
          detail: 'connection reset',
        },
      });
    await service.dispatch(id, command());
    const record = await service.escalateToReview(id, 'Provider unreachable for 2 hours');
    expect(record.state).toBe('MANUAL_REVIEW');
    expect(record.state).not.toBe('SUCCESSFUL');
    expect(record.state).not.toBe('FAILED');
  });

  it('refuses to escalate without a reason', async () => {
    const { id } = await prepared('commitment-review-2');
    await expect(service.escalateToReview(id, '  ')).rejects.toThrow(/reason/i);
  });

  it('cannot delete the record, so an uncertain attempt stays auditable', async () => {
    const { id } = await prepared('commitment-undeletable');
    await expect(
      db.query('DELETE FROM banking_outbound_operations WHERE id=$1', [id]),
    ).rejects.toThrow(/never deleted/i);
  });
});
