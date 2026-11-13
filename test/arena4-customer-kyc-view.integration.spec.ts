import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';
import * as request from 'supertest';

import { CustomerKycViewService } from '../src/customer-app/customer-kyc-view.service';

import { AppModule } from '../src/app.module';
import {
  createIntegrationDataSource,
  destroyIntegrationDataSource,
  truncateAllTables,
} from './support/pg-harness';

/**
 * ARENA 4 — customer-facing KYC projection (`GET /customers/me/kyc`).
 *
 * Proves the read is self-only, that it never fabricates requirements when no policy is
 * configured, that it reports the approved policy's requirement shape when one is, and that it
 * states the truth about evidence assessment (the tier evidence reader has no confirmed provider
 * adapter, so the projection reports UNAVAILABLE instead of judging requirements unmet).
 */

const POLICY_DEFINITION = {
  regulatoryRequirementsConfirmed: true,
  effectiveFrom: '2026-01-01T00:00:00.000Z',
  effectiveUntil: null,
  regulatory: {
    LEVEL_1: { all: ['PHONE'], any: [['BVN', 'NIN']] },
    LEVEL_2: { all: ['PHONE', 'ADDRESS'], any: [['BVN'], ['NIN']] },
  },
  operator: {
    LEVEL_1: { all: [], any: [] },
    LEVEL_2: { all: ['UTILITY_BILL'], any: [] },
  },
};

describe('ARENA 4 customer KYC projection (real PostgreSQL)', () => {
  let dataSource: DataSource;
  let app: NestFastifyApplication;
  let view: CustomerKycViewService;

  beforeAll(async () => {
    dataSource = await createIntegrationDataSource('a4custkyc');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DataSource)
      .useValue(dataSource)
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }),
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    view = app.get(CustomerKycViewService);
  }, 180000);

  afterAll(async () => {
    if (app) await app.close().catch(() => undefined);
    if (dataSource)
      await destroyIntegrationDataSource(dataSource).catch(() =>
        dataSource.destroy().catch(() => undefined),
      );
  }, 60000);

  beforeEach(async () => {
    await truncateAllTables(dataSource);
  });

  /**
   * Seeds a customer row directly. A real `customer-api` session cannot be minted in this
   * environment: `AuthenticationSessionService.issue` runs the financial-eligibility gate, which
   * requires a confirmed *trusted evidence* reader (currently `null` by design) and an effective
   * financial policy. That is a documented backend dependency, so the projection is exercised
   * through its service against real PostgreSQL, and the HTTP surface is asserted for its
   * unauthenticated/foreign-token behaviour only.
   */
  async function createCustomer(
    opts: { kycLevel?: string; kycStatus?: string } = {},
  ): Promise<{ customerId: string }> {
    const rows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO customers (reference, customer_type, status, kyc_level, kyc_status)
       VALUES ($1,'INDIVIDUAL','ACTIVE',$2,$3) RETURNING id`,
      [`cust-a4kyc-${randomUUID()}`, opts.kycLevel ?? 'NONE', opts.kycStatus ?? 'NOT_STARTED'],
    );
    const customerId = rows[0]!.id;
    await dataSource.query(
      `INSERT INTO customer_profiles (customer_id, display_name, is_active) VALUES ($1,'KYC Customer',true)`,
      [customerId],
    );
    return { customerId };
  }

  async function publishPolicy(): Promise<number> {
    const proposalId = randomUUID();
    await dataSource.query(
      `INSERT INTO kyc_tier_policy_proposals
        (id, request_id, expected_version, definition, fingerprint, maker_id, maker_session_id, checker_id, checker_session_id, state, decided_at)
       VALUES ($1,$2,0,$3::jsonb,$4,'maker:a4','11111111-1111-4111-8111-111111111111','checker:a4','22222222-2222-4222-8222-222222222222','APPROVED',now())`,
      [proposalId, randomUUID(), JSON.stringify(POLICY_DEFINITION), 'a'.repeat(64)],
    );
    await dataSource.query(
      `INSERT INTO kyc_tier_policy_versions (version, proposal_id, definition, maker_id, checker_id)
       VALUES (1,$1,$2::jsonb,'maker:a4','checker:a4')`,
      [proposalId, JSON.stringify(POLICY_DEFINITION)],
    );
    // `truncateAllTables` removes the singleton head row created by the migration, so the head is
    // restored explicitly rather than relying on an UPDATE that would silently affect no rows.
    await dataSource.query(
      `INSERT INTO kyc_tier_policy_head (singleton, version) VALUES (true, 1)
       ON CONFLICT (singleton) DO UPDATE SET version=1`,
    );
    return 1;
  }

  it('rejects unauthenticated and foreign-token callers at the HTTP surface', async () => {
    await request(app.getHttpServer()).get('/api/v1/customers/me/kyc').expect(401);
    await request(app.getHttpServer())
      .get('/api/v1/customers/me/kyc')
      .set('Authorization', 'Bearer not-a-customer-token')
      .expect(401);
  });

  it('reports "policy not configured" rather than inventing requirements', async () => {
    const { customerId } = await createCustomer();
    const projection = await view.view(customerId);
    expect(projection).toEqual(
      expect.objectContaining({
        customerId,
        kycLevel: 'NONE',
        kycStatus: 'NOT_STARTED',
        requirements: null,
        policy: { configured: false, version: null },
        upgradePathway: { status: 'POLICY_NOT_CONFIGURED', nextLevel: 'LEVEL_1' },
      }),
    );
    expect(projection.evidenceAssessment.status).toBe('UNAVAILABLE');
    expect(projection.assessment).toBeNull();
    expect(projection.lastEvaluation).toBeNull();
    const serial = JSON.stringify(projection).toLowerCase();
    expect(serial).not.toContain('password');
    expect(serial).not.toContain('maker:');
    expect(serial).not.toContain('checker:');
  });

  it('returns the approved policy requirement shape for the next tier without judging evidence', async () => {
    const version = await publishPolicy();
    const { customerId } = await createCustomer();
    const projection = await view.view(customerId);
    expect(projection.policy).toEqual({ configured: true, version });
    expect(projection.requirements).toEqual({
      level: 'LEVEL_1',
      regulatory: POLICY_DEFINITION.regulatory.LEVEL_1,
      operator: POLICY_DEFINITION.operator.LEVEL_1,
    });
    expect(projection.upgradePathway).toEqual({
      status: 'EVIDENCE_UNAVAILABLE',
      nextLevel: 'LEVEL_1',
    });
    expect(projection.evidenceAssessment.reason).toBe('TRUSTED_EVIDENCE_UNAVAILABLE');
    // No thresholds, no mislabelled rejection: the projection never says a requirement failed.
    expect(JSON.stringify(projection)).not.toMatch(/unmet|failed|rejected/i);
  });

  it('offers no managed upgrade path for LEVEL_2 and reports a manual hold', async () => {
    await publishPolicy();
    const top = await createCustomer({ kycLevel: 'LEVEL_2', kycStatus: 'APPROVED' });
    const topProjection = await view.view(top.customerId);
    expect(topProjection.upgradePathway).toEqual({ status: 'TOP_TIER', nextLevel: null });
    expect(topProjection.requirements).toBeNull();

    const held = await createCustomer({ kycLevel: 'LEVEL_1', kycStatus: 'APPROVED' });
    await dataSource.query(
      `INSERT INTO kyc_tier_manual_holds (customer_id, actor, reason) VALUES ($1,'workforce:a4','MANUAL_REVIEW')`,
      [held.customerId],
    );
    const heldProjection = await view.view(held.customerId);
    expect(heldProjection.upgradePathway).toEqual({
      status: 'MANUAL_REVIEW',
      nextLevel: 'LEVEL_2',
    });
    expect(heldProjection.manualHold?.reason).toBe('MANUAL_REVIEW');
  });

  it('surfaces the current assessment and last evaluation, and stays per-customer', async () => {
    const first = await createCustomer({ kycLevel: 'LEVEL_1', kycStatus: 'APPROVED' });
    await dataSource.query(
      `INSERT INTO customer_kyc_assessments
        (id, customer_id, kyc_level, kyc_status, reason, assessed_by, is_current, expires_at)
       VALUES ($1,$2,'LEVEL_1','APPROVED','LEGACY_IMPORT','workforce:a4',true,NULL)`,
      [randomUUID(), first.customerId],
    );
    await dataSource.query(
      `INSERT INTO kyc_tier_evaluations
        (id, customer_id, revision, policy_version, outcome, reason, old_level, new_level, evidence_ids, actor)
       VALUES ($1,$2,1,NULL,'NO_CHANGE','TRUSTED_EVIDENCE_UNAVAILABLE','LEVEL_1','LEVEL_1','{}','workforce:a4')`,
      [randomUUID(), first.customerId],
    );
    const firstProjection = await view.view(first.customerId);
    expect(firstProjection.assessment).toEqual({
      level: 'LEVEL_1',
      status: 'APPROVED',
      reason: 'LEGACY_IMPORT',
      expiresAt: null,
    });
    expect(firstProjection.lastEvaluation).toEqual(
      expect.objectContaining({
        outcome: 'NO_CHANGE',
        reason: 'TRUSTED_EVIDENCE_UNAVAILABLE',
        newLevel: 'LEVEL_1',
      }),
    );

    const second = await createCustomer();
    const secondProjection = await view.view(second.customerId);
    expect(secondProjection.customerId).toBe(second.customerId);
    expect(secondProjection.assessment).toBeNull();
    expect(secondProjection.lastEvaluation).toBeNull();
    expect(secondProjection.kycLevel).toBe('NONE');
    await expect(view.view('11111111-1111-4111-8111-11111111111f')).rejects.toThrow();
  });
});
