import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import type { AuthorizationPrincipal } from '../src/authorization/authorization.types';
import type { AuthorizationService } from '../src/authorization/authorization.service';
import { governedChangeFingerprint } from '../src/authorization/governed-action.registry';
import { PrivilegedActionApproval } from '../src/authorization/privileged-action-approval.entity';
import { PrivilegedActionApprovalService } from '../src/authorization/privileged-action-approval.service';
import { ProtectedAuthorityService } from '../src/authorization/protected-authority.service';
import { SecurityEventHistory } from '../src/customer-authentication/security-event-history.entity';
import { createKycAuthorityConnectionsOverTcp } from './support/kyc-authority-tcp';
import type { DataSource, EntityManager } from 'typeorm';

import { AuditEvent } from '../src/operations/audit-event.entity';
import { OutboxEvent } from '../src/operations/outbox-event.entity';
import { LedgerAccount } from '../src/ledger/ledger-account.entity';
import { LedgerJournal } from '../src/ledger/ledger-journal.entity';
import { LedgerLine } from '../src/ledger/ledger-line.entity';
import { AuditService } from '../src/operations/audit.service';
import { OutboxService } from '../src/operations/outbox.service';
import { LedgerService } from '../src/ledger/ledger.service';
import { SettlementAccountService } from '../src/payment/settlement-account.service';
import { FeeRuleCalculatorService } from '../src/fee-rules/fee-rule-calculator.service';
import { FeeRuleResolverService } from '../src/fee-rules/fee-rule-resolver.service';
import type { LimitEnforcementService } from '../src/limit-catalog/limit-enforcement.service';
import type { CustomerFinancialEligibilityService } from '../src/kyc-verification/customer-financial-eligibility.service';
import { WalletFinancialBoundaryService } from '../src/wallet/wallet-financial-boundary.service';
import { BankingInboundService } from '../src/banking/banking-inbound.service';
import { BankingProviderRegistry } from '../src/banking/banking-provider.registry';
import type { MonnifyHttpClient } from '../src/banking/monnify/monnify.http';
import { MonnifyProvider } from '../src/banking/monnify/monnify.provider';
import { BankToWalletExceptionService } from '../src/banking/bank-to-wallet-exception.service';
import { BankToWalletService } from '../src/banking/bank-to-wallet.service';
import { BankingVirtualAccountService } from '../src/banking/banking-virtual-account.service';
import { createIntegrationDataSource } from './support/pg-harness';

/**
 * Bank → Wallet acceptance against a fully migrated, disposable PostgreSQL database.
 *
 * Provider responses are deterministic fixtures: no sandbox credential, real money movement or
 * live transfer is used. The assertions cover the platform invariants that a provider simulator
 * cannot prove — one durable business reference, exactly one wallet credit under concurrent
 * replay, no credit on unverifiable/mismatched/limit-blocked payments, and separate amount chain
 * fields for Monnify deductions and MonieNaija charges.
 */
describe('Bank to Wallet with Monnify (real PostgreSQL, deterministic provider)', () => {
  let db: DataSource;
  let service: BankToWalletService;
  let exceptionService: BankToWalletExceptionService;
  let accounts: BankingVirtualAccountService;
  let institutionId: string;
  let walletId: string;
  let customerId: string;
  let accountNumber: string;
  let accountReference: string;
  let providerReference: string;
  let providerStatus = 'PAID';
  let allowLimit = true;
  let limitCalls = 0;
  let verifyCalls = 0;
  let connections: Awaited<ReturnType<typeof createKycAuthorityConnectionsOverTcp>>;
  let approvals: PrivilegedActionApprovalService;
  let maker: AuthorizationPrincipal;
  let checker: AuthorizationPrincipal;

  // Monnify's documented example uses major units: 10000.00 gross, 175.00 fee, 9825.00 settlement.
  const GROSS = '1000000';
  const PROVIDER_FEE = '17500';
  const SETTLEMENT = '982500';

  /** Drives the real maker/checker stack; the protected-authority triggers reject forged rows. */
  async function prepareApproval(
    action: string,
    resourceType: string,
    resourceId: string,
    payload: Record<string, unknown>,
  ): Promise<{ approvalId: string; fingerprint: string }> {
    const fingerprint = governedChangeFingerprint(action, resourceType, resourceId, payload);
    const requested = await approvals.request({
      principal: maker,
      policy: {
        resourceType,
        action,
        allowedPrincipalTypes: ['OPERATOR', 'SERVICE', 'PRIVILEGED'],
        requiredRoles: [],
        requiredFunctions: [],
        minimumAssurance: 'MFA',
        customerAccess: 'NONE',
      },
      resource: { type: resourceType, id: resourceId },
      actionFingerprint: fingerprint,
      reason: 'Synthetic Bank to Wallet fixture',
      requestDetails: payload,
    });
    if (!requested.approval) throw new Error(`Approval request denied: ${requested.reason}`);
    const decided = await approvals.approve({
      principal: checker,
      approvalId: requested.approval.id,
      comment: 'Synthetic fixture checker decision',
    });
    if (!decided.approved) throw new Error(`Approval decision denied: ${decided.reason}`);
    return { approvalId: requested.approval.id, fingerprint };
  }

  async function consumeApprovalIn(
    manager: EntityManager,
    action: string,
    resourceType: string,
    resourceId: string,
    approvalId: string,
    fingerprint: string,
  ): Promise<void> {
    const consumed = await approvals.consumeInTransaction(manager, {
      principal: checker,
      approvalId,
      actionType: action,
      resource: { type: resourceType, id: resourceId },
      actionFingerprint: fingerprint,
    });
    if (!consumed.approved) throw new Error(`Approval consumption denied: ${consumed.reason}`);
  }

  beforeAll(async () => {
    db = await createIntegrationDataSource('b2wmnf');
    connections = await createKycAuthorityConnectionsOverTcp(db);
    maker = {
      type: 'OPERATOR',
      principalId: 'b2w-fixture-maker',
      sessionId: randomUUID(),
      roles: ['OPERATIONS', 'FINANCE_PREPARER'],
      scopes: [
        'institution.lifecycle.prepare',
        'institution.attribution.prepare',
        'privileged:approve',
      ],
      customerAccess: 'NONE',
      assuranceLevel: 'MFA',
    } as AuthorizationPrincipal;
    checker = {
      type: 'OPERATOR',
      principalId: 'b2w-fixture-checker',
      sessionId: randomUUID(),
      roles: ['FINANCE_CONTROLLER'],
      scopes: [
        'institution.lifecycle.approve',
        'institution.attribution.approve',
        'privileged:approve',
      ],
      customerAccess: 'NONE',
      assuranceLevel: 'MFA',
    } as AuthorizationPrincipal;
    approvals = new PrivilegedActionApprovalService(
      db.getRepository(PrivilegedActionApproval),
      db.getRepository(SecurityEventHistory),
      connections.runtime,
      new AuditService(db.getRepository(AuditEvent)),
      { authorize: () => Promise.resolve({ allowed: true }) } as unknown as AuthorizationService,
      new ProtectedAuthorityService(db),
    );
    institutionId = randomUUID();
    customerId = randomUUID();
    const suffix = institutionId.replace(/-/g, '').slice(0, 8).toUpperCase();
    const digits = `${suffix.replace(/[^0-9]/g, '')}${Date.now()}`
      .replace(/[^0-9]/g, '')
      .slice(0, 16);
    accountNumber = `62${digits.slice(0, 10)}`;
    accountReference = `MN${digits}`;
    await db.query(
      `INSERT INTO financial_institutions (id,reference,code,legal_name,institution_type,created_by,status)
       VALUES ($1,$2,$3,'Bank to Wallet fixture','PARTNER','fixture','REGISTERED')`,
      [institutionId, `B2W-${suffix}`, `B2W_${suffix}`],
    );
    await db.query(
      `UPDATE financial_institutions
          SET status='EVIDENCE_SUBMITTED',evidence_reference=$2,evidence_recorded_at=clock_timestamp(),
              evidence_digest=repeat('a',64)
        WHERE id=$1`,
      [institutionId, `B2W-EVIDENCE-${suffix}`],
    );
    const payload = {
      currentStatus: 'EVIDENCE_SUBMITTED',
      targetStatus: 'APPROVED',
      institutionId,
    };
    const lifecycle = await prepareApproval(
      'FINANCIAL_INSTITUTION_LIFECYCLE_CHANGE',
      'FINANCIAL_INSTITUTION',
      institutionId,
      payload,
    );
    await db.transaction(async (manager) => {
      await consumeApprovalIn(
        manager,
        'FINANCIAL_INSTITUTION_LIFECYCLE_CHANGE',
        'FINANCIAL_INSTITUTION',
        institutionId,
        lifecycle.approvalId,
        lifecycle.fingerprint,
      );
      await manager.query(
        `UPDATE financial_institutions
            SET status='APPROVED',lifecycle_approval_id=$2,operational_approved_at=clock_timestamp(),
                operational_approved_by='fixture-approver',
                status_reason='Synthetic Bank to Wallet fixture'
          WHERE id=$1`,
        [institutionId, lifecycle.approvalId],
      );
    });
    await db.query(
      `INSERT INTO customers (id,reference,customer_type,status,kyc_level,kyc_status,is_synthetic)
       VALUES ($1,$2,'INDIVIDUAL','ACTIVE','LEVEL_2','APPROVED',false)`,
      [customerId, `b2w-c-${suffix.toLowerCase()}`],
    );

    const walletLedgerId = randomUUID();
    await db.query(
      `INSERT INTO ledger_accounts (id,code,name,account_type,normal_balance,currency,accounting_unit,is_active)
       VALUES ($1,$2,'Bank to Wallet customer','LIABILITY','CREDIT','NGN','CUSTOMER_FUNDS',true)`,
      [walletLedgerId, `B2W_WALLET_${suffix}`],
    );
    // The migrated schema already seeds the settlement asset account used by all ledger postings.
    walletId = randomUUID();
    await db.query(
      `INSERT INTO wallet_accounts (id,customer_id,currency,status,ledger_account_id,owner_class)
       VALUES ($1,$2,'NGN','ACTIVE',$3,'CUSTOMER')`,
      [walletId, customerId, walletLedgerId],
    );
    // Institution scope is attached through the governed attribution workflow, never by writing
    // the wallet's institution column directly.
    const attribution = await prepareApproval(
      'WALLET_INSTITUTION_ATTRIBUTION',
      'WALLET_ACCOUNT',
      walletId,
      { institutionId, ledgerAccountId: walletLedgerId, ownerClass: 'CUSTOMER' },
    );
    await db.transaction(async (manager) => {
      await consumeApprovalIn(
        manager,
        'WALLET_INSTITUTION_ATTRIBUTION',
        'WALLET_ACCOUNT',
        walletId,
        attribution.approvalId,
        attribution.fingerprint,
      );
      const receiptId = randomUUID();
      await manager.query(
        `INSERT INTO governed_wallet_institution_attributions
          (id,approval_id,wallet_id,ledger_account_id,institution_id,owner_class,owner_reference,
           evidence_type,evidence_reference,evidence_digest,reason,executed_by)
         VALUES ($1,$2,$3,$4,$5,'CUSTOMER',$6,'TEST_FIXTURE',$7,repeat('a',64),'fixture','fixture')`,
        [
          receiptId,
          attribution.approvalId,
          walletId,
          walletLedgerId,
          institutionId,
          customerId,
          accountReference,
        ],
      );
      await manager.query(
        `UPDATE wallet_accounts SET institution_id=$2,institution_attribution_id=$3 WHERE id=$1`,
        [walletId, institutionId, receiptId],
      );
    });
    await db.query(
      `INSERT INTO virtual_accounts (id,wallet_id,bank_code,account_number,account_name,provider,status,reference,assigned_at)
       VALUES ($1,$2,'50515',$3,'Synthetic reserved account','MONNIFY','ACTIVE',$4,clock_timestamp())`,
      [randomUUID(), walletId, accountNumber, accountReference],
    );

    // The REAL Monnify adapter is registered, with a deterministic in-memory transport that returns
    // the documented transaction-query envelope. No network call and no live/sandbox credential is
    // involved; all Monnify field mapping stays inside the adapter.
    const http: MonnifyHttpClient = {
      send: (request) => {
        if (request.path === '/api/v1/auth/login') {
          return Promise.resolve({
            status: 200,
            body: {
              requestSuccessful: true,
              responseCode: '0',
              responseBody: { accessToken: 'synthetic-token', expiresIn: 3600 },
            },
          });
        }
        if (request.path.startsWith('/api/v2/merchant/transactions/query')) {
          verifyCalls += 1;
          return Promise.resolve({
            status: 200,
            body: {
              requestSuccessful: true,
              responseCode: '0',
              responseBody: {
                transactionReference: providerReference,
                paymentReference: accountReference,
                amountPaid: 10000,
                totalPayable: 10000,
                settlementAmount: 9825,
                fee: 175,
                currencyCode: 'NGN',
                paymentStatus: providerStatus,
                paymentMethod: 'ACCOUNT_TRANSFER',
                paidOn: new Date().toISOString(),
                paymentSourceInformation: [
                  { bankCode: '058', accountNumber: '0123456789', accountName: 'Payer' },
                ],
              },
            },
          });
        }
        return Promise.resolve({
          status: 400,
          body: {
            requestSuccessful: false,
            responseCode: '99',
            responseMessage: 'unexpected path',
          },
        });
      },
    };
    const provider = new MonnifyProvider({
      environment: 'sandbox',
      contractCode: 'SYNTHETIC_CONTRACT',
      apiKey: 'synthetic-api-key',
      secretKey: 'synthetic-secret-key',
      http,
    });
    const registry = new BankingProviderRegistry();
    registry.register(provider);
    const inbound = new BankingInboundService(db, registry);
    accounts = new BankingVirtualAccountService(db, registry);

    // The eligibility and limit controls are real boundaries in production wiring. Here their
    // policy backends are deterministic so the proof isolates this journey's behaviour; the calls
    // themselves are asserted below.
    const eligibility = {
      require: () => Promise.resolve('LEVEL_2' as const),
    } as unknown as CustomerFinancialEligibilityService;
    const boundary = new WalletFinancialBoundaryService(eligibility);
    const ledger = new LedgerService(
      db.getRepository(LedgerAccount),
      db.getRepository(LedgerJournal),
      db.getRepository(LedgerLine),
      db,
      boundary,
    );
    const settlementAccounts = new SettlementAccountService();
    const exceptions = new BankToWalletExceptionService(db, approvals, ledger, settlementAccounts);
    exceptionService = exceptions;
    const limits = {
      enforceWithManager: () => {
        limitCalls += 1;
        return Promise.resolve({
          allowed: allowLimit,
          limitProfileCode: allowLimit ? 'B2W_TEST_PROFILE' : 'B2W_TEST_BLOCK',
          evaluatedDimensions: [],
          ruleRefs: [],
        });
      },
    } as unknown as LimitEnforcementService;
    const config = new ConfigService<Record<string, unknown>, true>({
      BANK_TO_WALLET_ENABLED: true,
      BANKING_ENVIRONMENT: 'sandbox',
    } as never);

    service = new BankToWalletService(
      db,
      inbound,
      registry,
      exceptions,
      new FeeRuleResolverService(db),
      new FeeRuleCalculatorService(),
      limits,
      boundary,
      ledger,
      settlementAccounts,
      new AuditService(db.getRepository(AuditEvent)),
      new OutboxService(db.getRepository(OutboxEvent)),
      config as never,
    );
  }, 120_000);

  afterAll(async () => {
    await connections?.cleanup();
    if (db?.isInitialized) await db.destroy();
  });

  beforeEach(() => {
    allowLimit = true;
    providerStatus = 'PAID';
    limitCalls = 0;
    verifyCalls = 0;
  });

  async function seedExplicitZeroFee(): Promise<void> {
    await db.query(
      `INSERT INTO products (code,name,domain,currency,enabled,status,created_by)
       VALUES ('BANK_TO_WALLET','Bank to wallet','CUSTOMER','NGN',true,'ACTIVE','fixture')
       ON CONFLICT (code) DO NOTHING`,
    );
    await db.query(
      `INSERT INTO fee_rules
         (product_code,currency,flat_fee_minor,percentage_bps,minimum_fee_minor,maximum_fee_minor,
          vat_bps,effective_from,is_active,created_by,priority)
       VALUES ('BANK_TO_WALLET','NGN',0,0,0,NULL,0,now() - interval '1 hour',true,'fixture',100)`,
    );
  }

  function intake(over: Record<string, unknown> = {}) {
    const providerTransactionReference = `MNFY|B2W|${randomUUID().slice(0, 12)}`;
    providerReference = providerTransactionReference;
    return {
      institutionId,
      providerKey: 'MONNIFY',
      environment: 'sandbox' as const,
      providerTransactionReference,
      providerPaymentReference: accountReference,
      reservationId: null,
      receivingAccountNumber: accountNumber,
      receivingBankCode: '50515',
      currency: 'NGN',
      grossAmountMinor: GROSS,
      providerFeeMinor: PROVIDER_FEE,
      paidAt: new Date().toISOString(),
      ...over,
    };
  }

  async function count(table: string, reference: string): Promise<number> {
    const rows = await db.query<Array<{ count: string }>>(
      `SELECT count(*)::text AS count FROM ${table} WHERE business_reference=$1`,
      [reference],
    );
    return Number(rows[0]?.count ?? '0');
  }

  it('credits once with a stable business reference and keeps the amount chain separate', async () => {
    await seedExplicitZeroFee();
    const { businessReference } = await service.intake(intake());
    expect(businessReference).toMatch(/^B2W-[0-9A-F]{32}$/);

    const result = await service.verifyAndPost({ businessReference, correlationId: 'b2w-credit' });
    expect(result).toMatchObject({
      status: 'CREDITED',
      businessReference,
      amountMinor: SETTLEMENT,
      replayed: false,
    });
    expect(limitCalls).toBe(1);

    const rows = await db.query<Array<Record<string, unknown>>>(
      `SELECT settlement_amount_minor::text AS settlement, provider_fee_minor::text AS provider_fee,
              monienaija_fee_minor::text AS platform_fee, amount_minor::text AS credit,
              fee_ref, wallet_id, journal_id AS credit_journal_id
         FROM bank_to_wallet_credits WHERE business_reference=$1`,
      [businessReference],
    );
    expect(rows[0]).toMatchObject({
      settlement: SETTLEMENT,
      provider_fee: PROVIDER_FEE,
      platform_fee: '0',
      credit: SETTLEMENT,
      wallet_id: walletId,
    });
    expect(rows[0]!.fee_ref).toMatchObject({
      feeMinor: '0',
      productCode: 'BANK_TO_WALLET',
    });
    expect(rows[0]!.credit_journal_id).toBeTruthy();

    const ledgerRows = await db.query<Array<Record<string, unknown>>>(
      `SELECT reference,metadata->>'businessReference' AS business_reference
         FROM ledger_journals WHERE id=$1`,
      [rows[0]!.credit_journal_id],
    );
    expect(ledgerRows[0]).toMatchObject({
      reference: businessReference,
      business_reference: businessReference,
    });

    const replay = await service.verifyAndPost({ businessReference, correlationId: 'b2w-replay' });
    expect(replay).toMatchObject({ status: 'CREDITED', replayed: true });
    expect(verifyCalls).toBe(1);
    expect(await count('bank_to_wallet_credits', businessReference)).toBe(1);
  });

  it('gives concurrent replays exactly one credit', async () => {
    const { businessReference } = await service.intake(intake());
    const attempts = await Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        service.verifyAndPost({ businessReference, correlationId: `b2w-concurrent-${index}` }),
      ),
    );
    expect(attempts.every((result) => result.status === 'CREDITED')).toBe(true);
    expect(
      attempts.filter((result) => result.status === 'CREDITED' && !result.replayed),
    ).toHaveLength(1);
    expect(await count('bank_to_wallet_credits', businessReference)).toBe(1);
    expect(await count('bank_to_wallet_settlements', businessReference)).toBe(1);
  });

  it('never credits an unverifiable payment and leaves a traceable exception', async () => {
    const { businessReference } = await service.intake(intake());
    providerStatus = 'NOT_FOUND';
    const result = await service.verifyAndPost({
      businessReference,
      correlationId: 'b2w-unverifiable',
    });
    expect(result).toMatchObject({ status: 'EXCEPTION', reason: 'UNVERIFIABLE_PAYMENT' });
    expect(await count('bank_to_wallet_credits', businessReference)).toBe(0);
    const exception = await db.query<Array<Record<string, unknown>>>(
      `SELECT reason,permitted_next_action,state FROM bank_to_wallet_exceptions WHERE business_reference=$1`,
      [businessReference],
    );
    expect(exception[0]).toMatchObject({
      reason: 'UNVERIFIABLE_PAYMENT',
      permitted_next_action: 'RETRY_PROVIDER_VERIFICATION',
      state: 'OPEN',
    });
    const replay = await service.verifyAndPost({
      businessReference,
      correlationId: 'b2w-unverifiable-2',
    });
    expect(replay).toMatchObject({ status: 'EXCEPTION', replayed: true });
    expect(await count('bank_to_wallet_credits', businessReference)).toBe(0);
  });

  it('refuses a destination that does not belong to the stored assignment', async () => {
    const { businessReference } = await service.intake(
      intake({ receivingAccountNumber: '6999999999', providerPaymentReference: 'OTHER-REFERENCE' }),
    );
    const result = await service.verifyAndPost({
      businessReference,
      correlationId: 'b2w-unmatched',
    });
    expect(result).toMatchObject({ status: 'EXCEPTION', reason: 'REFERENCE_MISMATCH' });
    expect(await count('bank_to_wallet_credits', businessReference)).toBe(0);
  });

  it('records an unmatched receiving account with no invented institution', async () => {
    const reference = 'MNFY|ORPHAN|4401';
    const recorded = await service.recordUnattributed({
      environment: 'sandbox',
      providerTransactionReference: reference,
      receivingAccountNumber: '6000000001',
      currency: 'NGN',
      grossAmountMinor: GROSS,
      providerFeeMinor: PROVIDER_FEE,
    });
    const rows = await db.query<Array<Record<string, unknown>>>(
      `SELECT institution_id,reason,permitted_next_action FROM bank_to_wallet_exceptions WHERE id=$1`,
      [recorded.exceptionId],
    );
    expect(rows[0]).toMatchObject({
      institution_id: null,
      reason: 'UNMATCHED_RECEIVING_ACCOUNT',
      permitted_next_action: 'IDENTIFY_ACCOUNT_THEN_FINANCE_REVIEW',
    });
    expect(recorded.businessReference).toMatch(/^B2W-[0-9A-F]{32}$/);
  });

  it('records a limit-blocked verified payment without a wallet journal', async () => {
    allowLimit = false;
    const { businessReference } = await service.intake(intake());
    const result = await service.verifyAndPost({ businessReference, correlationId: 'b2w-limit' });
    expect(result).toMatchObject({ status: 'EXCEPTION', reason: 'LIMIT_BLOCKED' });
    expect(await count('bank_to_wallet_credits', businessReference)).toBe(0);
    const rows = await db.query<Array<Record<string, unknown>>>(
      `SELECT e.permitted_next_action,e.evidence,p.resolution_state
         FROM bank_to_wallet_exceptions e
         JOIN banking_inbound_payments p ON p.business_reference=e.business_reference
        WHERE e.business_reference=$1`,
      [businessReference],
    );
    expect(rows[0]).toMatchObject({
      permitted_next_action: 'FINANCE_DECIDE_RELEASE_OR_RETURN',
      resolution_state: 'EXCEPTION',
    });
  });

  it('returns the receiving account and deposit states the Customer App renders', async () => {
    const view = await accounts.findForWallet(customerId, walletId);
    expect(view).toMatchObject({
      state: 'PROVISIONED',
      accountNumber,
      accountReference,
      providerSupportsProvisioning: true,
    });

    const { businessReference } = await service.intake(intake());
    const result = await service.verifyAndPost({
      businessReference,
      correlationId: 'b2w-app-view',
    });
    expect(result.status).toBe('CREDITED');
    const deposits = await accounts.depositHistoryForCustomer(customerId, 10);
    const deposit = deposits.find((item) => item.businessReference === businessReference);
    expect(typeof deposit?.reference).toBe('string');
    expect(deposit).toMatchObject({
      state: 'CREDITED',
      amountMinor: SETTLEMENT,
      grossAmountMinor: GROSS,
      providerFeeMinor: PROVIDER_FEE,
      monienaijaFeeMinor: '0',
    });
  });

  async function openLimitBlockedException(): Promise<string> {
    allowLimit = false;
    const { businessReference } = await service.intake(intake());
    const result = await service.verifyAndPost({
      businessReference,
      correlationId: 'b2w-governance-fixture',
    });
    if (result.status !== 'EXCEPTION') throw new Error('Expected a limit-blocked exception');
    await db.query(
      `INSERT INTO bank_to_wallet_settlements
        (business_reference,institution_id,provider_key,environment,provider_transaction_reference,
         currency,gross_amount_minor,provider_deduction_minor,settlement_amount_minor,
         monienaija_charge_minor,customer_credit_minor,settlement_state)
       VALUES ($1,$2,'MONNIFY','sandbox',$3,'NGN',$4,$5,$6,0,$6,'PENDING_PROVIDER_SETTLEMENT')
       ON CONFLICT (business_reference) DO NOTHING`,
      [
        businessReference,
        institutionId,
        `MNFY|${businessReference.slice(4, 12)}`,
        GROSS,
        PROVIDER_FEE,
        SETTLEMENT,
      ],
    );
    return result.exceptionId;
  }

  it('requires an independent Finance checker before a return decision is executed', async () => {
    const exceptionId = await openLimitBlockedException();
    const reason = 'Synthetic Finance decision for withheld transfer';
    const approval = await exceptionService.requestDecision(maker, {
      exceptionId,
      decision: 'RETURN',
      reason,
    });
    const selfApproval = await approvals.approve({
      principal: maker,
      approvalId: approval.id,
      comment: 'must be refused',
    });
    expect(selfApproval).toMatchObject({ approved: false, reason: 'SELF_APPROVAL_FORBIDDEN' });

    const checked = await approvals.approve({
      principal: checker,
      approvalId: approval.id,
      comment: 'independent checker',
    });
    expect(checked.approved).toBe(true);

    const executed = await exceptionService.executeDecision(checker, {
      exceptionId,
      approvalId: approval.id,
      decision: 'RETURN',
      reason,
    });
    expect(executed).toMatchObject({
      state: 'APPROVED_FOR_RETURN',
      replayed: false,
      journalId: null,
    });
    const replay = await exceptionService.executeDecision(checker, {
      exceptionId,
      approvalId: approval.id,
      decision: 'RETURN',
      reason,
    });
    expect(replay).toMatchObject({ state: 'APPROVED_FOR_RETURN', replayed: true });
    const rows = await db.query<Array<Record<string, unknown>>>(
      `SELECT state,notes FROM bank_to_wallet_exceptions WHERE id=$1`,
      [exceptionId],
    );
    expect(String(rows[0]!.notes)).toMatch(/external provider confirmation still required/i);
    expect(
      await count(
        'bank_to_wallet_credits',
        (await exceptionService.view(exceptionId)).business_reference as string,
      ),
    ).toBe(0);
  });

  it('refuses a governed release without confirmed provider settlement evidence', async () => {
    const exceptionId = await openLimitBlockedException();
    const reference = String((await exceptionService.view(exceptionId)).business_reference);
    // Downgrade the synthetic settlement row so no confirmed evidence exists.
    await db.query(
      `UPDATE bank_to_wallet_settlements SET settlement_state='OUTSTANDING' WHERE business_reference=$1`,
      [reference],
    );
    const reason = 'Release refused without confirmed settlement evidence';
    const approval = await exceptionService.requestDecision(maker, {
      exceptionId,
      decision: 'RELEASE',
      reason,
    });
    const checked = await approvals.approve({
      principal: checker,
      approvalId: approval.id,
      comment: 'independent checker',
    });
    expect(checked.approved).toBe(true);
    await expect(
      exceptionService.executeDecision(checker, {
        exceptionId,
        approvalId: approval.id,
        decision: 'RELEASE',
        reason,
      }),
    ).rejects.toThrow(/confirmed provider settlement evidence/i);
    expect(await count('bank_to_wallet_credits', reference)).toBe(0);
  });

  it('projects one customer deposit and one history row for a credit', async () => {
    const { businessReference } = await service.intake(intake());
    const result = await service.verifyAndPost({ businessReference, correlationId: 'b2w-history' });
    expect(result.status).toBe('CREDITED');
    const deposits = await db.query<Array<Record<string, unknown>>>(
      `SELECT business_reference,resolution_state,customer_credit_minor::text AS credit
         FROM banking_inbound_payments WHERE business_reference=$1`,
      [businessReference],
    );
    expect(deposits[0]).toMatchObject({
      business_reference: businessReference,
      resolution_state: 'CREDITED',
      credit: SETTLEMENT,
    });
    const history = await db.query<Array<Record<string, unknown>>>(
      `SELECT c.business_reference::text AS business_reference,p.id::text AS intake_id,
              j.metadata->>'bankIntakeId' AS bank_intake_id,
              p.ledger_transaction_id::text AS ledger_transaction_id
         FROM bank_to_wallet_credits c
         JOIN banking_inbound_payments p ON p.id=c.inbound_payment_id
         JOIN ledger_journals j ON j.id=c.journal_id
        WHERE c.business_reference=$1`,
      [businessReference],
    );
    expect(history[0]).toMatchObject({
      business_reference: businessReference,
      bank_intake_id: history[0]!.intake_id,
      ledger_transaction_id: result.status === 'CREDITED' ? result.journalId : null,
    });
  });
});
