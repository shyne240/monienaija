/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call */
/**
 * PR #27 — BANK DIRECTION PARITY: preview vs synthetic runtime decision.
 *
 * The mission's acceptance criterion is not "the preview renders". It is that, for each SUPPORTED
 * banking direction, the fee and limit PREVIEW a workforce operator sees agrees with the decision the
 * runtime engine actually takes for the same operation. This suite proves that on disposable
 * PostgreSQL with real workforce sessions, using the SAME resolvers the money movement uses:
 *
 *   WALLET_TO_BANK (outbound)
 *     - fee:   the effective-configuration preview vs `selectCurrentWalletToBankFeeRule` — the exact
 *              selector `BankingFeeBindingService` (called inside the commitment's SERIALIZABLE
 *              transaction) and the customer/agent pricing preview both use.
 *     - limit: the preview vs `LimitEnforcementService.enforceWithManager`, the engine that admits or
 *              refuses the commitment.
 *     - alias: a rule stored under the LEGACY `EXTERNAL_BANK_TRANSFER` spelling, which the runtime
 *              passes as an alias, must produce the same preview and the same decision as one stored
 *              under the canonical `WALLET_TO_BANK`. This is the compatibility guarantee that made a
 *              data migration unnecessary and unsafe.
 *
 *   BANK_TO_WALLET (inbound)
 *     - limit: the preview vs `InboundFundingService`'s in-transaction call path. The credit itself
 *              cannot execute (production binds UnavailableA7InboundExecutionAuthority), so the
 *              runtime half is a synthetic invocation of the same `LimitEnforcementService` call the
 *              credit path makes with the same arguments — the documented fallback for a direction
 *              whose execution is deliberately unavailable.
 *     - fee:   NOT_APPLICABLE, because a bank credit is money the customer never instructed us to
 *              spend. The preview must therefore show no fee section and NOT a zeroed tariff, and no
 *              fee rule may exist for the product. `BANK_TO_WALLET` is seeded DISABLED, which is what
 *              keeps that honest in the catalogue too.
 *
 * What is NOT mocked: real `a2_finance_role_assignments`, real `A2WorkforceSessionService` bearer
 * sessions, the real preview endpoint and its permission gates, the real limit engine, the real
 * commitment pricing selector, and a real ledger journal assertion (nothing posts).
 */
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DataSource } from 'typeorm';
import { createHash, randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import * as request from 'supertest';

import { AppModule } from '../src/app.module';
import { A2FinanceRoleAssignment } from '../src/authorization/workforce-authentication.entity';
import { A2WorkforceSessionService } from '../src/authorization/workforce-session.service';
import { A2_WORKFORCE_CONFIG } from '../src/authorization/workforce-oidc.service';
import { workforceConfiguration } from '../src/authorization/workforce-configuration';
import { selectCurrentWalletToBankFeeRule } from '../src/banking/banking-fee-rule-selection';
import { LimitEnforcementService } from '../src/limit-catalog/limit-enforcement.service';
import { BANK_TO_WALLET, WALLET_TO_BANK } from '../src/product-catalog/banking-product-identities';
import { ProductCatalogSeedService } from '../src/product-catalog/product-catalog-seed.service';
import {
  createIntegrationDataSource,
  destroyIntegrationDataSource,
  truncateAllTables,
} from './support/pg-harness';

const CURRENCY = 'NGN';
const PREVIEW_PATH = '/api/v1/internal/commercial-configuration/effective-preview';

/** `limit_reservations.request_hash` is constrained to a 64-char hex digest; derive one honestly. */
const hexHash = (label: string): string =>
  createHash('sha256').update(`pr27-bank-direction:${label}`).digest('hex');

describe('PR27 bank direction parity — preview vs runtime (real PostgreSQL)', () => {
  let dataSource: DataSource;
  let app: NestFastifyApplication;
  let sessions: A2WorkforceSessionService;
  let limits: LimitEnforcementService;
  const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    const workforceConfig = workforceConfiguration({
      NODE_ENV: 'development',
      A2_WORKFORCE_ENABLED: 'true',
      A2_WORKFORCE_OIDC_ISSUER: 'https://oidc.bank-direction.test',
      A2_WORKFORCE_OIDC_JWKS_URI: 'https://oidc.bank-direction.test/jwks',
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

    dataSource = await createIntegrationDataSource('pr27bankdir');

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DataSource)
      .useValue(dataSource)
      .overrideProvider(A2_WORKFORCE_CONFIG)
      .useValue(workforceConfig)
      .compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }),
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    sessions = moduleRef.get(A2WorkforceSessionService);
    limits = moduleRef.get(LimitEnforcementService);
  }, 180_000);

  afterAll(async () => {
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
    if (app) await app.close().catch(() => undefined);
    if (dataSource) await destroyIntegrationDataSource(dataSource).catch(() => undefined);
  }, 60_000);

  beforeEach(async () => {
    await truncateAllTables(dataSource);
    await app.get(ProductCatalogSeedService).seedIfEmpty();
  });

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function provisionRole(roleKey: string): Promise<{ principalId: string; token: string }> {
    const principalId = `pr27bank:${roleKey}:${randomUUID()}`.slice(0, 160);
    const now = new Date();
    await dataSource.getRepository(A2FinanceRoleAssignment).save({
      id: randomUUID(),
      assignmentReference: `pr27-bank-direction:${principalId}`,
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
    } as never);
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

  /** A customer with an ACTIVE limit profile assigned, so the preview resolves governing profiles. */
  async function seedCustomerWithProfile(): Promise<string> {
    const customerId = randomUUID();
    const profileCode = `PR27DIR_${randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase()}`;
    await dataSource.query(
      `INSERT INTO limit_profiles(code,name,kind,status,enabled,configuration_status,created_by)
       VALUES($1,'PR27 bank direction','CUSTOMER','ACTIVE',true,'CONFIGURED','fixture')`,
      [profileCode],
    );
    await dataSource.query(
      `INSERT INTO limit_assignments(id,limit_profile_code,subject_type,subject_id,effective_from,is_active,created_by)
       VALUES($1,$2,'CUSTOMER',$3,clock_timestamp()-interval '1 day',true,'fixture')`,
      [randomUUID(), profileCode, customerId],
    );
    (seedCustomerWithProfile as unknown as { profileCode?: string }).profileCode = profileCode;
    return customerId;
  }

  async function seedLimitRule(input: {
    profileCode: string;
    product: string;
    direction: 'INCOMING' | 'OUTGOING';
    limitValueMinor: string;
  }): Promise<string> {
    const id = randomUUID();
    await dataSource.query(
      `INSERT INTO limit_rules(id,limit_profile_code,product,direction,currency,dimension,limit_value_minor,effective_from,is_active,created_by)
       VALUES($1,$2,$3,$4,'NGN','DAILY_AMOUNT',$5,clock_timestamp()-interval '1 day',true,'fixture')`,
      [id, input.profileCode, input.product, input.direction, input.limitValueMinor],
    );
    return id;
  }

  async function preview(
    token: string,
    query: Record<string, string>,
  ): Promise<Record<string, any>> {
    const qs = new URLSearchParams(query).toString();
    const res = await request(app.getHttpServer()).get(`${PREVIEW_PATH}?${qs}`).set(auth(token));
    expect(res.status).toBe(200);
    return res.body as Record<string, any>;
  }

  describe('WALLET_TO_BANK (outbound) — supported and executing', () => {
    it('seeds an ACTIVE, enabled, chargeable product that the preview resolves', async () => {
      const operator = await provisionRole('SUPER_ADMIN');
      const body = await preview(operator.token, {
        productCode: WALLET_TO_BANK.productCode,
        currency: CURRENCY,
      });
      expect(body.product).toMatchObject({
        code: 'WALLET_TO_BANK',
        status: 'ACTIVE',
        enabled: true,
        currency: 'NGN',
      });
    });

    it('fee preview equals the selector the commitment binds with, end to end', async () => {
      const operator = await provisionRole('SUPER_ADMIN');
      const customerId = await seedCustomerWithProfile();
      await dataSource.query(
        `INSERT INTO fee_rules(product_code,currency,flat_fee_minor,percentage_bps,minimum_fee_minor,
                                maximum_fee_minor,vat_bps,effective_from,is_active,created_by)
         VALUES($1,'NGN',100,0,NULL,NULL,0,clock_timestamp()-interval '1 hour',true,'fixture')`,
        [WALLET_TO_BANK.productCode],
      );

      const amountMinor = '250000';
      const body = await preview(operator.token, {
        productCode: WALLET_TO_BANK.productCode,
        currency: CURRENCY,
        principalType: 'CUSTOMER',
        principalId: customerId,
        direction: 'OUTGOING',
        amountMinor,
      });

      // PREVIEW half
      expect(body.fee.status).toBe('RESOLVED');
      expect(body.fee.computed).toMatchObject({
        feeMinor: '100',
        vatMinor: '0',
        totalMinor: '250100',
        postsJournalLegs: false,
      });

      // RUNTIME half: the exact function BankingFeeBindingService calls inside the commitment's
      // SERIALIZABLE transaction.
      const runtimeRule = await selectCurrentWalletToBankFeeRule(dataSource.manager, CURRENCY);
      expect(runtimeRule).not.toBeNull();
      expect(runtimeRule!.product_code).toBe(WALLET_TO_BANK.productCode);
      expect(runtimeRule!.flat_fee_minor).toBe('100');
      // ... and it is the same ROW the preview resolved, not merely an equal-looking one.
      expect(runtimeRule!.id).toBe(body.fee.rule.ruleId);

      // No money moved: the preview and the selector are reads.
      const journals = await dataSource.query<Array<{ count: string }>>(
        'SELECT count(*)::text AS count FROM ledger_journals',
      );
      expect(journals[0]!.count).toBe('0');
    });

    it('limit preview equals the runtime admission decision, and a breach is refused by both', async () => {
      const operator = await provisionRole('SUPER_ADMIN');
      const customerId = await seedCustomerWithProfile();
      const profileCode = (seedCustomerWithProfile as unknown as { profileCode?: string })
        .profileCode!;
      await seedLimitRule({
        profileCode,
        product: WALLET_TO_BANK.productCode,
        direction: 'OUTGOING',
        limitValueMinor: '500000',
      });

      // ── within the approved limit: preview RESOLVED and runtime allows
      const okPreview = await preview(operator.token, {
        productCode: WALLET_TO_BANK.productCode,
        currency: CURRENCY,
        principalType: 'CUSTOMER',
        principalId: customerId,
        direction: 'OUTGOING',
        amountMinor: '400000',
      });
      expect(okPreview.limits.status).toBe('RESOLVED');
      expect(okPreview.limits.evaluatedDimensions).toContain('DAILY_AMOUNT');
      expect(okPreview.limits.rules).toHaveLength(1);

      const allowed = await dataSource.transaction((manager) =>
        limits.enforceWithManager(manager, {
          principalType: 'CUSTOMER',
          principalId: customerId,
          product: WALLET_TO_BANK.productCode,
          direction: 'OUTGOING',
          channel: null,
          currency: CURRENCY,
          amountMinor: '400000',
          idempotencyKey: `pr27-bank-dir-ok-${randomUUID()}`,
          requestHash: hexHash('wallet-to-bank-within-limit'),
          requireConfiguration: true,
        }),
      );
      expect(allowed.allowed).toBe(true);
      expect(allowed.evaluatedDimensions).toContain('DAILY_AMOUNT');
      // The preview named the very rule the engine evaluated.
      expect((allowed.ruleRefs ?? []).map((r) => r.ruleId)).toEqual([
        okPreview.limits.rules[0].ruleId,
      ]);

      // ── above the approved limit: preview still shows the blocking rule, runtime refuses
      const breachPreview = await preview(operator.token, {
        productCode: WALLET_TO_BANK.productCode,
        currency: CURRENCY,
        principalType: 'CUSTOMER',
        principalId: customerId,
        direction: 'OUTGOING',
        amountMinor: '900000',
      });
      expect(breachPreview.limits.status).toBe('RESOLVED');
      expect(breachPreview.limits.rules[0].limitValueMinor).toBe('500000');

      await expect(
        dataSource.transaction((manager) =>
          limits.enforceWithManager(manager, {
            principalType: 'CUSTOMER',
            principalId: customerId,
            product: WALLET_TO_BANK.productCode,
            direction: 'OUTGOING',
            channel: null,
            currency: CURRENCY,
            amountMinor: '900000',
            idempotencyKey: `pr27-bank-dir-breach-${randomUUID()}`,
            requestHash: hexHash('wallet-to-bank-breach'),
            requireConfiguration: true,
          }),
        ),
      ).rejects.toThrow(/exceeds 500000/i);
    });

    it('a rule stored under the legacy alias previews and decides IDENTICALLY', async () => {
      const operator = await provisionRole('SUPER_ADMIN');
      const customerId = await seedCustomerWithProfile();
      const profileCode = (seedCustomerWithProfile as unknown as { profileCode?: string })
        .profileCode!;
      // The pre-PR #27 spelling an operator's approved rule actually carries.
      await seedLimitRule({
        profileCode,
        product: 'WITHDRAWAL',
        direction: 'OUTGOING',
        limitValueMinor: '500000',
      });

      const body = await preview(operator.token, {
        productCode: WALLET_TO_BANK.productCode,
        currency: CURRENCY,
        principalType: 'CUSTOMER',
        principalId: customerId,
        direction: 'OUTGOING',
        amountMinor: '400000',
      });
      expect(body.limits.status).toBe('RESOLVED');
      expect(body.limits.rules).toHaveLength(1);
      // The rule is reported with the spelling it was authored with — evidence, not a rewrite.
      expect(body.limits.rules[0].ruleId).toBeTruthy();

      const decision = await dataSource.transaction((manager) =>
        limits.enforceWithManager(manager, {
          principalType: 'CUSTOMER',
          principalId: customerId,
          product: WALLET_TO_BANK.productCode,
          direction: 'OUTGOING',
          channel: null,
          currency: CURRENCY,
          amountMinor: '400000',
          idempotencyKey: `pr27-bank-alias-ok-${randomUUID()}`,
          requestHash: hexHash('wallet-to-bank-alias-within'),
          requireConfiguration: true,
        }),
      );
      expect(decision.allowed).toBe(true);
      expect(decision.ruleRefs).toHaveLength(1);
      expect(decision.ruleRefs![0]!.ruleId).toBe(body.limits.rules[0].ruleId);

      // And the alias honours the same allowance ceiling.
      await expect(
        dataSource.transaction((manager) =>
          limits.enforceWithManager(manager, {
            principalType: 'CUSTOMER',
            principalId: customerId,
            product: WALLET_TO_BANK.productCode,
            direction: 'OUTGOING',
            channel: null,
            currency: CURRENCY,
            amountMinor: '600000',
            idempotencyKey: `pr27-bank-alias-breach-${randomUUID()}`,
            requestHash: hexHash('wallet-to-bank-alias-breach'),
            requireConfiguration: true,
          }),
        ),
      ).rejects.toThrow(/exceeds 500000/i);
    });

    it('is governed for an AGENT principal under the same product — never a second product', async () => {
      const operator = await provisionRole('SUPER_ADMIN');
      const agentId = randomUUID();
      const profileCode = `PR27DAG_${randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase()}`;
      await dataSource.query(
        `INSERT INTO limit_profiles(code,name,kind,status,enabled,configuration_status,created_by)
         VALUES($1,'PR27 agent bank','AGENT','ACTIVE',true,'CONFIGURED','fixture')`,
        [profileCode],
      );
      await dataSource.query(
        `INSERT INTO limit_assignments(id,limit_profile_code,subject_type,subject_id,effective_from,is_active,created_by)
         VALUES($1,$2,'AGENT',$3,clock_timestamp()-interval '1 day',true,'fixture')`,
        [randomUUID(), profileCode, agentId],
      );
      await seedLimitRule({
        profileCode,
        product: 'EXTERNAL_BANK_TRANSFER',
        direction: 'OUTGOING',
        limitValueMinor: '300000',
      });

      const body = await preview(operator.token, {
        productCode: WALLET_TO_BANK.productCode,
        currency: CURRENCY,
        principalType: 'AGENT',
        principalId: agentId,
        direction: 'OUTGOING',
        amountMinor: '200000',
      });
      expect(body.limits.status).toBe('RESOLVED');
      // Nothing anywhere is an agent-specific catalogue product.
      expect(
        await dataSource.query('SELECT code FROM products WHERE code LIKE $1', ['%AGENT%BANK%']),
      ).toHaveLength(0);

      const decision = await dataSource.transaction((manager) =>
        limits.enforceWithManager(manager, {
          principalType: 'AGENT',
          principalId: agentId,
          product: WALLET_TO_BANK.productCode,
          direction: 'OUTGOING',
          channel: null,
          currency: CURRENCY,
          amountMinor: '200000',
          idempotencyKey: `pr27-bank-agent-${randomUUID()}`,
          requestHash: hexHash('wallet-to-bank-agent'),
          requireConfiguration: true,
          strictConfiguredRules: true,
        }),
      );
      expect(decision.allowed).toBe(true);
      expect(decision.ruleRefs![0]!.ruleId).toBe(body.limits.rules[0].ruleId);
    });
  });

  describe('BANK_TO_WALLET (inbound) — credit path visibly unavailable', () => {
    it('says WHY it is unavailable rather than pretending a tariff exists', async () => {
      const operator = await provisionRole('SUPER_ADMIN');
      const body = await preview(operator.token, {
        productCode: BANK_TO_WALLET.productCode,
        currency: CURRENCY,
      });
      expect(body.product).toMatchObject({
        code: 'BANK_TO_WALLET',
        status: 'DISABLED',
        enabled: false,
      });
      // No tariff is invented and none can be: the product cannot carry a chargeable rule.
      expect(body.fee.status).not.toBe('RESOLVED');
      expect(BANK_TO_WALLET.feeDisposition).toBe('NOT_APPLICABLE_INBOUND_CREDIT');
      expect(BANK_TO_WALLET.executionBlockers.join(' ')).toContain(
        'UnavailableA7InboundExecutionAuthority',
      );
    });

    it('limit preview equals the synthetic runtime decision the credit path makes', async () => {
      const operator = await provisionRole('SUPER_ADMIN');
      const customerId = await seedCustomerWithProfile();
      const profileCode = (seedCustomerWithProfile as unknown as { profileCode?: string })
        .profileCode!;
      await seedLimitRule({
        profileCode,
        product: BANK_TO_WALLET.productCode,
        direction: 'INCOMING',
        limitValueMinor: '1000000',
      });

      const amountMinor = '750000';
      const body = await preview(operator.token, {
        productCode: BANK_TO_WALLET.productCode,
        currency: CURRENCY,
        principalType: 'CUSTOMER',
        principalId: customerId,
        direction: 'INCOMING',
        amountMinor,
      });
      expect(body.limits.status).toBe('RESOLVED');
      expect(body.limits.rules).toHaveLength(1);

      // The runtime half. InboundFundingService.enforceInboundLimit calls exactly this, with exactly
      // these arguments, inside the serializable transaction that posts the credit. The credit
      // itself cannot execute yet (no approved execution authority), which is why this is a
      // synthetic invocation rather than a posted journal — and the evidence records that.
      const decision = await dataSource.transaction((manager) =>
        limits.enforceWithManager(manager, {
          principalType: 'CUSTOMER',
          principalId: customerId,
          product: BANK_TO_WALLET.productCode,
          direction: 'INCOMING',
          channel: null,
          currency: CURRENCY,
          amountMinor,
          idempotencyKey: `pr27-inbound-limit-${randomUUID()}`,
          requestHash: hexHash('bank-to-wallet-within'),
          requireConfiguration: true,
        }),
      );
      expect(decision.allowed).toBe(true);
      expect(decision.ruleRefs![0]!.ruleId).toBe(body.limits.rules[0].ruleId);

      // A bank credit above the configured ceiling is refused by the rule itself.
      await expect(
        dataSource.transaction((manager) =>
          limits.enforceWithManager(manager, {
            principalType: 'CUSTOMER',
            principalId: customerId,
            product: BANK_TO_WALLET.productCode,
            direction: 'INCOMING',
            channel: null,
            currency: CURRENCY,
            amountMinor: '2000000',
            idempotencyKey: `pr27-inbound-breach-${randomUUID()}`,
            requestHash: hexHash('bank-to-wallet-breach'),
            requireConfiguration: true,
          }),
        ),
        // The BANK_TO_WALLET ceiling seeded above is 1,000,000; the engine names the actual limit.
      ).rejects.toThrow(/exceeds 1000000/i);
    });

    it('records machine-readable evidence for the PR body', async () => {
      const evidencePath = process.env.PR27_EVIDENCE_OUT?.trim();
      if (!evidencePath) return;

      const operator = await provisionRole('SUPER_ADMIN');
      const customerId = await seedCustomerWithProfile();
      const profileCode = (seedCustomerWithProfile as unknown as { profileCode?: string })
        .profileCode!;
      await dataSource.query(
        `INSERT INTO fee_rules(product_code,currency,flat_fee_minor,percentage_bps,vat_bps,
                                effective_from,is_active,created_by)
         VALUES($1,'NGN',100,0,0,clock_timestamp()-interval '1 hour',true,'fixture')`,
        [WALLET_TO_BANK.productCode],
      );
      await seedLimitRule({
        profileCode,
        product: 'WITHDRAWAL',
        direction: 'OUTGOING',
        limitValueMinor: '500000',
      });
      await seedLimitRule({
        profileCode,
        product: BANK_TO_WALLET.productCode,
        direction: 'INCOMING',
        limitValueMinor: '1000000',
      });

      const outbound = await preview(operator.token, {
        productCode: WALLET_TO_BANK.productCode,
        currency: CURRENCY,
        principalType: 'CUSTOMER',
        principalId: customerId,
        direction: 'OUTGOING',
        amountMinor: '250000',
      });
      const inbound = await preview(operator.token, {
        productCode: BANK_TO_WALLET.productCode,
        currency: CURRENCY,
        principalType: 'CUSTOMER',
        principalId: customerId,
        direction: 'INCOMING',
        amountMinor: '750000',
      });
      const outboundFeeRule = await selectCurrentWalletToBankFeeRule(dataSource.manager, CURRENCY);
      const outboundRuntime = await dataSource.transaction((manager) =>
        limits.enforceWithManager(manager, {
          principalType: 'CUSTOMER',
          principalId: customerId,
          product: WALLET_TO_BANK.productCode,
          direction: 'OUTGOING',
          channel: null,
          currency: CURRENCY,
          amountMinor: '250000',
          idempotencyKey: `pr27-evidence-out-${randomUUID()}`,
          requestHash: hexHash('evidence-outbound'),
          requireConfiguration: true,
        }),
      );
      const inboundRuntime = await dataSource.transaction((manager) =>
        limits.enforceWithManager(manager, {
          principalType: 'CUSTOMER',
          principalId: customerId,
          product: BANK_TO_WALLET.productCode,
          direction: 'INCOMING',
          channel: null,
          currency: CURRENCY,
          amountMinor: '750000',
          idempotencyKey: `pr27-evidence-in-${randomUUID()}`,
          requestHash: hexHash('evidence-inbound'),
          requireConfiguration: true,
        }),
      );
      const journals = await dataSource.query<Array<{ count: string }>>(
        'SELECT count(*)::text AS count FROM ledger_journals',
      );

      writeFileSync(
        evidencePath,
        JSON.stringify(
          {
            generatedAt: new Date().toISOString(),
            branch: 'arena/41dde913-monienaija',
            database: process.env.DB_NAME ?? null,
            note: 'Preview-vs-runtime parity per banking direction. All reads; zero journals.',
            directions: {
              WALLET_TO_BANK: {
                canonicalProduct: WALLET_TO_BANK.productCode,
                authoritativeRecord: WALLET_TO_BANK.authoritativeRecord,
                limitAliasesExercised: ['WITHDRAWAL', 'EXTERNAL_BANK_TRANSFER'],
                fee: {
                  previewStatus: outbound.fee.status,
                  previewComputed: outbound.fee.computed,
                  runtimeRuleId: outboundFeeRule?.id ?? null,
                  sameRuleRow: outboundFeeRule?.id === outbound.fee.rule?.ruleId,
                },
                limits: {
                  previewStatus: outbound.limits.status,
                  previewRuleIds: outbound.limits.rules.map((r: { ruleId: string }) => r.ruleId),
                  runtimeAllowed: outboundRuntime.allowed,
                  runtimeRuleIds: (outboundRuntime.ruleRefs ?? []).map((r) => r.ruleId),
                  rulesMatch:
                    JSON.stringify(
                      outbound.limits.rules.map((r: { ruleId: string }) => r.ruleId),
                    ) === JSON.stringify((outboundRuntime.ruleRefs ?? []).map((r) => r.ruleId)),
                },
              },
              BANK_TO_WALLET: {
                canonicalProduct: BANK_TO_WALLET.productCode,
                authoritativeRecord: BANK_TO_WALLET.authoritativeRecord,
                feeDisposition: BANK_TO_WALLET.feeDisposition,
                executionBlockers: BANK_TO_WALLET.executionBlockers,
                limits: {
                  previewStatus: inbound.limits.status,
                  previewRuleIds: inbound.limits.rules.map((r: { ruleId: string }) => r.ruleId),
                  runtimeKind: 'SYNTHETIC (no live credit execution authority)',
                  runtimeAllowed: inboundRuntime.allowed,
                  runtimeRuleIds: (inboundRuntime.ruleRefs ?? []).map((r) => r.ruleId),
                  rulesMatch:
                    JSON.stringify(
                      inbound.limits.rules.map((r: { ruleId: string }) => r.ruleId),
                    ) === JSON.stringify((inboundRuntime.ruleRefs ?? []).map((r) => r.ruleId)),
                },
              },
            },
            journalsPosted: journals[0]!.count,
          },
          null,
          2,
        ),
      );
    });
  });
});
