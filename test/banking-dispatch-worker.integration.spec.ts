import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';

import { BankingDispatchWorker } from '../src/banking/banking-dispatch-worker.service';
import { BankingOutboundService } from '../src/banking/banking-outbound.service';
import { BankingProviderRegistry, capabilitiesOf } from '../src/banking/banking-provider.registry';
import type { BankingProvider } from '../src/banking/banking-provider.types';
import { BankingCommitmentBridgeService } from '../src/banking/banking-commitment-bridge.service';
import { createIntegrationDataSource } from './support/pg-harness';

/**
 * Durable dispatch worker acceptance (real PostgreSQL).
 *
 * The worker is where an authorized commitment becomes a provider submission, so the properties tested
 * here are the ones whose failure costs money:
 *
 * - at most one process dispatches one operation, even under concurrency (database lease, not a flag);
 * - a process that dies mid-tick leaves a recoverable operation, not a stranded one;
 * - the worker submits under the provider the commitment was authorized for, never whatever is
 *   configured at dispatch time;
 * - attempts are bounded, and exhaustion escalates to a human — it never invents an outcome.
 */
describe('banking dispatch worker (real PostgreSQL)', () => {
  let db: DataSource;
  let service: BankingOutboundService;
  let registry: BankingProviderRegistry;
  let institutionId: string;
  let walletId: string;

  let submissions: string[];
  let enquiries: number;
  let submitImpl: () => Promise<unknown>;
  let statusImpl: () => Promise<unknown>;

  const CORRELATION = 'corr-dispatch-worker';

  function accepted(): unknown {
    return {
      ok: true,
      value: {
        outcome: 'ACCEPTED',
        operationReference: 'ignored',
        providerReference: 'MNFY|WORKER|1',
        correlationId: CORRELATION,
      },
    };
  }

  beforeAll(async () => {
    db = await createIntegrationDataSource('bkworker');
    institutionId = randomUUID();
    const suffix = institutionId.replace(/-/g, '').slice(0, 8).toUpperCase();
    await db.query(
      `INSERT INTO financial_institutions (id,reference,code,legal_name,institution_type,created_by)
       VALUES ($1,$2,$3,'Dispatch worker fixture','PARTNER','fixture')`,
      [institutionId, `BKWK-${suffix}`, `BKWK_${suffix}`],
    );
    const ledgerAccountId = randomUUID();
    await db.query(
      `INSERT INTO ledger_accounts (id,code,name,account_type,normal_balance,currency)
       VALUES ($1,$2,'Dispatch worker fixture','LIABILITY','CREDIT','NGN')`,
      [ledgerAccountId, `WORK_FIXTURE_${suffix}`],
    );
    walletId = randomUUID();
    await db.query(
      // The wallet is deliberately NOT institution-attributed: a protected trigger refuses direct
      // attribution at insert and requires the governed approval workflow, which this suite must not
      // bypass. `prepare()` binds the institution as an explicit parameter instead, so the dispatch
      // path is exercised without weakening that safeguard.
      `INSERT INTO wallet_accounts (id,customer_id,currency,status,ledger_account_id,owner_class)
       VALUES ($1,$2,'NGN','ACTIVE',$3,'CUSTOMER')`,
      [walletId, `cust-${suffix}`, ledgerAccountId],
    );

    const provider = {
      descriptor: {
        key: 'MONNIFY',
        displayName: 'Monnify',
        environment: 'sandbox',
        capabilities: capabilitiesOf({
          OUTBOUND_TRANSFER_SUBMIT: true,
          TRANSFER_STATUS_ENQUIRY: true,
        }),
        descriptors: [],
      },
      submitOutboundTransfer: (request: { operationReference: string }) => {
        submissions.push(request.operationReference);
        return Promise.resolve(submitImpl());
      },
      getTransferStatus: () => {
        enquiries += 1;
        return Promise.resolve(statusImpl());
      },
    } as unknown as BankingProvider;

    registry = new BankingProviderRegistry();
    registry.register(provider);
    service = new BankingOutboundService(db, registry);
  }, 180_000);

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
    // Neither outbound operations nor their dispatch attempts may ever be deleted: triggers refuse
    // both, which is the audit guarantee this system is built on. Each case therefore creates its own
    // operation and asserts against that operation's id, rather than clearing a shared table.
  });

  afterAll(async () => {
    if (db?.isInitialized) await db.destroy();
  });

  async function prepared(key: string): Promise<{ id: string; operationReference: string }> {
    const record = await service.prepare(
      {
        institutionId,
        walletId,
        providerKey: 'MONNIFY',
        environment: 'sandbox' as const,
        currency: 'NGN',
        amountMinor: '250000',
        destinationBankCode: '058',
        destinationAccountNumber: '0123456789',
        destinationAccountName: 'JOHN DOE',
        narration: 'Worker fixture',
        correlationId: CORRELATION,
      },
      key,
    );
    return { id: record.id, operationReference: record.operationReference };
  }

  function worker(over: Partial<{ leaseMs: number; maxAttempts: number }> = {}) {
    return new BankingDispatchWorker(db, service, {
      enabled: false,
      leaseMs: over.leaseMs ?? 30_000,
      maxAttempts: over.maxAttempts ?? 3,
    });
  }

  it('dispatches a CREATED operation exactly once and records the provider reference', async () => {
    const { id, operationReference } = await prepared('worker-1');
    const result = await worker().tick();
    expect(result.dispatched).toBe(1);
    expect(submissions).toEqual([operationReference]);

    const rows = await db.query<Array<{ state: string; provider_transaction_reference: string }>>(
      'SELECT state,provider_transaction_reference FROM banking_outbound_operations WHERE id=$1',
      [id],
    );
    expect(rows[0]!.state).toBe('PENDING_PROVIDER');
    expect(rows[0]!.provider_transaction_reference).toBe('MNFY|WORKER|1');
  });

  it('does not dispatch the same operation twice across two workers', async () => {
    await prepared('worker-2');
    // Two independent instances, as two application pods would be.
    const [first, second] = await Promise.all([worker().tick(), worker().tick()]);
    expect(submissions.length).toBe(1);
    // One of them did the work; the other either found nothing claimable or skipped it.
    expect(first.dispatched + second.dispatched).toBe(1);
  });

  it('recovers an operation whose lease expired without re-submitting blindly', async () => {
    const { id, operationReference } = await prepared('worker-3');
    // Simulate a process that claimed the operation and died before releasing: a live lease that is
    // already expired. The tick clears expired leases and reclaims.
    await db.query(
      `INSERT INTO banking_dispatch_leases(operation_id,lease_owner,leased_until,fence)
       VALUES($1,'dead-process:1:abcdef',clock_timestamp() - interval '1 second',7)`,
      [id],
    );
    const result = await worker().tick();
    expect(result.dispatched).toBe(1);
    expect(submissions).toEqual([operationReference]);
    // The stale lease is gone; a new one was taken and released.
    const leases = await db.query<Array<{ count: string }>>(
      'SELECT count(*)::text AS count FROM banking_dispatch_leases WHERE operation_id=$1',
      [id],
    );
    expect(leases[0]!.count).toBe('0');
  });

  it('refuses to dispatch a new operation when intake is disabled, but still enquires', async () => {
    const { id } = await prepared('worker-4');
    const w = worker();
    w.disableIntake();
    const first = await w.tick();
    expect(first.dispatched).toBe(0);
    expect(submissions).toHaveLength(0);

    // An operation already in the uncertain family is still investigated: disablement stops new
    // submissions, it must not strand money that may already have moved.
    await db.query(`UPDATE banking_outbound_operations SET state='UNKNOWN' WHERE id=$1`, [id]);
    const second = await w.tick();
    expect(second.enquired).toBe(1);
    expect(enquiries).toBe(1);
  });

  it('escalates to MANUAL_REVIEW after bounded attempts and never asserts failure', async () => {
    const { id } = await prepared('worker-5');
    // The provider stays unreachable for BOTH submission and enquiry. If the enquiry could answer, a
    // correct system would resolve the operation — that is the escalation test in the outbound suite.
    // Here the question is what happens when nobody can answer at all.
    submitImpl = () => Promise.resolve({ ok: false, error: { code: 'MONNIFY_TRANSPORT_FAILED' } });
    statusImpl = () => Promise.resolve({ ok: false, error: { code: 'MONNIFY_TRANSPORT_FAILED' } });
    const w = worker({ maxAttempts: 2 });
    await w.tick();
    const afterFirst = await db.query<Array<{ state: string; attempts: number }>>(
      'SELECT state,attempts FROM banking_outbound_operations WHERE id=$1',
      [id],
    );
    // A transport failure leaves the operation UNKNOWN: the request may have been received.
    expect(afterFirst[0]!.state).toBe('UNKNOWN');

    await db.query(`UPDATE banking_outbound_operations SET attempts=2 WHERE id=$1`, [id]);
    await w.tick();
    const rows = await db.query<Array<{ state: string; resolved_at: Date | null }>>(
      'SELECT state,resolved_at FROM banking_outbound_operations WHERE id=$1',
      [id],
    );
    // Exhaustion is a human's problem, not a verdict. FAILED would tell the customer the money did
    // not move, which we do not know.
    expect(rows[0]!.state).toBe('MANUAL_REVIEW');
    expect(rows[0]!.resolved_at).toBeNull();
  });

  it('records a durable, append-only attempt history', async () => {
    const { id } = await prepared('worker-6');
    await worker().tick();
    const attempts = await db.query<Array<{ attempt_number: number; outcome: string }>>(
      'SELECT attempt_number,outcome FROM banking_dispatch_attempts WHERE operation_id=$1 ORDER BY attempt_number',
      [id],
    );
    expect(attempts.length).toBeGreaterThan(0);
    expect(attempts[0]!.attempt_number).toBe(1);
    // Attempts are evidence of what was tried. The schema permits completing an attempt's own
    // outcome (that is how it finishes) but refuses to rewrite its identity or delete it — both of
    // which would falsify the record of what was actually sent.
    await expect(
      db.query('UPDATE banking_dispatch_attempts SET attempt_number=99 WHERE operation_id=$1', [
        id,
      ]),
    ).rejects.toThrow(/immutable/i);
    await expect(
      db.query(
        `UPDATE banking_dispatch_attempts SET lease_owner='someone-else' WHERE operation_id=$1`,
        [id],
      ),
    ).rejects.toThrow(/immutable/i);
    await expect(
      db.query('DELETE FROM banking_dispatch_attempts WHERE operation_id=$1', [id]),
    ).rejects.toThrow(/never deleted/i);
  });

  it('does not dispatch an operation that is already terminal', async () => {
    const { id } = await prepared('worker-7');
    await db.query(
      `UPDATE banking_outbound_operations SET state='SUCCESSFUL',resolved_at=now() WHERE id=$1`,
      [id],
    );
    const result = await worker().tick();
    expect(result.dispatched).toBe(0);
    expect(submissions).toHaveLength(0);
  });

  describe('commitment bridge', () => {
    function bridgeInput(
      over: Partial<
        Parameters<BankingCommitmentBridgeService['createDispatchIntentInTransaction']>[1]
      > = {},
    ) {
      return {
        institutionId,
        providerKey: 'MONNIFY',
        environment: 'sandbox' as const,
        externalOperationId: randomUUID(),
        externalOperationReference: 'EXT-1',
        walletId,
        currency: 'NGN',
        amountMinor: '7000',
        destinationBankCode: '058',
        destinationAccountNumber: '0123456789',
        destinationAccountName: null,
        ...over,
      };
    }

    it('creates the dispatch intent once for a repeated commitment', async () => {
      const bridge = new BankingCommitmentBridgeService(registry);
      const input = bridgeInput();
      const first = await db.transaction((m) => bridge.createDispatchIntentInTransaction(m, input));
      const second = await db.transaction((m) =>
        bridge.createDispatchIntentInTransaction(m, input),
      );
      expect(first!.created).toBe(true);
      expect(second!.created).toBe(false);
      // Same identity, so a replay addresses the same provider operation.
      expect(second!.id).toBe(first!.id);
      expect(second!.operationReference).toBe(first!.operationReference);
    });

    it('creates nothing for a provider that is not a banking provider', async () => {
      const bridge = new BankingCommitmentBridgeService(registry);
      const input = bridgeInput({ providerKey: 'NIBSS_NIP' });
      const result = await db.transaction((m) =>
        bridge.createDispatchIntentInTransaction(m, input),
      );
      // Not a banking dispatch: a row here would sit in the worklist forever.
      expect(result).toBeNull();
      const rows = await db.query<Array<{ count: string }>>(
        `SELECT count(*)::text AS count FROM banking_outbound_operations
          WHERE external_operation_id=$1`,
        [input.externalOperationId],
      );
      expect(rows[0]!.count).toBe('0');
    });

    it('refuses a banking provider with no institution attribution', async () => {
      const bridge = new BankingCommitmentBridgeService(registry);
      await expect(
        db.transaction((m) =>
          bridge.createDispatchIntentInTransaction(m, bridgeInput({ institutionId: null })),
        ),
      ).rejects.toThrow(/institution/i);
    });
  });
});
