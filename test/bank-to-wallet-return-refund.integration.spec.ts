/**
 * Governed RETURN → Monnify refund lifecycle on disposable PostgreSQL.
 *
 * Deterministic provider transport; no live refund, credential or real money. The tests drive the
 * real maker/checker approval, the exception resolution and the refund execution service. They
 * prove that a decision is not a payout, that an uncertain submission is resolved by status lookup
 * and that a confirmed outcome cannot be rewritten by late or duplicate notifications.
 */
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DataSource } from 'typeorm';

import type { AuthorizationPrincipal } from '../src/authorization/authorization.types';
import { PrivilegedActionApprovalService } from '../src/authorization/privileged-action-approval.service';
import { BankToWalletExceptionService } from '../src/banking/bank-to-wallet-exception.service';
import { BankToWalletReturnExecutionService } from '../src/banking/bank-to-wallet-return-execution.service';
import { BankingProviderRegistry, capabilitiesOf } from '../src/banking/banking-provider.registry';
import type {
  BankingProvider,
  RefundInitiationResult,
  RefundStatusResult,
} from '../src/banking/banking-provider.types';
import { createIntegrationDataSource, destroyIntegrationDataSource } from './support/pg-harness';

type DispatchMode = 'timeout' | 'accepted' | 'duplicate';
type StatusOutcome = RefundStatusResult['outcome'];

describe('Bank to Wallet governed RETURN refunds (real PostgreSQL)', () => {
  let db: DataSource;
  let app: NestFastifyApplication;
  let exceptions: BankToWalletExceptionService;
  let refunds: BankToWalletReturnExecutionService;
  let institutionId: string;
  let dispatchMode: DispatchMode;
  let statusOutcome: StatusOutcome;
  let submissions: string[];
  let lookups: string[];
  const maker = {
    type: 'OPERATOR',
    principalId: 'return-fixture-maker',
    sessionId: randomUUID(),
    roles: ['FINANCE_PREPARER'],
    scopes: [],
    customerAccess: 'NONE',
    agentAccess: 'NONE',
    assuranceLevel: 'MFA',
  } as AuthorizationPrincipal;
  const checker = {
    type: 'OPERATOR',
    principalId: 'return-fixture-checker',
    sessionId: randomUUID(),
    roles: ['FINANCE_CONTROLLER'],
    scopes: ['privileged:approve'],
    customerAccess: 'NONE',
    agentAccess: 'NONE',
    assuranceLevel: 'MFA',
  } as AuthorizationPrincipal;

  const provider: BankingProvider = {
    descriptor: {
      key: 'MONNIFY',
      displayName: 'Monnify (deterministic refund transport)',
      environment: 'sandbox',
      capabilities: capabilitiesOf({ REFUND_INITIATION: true }),
      descriptors: [],
    },
    initiateRefund: (request) => {
      submissions.push(request.refundReference);
      if (dispatchMode === 'timeout') return Promise.reject(new Error('deterministic timeout'));
      const value: RefundInitiationResult = {
        outcome: dispatchMode === 'duplicate' ? 'UNKNOWN' : 'PENDING',
        refundReference: request.refundReference,
        originalProviderReference: request.originalProviderReference,
        providerStatus: dispatchMode === 'duplicate' ? 'D07' : 'PENDING',
        correlationId: request.correlationId,
      };
      return Promise.resolve({ ok: true, value });
    },
    getRefundStatus: (reference) => {
      lookups.push(reference);
      const value: RefundStatusResult = {
        outcome: statusOutcome,
        refundReference: reference,
        providerStatus: statusOutcome,
        correlationId: 'refund-recovery',
      };
      return Promise.resolve({ ok: true, value });
    },
  };

  beforeAll(async () => {
    db = await createIntegrationDataSource('b2wreturn');
    const registry = new BankingProviderRegistry();
    registry.register(provider);
    const { AppModule } = await import('../src/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DataSource)
      .useValue(db)
      .overrideProvider(BankingProviderRegistry)
      .useValue(registry)
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();

    exceptions = app.get(BankToWalletExceptionService);
    refunds = new BankToWalletReturnExecutionService(db, registry, true);

    institutionId = randomUUID();
    await db.query(
      `INSERT INTO financial_institutions (id,reference,code,legal_name,institution_type,created_by,status)
       VALUES ($1,$2,$3,'Return fixture institution','PARTNER','fixture','REGISTERED')`,
      [
        institutionId,
        `RET-${institutionId.slice(0, 8).toUpperCase()}`,
        `RET_${institutionId.replace(/-/g, '').slice(0, 8).toUpperCase()}`,
      ],
    );
  }, 180_000);

  afterAll(async () => {
    if (app) await app.close();
    if (db) await destroyIntegrationDataSource(db);
  }, 60_000);

  beforeEach(() => {
    dispatchMode = 'accepted';
    statusOutcome = 'PENDING';
    submissions = [];
    lookups = [];
  });

  async function seedException() {
    const suffix = randomUUID();
    const created = await exceptions.record({
      businessReference: `B2W-${suffix}`,
      institutionId,
      providerKey: 'MONNIFY',
      environment: 'sandbox',
      providerTransactionReference: `MNFY|ORIGINAL|${suffix}`,
      currency: 'NGN',
      grossAmountMinor: '100000',
      providerFeeMinor: '1750',
      settlementAmountMinor: '98250',
      customerCreditMinor: '98250',
      reason: 'REFERENCE_MISMATCH',
    });
    return created.id;
  }

  async function approveReturn(exceptionId: string) {
    const approval = await exceptions.requestDecision(maker, {
      exceptionId,
      decision: 'RETURN',
      reason: 'Provider evidence does not match the wallet business reference',
    });
    const checked = app.get(PrivilegedActionApprovalService);
    const decision = await checked.approve({
      principal: checker,
      approvalId: approval.id,
      comment: 'Independent Finance Controller approval',
    });
    if (!decision.approved) throw new Error(`Approval failed: ${String(decision.reason)}`);
    const executed = await exceptions.executeDecision(checker, {
      exceptionId,
      approvalId: approval.id,
      decision: 'RETURN',
      reason: 'Provider evidence does not match the wallet business reference',
    });
    expect(executed.state).toBe('APPROVED_FOR_RETURN');
    return approval.id;
  }

  it('refuses to prepare a refund without a consumed RETURN approval', async () => {
    const exceptionId = await seedException();
    await expect(refunds.prepare(exceptionId)).rejects.toThrow('consumed RETURN approval');
    expect(submissions).toEqual([]);
  });

  it('timeout resolves by status lookup; retries never send a second refund', async () => {
    const exceptionId = await seedException();
    await approveReturn(exceptionId);
    const original: Array<{
      business_reference: string;
      provider_transaction_reference: string;
      state: string;
    }> = await db.query(
      `SELECT business_reference,provider_transaction_reference,state
           FROM bank_to_wallet_exceptions WHERE id=$1`,
      [exceptionId],
    );
    const prepared = await refunds.prepare(exceptionId);
    expect(prepared.state).toBe('APPROVED');
    expect(prepared.originalProviderReference).toBe(original[0]!.provider_transaction_reference);

    dispatchMode = 'timeout';
    const uncertain = await refunds.dispatch(prepared.id, 'refund-1');
    expect(uncertain.state).toBe('UNKNOWN');
    expect(submissions).toHaveLength(1);
    expect(lookups).toEqual([]);

    // A retry cannot submit again; it must first learn what the provider did.
    const retry = await refunds.dispatch(prepared.id, 'refund-2');
    expect(retry.state).toBe('UNKNOWN');
    expect(retry.returnReference).toBe(prepared.returnReference);
    expect(submissions).toHaveLength(1);

    statusOutcome = 'COMPLETED';
    const confirmed = await refunds.enquire(prepared.id, 'refund-recovery');
    expect(confirmed.state).toBe('RETURNED');
    expect(confirmed.refundReference).toBe(prepared.returnReference);
    expect(lookups).toEqual([prepared.returnReference]);

    const after: Array<{
      business_reference: string;
      provider_transaction_reference: string;
      state: string;
      notes: string;
    }> = await db.query(
      `SELECT business_reference,provider_transaction_reference,state,notes
           FROM bank_to_wallet_exceptions WHERE id=$1`,
      [exceptionId],
    );
    expect(after[0]).toMatchObject({
      business_reference: original[0]!.business_reference,
      provider_transaction_reference: original[0]!.provider_transaction_reference,
      state: 'RETURNED',
    });
    expect(after[0]!.notes).toContain(prepared.returnReference);

    // Late/out-of-order updates cannot overwrite a confirmed return or send again.
    statusOutcome = 'FAILED';
    const late = await refunds.enquire(prepared.id, 'refund-late');
    expect(late.state).toBe('RETURNED');
    expect(submissions).toHaveLength(1);
    expect(lookups).toEqual([prepared.returnReference]);
  });

  it('a duplicate-provider response stays uncertain until status lookup confirms failure', async () => {
    const exceptionId = await seedException();
    await approveReturn(exceptionId);
    const prepared = await refunds.prepare(exceptionId);
    dispatchMode = 'duplicate';
    const uncertain = await refunds.dispatch(prepared.id, 'refund-duplicate');
    expect(uncertain.state).toBe('UNKNOWN');
    expect(uncertain.lastFailureCode).toBe('D07');
    expect(submissions).toEqual([prepared.returnReference]);

    statusOutcome = 'FAILED';
    statusOutcome = 'FAILED';
    const failed = await refunds.enquire(prepared.id, 'refund-status');
    expect(failed.state).toBe('FAILED');
    expect(failed.resolvedAt).toBeTruthy();

    statusOutcome = 'COMPLETED';
    const late = await refunds.enquire(prepared.id, 'refund-late');
    expect(late.state).toBe('FAILED');
    expect(submissions).toEqual([prepared.returnReference]);
  });
});
