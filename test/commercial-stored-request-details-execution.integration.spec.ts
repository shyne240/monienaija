/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any */

/**
 * GOVERNED COMMERCIAL CHANGES MUST SURVIVE THEIR OWN RECORD.
 *
 * A commercial change is a two-phase thing: the maker posts a payload, the service fingerprints it,
 * the approval stores a *filtered* copy of that payload as `policy.requestDetails`, an independent
 * checker approves it, and a checker session replays the stored details into `execute-*`, where the
 * fingerprint is recomputed from the replayed body and compared with the approved one.
 *
 * That design only holds if the stored copy carries every field the executor writes. When it does
 * not, two things break at once — and the second is the dangerous one:
 *
 *   1. An untouched approval fails with `FINGERPRINT_MISMATCH`, so an operator cannot apply an
 *      ordinary rule from the Studio (found in the Admin Web, see
 *      `docs/review/PR27-integration-review.md`, PR27-BROWSER-01).
 *   2. A field that is written but not stored is a field the approver never saw a value for and the
 *      fingerprint cannot bind — the only reason the mismatch trips is that the value happened to
 *      differ from the approved one, not that the comparison covers it.
 *
 * This suite pins the invariant per domain: author → approve → **replay the stored details** →
 * execution succeeds and the rule carries the authored values. Then it proves the guard is still a
 * guard: mutating one stored field must be refused, must leave the approval APPROVED and must write
 * no rule. Nothing authorization-relevant is mocked; the only double is the trusted KYC evidence
 * reader, as in the sibling suites.
 */
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';
import * as request from 'supertest';

import { AppModule } from '../src/app.module';
import { A2WorkforceSessionService } from '../src/authorization/workforce-session.service';
import { A2_WORKFORCE_CONFIG } from '../src/authorization/workforce-oidc.service';
import { workforceConfiguration } from '../src/authorization/workforce-configuration';
import { A2FinanceRoleAssignment } from '../src/authorization/workforce-authentication.entity';
import { KycTierEvidenceReader } from '../src/kyc-verification/kyc-tier-evidence.reader';
import { ProductCatalogSeedService } from '../src/product-catalog/product-catalog-seed.service';
import {
  createIntegrationDataSource,
  destroyIntegrationDataSource,
  truncateAllTables,
} from './support/pg-harness';
import { createTestEvidenceReader } from './support/kyc-test-evidence-reader';

const APPROVALS_PATH = '/api/v1/internal/a2/workforce/approvals';
const FEE_PATH = '/api/v1/internal/fee-rules';
const COMMISSION_PATH = '/api/v1/internal/commission-rules';
const REWARD_PATH = '/api/v1/internal/reward-rules';
const PRODUCT = 'WALLET_TRANSFER';
const CURRENCY = 'NGN';

const kycEvidence = createTestEvidenceReader({ mode: 'ELIGIBLE' });

interface StoredApproval {
  status: string;
  actionType: string;
  fingerprint: string | null;
  details: Record<string, unknown>;
}

describe('governed commercial changes execute from their stored request details (real PostgreSQL + HTTP)', () => {
  let dataSource: DataSource;
  let app: NestFastifyApplication;
  let sessions: A2WorkforceSessionService;
  const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
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
          scopes: [
            'finance:prepare',
            'fee_rule.view',
            'fee_rule.create',
            'fee_rule.modify',
            'commission_rule.view',
            'commission_rule.create',
            'commission_rule.modify',
            'reward_rule.view',
            'reward_rule.create',
            'reward_rule.modify',
          ],
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
          scopes: [
            'privileged:approve',
            'privileged:execute',
            'fee_rule.view',
            'fee_rule.create',
            'fee_rule.modify',
            'commission_rule.view',
            'commission_rule.create',
            'commission_rule.modify',
            'reward_rule.view',
            'reward_rule.create',
            'reward_rule.modify',
          ],
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
    dataSource = await createIntegrationDataSource('pr27replay');

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
  }, 180_000);

  afterAll(async () => {
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
    if (app) await app.close().catch(() => undefined);
    if (dataSource) {
      try {
        await destroyIntegrationDataSource(dataSource);
      } catch {
        /* best-effort cleanup */
      }
    }
  }, 60_000);

  beforeEach(async () => {
    await truncateAllTables(dataSource);
    // fee_rules/commission_rules/reward_rules carry a FK to products(code).
    await app.get(ProductCatalogSeedService).seedIfEmpty();
  });

  async function provisionRole(roleKey: string): Promise<{ principalId: string; token: string }> {
    const principalId = `pr27replay:${roleKey}:${randomUUID()}`.slice(0, 160);
    const now = new Date();
    await dataSource.getRepository(A2FinanceRoleAssignment).save({
      id: randomUUID(),
      assignmentReference: `pr27-replay:${principalId}`,
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

  /** Reads the approval exactly as the checker's `execute-*` replay does: from `policy.requestDetails`. */
  async function stored(approvalId: string): Promise<StoredApproval> {
    const rows = await dataSource.query<
      Array<{ status: string; action_type: string; policy: any }>
    >(`SELECT status, action_type, policy FROM privileged_action_approvals WHERE id = $1`, [
      approvalId,
    ]);
    const row = rows[0];
    if (!row) throw new Error(`no approval ${approvalId}`);
    return {
      status: row.status,
      actionType: row.action_type,
      fingerprint: (row.policy?.actionFingerprint ?? null) as string | null,
      details: (row.policy?.requestDetails ?? {}) as Record<string, unknown>,
    };
  }

  /** author as maker → approve as an independent checker; returns the approval id. */
  async function authorAndApprove(
    path: string,
    body: Record<string, unknown>,
  ): Promise<{ approvalId: string; details: Record<string, unknown> }> {
    const maker = await provisionRole('FINANCE_PREPARER');
    const checker = await provisionRole('FINANCE_CONTROLLER');
    const proposed = await request(app.getHttpServer())
      .post(path)
      .set(auth(maker.token))
      .send(body);
    expect([200, 201]).toContain(proposed.status);
    const approvalId = proposed.body.approvalId as string;
    expect(approvalId).toBeTruthy();

    // Approval alone writes nothing, and only the approver may move it.
    const self = await request(app.getHttpServer())
      .post(`${APPROVALS_PATH}/${approvalId}/approve`)
      .set(auth(maker.token))
      .send({ comment: 'self' });
    expect(self.status).toBe(403);

    const approved = await request(app.getHttpServer())
      .post(`${APPROVALS_PATH}/${approvalId}/approve`)
      .set(auth(checker.token))
      .send({ comment: 'independent verification' });
    expect(approved.status).toBe(201);
    expect(await stored(approvalId)).toMatchObject({ status: 'APPROVED' });
    return { approvalId, details: (await stored(approvalId)).details };
  }

  function executePathFor(domain: 'fee' | 'commission' | 'reward', approvalId: string): string {
    const base =
      domain === 'fee' ? FEE_PATH : domain === 'commission' ? COMMISSION_PATH : REWARD_PATH;
    return `${base}/changes/${approvalId}/execute-create`;
  }

  it('applies a fee carrying VAT, minimum and maximum from the stored request details', async () => {
    const body = {
      reason: 'replay: wallet transfer fee with a VAT band and a min/max collar',
      productCode: PRODUCT,
      currency: CURRENCY,
      flatFeeMinor: '100',
      percentageBps: 0,
      minimumFeeMinor: '50',
      maximumFeeMinor: '500',
      vatBps: 750,
      effectiveFrom: '2026-01-01T00:00:00.000Z',
      priority: 100,
      isActive: true,
    };
    const { approvalId, details } = await authorAndApprove(FEE_PATH, body);

    // The stored record must carry the three fields the executor writes.
    expect(details).toMatchObject({
      vatBps: 750,
      minimumFeeMinor: '50',
      maximumFeeMinor: '500',
      flatFeeMinor: '100',
    });

    const checker = await provisionRole('FINANCE_CONTROLLER');
    const executed = await request(app.getHttpServer())
      .post(executePathFor('fee', approvalId))
      .set(auth(checker.token))
      .send(details);
    expect(executed.status).toBe(201);
    expect(executed.body).toMatchObject({
      productCode: PRODUCT,
      flatFeeMinor: '100',
      minimumFeeMinor: '50',
      maximumFeeMinor: '500',
      vatBps: 750,
    });
    expect((await stored(approvalId)).status).toBe('CONSUMED');
  });

  it('applies a commission carrying flat, minimum and maximum from the stored request details', async () => {
    const body = {
      reason: 'replay: agent commission with a floor and a cap',
      productCode: PRODUCT,
      currency: CURRENCY,
      recipientType: 'AGENT',
      // PERCENTAGE_MIN_MAX: a rate inside an explicit floor and cap (model coherence is enforced).
      calculationModel: 'PERCENTAGE_MIN_MAX',
      calculationBasis: 'PRINCIPAL',
      percentageBps: 50,
      minimumCommissionMinor: '10',
      maximumCommissionMinor: '900',
      effectiveFrom: '2026-01-01T00:00:00.000Z',
      priority: 100,
      isActive: true,
    };
    const { approvalId, details } = await authorAndApprove(COMMISSION_PATH, body);
    expect(details).toMatchObject({
      recipientType: 'AGENT',
      percentageBps: 50,
      minimumCommissionMinor: '10',
      maximumCommissionMinor: '900',
    });

    const checker = await provisionRole('FINANCE_CONTROLLER');
    const executed = await request(app.getHttpServer())
      .post(executePathFor('commission', approvalId))
      .set(auth(checker.token))
      .send(details);
    expect(executed.status).toBe(201);
    expect(executed.body).toMatchObject({
      recipientType: 'AGENT',
      percentageBps: 50,
      minimumCommissionMinor: '10',
      maximumCommissionMinor: '900',
    });
    expect((await stored(approvalId)).status).toBe('CONSUMED');
  });

  it('applies a reward carrying flat, minimum and maximum from the stored request details', async () => {
    const body = {
      reason: 'replay: cashback reward with a floor and a cap',
      productCode: PRODUCT,
      currency: CURRENCY,
      beneficiaryType: 'CUSTOMER',
      rewardType: 'CASHBACK',
      calculationModel: 'PERCENTAGE_MIN_MAX',
      calculationBasis: 'PRINCIPAL',
      percentageBps: 100,
      minimumRewardMinor: '5',
      maximumRewardMinor: '250',
      effectiveFrom: '2026-01-01T00:00:00.000Z',
      priority: 100,
      isActive: true,
    };
    const { approvalId, details } = await authorAndApprove(REWARD_PATH, body);
    expect(details).toMatchObject({
      beneficiaryType: 'CUSTOMER',
      rewardType: 'CASHBACK',
      minimumRewardMinor: '5',
      maximumRewardMinor: '250',
    });

    const checker = await provisionRole('FINANCE_CONTROLLER');
    const executed = await request(app.getHttpServer())
      .post(executePathFor('reward', approvalId))
      .set(auth(checker.token))
      .send(details);
    expect(executed.status).toBe(201);
    expect(executed.body).toMatchObject({
      beneficiaryType: 'CUSTOMER',
      rewardType: 'CASHBACK',
      minimumRewardMinor: '5',
      maximumRewardMinor: '250',
    });
    expect((await stored(approvalId)).status).toBe('CONSUMED');
  });

  it('documents that a product registration is still refused from its stored record (PR27-BROWSER-02)', async () => {
    const body = {
      reason: 'replay: a new product registration',
      code: 'PR27_NEW_PRODUCT',
      name: 'PR27 New Product',
      description: 'created by the stored-details replay suite',
      domain: 'TRANSFER',
      currency: CURRENCY,
      productScope: 'CUSTOMER',
      status: 'DRAFT',
      enabled: false,
      configurationStatus: 'NOT_CONFIGURED',
    };
    const { approvalId, details } = await authorAndApprove('/api/v1/internal/products', body);

    // Adjacent to PR27-BROWSER-01 but a different root cause: the redaction boundary treats a bare
    // `code` key as a credential carrier, so the record carries `code: '[REDACTED]'` plus a
    // `productCode` alias, and neither can reproduce the approved fingerprint. This case characterises
    // today's behaviour so the day it is fixed shows up as a failing expectation, not a silent change.
    expect(details.code).toBe('[REDACTED]');
    expect(details.productCode).toBe('PR27_NEW_PRODUCT');

    const checker = await provisionRole('FINANCE_CONTROLLER');
    const refused = await request(app.getHttpServer())
      .post(`/api/v1/internal/products/changes/${approvalId}/execute-create`)
      .set(auth(checker.token))
      .send(details);
    expect(refused.status).toBe(403);
    expect(`${refused.body?.message ?? ''}`).toMatch(/FINGERPRINT_MISMATCH/);
    expect((await stored(approvalId)).status).toBe('APPROVED');
    const rows = await dataSource.query<Array<{ count: string }>>(
      "SELECT count(*)::text AS count FROM products WHERE code = 'PR27_NEW_PRODUCT'",
    );
    expect(rows[0]!.count).toBe('0');
  });

  it('refuses a stored request detail that was altered after approval and writes nothing', async () => {
    const body = {
      reason: 'replay: tamper probe',
      productCode: PRODUCT,
      currency: CURRENCY,
      flatFeeMinor: '100',
      percentageBps: 0,
      minimumFeeMinor: '50',
      maximumFeeMinor: '500',
      vatBps: 750,
      effectiveFrom: '2026-01-01T00:00:00.000Z',
      priority: 100,
      isActive: true,
    };
    const { approvalId, details } = await authorAndApprove(FEE_PATH, body);
    const checker = await provisionRole('FINANCE_CONTROLLER');

    // A checker who "replays" a richer fee than the one that was approved must be refused: the
    // fingerprint covers vatBps/minimumFeeMinor/maximumFeeMinor now, so no field is unbound.
    for (const tampered of [
      { ...details, vatBps: 1500 },
      { ...details, minimumFeeMinor: '1' },
      { ...details, maximumFeeMinor: '100000' },
      { ...details, flatFeeMinor: '101' },
    ]) {
      const refused = await request(app.getHttpServer())
        .post(executePathFor('fee', approvalId))
        .set(auth(checker.token))
        .send(tampered);
      expect(refused.status).toBe(403);
      expect(`${refused.body?.message ?? ''}`).toMatch(/FINGERPRINT_MISMATCH/);
    }

    const after = await stored(approvalId);
    expect(after.status).toBe('APPROVED');
    const rules = await dataSource.query<Array<{ count: string }>>(
      'SELECT count(*)::text AS count FROM fee_rules WHERE product_code = $1',
      [PRODUCT],
    );
    expect(rules[0]!.count).toBe('0');

    // The untouched details still apply — the refusals consumed nothing.
    const executed = await request(app.getHttpServer())
      .post(executePathFor('fee', approvalId))
      .set(auth(checker.token))
      .send(details);
    expect(executed.status).toBe(201);
    expect((await stored(approvalId)).status).toBe('CONSUMED');
  });
});
