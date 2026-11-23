/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-return */

/**
 * ARENA 3 — COMMERCIAL CONFIGURATION PHASE 2: governed authoring, effective preview and change
 * history, proven against a real PostgreSQL cluster and a real HTTP stack.
 *
 * Scope (mirrors the mission's Phase 7 acceptance list):
 *
 *   1. Route-policy authorization for the two NEW read surfaces, including audited denial.
 *   2. Limit-rule selection PARITY: the preview must select exactly the rules runtime enforcement
 *      selects (`limit-rule-applicability.ts`), including direction narrowing, channel narrowing
 *      and effective-date boundaries.
 *   3. Missing configuration vs an explicitly unlimited allowance — never conflated.
 *   4. Ambiguity: a fee-rule tie is reported as AMBIGUOUS and never silently resolved.
 *   5. Limit-rule authoring through the EXISTING governed workflow: proposal → independent
 *      approval → execution, with self-approval refusal, replay refusal, tamper refusal and
 *      stale-version refusal.
 *   6. Zero money movement: the preview and the authoring lifecycle write no journal, ledger,
 *      limit-usage or reward-credit rows.
 *   7. Change-history filtering by action type and resource.
 *
 * NOTHING authorization-relevant is mocked: real bearer sessions minted by the real
 * `A2WorkforceSessionService.establish()` after persisting real `a2_finance_role_assignments`
 * rows, real `AuthorizationService` decisions, the real `PrivilegedActionApprovalService`
 * approval ledger, the real limit catalogue and the real commercial resolvers.
 *
 * The ONLY test double is the trusted KYC evidence reader, which is test-only by construction
 * (see test/support/kyc-test-evidence-reader.ts) and is required because production evidence
 * provenance deliberately defaults to unavailable.
 */
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';
import * as request from 'supertest';

import { AppModule } from '../src/app.module';
import { A2WorkforceSessionService } from '../src/authorization/workforce-session.service';
import { A2FinanceRoleAssignment } from '../src/authorization/workforce-authentication.entity';
import { PrivilegedActionApproval } from '../src/authorization/privileged-action-approval.entity';
import { PrivilegedActionApprovalStatus } from '../src/authorization/privileged-action-approval.enums';
import { RoutePolicyRegistry } from '../src/authorization/route-policy-registry';
import {
  fetchApplicableLimitRuleCandidates,
  narrowApplicableLimitRules,
} from '../src/limit-catalog/limit-rule-applicability';
import { LimitEnforcementService } from '../src/limit-catalog/limit-enforcement.service';
import { KycTierEvidenceReader } from '../src/kyc-verification/kyc-tier-evidence.reader';
import { ProductCatalogSeedService } from '../src/product-catalog/product-catalog-seed.service';
import {
  createIntegrationDataSource,
  destroyIntegrationDataSource,
  truncateAllTables,
} from './support/pg-harness';
import { createTestEvidenceReader } from './support/kyc-test-evidence-reader';
import { createEligibleCustomer } from './support/kyc-test-fixtures';

const PREVIEW_PATH = '/api/v1/internal/commercial-configuration/effective-preview';
const HISTORY_PATH = '/api/v1/internal/commercial-configuration/change-history';
const APPROVALS_PATH = '/api/v1/internal/a2/workforce/approvals';
const LIMIT_RULES_PATH = '/api/v1/internal/limit-rules';
const PRODUCT = 'WALLET_TRANSFER';
const CURRENCY = 'NGN';

const kycEvidence = createTestEvidenceReader({ mode: 'ELIGIBLE' });

interface SeededProfile {
  code: string;
}

describe('ARENA 3 commercial configuration Phase 2 — real PostgreSQL + real HTTP', () => {
  let dataSource: DataSource;
  let app: NestFastifyApplication;
  let sessions: A2WorkforceSessionService;
  let enforcement: LimitEnforcementService;
  let routePolicies: RoutePolicyRegistry;
  const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    dataSource = await createIntegrationDataSource('a3comcfg02');

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DataSource)
      .useValue(dataSource)
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
    enforcement = moduleRef.get(LimitEnforcementService);
    routePolicies = moduleRef.get(RoutePolicyRegistry);
  }, 180_000);

  afterAll(async () => {
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
    if (app) await app.close().catch(() => undefined);
    if (dataSource) {
      try {
        await destroyIntegrationDataSource(dataSource);
      } catch {
        try {
          if (dataSource.isInitialized) await dataSource.destroy().catch(() => undefined);
        } catch {
          /* best-effort cleanup */
        }
      }
    }
  }, 60_000);

  beforeEach(async () => {
    await truncateAllTables(dataSource);
    // fee_rules/commission_rules/reward_rules carry a FK to products(code); the wholesale
    // truncate empties products, so restore the canonical catalogue seed.
    await app.get(ProductCatalogSeedService).seedIfEmpty();
  });

  // ─────────────────────────────────────────────────────────────────── session helpers

  async function provisionRole(roleKey: string): Promise<{ principalId: string; token: string }> {
    const principalId = `a3comcfg02:${roleKey}:${randomUUID()}`.slice(0, 160);
    const now = new Date();
    await dataSource.getRepository(A2FinanceRoleAssignment).save({
      id: randomUUID(),
      assignmentReference: `a3-com-cfg-02:${principalId}`,
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

  /**
   * Assign the customer to a seeded customer class. The migration backfills STANDARD, so a test
   * that wants PREMIUM/BUSINESS must close the live assignment exactly as the governed switch does.
   */
  async function assignClass(
    customerId: string,
    classCode: string,
    options: { readonly effectiveFrom?: Date; readonly effectiveTo?: Date | null } = {},
  ): Promise<{ classId: string; assignmentId: string }> {
    // `truncateAllTables` empties the migration-seeded classes, so restore the canonical seed for
    // this code on demand — exactly as the suite restores the product catalogue seed.
    const classes: Array<{ id: string }> = await dataSource.query(
      'SELECT id FROM customer_classes WHERE code = $1 AND deleted_at IS NULL',
      [classCode],
    );
    let classId = classes[0]?.id;
    if (!classId) {
      const inserted: Array<{ id: string }> = await dataSource.query(
        `INSERT INTO customer_classes
           (reference, code, name, kind, status, enabled, configuration_status, is_default, created_by)
         VALUES ($1,$2,$3,'CUSTOMER','ACTIVE',TRUE,'CONFIGURED',FALSE,'test-harness')
         RETURNING id`,
        [`CUSTOMER-CLASS-${classCode}`, classCode, classCode[0] + classCode.slice(1).toLowerCase()],
      );
      classId = inserted[0]!.id;
    }
    await dataSource.query(
      'UPDATE customer_class_assignments SET is_active = false, effective_to = NOW() WHERE customer_id = $1 AND is_active',
      [customerId],
    );
    const rows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO customer_class_assignments
         (customer_id, class_id, effective_from, effective_to, is_active, precedence, source, reason, created_by)
       VALUES ($1,$2,$3,$4,true,0,'MANUAL','test assignment','test-harness')
       RETURNING id`,
      [
        customerId,
        classId,
        options.effectiveFrom ?? new Date(Date.now() - 60_000),
        options.effectiveTo ?? null,
      ],
    );
    return { classId, assignmentId: rows[0]!.id };
  }

  // ──────────────────────────────────────────────────────────────────── limit fixtures

  async function seedProfile(code: string, kind = 'CUSTOMER'): Promise<SeededProfile> {
    await dataSource.query(
      `INSERT INTO limit_profiles (code, name, kind, status, enabled, configuration_status, created_by)
       VALUES ($1,$2,$3,'ACTIVE',true,'CONFIGURED','test')`,
      [code, `Profile ${code}`, kind],
    );
    return { code };
  }

  async function seedAssignment(params: {
    profileCode: string;
    subjectType: 'CUSTOMER' | 'GLOBAL' | 'AGENT' | 'AGENT_CLASS';
    subjectId?: string | null;
    precedence?: number;
    effectiveFrom?: string;
  }): Promise<void> {
    await dataSource.query(
      `INSERT INTO limit_assignments (id, limit_profile_code, subject_type, subject_id, segment_code,
         precedence, effective_from, effective_to, is_active, created_by)
       VALUES ($1,$2,$3,$4,NULL,$5,$6,NULL,true,'test')`,
      [
        randomUUID(),
        params.profileCode,
        params.subjectType,
        params.subjectId ?? null,
        params.precedence ?? 0,
        params.effectiveFrom ?? new Date(Date.now() - 86_400_000).toISOString(),
      ],
    );
  }

  async function seedLimitRule(params: {
    profileCode: string;
    dimension: string;
    product?: string;
    currency?: string;
    direction?: string | null;
    channel?: string | null;
    limitMinor?: string | null;
    limitCount?: number | null;
    effectiveFrom?: string;
    effectiveTo?: string | null;
    isActive?: boolean;
    priority?: number;
  }): Promise<string> {
    const id = randomUUID();
    await dataSource.query(
      `INSERT INTO limit_rules (id, limit_profile_code, product, direction, channel, currency,
         dimension, limit_value_minor, limit_value_count, effective_from, effective_to, is_active,
         priority, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'test')`,
      [
        id,
        params.profileCode,
        params.product ?? PRODUCT,
        params.direction ?? null,
        params.channel ?? null,
        params.currency ?? CURRENCY,
        params.dimension,
        params.limitMinor ?? null,
        params.limitCount ?? null,
        params.effectiveFrom ?? new Date(Date.now() - 3_600_000).toISOString(),
        params.effectiveTo ?? null,
        params.isActive ?? true,
        params.priority ?? 0,
      ],
    );
    return id;
  }

  /** Seed a CUSTOMER-assigned profile holding one MAX_AMOUNT_PER_TX rule for WALLET_TRANSFER. */
  async function seedAssignedCustomerRule(
    principalId: string,
    overrides: Partial<Parameters<typeof seedLimitRule>[0]> = {},
  ): Promise<{ profile: string; ruleId: string; assignmentId?: string }> {
    const profile = `A3CFG_${randomUUID().slice(0, 8).toUpperCase()}`;
    await seedProfile(profile);
    await seedAssignment({ profileCode: profile, subjectType: 'CUSTOMER', subjectId: principalId });
    const ruleId = await seedLimitRule({
      profileCode: profile,
      dimension: 'MAX_AMOUNT_PER_TX',
      limitMinor: '500000',
      ...overrides,
    });
    return { profile, ruleId };
  }

  /** Real enforcement through the SHARED selection path (no mocks, no reservation side effects). */
  async function enforce(
    input: {
      principalId: string;
      direction?: string;
      channel?: string | null;
      amountMinor?: string;
      product?: string;
      currency?: string;
      now?: Date;
    },
    mode: 'STRICT' | 'LEGACY' = 'STRICT',
  ): Promise<{ status: 'ALLOWED' | 'REFUSED'; ruleIds: string[]; dimensions: string[] }> {
    try {
      const result = await dataSource.transaction(async (manager) => {
        return enforcement.enforceWithManager(manager, {
          principalType: 'CUSTOMER',
          principalId: input.principalId,
          product: input.product ?? PRODUCT,
          currency: input.currency ?? CURRENCY,
          direction: input.direction ?? 'OUTGOING',
          channel: input.channel ?? null,
          amountMinor: input.amountMinor ?? '1000',
          idempotencyKey: randomUUID(),
          // `idempotency_records.chk_idempotency_records_hash` requires a real sha256-shaped hash.
          requestHash: randomUUID().replace(/-/g, '').padEnd(64, '0'),
          correlationId: 'a3-commercial-configuration-parity',
          now: input.now ?? new Date(),
          ...(mode === 'STRICT' ? { strictConfiguredRules: true } : {}),
        });
      });
      return {
        status: 'ALLOWED',
        // Precedence order is meaningful evidence — never re-sort it.
        ruleIds: (result.ruleRefs ?? []).map((ref) => ref.ruleId),
        dimensions: result.evaluatedDimensions,
      };
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (status === 503) return { status: 'REFUSED', ruleIds: [], dimensions: [] };
      throw error;
    }
  }

  // ═══════════════════════════════════════════════════ 1. route-policy authorization

  describe('route-policy authorization', () => {
    it('declares an explicit workforce policy for both new read surfaces (no generic internal fallback)', () => {
      const preview = routePolicies.resolve({ method: 'GET', url: PREVIEW_PATH });
      expect(preview.public).toBe(false);
      expect(preview.authenticationMode).toBe('WORKFORCE_SESSION');
      expect(preview.resourceType).toBe('commercial-configuration-preview');
      expect(preview.auditDeniedWorkforceFunction).toBe(true);
      expect(preview.policy?.requiredFunctions).toEqual(['limit.view']);
      expect(preview.policy?.allowedPrincipalTypes).toEqual(['OPERATOR', 'SERVICE', 'PRIVILEGED']);
      expect(preview.policy?.customerAccess).toBe('NONE');

      const history = routePolicies.resolve({ method: 'GET', url: HISTORY_PATH });
      expect(history.public).toBe(false);
      expect(history.resourceType).toBe('commercial-configuration-change-history');
      expect(history.policy?.requiredFunctions).toEqual(['limit.view']);

      // The generic /internal branch must NOT be what governs these two routes.
      expect(preview.resourceType).not.toBe('internal-route');
      expect(history.resourceType).not.toBe('internal-route');
    });

    it('serves the preview to a limit.view holder and refuses an unauthenticated caller', async () => {
      const auditor = await provisionRole('FINANCE_AUDITOR');
      const ok = await request(app.getHttpServer())
        .get(`${PREVIEW_PATH}?productCode=${PRODUCT}&currency=${CURRENCY}`)
        .set(auth(auditor.token));
      expect(ok.status).toBe(200);

      const anonymous = await request(app.getHttpServer()).get(
        `${PREVIEW_PATH}?productCode=${PRODUCT}`,
      );
      expect(anonymous.status).toBe(401);
    });

    it('refuses a role without limit.view and records the denial as an audit event', async () => {
      const service = await provisionRole('CUSTOMER_SERVICE');
      const before = await dataSource.query<Array<{ count: string }>>(
        `SELECT count(*)::text AS count FROM audit_events
          WHERE entity_type = 'AUTHORIZATION_DECISION' AND action = 'DENIED'`,
      );

      const denied = await request(app.getHttpServer())
        .get(`${PREVIEW_PATH}?productCode=${PRODUCT}`)
        .set(auth(service.token));
      expect(denied.status).toBe(403);

      const deniedHistory = await request(app.getHttpServer())
        .get(`${HISTORY_PATH}?actionType=LIMIT_RULE_CREATE&resourceId=${randomUUID()}`)
        .set(auth(service.token));
      expect(deniedHistory.status).toBe(403);

      const after = await dataSource.query<Array<{ count: string }>>(
        `SELECT count(*)::text AS count FROM audit_events
          WHERE entity_type = 'AUTHORIZATION_DECISION' AND action = 'DENIED'`,
      );
      expect(Number(after[0]!.count)).toBeGreaterThan(Number(before[0]!.count));
    });

    it('rejects upload-capable verbs on both read surfaces', async () => {
      const auditor = await provisionRole('FINANCE_AUDITOR');
      const post = await request(app.getHttpServer())
        .post(PREVIEW_PATH)
        .set(auth(auditor.token))
        .send({ productCode: PRODUCT });
      expect([404, 405]).toContain(post.status);
      const del = await request(app.getHttpServer()).delete(HISTORY_PATH).set(auth(auditor.token));
      expect([404, 405]).toContain(del.status);
    });

    it('validates preview input rather than silently defaulting it', async () => {
      const auditor = await provisionRole('FINANCE_AUDITOR');
      const missingProduct = await request(app.getHttpServer())
        .get(PREVIEW_PATH)
        .set(auth(auditor.token));
      expect(missingProduct.status).toBe(400);

      const badDirection = await request(app.getHttpServer())
        .get(`${PREVIEW_PATH}?productCode=${PRODUCT}&direction=SIDEWAYS`)
        .set(auth(auditor.token));
      expect(badDirection.status).toBe(400);

      const badAmount = await request(app.getHttpServer())
        .get(`${PREVIEW_PATH}?productCode=${PRODUCT}&amountMinor=-5`)
        .set(auth(auditor.token));
      expect(badAmount.status).toBe(400);
    });
  });

  // ═══════════════════════════════════════════════ 2. selection parity with enforcement

  describe('limit selection parity (preview vs runtime enforcement)', () => {
    it('selects exactly the rule set runtime enforcement selects for the same operation', async () => {
      const auditor = await provisionRole('FINANCE_AUDITOR');
      const { customerId } = await createEligibleCustomer(dataSource, kycEvidence);
      const { ruleId } = await seedAssignedCustomerRule(customerId);

      const preview = await request(app.getHttpServer())
        .get(
          `${PREVIEW_PATH}?productCode=${PRODUCT}&currency=${CURRENCY}` +
            `&principalType=CUSTOMER&principalId=${customerId}&direction=OUTGOING&amountMinor=1000`,
        )
        .set(auth(auditor.token));
      expect(preview.status).toBe(200);
      expect(preview.body.limits.status).toBe('RESOLVED');

      const runtime = await enforce({ principalId: customerId, direction: 'OUTGOING' });

      expect(preview.body.limits.rules.map((rule: any) => rule.ruleId)).toEqual(runtime.ruleIds);
      expect(preview.body.limits.rules.map((rule: any) => rule.ruleId)).toEqual([ruleId]);
      expect(preview.body.limits.evaluatedDimensions).toEqual(runtime.dimensions);
    });

    it('narrows by direction identically: an OUTGOING-only rule is invisible to an INCOMING preview and refused by runtime', async () => {
      const auditor = await provisionRole('FINANCE_AUDITOR');
      const { customerId } = await createEligibleCustomer(dataSource, kycEvidence);
      await seedAssignedCustomerRule(customerId, { direction: 'OUTGOING' });

      const outgoing = await request(app.getHttpServer())
        .get(`${PREVIEW_PATH}?productCode=${PRODUCT}&principalId=${customerId}&direction=OUTGOING`)
        .set(auth(auditor.token));
      expect(outgoing.body.limits.status).toBe('RESOLVED');

      const incoming = await request(app.getHttpServer())
        .get(`${PREVIEW_PATH}?productCode=${PRODUCT}&principalId=${customerId}&direction=INCOMING`)
        .set(auth(auditor.token));
      expect(incoming.body.limits.status).toBe('MISSING');
      expect(incoming.body.limits.rules).toEqual([]);
      expect(incoming.body.explanation.map((item: any) => item.code)).toContain(
        'LIMIT_RULE_MISSING',
      );

      expect((await enforce({ principalId: customerId, direction: 'OUTGOING' })).status).toBe(
        'ALLOWED',
      );
      expect((await enforce({ principalId: customerId, direction: 'INCOMING' })).status).toBe(
        'REFUSED',
      );
    });

    it('narrows by channel identically: a channel-scoped rule does not apply to a channel-less operation', async () => {
      const auditor = await provisionRole('FINANCE_AUDITOR');
      const { customerId } = await createEligibleCustomer(dataSource, kycEvidence);
      const { ruleId } = await seedAssignedCustomerRule(customerId, { channel: 'USSD' });

      const withChannel = await request(app.getHttpServer())
        .get(
          `${PREVIEW_PATH}?productCode=${PRODUCT}&principalId=${customerId}` +
            `&direction=OUTGOING&channel=USSD`,
        )
        .set(auth(auditor.token));
      expect(withChannel.body.limits.status).toBe('RESOLVED');
      expect(withChannel.body.limits.rules.map((rule: any) => rule.ruleId)).toEqual([ruleId]);

      const withoutChannel = await request(app.getHttpServer())
        .get(`${PREVIEW_PATH}?productCode=${PRODUCT}&principalId=${customerId}&direction=OUTGOING`)
        .set(auth(auditor.token));
      expect(withoutChannel.body.limits.status).toBe('MISSING');

      expect(
        (await enforce({ principalId: customerId, channel: 'USSD', direction: 'OUTGOING' })).status,
      ).toBe('ALLOWED');
      expect(
        (await enforce({ principalId: customerId, channel: null, direction: 'OUTGOING' })).status,
      ).toBe('REFUSED');
    });

    it('applies identical effective-date boundaries: inclusive start, exclusive end', async () => {
      const auditor = await provisionRole('FINANCE_AUDITOR');
      const { customerId } = await createEligibleCustomer(dataSource, kycEvidence);

      const windowStart = new Date('2026-03-01T00:00:00.000Z');
      const windowEnd = new Date('2026-04-01T00:00:00.000Z');
      const profile = `A3CFG_WIN_${randomUUID().slice(0, 6).toUpperCase()}`;
      await seedProfile(profile);
      // The ASSIGNMENT must also cover the historical window, otherwise a MISSING result would
      // prove nothing about the rule's own effective dates.
      await seedAssignment({
        profileCode: profile,
        subjectType: 'CUSTOMER',
        subjectId: customerId,
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z').toISOString(),
      });
      const ruleId = await seedLimitRule({
        profileCode: profile,
        dimension: 'MAX_AMOUNT_PER_TX',
        limitMinor: '500000',
        effectiveFrom: windowStart.toISOString(),
        effectiveTo: windowEnd.toISOString(),
      });

      const at = async (iso: string) => {
        const res = await request(app.getHttpServer())
          .get(`${PREVIEW_PATH}?productCode=${PRODUCT}&principalId=${customerId}&at=${iso}`)
          .set(auth(auditor.token));
        expect(res.status).toBe(200);
        return res.body.limits;
      };

      // One millisecond before the window opens: absent.
      expect((await at('2026-02-28T23:59:59.999Z')).status).toBe('MISSING');
      // First instant of the window: present (inclusive).
      const opened = await at('2026-03-01T00:00:00.000Z');
      expect(opened.status).toBe('RESOLVED');
      expect(opened.rules.map((rule: any) => rule.ruleId)).toEqual([ruleId]);
      // Last instant inside the window: present.
      expect((await at('2026-03-31T23:59:59.999Z')).status).toBe('RESOLVED');
      // First instant at/after the window end: absent (exclusive).
      expect((await at('2026-04-01T00:00:00.000Z')).status).toBe('MISSING');

      // Runtime agrees at the exact same instants.
      expect(
        (await enforce({ principalId: customerId, now: new Date('2026-02-28T23:59:59.999Z') }))
          .status,
      ).toBe('REFUSED');
      expect(
        (await enforce({ principalId: customerId, now: new Date('2026-03-01T00:00:00.000Z') }))
          .status,
      ).toBe('ALLOWED');
      expect(
        (await enforce({ principalId: customerId, now: new Date('2026-03-31T23:59:59.999Z') }))
          .status,
      ).toBe('ALLOWED');
      expect(
        (await enforce({ principalId: customerId, now: new Date('2026-04-01T00:00:00.000Z') }))
          .status,
      ).toBe('REFUSED');
    });

    it('ignores inactive and soft-deleted rules identically in preview and runtime', async () => {
      const auditor = await provisionRole('FINANCE_AUDITOR');
      const { customerId } = await createEligibleCustomer(dataSource, kycEvidence);
      const profile = `A3CFG_DEAD_${randomUUID().slice(0, 6).toUpperCase()}`;
      await seedProfile(profile);
      await seedAssignment({
        profileCode: profile,
        subjectType: 'CUSTOMER',
        subjectId: customerId,
      });
      await seedLimitRule({
        profileCode: profile,
        dimension: 'MAX_AMOUNT_PER_TX',
        limitMinor: '500000',
        isActive: false,
      });
      const deletedId = await seedLimitRule({
        profileCode: profile,
        dimension: 'DAILY_AMOUNT',
        limitMinor: '900000',
      });
      await dataSource.query('UPDATE limit_rules SET deleted_at = NOW() WHERE id = $1', [
        deletedId,
      ]);

      const preview = await request(app.getHttpServer())
        .get(`${PREVIEW_PATH}?productCode=${PRODUCT}&principalId=${customerId}`)
        .set(auth(auditor.token));
      expect(preview.body.limits.status).toBe('MISSING');
      expect(preview.body.limits.rules).toEqual([]);
      expect((await enforce({ principalId: customerId })).status).toBe('REFUSED');
    });

    it('honours the same precedence order (priority DESC, created_at ASC) without re-sorting', async () => {
      const auditor = await provisionRole('FINANCE_AUDITOR');
      const { customerId } = await createEligibleCustomer(dataSource, kycEvidence);
      const profile = `A3CFG_ORD_${randomUUID().slice(0, 6).toUpperCase()}`;
      await seedProfile(profile);
      await seedAssignment({
        profileCode: profile,
        subjectType: 'CUSTOMER',
        subjectId: customerId,
      });

      const low = await seedLimitRule({
        profileCode: profile,
        dimension: 'DAILY_COUNT',
        limitCount: 10,
        priority: 1,
      });
      const high = await seedLimitRule({
        profileCode: profile,
        dimension: 'DAILY_AMOUNT',
        limitMinor: '1000000',
        priority: 9,
      });
      const midA = await seedLimitRule({
        profileCode: profile,
        dimension: 'WEEKLY_AMOUNT',
        limitMinor: '5000000',
        priority: 5,
      });
      const midB = await seedLimitRule({
        profileCode: profile,
        dimension: 'MONTHLY_AMOUNT',
        limitMinor: '9000000',
        priority: 5,
      });
      // Make the priority-5 tie-break (created_at ASC) explicit rather than microsecond-dependent.
      await dataSource.query(`UPDATE limit_rules SET created_at = NOW() WHERE id = $1`, [midA]);
      await dataSource.query(
        `UPDATE limit_rules SET created_at = NOW() + interval '1 second' WHERE id = $1`,
        [midB],
      );

      const preview = await request(app.getHttpServer())
        .get(`${PREVIEW_PATH}?productCode=${PRODUCT}&principalId=${customerId}`)
        .set(auth(auditor.token));
      const previewOrder = preview.body.limits.rules.map((rule: any) => rule.ruleId);

      expect(previewOrder).toEqual([high, midA, midB, low]);
      expect(previewOrder).toEqual((await enforce({ principalId: customerId })).ruleIds);
    });

    it('selects the same rules when the preview and enforcement share the helper directly', async () => {
      const { customerId } = await createEligibleCustomer(dataSource, kycEvidence);
      const { profile, ruleId } = await seedAssignedCustomerRule(customerId);

      const direct = await dataSource.transaction(async (manager) => {
        const candidates = await fetchApplicableLimitRuleCandidates(manager, {
          profileCodes: [profile],
          product: PRODUCT,
          currency: CURRENCY,
          now: new Date(),
        });
        return narrowApplicableLimitRules(candidates, {
          direction: 'OUTGOING',
          channel: null,
        }).map((rule) => rule.id);
      });
      expect(direct).toEqual([ruleId]);
    });
  });

  // ═════════════════════════════════════════════ 3. missing vs unlimited, ambiguity

  describe('missing configuration is never reported as unlimited', () => {
    it('reports MISSING with a BLOCKER when no profile is assigned — and runtime refuses', async () => {
      const auditor = await provisionRole('FINANCE_AUDITOR');
      const { customerId } = await createEligibleCustomer(dataSource, kycEvidence);

      const preview = await request(app.getHttpServer())
        .get(`${PREVIEW_PATH}?productCode=${PRODUCT}&principalId=${customerId}`)
        .set(auth(auditor.token));
      expect(preview.status).toBe(200);
      expect(preview.body.limits.status).toBe('MISSING');
      expect(preview.body.limits.governingProfileCodes).toEqual([]);
      expect(preview.body.limits.rules).toEqual([]);
      expect(preview.body.limits.note).toMatch(/not an unlimited allowance/i);
      expect(preview.body.explanation).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'LIMIT_PROFILE_MISSING', severity: 'BLOCKER' }),
        ]),
      );
      expect(preview.body.summary.blockerCount).toBeGreaterThanOrEqual(1);
      expect(preview.body.summary.sections.limits).toBe('MISSING');

      expect((await enforce({ principalId: customerId })).status).toBe('REFUSED');
      // The legacy advisory contract is unchanged: same data, no strict flag → pass-through.
      expect((await enforce({ principalId: customerId }, 'LEGACY')).status).toBe('ALLOWED');
    });

    it('distinguishes an explicitly configured zero/absent-rule profile from no profile at all', async () => {
      const auditor = await provisionRole('FINANCE_AUDITOR');
      const { customerId } = await createEligibleCustomer(dataSource, kycEvidence);
      const profile = `A3CFG_EMPTY_${randomUUID().slice(0, 6).toUpperCase()}`;
      await seedProfile(profile);
      await seedAssignment({
        profileCode: profile,
        subjectType: 'CUSTOMER',
        subjectId: customerId,
      });

      const preview = await request(app.getHttpServer())
        .get(`${PREVIEW_PATH}?productCode=${PRODUCT}&principalId=${customerId}`)
        .set(auth(auditor.token));
      expect(preview.body.limits.status).toBe('MISSING');
      expect(preview.body.limits.governingProfileCodes).toEqual([profile]);
      expect(preview.body.explanation.map((item: any) => item.code)).toContain(
        'LIMIT_RULE_MISSING',
      );
      expect(preview.body.explanation.map((item: any) => item.code)).not.toContain(
        'LIMIT_PROFILE_MISSING',
      );
    });

    it('reports NOT_APPLICABLE (not MISSING) when the caller asked about no principal', async () => {
      const auditor = await provisionRole('FINANCE_AUDITOR');
      const preview = await request(app.getHttpServer())
        .get(`${PREVIEW_PATH}?productCode=${PRODUCT}`)
        .set(auth(auditor.token));
      expect(preview.body.limits.status).toBe('NOT_APPLICABLE');
      expect(preview.body.explanation.map((item: any) => item.code)).toEqual(
        expect.arrayContaining(['PREVIEW_PRINCIPAL_NOT_PROVIDED']),
      );
    });
  });

  describe('ambiguity is reported, never silently resolved', () => {
    it('reports AMBIGUOUS for a fee-rule priority tie and selects no fee', async () => {
      const auditor = await provisionRole('FINANCE_AUDITOR');
      const { customerId } = await createEligibleCustomer(dataSource, kycEvidence);
      await seedAssignedCustomerRule(customerId);

      const first = randomUUID();
      const second = randomUUID();
      // `uq_fee_rules_identity` is (product_code, currency, effective_from), so two simultaneously
      // effective rules must carry distinct `effective_from` values. Both are still in force at the
      // preview instant and share priority 7, which is exactly the ambiguity under test.
      for (const [id, bps, offsetMs] of [
        [first, 100, 7_200_000],
        [second, 200, 3_600_000],
      ] as const) {
        await dataSource.query(
          `INSERT INTO fee_rules (id, product_code, currency, percentage_bps, effective_from,
             priority, is_active, created_by)
           VALUES ($1,$2,$3,$4,$5,7,true,'test')`,
          [id, PRODUCT, CURRENCY, bps, new Date(Date.now() - offsetMs).toISOString()],
        );
      }

      const preview = await request(app.getHttpServer())
        .get(`${PREVIEW_PATH}?productCode=${PRODUCT}&principalId=${customerId}&amountMinor=100000`)
        .set(auth(auditor.token));
      expect(preview.status).toBe(200);
      expect(preview.body.fee.status).toBe('AMBIGUOUS');
      expect(preview.body.fee.rule).toBeNull();
      expect(preview.body.fee.computed).toBeNull();
      expect(preview.body.fee.ambiguousPriority).toBe(7);
      expect(preview.body.fee.ambiguousRuleIds).toEqual([first, second].sort());
      expect(preview.body.explanation).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'FEE_RULE_AMBIGUOUS', severity: 'BLOCKER' }),
        ]),
      );

      // The tie never becomes a fee and never posts.
      expect(preview.body.guarantees).toEqual({
        readonly: true,
        writesPerformed: [],
        financialMutations: [],
        databaseTransactionReadOnly: true,
      });
    });
  });

  // ══════════════════════════════════════ 4. advisory guarantee / zero money movement

  describe('read-only advisory contract', () => {
    it('resolves fee/commission/reward from the authoritative resolvers and posts nothing', async () => {
      const auditor = await provisionRole('FINANCE_AUDITOR');
      const { customerId } = await createEligibleCustomer(dataSource, kycEvidence);
      await seedAssignedCustomerRule(customerId);

      const effectiveFrom = new Date(Date.now() - 3_600_000).toISOString();
      await dataSource.query(
        `INSERT INTO fee_rules (product_code, currency, percentage_bps, effective_from, priority,
           is_active, created_by)
         VALUES ($1,$2,250,$3,1,true,'test')`,
        [PRODUCT, CURRENCY, effectiveFrom],
      );
      await dataSource.query(
        `INSERT INTO commission_rules (product_code, currency, recipient_type, calculation_model,
           calculation_basis, flat_commission_minor, effective_from, priority, is_active, created_by)
         VALUES ($1,$2,'PLATFORM','FIXED','PRINCIPAL',5000,$3,1,true,'test')`,
        [PRODUCT, CURRENCY, effectiveFrom],
      );
      await dataSource.query(
        `INSERT INTO reward_rules (product_code, currency, beneficiary_type, reward_type,
           calculation_model, calculation_basis, flat_reward_minor, effective_from, priority,
           is_active, created_by)
         VALUES ($1,$2,'CUSTOMER','CASHBACK','FIXED','PRINCIPAL',1500,$3,1,true,'test')`,
        [PRODUCT, CURRENCY, effectiveFrom],
      );

      const journalBefore = await dataSource.query<Array<{ count: string }>>(
        'SELECT count(*)::text AS count FROM ledger_journals',
      );
      const usageBefore = await dataSource.query<Array<{ count: string }>>(
        'SELECT count(*)::text AS count FROM limit_usages',
      );
      const reservationBefore = await dataSource.query<Array<{ count: string }>>(
        'SELECT count(*)::text AS count FROM limit_reservations',
      );

      const preview = await request(app.getHttpServer())
        .get(
          `${PREVIEW_PATH}?productCode=${PRODUCT}&principalType=CUSTOMER&principalId=${customerId}` +
            `&direction=OUTGOING&amountMinor=200000`,
        )
        .set(auth(auditor.token));

      expect(preview.status).toBe(200);
      expect(preview.body.mode).toBe('ADVISORY');
      expect(preview.body.authoritative).toBe('BACKEND_RESOLVERS');
      expect(preview.body.fee.status).toBe('RESOLVED');
      expect(preview.body.fee.computed.postsJournalLegs).toBe(false);
      expect(preview.body.fee.computed.feeMinor).toBe('5000');
      expect(preview.body.commission.status).toBe('RESOLVED');
      expect(preview.body.commission.accrualPosted).toBe(false);
      expect(preview.body.commission.allocations[0]).toMatchObject({
        recipientType: 'PLATFORM',
        amountMinor: '5000',
      });
      expect(preview.body.reward.status).toBe('RESOLVED');
      expect(preview.body.reward.creditPosted).toBe(false);
      expect(preview.body.reward.grants[0]).toMatchObject({ amountMinor: '1500' });

      // Nothing moved.
      for (const [table, before] of [
        ['ledger_journals', journalBefore],
        ['limit_usages', usageBefore],
        ['limit_reservations', reservationBefore],
      ] as const) {
        const after = await dataSource.query<Array<{ count: string }>>(
          `SELECT count(*)::text AS count FROM ${table}`,
        );
        expect(Number(after[0]!.count)).toBe(Number(before[0]!.count));
      }
    });

    it('resolves the canonical customer class instead of reporting an unavailable contract', async () => {
      const auditor = await provisionRole('FINANCE_AUDITOR');
      const { customerId } = await createEligibleCustomer(dataSource, kycEvidence);
      await assignClass(customerId, 'PREMIUM');

      const preview = await request(app.getHttpServer())
        .get(`${PREVIEW_PATH}?productCode=${PRODUCT}&principalId=${customerId}`)
        .set(auth(auditor.token));

      expect(preview.status).toBe(200);
      // The hardcoded NOT_APPLICABLE is gone: Arena 1's resolver answers.
      expect(preview.body.customerClass.status).toBe('RESOLVED');
      expect(preview.body.customerClass.effective).toMatchObject({
        classCode: 'PREMIUM',
        className: 'Premium',
        source: 'MANUAL',
      });
      expect(preview.body.customerClass.effective.assignmentId).toMatch(/^[0-9a-f-]{36}$/i);
      expect(typeof preview.body.customerClass.effective.assignmentVersion).toBe('number');
      expect(typeof preview.body.customerClass.effective.classVersion).toBe('number');
    });

    it('reports an explicit MISSING class rather than inferring one from tier, segment or agent class', async () => {
      const auditor = await provisionRole('FINANCE_AUDITOR');
      const { customerId } = await createEligibleCustomer(dataSource, kycEvidence);
      // Remove the assignment the class resolver would otherwise find.
      await dataSource.query(
        'UPDATE customer_class_assignments SET is_active = false WHERE customer_id = $1',
        [customerId],
      );

      const preview = await request(app.getHttpServer())
        .get(
          `${PREVIEW_PATH}?productCode=${PRODUCT}&principalId=${customerId}` +
            `&segmentCodes=PREMIUM&agentClassId=${randomUUID()}`,
        )
        .set(auth(auditor.token));

      expect(preview.body.customerClass.status).toBe('MISSING');
      expect(preview.body.customerClass.effective).toBeNull();
      expect(preview.body.customerClass.note).toMatch(/No class was inferred from KYC tier/i);
      // Even though the caller *asked* about segment PREMIUM, the class section never echoes it as
      // a resolved class.
      expect(preview.body.customerClass.effective).toBeNull();
    });

    it('reports an agent principal customer class as NOT_APPLICABLE, not as a guessed class', async () => {
      const auditor = await provisionRole('FINANCE_AUDITOR');
      const preview = await request(app.getHttpServer())
        .get(
          `${PREVIEW_PATH}?productCode=${PRODUCT}&principalType=AGENT&principalId=${randomUUID()}`,
        )
        .set(auth(auditor.token));
      expect(preview.body.customerClass.status).toBe('NOT_APPLICABLE');
      expect(preview.body.customerClass.effective).toBeNull();
    });
  });

  // ════════════════════════ 4b. role-based information isolation (RESTRICTED sections)

  describe('limit.view alone never exposes commercial configuration', () => {
    /**
     * AGENT_NETWORK_MANAGER holds `limit.view` and `institution.view` but none of
     * fee_rule.view / commission_rule.view / reward_rule.view / kyc.view / customer.view.
     * The preview must answer 200 and name what was withheld — it must never leak a value.
     */
    it('answers with explicit RESTRICTED states and leaks no withheld configuration', async () => {
      const agentNetwork = await provisionRole('AGENT_NETWORK_MANAGER');
      const { customerId } = await createEligibleCustomer(dataSource, kycEvidence);
      await assignClass(customerId, 'PREMIUM');
      await seedProfile('LP_A3_ISOLATION');
      await dataSource.query(
        `INSERT INTO limit_assignments (limit_profile_code, subject_type, subject_id, segment_code,
           precedence, effective_from, is_active, created_by)
         VALUES ('LP_A3_ISOLATION','CUSTOMER',$1,NULL,10,NOW()-interval '1 hour',true,'test')`,
        [customerId],
      );
      // A live fee rule that must never appear in this response.
      const withheldFeeRule: Array<{ id: string }> = await dataSource.query(
        `INSERT INTO fee_rules (product_code, currency, percentage_bps, effective_from, priority,
           is_active, created_by)
         VALUES ($1,$2,9876,NOW()-interval '1 hour',1,true,'test')
         RETURNING id`,
        [PRODUCT, CURRENCY],
      );

      const preview = await request(app.getHttpServer())
        .get(
          `${PREVIEW_PATH}?productCode=${PRODUCT}&principalType=CUSTOMER&principalId=${customerId}`,
        )
        .set(auth(agentNetwork.token));

      expect(preview.status).toBe(200);

      const restrictedSections: Record<string, string> = {
        fee: 'fee_rule.view',
        commission: 'commission_rule.view',
        reward: 'reward_rule.view',
        kycRestriction: 'kyc.view',
        customerClass: 'customer.view',
      };
      for (const bodyKey of Object.keys(restrictedSections)) {
        const requiredFunction = restrictedSections[bodyKey]!;
        const section: { status?: string; requiredFunction?: string } | undefined =
          preview.body[bodyKey];
        expect(section?.status).toBe('RESTRICTED');
        expect(section?.requiredFunction).toBe(requiredFunction);
        // A RESTRICTED section carries no configuration payload at all: exactly three keys.
        expect(Object.keys(section ?? {}).sort()).toEqual(['note', 'requiredFunction', 'status']);
      }

      // Nothing withheld may be smuggled out through another field. Assertions target exact
      // identifiers and class codes rather than bare digits: a substring scan for a short number
      // is unsound because unrelated generated UUIDs can legitimately contain the same digits.
      const serialized = JSON.stringify(preview.body);
      expect(serialized).not.toContain(withheldFeeRule[0]!.id);
      expect(serialized).not.toContain('percentageBps');
      expect(serialized).not.toContain('PREMIUM');
      expect(serialized).not.toContain('STANDARD');

      // Sections the caller IS entitled to still resolve: the limit section runs on limit.view.
      // The assignment resolves even though the profile carries no rule (correctly MISSING, never
      // unlimited).
      expect(preview.body.limits.assignmentProfileCode).toBe('LP_A3_ISOLATION');
      expect(preview.body.limits.status).toBe('MISSING');
    });

    it('withholds the product section without probing whether the product exists', async () => {
      // AGENT_NETWORK_MANAGER holds limit.view but NOT product.view — the only seeded role with
      // that combination, so it is exactly the caller who could otherwise probe the catalogue.
      const operations = await provisionRole('AGENT_NETWORK_MANAGER');
      const { customerId } = await createEligibleCustomer(dataSource, kycEvidence);

      const known = await request(app.getHttpServer())
        .get(`${PREVIEW_PATH}?productCode=${PRODUCT}&principalId=${customerId}`)
        .set(auth(operations.token));
      const unknown = await request(app.getHttpServer())
        .get(`${PREVIEW_PATH}?productCode=A3_UNREGISTERED_PRODUCT&principalId=${customerId}`)
        .set(auth(operations.token));

      // Identical answers: a withheld caller cannot use the preview as an existence oracle.
      expect(known.status).toBe(200);
      expect(unknown.status).toBe(200);
      expect(known.body.product).toBeNull();
      expect(unknown.body.product).toBeNull();
      expect(known.body.productRestricted.status).toBe('RESTRICTED');
      expect(unknown.body.productRestricted.status).toBe('RESTRICTED');
      expect(known.body.productRestricted.requiredFunction).toBe('product.view');
      expect(unknown.body.productRestricted.requiredFunction).toBe('product.view');
    });

    it('gives a fully entitled auditor the resolved sections a restricted caller cannot see', async () => {
      const auditor = await provisionRole('FINANCE_AUDITOR');
      const { customerId } = await createEligibleCustomer(dataSource, kycEvidence);
      await assignClass(customerId, 'BUSINESS');

      const preview = await request(app.getHttpServer())
        .get(`${PREVIEW_PATH}?productCode=${PRODUCT}&principalId=${customerId}`)
        .set(auth(auditor.token));

      expect(preview.status).toBe(200);
      for (const section of ['fee', 'commission', 'reward', 'kycRestriction', 'customerClass']) {
        expect(preview.body[section]).toBeDefined();
        expect(preview.body[section].status).not.toBe('RESTRICTED');
      }
      expect(preview.body.product).not.toBeNull();
      expect(preview.body.customerClass.effective.classCode).toBe('BUSINESS');
    });
  });

  // ══════════════════════════════ 4c. database-enforced read-only guarantee

  describe('the advisory transaction is READ ONLY at the database level', () => {
    it('reports the database-confirmed read-only state rather than asserting it in code', async () => {
      const auditor = await provisionRole('FINANCE_AUDITOR');
      const { customerId } = await createEligibleCustomer(dataSource, kycEvidence);

      const preview = await request(app.getHttpServer())
        .get(`${PREVIEW_PATH}?productCode=${PRODUCT}&principalId=${customerId}`)
        .set(auth(auditor.token));

      expect(preview.status).toBe(200);
      expect(preview.body.guarantees.databaseTransactionReadOnly).toBe(true);
      expect(preview.body.guarantees.readonly).toBe(true);
      expect(preview.body.guarantees.writesPerformed).toEqual([]);
      expect(preview.body.guarantees.financialMutations).toEqual([]);
    });

    it('is enforced by PostgreSQL: a write attempted inside the preview transaction is refused', async () => {
      // Proves the guarantee is a database property, not a convention. The service uses
      // REPEATABLE READ + SET TRANSACTION READ ONLY, which is exactly what is reproduced here.
      const customerId = randomUUID();
      await expect(
        dataSource.transaction('REPEATABLE READ', async (manager) => {
          await manager.query('SET TRANSACTION READ ONLY');
          const state: Array<{ transaction_read_only: string }> = await manager.query(
            'SHOW transaction_read_only',
          );
          expect(state[0]!.transaction_read_only).toBe('on');
          await manager.query(
            `INSERT INTO limit_assignments (limit_profile_code, subject_type, subject_id,
               precedence, effective_from, is_active, created_by)
             VALUES ('LP_SHOULD_NOT_EXIST','CUSTOMER',$1,0,NOW(),true,'test')`,
            [customerId],
          );
        }),
      ).rejects.toThrow(/read-only transaction/i);

      const rows: Array<{ count: string }> = await dataSource.query(
        `SELECT COUNT(*)::text AS count FROM limit_assignments WHERE limit_profile_code = 'LP_SHOULD_NOT_EXIST'`,
      );
      expect(rows[0]!.count).toBe('0');
    });

    it('writes nothing at all: every commercial table is unchanged after a resolved preview', async () => {
      const auditor = await provisionRole('FINANCE_AUDITOR');
      const { customerId } = await createEligibleCustomer(dataSource, kycEvidence);
      await assignClass(customerId, 'PREMIUM');

      const snapshot = async () =>
        Promise.all(
          [
            'fee_rules',
            'commission_rules',
            'reward_rules',
            'limit_profiles',
            'limit_rules',
            'limit_assignments',
            'customer_classes',
            'customer_class_assignments',
          ].map(async (table) => {
            const rows: Array<{ count: string; digest: string | null }> = await dataSource.query(
              `SELECT COUNT(*)::text AS count, md5(COALESCE(string_agg(t::text, '|' ORDER BY t::text), '')) AS digest FROM ${table} t`,
            );
            return `${table}:${rows[0]!.count}:${rows[0]!.digest}`;
          }),
        );

      const before = await snapshot();
      const preview = await request(app.getHttpServer())
        .get(`${PREVIEW_PATH}?productCode=${PRODUCT}&principalId=${customerId}`)
        .set(auth(auditor.token));
      expect(preview.status).toBe(200);
      expect(preview.body.guarantees.databaseTransactionReadOnly).toBe(true);
      expect(await snapshot()).toEqual(before);
    });
  });

  // ═══════════════════════════ 4d. fee targeting reaches the resolver

  describe('fee resolution receives the applicable targeting dimensions', () => {
    it('selects a rule targeted at the resolved customer class and ignores an untargeted cheaper one', async () => {
      const auditor = await provisionRole('FINANCE_AUDITOR');
      const { customerId } = await createEligibleCustomer(dataSource, kycEvidence);
      await assignClass(customerId, 'PREMIUM');

      // Untargeted rule (applies to everyone) at 100 bps.
      await dataSource.query(
        `INSERT INTO fee_rules (product_code, currency, percentage_bps, effective_from, priority,
           is_active, created_by)
         VALUES ($1,$2,100,NOW()-interval '2 hours',1,true,'test')`,
        [PRODUCT, CURRENCY],
      );
      // Class-targeted rule at 250 bps, higher priority.
      await dataSource.query(
        `INSERT INTO fee_rules (product_code, currency, customer_class_code, percentage_bps,
           effective_from, priority, is_active, created_by)
         VALUES ($1,$2,'PREMIUM',250,NOW()-interval '1 hour',5,true,'test')`,
        [PRODUCT, CURRENCY],
      );

      const preview = await request(app.getHttpServer())
        .get(`${PREVIEW_PATH}?productCode=${PRODUCT}&principalId=${customerId}`)
        .set(auth(auditor.token));

      expect(preview.status).toBe(200);
      expect(preview.body.fee.status).toBe('RESOLVED');
      // The class-targeted rule wins: targeting is applied, not silently dropped.
      expect(preview.body.fee.rule.percentageBps).toBe(250);
      expect(preview.body.customerClass.effective.classCode).toBe('PREMIUM');
    });

    it('does not apply a rule targeted at a class the customer does not hold', async () => {
      const auditor = await provisionRole('FINANCE_AUDITOR');
      const { customerId } = await createEligibleCustomer(dataSource, kycEvidence);
      await assignClass(customerId, 'STANDARD');

      await dataSource.query(
        `INSERT INTO fee_rules (product_code, currency, percentage_bps, effective_from, priority,
           is_active, created_by)
         VALUES ($1,$2,100,NOW()-interval '2 hours',1,true,'test')`,
        [PRODUCT, CURRENCY],
      );
      const targeted: Array<{ id: string }> = await dataSource.query(
        `INSERT INTO fee_rules (product_code, currency, customer_class_code, percentage_bps,
           effective_from, priority, is_active, created_by)
         VALUES ($1,$2,'BUSINESS',999,NOW()-interval '1 hour',9,true,'test')
         RETURNING id`,
        [PRODUCT, CURRENCY],
      );

      const preview = await request(app.getHttpServer())
        .get(`${PREVIEW_PATH}?productCode=${PRODUCT}&principalId=${customerId}`)
        .set(auth(auditor.token));

      expect(preview.status).toBe(200);
      // The untargeted rule applies; the BUSINESS-targeted rule must not be selected.
      expect(preview.body.fee.status).toBe('RESOLVED');
      expect(preview.body.fee.rule.percentageBps).toBe(100);
      expect(preview.body.fee.rule.ruleId).not.toBe(targeted[0]!.id);
      expect(preview.body.customerClass.effective.classCode).toBe('STANDARD');
      // Assert on the SELECTED RULE rather than scanning the serialized body: a substring scan is
      // unsound because unrelated generated UUIDs can legitimately contain the same digits.
      expect(JSON.stringify(preview.body.fee)).not.toContain('999');
      expect(JSON.stringify(preview.body.fee)).not.toContain(targeted[0]!.id);
    });
  });

  // ═══════════════════════════════ 5. governed limit-rule authoring (existing workflow)

  describe('limit-rule authoring uses the existing governed workflow', () => {
    async function proposeCreate(
      preparer: { token: string },
      profileCode: string,
      overrides: Record<string, unknown> = {},
    ) {
      const body = {
        product: PRODUCT,
        currency: CURRENCY,
        dimension: 'MAX_AMOUNT_PER_TX',
        direction: 'OUTGOING',
        limitValueMinor: '750000',
        effectiveFrom: new Date(Date.now() - 60_000).toISOString(),
        priority: 3,
        reason: 'Arena 3 governed limit-rule creation',
        ...overrides,
      };
      const res = await request(app.getHttpServer())
        .post(`/api/v1/internal/limit-profiles/${profileCode}/rules`)
        .set(auth(preparer.token))
        .send(body);
      return { res, body };
    }

    it('proposes without writing, refuses self-approval, then applies only on execution', async () => {
      const preparer = await provisionRole('FINANCE_PREPARER');
      const controller = await provisionRole('FINANCE_CONTROLLER');
      await seedProfile('A3CFG_GOV');

      const { res, body } = await proposeCreate(preparer, 'A3CFG_GOV');
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        status: 'REQUESTED',
        actionType: 'LIMIT_RULE_CREATE',
        resourceType: 'LIMIT_RULE',
        resourceId: null,
      });
      const approvalId = res.body.approvalId as string;

      // Nothing was written by the proposal.
      const pending = await dataSource.query<Array<{ count: string }>>(
        'SELECT count(*)::text AS count FROM limit_rules WHERE limit_profile_code = $1',
        ['A3CFG_GOV'],
      );
      expect(Number(pending[0]!.count)).toBe(0);

      // The maker cannot approve their own request.
      const selfApproval = await request(app.getHttpServer())
        .post(`${APPROVALS_PATH}/${approvalId}/approve`)
        .set(auth(preparer.token))
        .send({ comment: 'self' });
      expect(selfApproval.status).toBe(403);

      // An independent controller can.
      const approved = await request(app.getHttpServer())
        .post(`${APPROVALS_PATH}/${approvalId}/approve`)
        .set(auth(controller.token))
        .send({ comment: 'verified' });
      expect(approved.status).toBe(201);
      expect(approved.body).toMatchObject({ approved: true, reason: 'APPROVED' });

      // Approval alone still writes nothing.
      const afterApproval = await dataSource.query<Array<{ count: string }>>(
        'SELECT count(*)::text AS count FROM limit_rules WHERE limit_profile_code = $1',
        ['A3CFG_GOV'],
      );
      expect(Number(afterApproval[0]!.count)).toBe(0);

      // Execution writes exactly one rule.
      const executed = await request(app.getHttpServer())
        .post(
          `/api/v1/internal/limit-profiles/A3CFG_GOV/rules/changes/${approvalId}/execute-create`,
        )
        .set(auth(controller.token))
        .send(body);
      expect(executed.status).toBe(201);
      expect(executed.body).toMatchObject({
        limitProfileCode: 'A3CFG_GOV',
        dimension: 'MAX_AMOUNT_PER_TX',
        limitValueMinor: '750000',
      });
      const ruleId = executed.body.id as string;

      // Replay is refused.
      const replay = await request(app.getHttpServer())
        .post(
          `/api/v1/internal/limit-profiles/A3CFG_GOV/rules/changes/${approvalId}/execute-create`,
        )
        .set(auth(controller.token))
        .send(body);
      expect(replay.status).toBe(409);

      // The change history explains the whole lifecycle for this resource.
      const history = await request(app.getHttpServer())
        .get(`${HISTORY_PATH}?actionType=LIMIT_RULE_CREATE&resourceId=${ruleId}`)
        .set(auth(controller.token));
      expect(history.status).toBe(200);
      expect(history.body).toMatchObject({
        actionType: 'LIMIT_RULE_CREATE',
        resourceType: 'LIMIT_RULE',
        resourceId: ruleId,
      });

      // The executed rule is what runtime enforcement now selects.
      const { customerId } = await createEligibleCustomer(dataSource, kycEvidence);
      await seedAssignment({
        profileCode: 'A3CFG_GOV',
        subjectType: 'CUSTOMER',
        subjectId: customerId,
      });
      expect((await enforce({ principalId: customerId })).ruleIds).toEqual([ruleId]);
    });

    it('refuses a tampered payload at execution and leaves the approval un-consumed', async () => {
      const preparer = await provisionRole('FINANCE_PREPARER');
      const controller = await provisionRole('FINANCE_CONTROLLER');
      await seedProfile('A3CFG_TAMPER');

      const { res, body } = await proposeCreate(preparer, 'A3CFG_TAMPER');
      const approvalId = res.body.approvalId as string;
      await request(app.getHttpServer())
        .post(`${APPROVALS_PATH}/${approvalId}/approve`)
        .set(auth(controller.token))
        .send({ comment: 'ok' });

      const tampered = await request(app.getHttpServer())
        .post(
          `/api/v1/internal/limit-profiles/A3CFG_TAMPER/rules/changes/${approvalId}/execute-create`,
        )
        .set(auth(controller.token))
        .send({ ...body, limitValueMinor: '999999999' });
      expect(tampered.status).toBe(403);

      const stored = await dataSource.getRepository(PrivilegedActionApproval).findOne({
        where: { id: approvalId },
      });
      expect(stored?.status).toBe(PrivilegedActionApprovalStatus.APPROVED);
      expect(stored?.actionType).toBe('LIMIT_RULE_CREATE');
      expect(stored?.resourceType).toBe('LIMIT_RULE');
    });

    it('refuses an unentitled maker and an unrelated executor', async () => {
      const auditor = await provisionRole('FINANCE_AUDITOR');
      const controller = await provisionRole('FINANCE_CONTROLLER');
      await seedProfile('A3CFG_DENY');

      // FINANCE_AUDITOR holds limit.view only — it cannot propose a limit change.
      const auditorProposal = await proposeCreate(auditor, 'A3CFG_DENY');
      expect(auditorProposal.res.status).toBe(403);

      const preparer = await provisionRole('FINANCE_PREPARER');
      const { res, body } = await proposeCreate(preparer, 'A3CFG_DENY');
      const approvalId = res.body.approvalId as string;

      // Unapproved execution is impossible.
      const premature = await request(app.getHttpServer())
        .post(
          `/api/v1/internal/limit-profiles/A3CFG_DENY/rules/changes/${approvalId}/execute-create`,
        )
        .set(auth(controller.token))
        .send(body);
      expect(premature.status).toBe(409);

      await request(app.getHttpServer())
        .post(`${APPROVALS_PATH}/${approvalId}/approve`)
        .set(auth(controller.token))
        .send({ comment: 'ok' });

      // The maker still cannot execute — execution is the checker's step.
      const makerExecute = await request(app.getHttpServer())
        .post(
          `/api/v1/internal/limit-profiles/A3CFG_DENY/rules/changes/${approvalId}/execute-create`,
        )
        .set(auth(preparer.token))
        .send(body);
      expect(makerExecute.status).toBe(403);
    });

    it('refuses an approved modify against a stale rule version', async () => {
      const preparer = await provisionRole('FINANCE_PREPARER');
      const controller = await provisionRole('FINANCE_CONTROLLER');
      await seedProfile('A3CFG_STALE');
      const ruleId = await seedLimitRule({
        profileCode: 'A3CFG_STALE',
        dimension: 'MAX_AMOUNT_PER_TX',
        limitMinor: '400000',
      });

      const modifyBody = {
        reason: 'Arena 3 governed limit-rule update',
        limitValueMinor: '450000',
        version: 1,
      };
      const proposed = await request(app.getHttpServer())
        .patch(`${LIMIT_RULES_PATH}/${ruleId}`)
        .set(auth(preparer.token))
        .send(modifyBody);
      expect(proposed.status).toBe(200);
      expect(proposed.body).toMatchObject({
        actionType: 'LIMIT_RULE_UPDATE',
        resourceType: 'LIMIT_RULE',
        resourceId: ruleId,
      });
      const approvalId = proposed.body.approvalId as string;

      await request(app.getHttpServer())
        .post(`${APPROVALS_PATH}/${approvalId}/approve`)
        .set(auth(controller.token))
        .send({ comment: 'ok' });

      // Another writer moves the rule on while the approval is pending.
      await dataSource.query(
        'UPDATE limit_rules SET version = version + 1, updated_by = $2 WHERE id = $1',
        [ruleId, 'concurrent-writer'],
      );

      const executed = await request(app.getHttpServer())
        .post(`${LIMIT_RULES_PATH}/${ruleId}/changes/${approvalId}/execute-update`)
        .set(auth(controller.token))
        .send(modifyBody);
      expect(executed.status).toBe(409);
      expect(String(executed.body.message)).toMatch(/stale version/i);

      const rows = await dataSource.query<Array<{ limit_value_minor: string; version: number }>>(
        'SELECT limit_value_minor::text AS limit_value_minor, version FROM limit_rules WHERE id = $1',
        [ruleId],
      );
      expect(rows[0]!.limit_value_minor).toBe('400000');
      expect(rows[0]!.version).toBe(2);
    });
  });

  // ══════════════════════════════════════════════════ 6. change-history filtering

  describe('change history', () => {
    async function seedApproval(params: {
      actionType: string;
      resourceType: string;
      resourceId: string | null;
      status?: PrivilegedActionApprovalStatus;
    }): Promise<string> {
      const repo = dataSource.getRepository(PrivilegedActionApproval);
      const row = await repo.save(
        repo.create({
          actionType: params.actionType,
          resourceType: params.resourceType,
          resourceId: params.resourceId,
          policy: { action: params.actionType, resourceType: params.resourceType },
          approvalScope: 'limit.modify',
          reason: 'history fixture',
          actionFingerprint: 'b'.repeat(64),
          requesterPrincipalId: 'maker',
          status: params.status ?? PrivilegedActionApprovalStatus.REQUESTED,
          requestedAt: new Date(),
          expiresAt: new Date(Date.now() + 600_000),
        }),
      );
      return row.id;
    }

    it('returns only the requested action type and resource, newest first', async () => {
      const auditor = await provisionRole('FINANCE_AUDITOR');
      const ruleId = randomUUID();
      const otherRule = randomUUID();

      const newest = await seedApproval({
        actionType: 'LIMIT_RULE_CREATE',
        resourceType: 'LIMIT_RULE',
        resourceId: ruleId,
        status: PrivilegedActionApprovalStatus.CONSUMED,
      });
      await dataSource.query(
        'UPDATE privileged_action_approvals SET requested_at = NOW() WHERE id = $1',
        [newest],
      );
      const older = await seedApproval({
        actionType: 'LIMIT_RULE_CREATE',
        resourceType: 'LIMIT_RULE',
        resourceId: ruleId,
      });
      await dataSource.query(
        "UPDATE privileged_action_approvals SET requested_at = NOW() - interval '1 hour' WHERE id = $1",
        [older],
      );
      await seedApproval({
        actionType: 'LIMIT_RULE_CREATE',
        resourceType: 'LIMIT_RULE',
        resourceId: otherRule,
      });
      await seedApproval({
        actionType: 'LIMIT_RULE_UPDATE',
        resourceType: 'LIMIT_RULE',
        resourceId: ruleId,
      });

      const res = await request(app.getHttpServer())
        .get(`${HISTORY_PATH}?actionType=LIMIT_RULE_CREATE&resourceId=${ruleId}`)
        .set(auth(auditor.token));
      expect(res.status).toBe(200);
      expect(res.body.actionType).toBe('LIMIT_RULE_CREATE');
      expect(res.body.resourceType).toBe('LIMIT_RULE');
      expect(res.body.resourceId).toBe(ruleId);
      expect(res.body.entries.map((entry: any) => entry.approvalId)).toEqual([newest, older]);
      expect(res.body.entries[0]).toMatchObject({
        status: 'CONSUMED',
        executed: true,
      });
      expect(res.body.entries[1]).toMatchObject({ status: 'REQUESTED', executed: false });
      expect(typeof res.body.entries[1].expiresInMs).toBe('number');
      // No policy or fingerprint leakage.
      expect(res.body.entries[0]).not.toHaveProperty('policy');
      expect(res.body.entries[0]).not.toHaveProperty('actionFingerprint');
    });

    it('refuses an action type outside the commercial allowlist', async () => {
      const auditor = await provisionRole('FINANCE_AUDITOR');
      const res = await request(app.getHttpServer())
        .get(`${HISTORY_PATH}?actionType=AGENT_FUNDING_REQUEST&resourceId=${randomUUID()}`)
        .set(auth(auditor.token));
      expect(res.status).toBe(403);
    });

    it('enforces the action-specific read function rather than limit.view alone', async () => {
      // AGENT_NETWORK_MANAGER holds limit.view but NOT fee_rule.view.
      const agentManager = await provisionRole('AGENT_NETWORK_MANAGER');
      const res = await request(app.getHttpServer())
        .get(`${HISTORY_PATH}?actionType=FEE_RULE_CREATE&resourceId=${randomUUID()}`)
        .set(auth(agentManager.token));
      expect(res.status).toBe(403);
    });

    it('validates required query parameters and the limit bound', async () => {
      const auditor = await provisionRole('FINANCE_AUDITOR');
      const missingAction = await request(app.getHttpServer())
        .get(`${HISTORY_PATH}?resourceId=${randomUUID()}`)
        .set(auth(auditor.token));
      expect(missingAction.status).toBe(400);

      const missingResource = await request(app.getHttpServer())
        .get(`${HISTORY_PATH}?actionType=LIMIT_RULE_CREATE`)
        .set(auth(auditor.token));
      expect(missingResource.status).toBe(400);

      const oversized = await request(app.getHttpServer())
        .get(`${HISTORY_PATH}?actionType=LIMIT_RULE_CREATE&resourceId=${randomUUID()}&limit=500`)
        .set(auth(auditor.token));
      expect(oversized.status).toBe(400);

      const empty = await request(app.getHttpServer())
        .get(`${HISTORY_PATH}?actionType=LIMIT_RULE_CREATE&resourceId=${randomUUID()}`)
        .set(auth(auditor.token));
      expect(empty.status).toBe(200);
      expect(empty.body.entries).toEqual([]);
    });
  });
});
