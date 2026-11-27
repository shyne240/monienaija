/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any */

/**
 * PR #27 — APPLIED FEE → RUNTIME QUOTE PARITY (real PostgreSQL + real workforce sessions).
 *
 * The governed authoring lifecycle is only meaningful if the configuration it publishes actually
 * governs an operation. This suite closes that loop for a fee:
 *
 *   1. A maker (FINANCE_PREPARER) proposes an OPEN-ENDED (effectiveTo absent) WALLET_TRANSFER fee.
 *   2. An independent checker (FINANCE_CONTROLLER) approves it.
 *   3. The same checker executes it; the rule row is written and the approval is consumed.
 *   4. A REAL customer self-session creates a REAL wallet-transfer quote through
 *      `TransferQuoteService.create()` — the same call the customer app makes — inside a
 *      SERIALIZABLE transaction with real wallet/ledger/boundary/institution gates.
 *   5. The quote's fee/vat/total equal BOTH the effective-configuration preview and the
 *      applied rule, so preview, quote and runtime resolution cannot diverge.
 *
 * Nothing authorization-relevant is mocked: real `a2_finance_role_assignments` rows, real
 * `A2WorkforceSessionService.establish()` bearer sessions, the real `PrivilegedActionApprovalService`
 * ledger, the real fee registry/governance service and the real transfer pricing stack.
 *
 * The only test doubles are the ones the sibling suites already use, and each is a documented
 * test-only seam rather than a production bypass:
 *   - the trusted KYC evidence reader (production provenance deliberately defaults to unavailable);
 *   - the commercial accounting registry rows provisioned verbatim from migration 1785753600076
 *     (the per-test TRUNCATE empties the migration-seeded rows, exactly as in
 *     `v1-commercial-accounting-01.integration.spec.ts`).
 */
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import * as request from 'supertest';

import { AppModule } from '../src/app.module';
import { A2WorkforceSessionService } from '../src/authorization/workforce-session.service';
import { A2_WORKFORCE_CONFIG } from '../src/authorization/workforce-oidc.service';
import { workforceConfiguration } from '../src/authorization/workforce-configuration';
import { A2FinanceRoleAssignment } from '../src/authorization/workforce-authentication.entity';
import { FeeRuleResolverService } from '../src/fee-rules/fee-rule-resolver.service';
import { KycTierEvidenceReader } from '../src/kyc-verification/kyc-tier-evidence.reader';
import { ProductCatalogSeedService } from '../src/product-catalog/product-catalog-seed.service';
import { TransferQuoteService } from '../src/transfer/transfer-quote.service';
import { WalletService } from '../src/wallet/wallet.service';
import {
  createIntegrationDataSource,
  destroyIntegrationDataSource,
  truncateAllTables,
} from './support/pg-harness';
import { createTestEvidenceReader } from './support/kyc-test-evidence-reader';
import { createEligibleCustomer } from './support/kyc-test-fixtures';
import { GovernedFinancialFixture } from './support/governed-financial-fixture';

const PRODUCT = 'WALLET_TRANSFER';
const CURRENCY = 'NGN';
const APPROVALS_PATH = '/api/v1/internal/a2/workforce/approvals';
const PREVIEW_PATH = '/api/v1/internal/commercial-configuration/effective-preview';

const kycEvidence = createTestEvidenceReader({ mode: 'ELIGIBLE' });

/** Migration 1785753600076 provisioning state, restored after the per-test TRUNCATE. */
const ACCOUNTING_FAMILIES = [
  { role: 'FEE_REVENUE', code: 'FINANCE-FEE_REVENUE-NGN', type: 'REVENUE', normal: 'CREDIT' },
  { role: 'VAT_PAYABLE', code: 'FINANCE-VAT_PAYABLE-NGN', type: 'LIABILITY', normal: 'CREDIT' },
  {
    role: 'COMMISSION_EXPENSE',
    code: 'FINANCE-COMMISSION_EXPENSE-NGN',
    type: 'EXPENSE',
    normal: 'DEBIT',
  },
  {
    role: 'COMMISSION_PAYABLE',
    code: 'FINANCE-COMMISSION_PAYABLE-NGN',
    type: 'LIABILITY',
    normal: 'CREDIT',
  },
] as const;

describe('PR27 applied fee governs the real runtime quote (real PostgreSQL)', () => {
  let dataSource: DataSource;
  let app: NestFastifyApplication;
  let sessions: A2WorkforceSessionService;
  let quotes: TransferQuoteService;
  let wallets: WalletService;
  let resolver: FeeRuleResolverService;
  let governed: GovernedFinancialFixture;
  const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
  const ACCOUNTING_KEYS = [
    'COMMERCIAL_ACCOUNTING_ENABLED',
    'COMMERCIAL_ACCOUNTING_VAT_TREATMENT',
    'COMMERCIAL_COMMISSION_ACCOUNTING_TREATMENT',
    'COMMERCIAL_COMMISSION_RECOGNITION_TIMING',
  ] as const;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    // Runtime accounting configuration is read fresh on every call; an explicit VAT treatment is
    // required before ANY fee can be quoted. EXCLUSIVE_ADD_ON mirrors the sibling suites.
    process.env.COMMERCIAL_ACCOUNTING_ENABLED = 'true';
    process.env.COMMERCIAL_ACCOUNTING_VAT_TREATMENT = 'EXCLUSIVE_ADD_ON';
    process.env.COMMERCIAL_COMMISSION_ACCOUNTING_TREATMENT = 'EXPENSE_PAYABLE';
    process.env.COMMERCIAL_COMMISSION_RECOGNITION_TIMING = 'ACCRUE_NOW_SETTLE_LATER';

    const workforceConfig = workforceConfiguration({
      NODE_ENV: 'development',
      A2_WORKFORCE_ENABLED: 'true',
      A2_WORKFORCE_OIDC_ISSUER: 'https://oidc.commercial-authoring.test',
      A2_WORKFORCE_OIDC_JWKS_URI: 'https://oidc.commercial-authoring.test/jwks',
      A2_WORKFORCE_OIDC_AUDIENCE: 'monienaija-workforce',
      A2_WORKFORCE_OIDC_CLIENT_ID: 'monienaija-admin-console',
      A2_WORKFORCE_INTERNAL_AUDIENCE: 'workforce-admin',
      A2_WORKFORCE_SESSION_TTL_SECONDS: '900',
      A2_BOOTSTRAP_ENABLED: 'false',
      A2_BOOTSTRAP_ADMIN_SCOPES_JSON: JSON.stringify(['privileged:execute']),
      A2_BOOTSTRAP_JWKS_JSON: '[]',
      A2_FINANCE_ROLES_JSON: JSON.stringify([
        {
          roleKey: 'SUPER_ADMIN',
          displayName: 'Super Administrator',
          description: 'Privileged administration.',
          enabled: true,
          scopes: ['privileged:execute'],
          applicableActions: ['FINANCE_ROLE_ASSIGN', 'FINANCE_ROLE_REVOKE'],
          mfaRequired: true,
          approvalCapability: false,
          makerEligible: true,
          checkerEligible: false,
          administrativeCapability: true,
        },
        {
          roleKey: 'FINANCE_PREPARER',
          displayName: 'Finance Preparer',
          description: 'Initiates finance control changes.',
          enabled: true,
          scopes: ['finance:prepare'],
          applicableActions: ['FINANCE_CONTROL_POLICY_ACTIVATE'],
          mfaRequired: true,
          approvalCapability: false,
          makerEligible: true,
          checkerEligible: false,
          administrativeCapability: false,
        },
        {
          roleKey: 'FINANCE_CONTROLLER',
          displayName: 'Finance Controller',
          description: 'Approves finance role/control changes.',
          enabled: true,
          scopes: ['privileged:approve', 'privileged:execute'],
          applicableActions: [
            'FINANCE_ROLE_ASSIGN',
            'FINANCE_ROLE_REVOKE',
            'FINANCE_CONTROL_POLICY_ACTIVATE',
          ],
          mfaRequired: true,
          approvalCapability: true,
          makerEligible: false,
          checkerEligible: true,
          administrativeCapability: false,
        },
        {
          roleKey: 'FINANCE_AUDITOR',
          displayName: 'Finance Auditor',
          description: 'Read-oriented assurance role.',
          enabled: true,
          scopes: ['finance:audit'],
          applicableActions: [],
          mfaRequired: true,
          approvalCapability: false,
          makerEligible: false,
          checkerEligible: false,
          administrativeCapability: false,
        },
        {
          roleKey: 'ADMINISTRATOR',
          displayName: 'Administrator',
          description: 'Administrative role.',
          enabled: true,
          scopes: [],
          applicableActions: [],
          mfaRequired: true,
          approvalCapability: false,
          makerEligible: false,
          checkerEligible: false,
          administrativeCapability: false,
        },
      ]),
      A2_MAKER_CHECKER_RULES_JSON: JSON.stringify([
        {
          action: 'FINANCE_ROLE_ASSIGN',
          initiatingRoles: ['SUPER_ADMIN'],
          approvingRoles: ['FINANCE_CONTROLLER'],
          minimumApprovals: 1,
          separationRequired: true,
          selfApprovalProhibited: true,
          mfaRequired: true,
          minimumAssurance: 'MFA',
          materialityRequired: false,
        },
        {
          action: 'FINANCE_ROLE_REVOKE',
          initiatingRoles: ['SUPER_ADMIN'],
          approvingRoles: ['FINANCE_CONTROLLER'],
          minimumApprovals: 1,
          separationRequired: true,
          selfApprovalProhibited: true,
          mfaRequired: true,
          minimumAssurance: 'MFA',
          materialityRequired: false,
        },
        {
          action: 'FINANCE_CONTROL_POLICY_ACTIVATE',
          initiatingRoles: ['FINANCE_PREPARER'],
          approvingRoles: ['FINANCE_CONTROLLER'],
          minimumApprovals: 1,
          separationRequired: true,
          selfApprovalProhibited: true,
          mfaRequired: true,
          minimumAssurance: 'MFA',
          materialityRequired: false,
        },
      ]),
      A2_WORKFORCE_RATE_LIMITS_JSON: JSON.stringify([
        {
          category: 'workforce-authentication',
          capacity: 1000,
          refillRatePerSecond: 1000,
          enabled: true,
        },
        {
          category: 'workforce-bootstrap',
          capacity: 1000,
          refillRatePerSecond: 1000,
          enabled: true,
        },
        {
          category: 'finance-role-administration',
          capacity: 1000,
          refillRatePerSecond: 1000,
          enabled: true,
        },
        {
          category: 'privileged-approval',
          capacity: 1000,
          refillRatePerSecond: 1000,
          enabled: true,
        },
      ]),
      A2_TRUSTED_PROXY_ADDRESSES_JSON: JSON.stringify(['127.0.0.1', '::1/128']),
    });

    dataSource = await createIntegrationDataSource('pr27feequote');

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DataSource)
      .useValue(dataSource)
      .overrideProvider(A2_WORKFORCE_CONFIG)
      .useValue(workforceConfig)
      .overrideProvider(KycTierEvidenceReader)
      .useValue(kycEvidence.reader)
      .compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }),
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    sessions = moduleRef.get(A2WorkforceSessionService);
    quotes = moduleRef.get(TransferQuoteService);
    wallets = moduleRef.get(WalletService);
    resolver = moduleRef.get(FeeRuleResolverService);
  }, 180_000);

  afterAll(async () => {
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
    for (const key of ACCOUNTING_KEYS) delete process.env[key];
    if (app) await app.close().catch(() => undefined);
    if (dataSource) await destroyIntegrationDataSource(dataSource).catch(() => undefined);
  }, 60_000);

  beforeEach(async () => {
    await truncateAllTables(dataSource);
    await app.get(ProductCatalogSeedService).seedIfEmpty();
    await seedAccountingFamilies();
    governed = new GovernedFinancialFixture({ app, dataSource, label: 'pr27fee' });
  });

  /**
   * Restores the migration-provisioned commercial accounting registry. The per-test TRUNCATE also
   * empties these tables, and `TransferPricingService` legitimately refuses to quote a fee when
   * the VAT treatment or revenue account family is missing (fail-closed, DP-03=B).
   */
  async function seedAccountingFamilies(): Promise<void> {
    const institutionId = await new GovernedFinancialFixture({
      app,
      dataSource,
      label: 'pr27acct',
    }).institution();
    for (const family of ACCOUNTING_FAMILIES) {
      await dataSource.query(
        `INSERT INTO ledger_accounts (id, code, name, account_type, normal_balance, currency, accounting_unit, allow_negative_balance, is_active, institutional_scope, institution_id)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, 'NGN', 'CUSTOMER_FUNDS', FALSE, TRUE, 'INSTITUTION', $5)
         ON CONFLICT (code) DO NOTHING`,
        [family.code, `${family.code} (PR27 fixture)`, family.type, family.normal, institutionId],
      );
      await dataSource.query(
        `INSERT INTO commercial_accounting_registry (
           family_code, account_code, account_type, normal_balance, currency, accounting_unit,
           purpose, decision_references, evidence_source, provisioned_by
         ) VALUES ($1, $2, $3, $4, 'NGN', 'CUSTOMER_FUNDS',
           'PR27 fixture mirroring migration 1785753600076', ARRAY['DP-31=A'], 'TEST', '1785753600076')
         ON CONFLICT (family_code) DO NOTHING`,
        [family.role, family.code, family.type, family.normal],
      );
    }
  }

  async function provisionRole(roleKey: string): Promise<{ principalId: string; token: string }> {
    const principalId = `pr27fee:${roleKey}:${randomUUID()}`.slice(0, 160);
    const now = new Date();
    await dataSource.getRepository(A2FinanceRoleAssignment).save({
      id: randomUUID(),
      assignmentReference: `pr27-fee-quote:${principalId}`,
      assignmentVersion: 1,
      principalId,
      roleKey,
      scopes: [],
      status: 'ACTIVE',
      initiatedScope: 'SUPER_ADMIN_SCOPE',
      interim: true,
      effectiveFrom: new Date(now.getTime() - 60_000),
      effectiveTo: new Date(now.getTime() + 3_600_000),
      assignedBy: 'test-harness',
      assignedAt: now,
      revokedBy: null,
      revokedAt: null,
      bootstrapReference: null,
      approvalIds: [],
      auditReferences: [],
    } as any);
    const session = await sessions.establish({
      issuer: 'https://local-dev-identity.monienaija.invalid',
      subject: principalId,
      principalId,
      audience: ['workforce-admin'],
      issuedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 3_600_000).toISOString(),
      authenticatedAt: now.toISOString(),
      assuranceLevel: 'MFA',
      amr: ['pwd', 'otp'],
      acr: null,
      signingKeyId: 'test-harness-key',
    });
    return { principalId, token: session.accessToken };
  }

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  it('publishes an open-ended fee through real maker/checker/executor sessions and governs the next real quote', async () => {
    const preparer = await provisionRole('FINANCE_PREPARER');
    const controller = await provisionRole('FINANCE_CONTROLLER');

    // ── 1. MAKER proposes an open-ended rule: `effectiveTo` omitted, exactly as the Admin Web
    // contract emits it for an empty "Effective until".
    const proposal = {
      reason: 'PR27 runtime quote parity — open-ended wallet transfer fee',
      productCode: PRODUCT,
      currency: CURRENCY,
      customerClassCode: null,
      agentClassId: null,
      institutionId: null,
      flatFeeMinor: '100',
      percentageBps: 0,
      minimumFeeMinor: null,
      maximumFeeMinor: null,
      vatBps: 0,
      effectiveFrom: '2026-01-01T00:00:00.000Z',
      priority: 100,
      isActive: true,
    };
    const proposed = await request(app.getHttpServer())
      .post('/api/v1/internal/fee-rules')
      .set(auth(preparer.token))
      .send(proposal);
    expect(proposed.status).toBe(201);
    expect(proposed.body).toMatchObject({ status: 'REQUESTED', actionType: 'FEE_RULE_CREATE' });
    const approvalId = proposed.body.approvalId as string;

    // ── 2. Independent CHECKER approves. The maker cannot approve their own request.
    const selfApproval = await request(app.getHttpServer())
      .post(`${APPROVALS_PATH}/${approvalId}/approve`)
      .set(auth(preparer.token))
      .send({ comment: 'self approval attempt' });
    expect(selfApproval.status).toBeGreaterThanOrEqual(403);
    const approved = await request(app.getHttpServer())
      .post(`${APPROVALS_PATH}/${approvalId}/approve`)
      .set(auth(controller.token))
      .send({ comment: 'independent approval' });
    expect(approved.status).toBe(201);
    // The approval ledger is the authority for lifecycle state; read it back rather than inferring.
    const approvedRow = await dataSource.query<Array<{ status: string }>>(
      'SELECT status FROM privileged_action_approvals WHERE id = $1',
      [approvalId],
    );
    expect(approvedRow[0]!.status).toBe('APPROVED');

    // ── 3. The approving checker EXECUTES the approved payload. Nothing is written before this.
    const beforeExecution = await dataSource.query<Array<{ count: string }>>(
      'SELECT count(*)::text AS count FROM fee_rules WHERE product_code = $1',
      [PRODUCT],
    );
    expect(beforeExecution[0]!.count).toBe('0');

    const executed = await request(app.getHttpServer())
      .post(`/api/v1/internal/fee-rules/changes/${approvalId}/execute-create`)
      .set(auth(controller.token))
      .send(proposal);
    expect(executed.status).toBe(201);
    expect(executed.body).toMatchObject({
      productCode: PRODUCT,
      currency: CURRENCY,
      flatFeeMinor: '100',
      percentageBps: 0,
      vatBps: 0,
      effectiveTo: null,
      isActive: true,
    });
    const ruleId = executed.body.id as string;

    const approvalState = await dataSource.query<Array<{ status: string }>>(
      'SELECT status FROM privileged_action_approvals WHERE id = $1',
      [approvalId],
    );
    expect(approvalState[0]!.status).toBe('CONSUMED');

    // ── 4. A REAL customer session creates a REAL wallet-transfer quote.
    // `createEligibleCustomer` already writes the active profile, the verified primary phone and
    // the governed eligibility evidence; only a credential and a session are still needed.
    const customer = await createEligibleCustomer(dataSource, kycEvidence);
    await dataSource.query(
      `INSERT INTO customer_authentication_credentials
         (customer_id, password_hash, hash_algorithm, password_version, password_changed_at,
          status, account_locked, failed_authentication_count, version)
       VALUES ($1, 'pr27-not-a-login-credential', 'PBKDF2', 1, now(), 'ACTIVE', false, 0, 1)`,
      [customer.customerId],
    );

    const now = new Date();
    const customerSessionRows = await dataSource.query<Array<{ id: string }>>(
      `INSERT INTO authentication_sessions
         (customer_id, credential_id, token_hash, audience, status, issued_at, expires_at,
          last_seen_at, onboarding_password_version)
       SELECT $1, c.id, $2, 'customer-api', 'ACTIVE', $3, $4, $3, 1
         FROM customer_authentication_credentials c
        WHERE c.customer_id = $1 AND c.status = 'ACTIVE' AND c.deleted_at IS NULL
        LIMIT 1
       RETURNING id`,
      [
        customer.customerId,
        randomUUID().replace(/-/g, '').padEnd(64, '0'),
        now.toISOString(),
        new Date(now.getTime() + 900_000).toISOString(),
      ],
    );
    expect(customerSessionRows).toHaveLength(1);
    const customerSessionId = customerSessionRows[0]!.id;

    // Both sides are real, individually eligible customers of the same institution. Enrolment is
    // a prerequisite for attributing a customer wallet, so it happens before provisioning.
    const counterparty = await createEligibleCustomer(dataSource, kycEvidence);
    const institutionId = await governed.institution('pr27-quote');
    await governed.enrolCustomer(customer.customerId, institutionId);
    await governed.enrolCustomer(counterparty.customerId, institutionId);
    const source = await wallets.createWallet({
      customerId: customer.customerId,
      currency: CURRENCY,
      idempotencyKey: `pr27-src-${randomUUID()}`,
    });
    const destination = await wallets.createWallet({
      customerId: counterparty.customerId,
      currency: CURRENCY,
      idempotencyKey: `pr27-dst-${randomUUID()}`,
    });
    await governed.attributeWallet(source.id, institutionId);
    await governed.attributeWallet(destination.id, institutionId);

    const customerPrincipal = {
      type: 'CUSTOMER' as const,
      principalId: customer.customerId,
      customerId: customer.customerId,
      sessionId: customerSessionId,
      roles: [],
      scopes: [],
      customerAccess: 'SELF' as const,
    };
    const amountMinor = '100000';
    const quote = await quotes.create(customerPrincipal, {
      sourceWalletId: source.id,
      destinationWalletId: destination.id,
      amountMinor,
      currency: CURRENCY,
      idempotencyKey: `pr27-quote-${randomUUID()}`,
    });

    // ── 5. Quote, runtime resolver and effective preview agree.
    expect(quote).toMatchObject({
      amountMinor,
      currency: CURRENCY,
      feeMinor: '100',
      vatMinor: '0',
      totalDebitMinor: '100100',
      status: 'ACTIVE',
    });

    const runtime = await resolver.resolve({ productCode: PRODUCT, currency: CURRENCY });
    expect(runtime.status).toBe('RESOLVED');
    expect(runtime.rule?.ruleId).toBe(ruleId);
    expect(runtime.rule?.effectiveTo).toBeNull();

    const preview = await request(app.getHttpServer())
      .get(
        `${PREVIEW_PATH}?productCode=${PRODUCT}&currency=${CURRENCY}&principalType=CUSTOMER&principalId=${customer.customerId}&amountMinor=${amountMinor}`,
      )
      .set(auth(controller.token));
    expect(preview.status).toBe(200);
    expect(preview.body.fee.status).toBe('RESOLVED');
    expect(preview.body.fee.rule.ruleId).toBe(ruleId);
    expect(preview.body.fee.computed).toMatchObject({
      feeMinor: quote.feeMinor,
      vatMinor: quote.vatMinor,
      totalMinor: quote.totalDebitMinor,
    });

    // ── 6. The quote is evidence only: no journal/ledger money moved.
    const journals = await dataSource.query<Array<{ count: string }>>(
      'SELECT count(*)::text AS count FROM ledger_journals',
    );
    expect(journals[0]!.count).toBe('0');

    // ── 7. Optionally persist machine-readable evidence for the PR (CI leaves this unset).
    const evidencePath = process.env.PR27_EVIDENCE_OUT?.trim();
    if (evidencePath) {
      const artifact = {
        generatedAt: new Date().toISOString(),
        branch: 'arena/41dde913-monienaija',
        database: process.env.DB_NAME ?? null,
        product: PRODUCT,
        currency: CURRENCY,
        proposal: {
          action: 'FEE_RULE_CREATE',
          approvalId,
          payloadSentByAdminWebContract: proposal,
          effectiveToKeyPresent: 'effectiveTo' in proposal,
        },
        lifecycle: {
          makerRoleKey: 'FINANCE_PREPARER',
          makerPrincipalId: preparer.principalId,
          selfApprovalStatus: selfApproval.status,
          checkerRoleKey: 'FINANCE_CONTROLLER',
          checkerPrincipalId: controller.principalId,
          approvalStatusAfterApprove: approvedRow[0]!.status,
          ruleIdBeforeExecution: null,
          executionStatus: executed.status,
          appliedRuleId: ruleId,
          approvalStatusAfterExecution: approvalState[0]!.status,
        },
        appliedRule: {
          flatFeeMinor: executed.body.flatFeeMinor,
          percentageBps: executed.body.percentageBps,
          vatBps: executed.body.vatBps,
          effectiveFrom: executed.body.effectiveFrom,
          effectiveTo: executed.body.effectiveTo,
          priority: executed.body.priority,
          isActive: executed.body.isActive,
        },
        runtime: {
          resolverStatus: runtime.status,
          resolvedRuleId: runtime.rule?.ruleId ?? null,
          resolvedEffectiveTo: runtime.rule?.effectiveTo ?? null,
          quote: {
            quoteId: quote.quoteId,
            amountMinor: quote.amountMinor,
            feeMinor: quote.feeMinor,
            vatMinor: quote.vatMinor,
            totalDebitMinor: quote.totalDebitMinor,
            status: quote.status,
          },
          preview: {
            status: preview.body.fee.status,
            ruleId: preview.body.fee.rule?.ruleId ?? null,
            computed: preview.body.fee.computed,
          },
          parity: {
            quoteEqualsPreview:
              quote.feeMinor === preview.body.fee.computed?.feeMinor &&
              quote.vatMinor === preview.body.fee.computed?.vatMinor &&
              quote.totalDebitMinor === preview.body.fee.computed?.totalMinor,
            quoteEqualsResolver: runtime.rule?.ruleId === ruleId,
          },
        },
        guarantees: {
          journalsPosted: journals[0]!.count,
        },
      };
      writeFileSync(evidencePath, `${JSON.stringify(artifact, null, 2)}\n`);
    }
  }, 180_000);
});
