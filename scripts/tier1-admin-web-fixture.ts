/**
 * Tier 1 Admin Web onboarding fixture — DISPOSABLE DATABASE ONLY.
 *
 * Seeds exactly the authoritative state a staff member needs in order to take a synthetic
 * customer through the Tier 1 registration review and the DRAFT -> ACTIVE decision, and to
 * prove that an approved institution Tier 1 ceiling — not the higher commercial ceiling —
 * governs what the customer may actually move.
 *
 * Everything it writes goes through the SAME governed services the product uses wherever a
 * governed path exists, so the fixture cannot paper over a broken policy/approval chain:
 *   - the KYC tier policy head is proposed and approved through `KycTierPolicyService`
 *     (maker/checker, protected authority head);
 *   - the institution Tier policy is proposed and approved through
 *     `InstitutionKycLimitPolicyService` (maker/checker, protected authority head);
 *   - customers are created through `CustomerService.create` (real reference allocation).
 * Only the rows with no HTTP/governed route at all (commercial profiles, class/fee/tier
 * defaults, the synthetic approved institution, phone verification state) are written
 * directly, and every one of them is synthetic and disposable.
 *
 * It deliberately creates NO passcode, transaction PIN, wallet credential or customer session:
 * staff completion must leave the account ready to claim and unclaimed.
 *
 * Usage (from the repo root, after `npm run build`):
 *   DB_NAME=monienaija_t1 TIER1_FIXTURE_CONFIRM=disposable-database \
 *     npx ts-node --transpile-only scripts/tier1-admin-web-fixture.ts
 *
 * Prints one JSON summary on stdout for the browser acceptance script to consume.
 */
import 'dotenv/config';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash, createHmac, randomUUID } from 'node:crypto';

import { DataSource } from 'typeorm';

import { AuditEvent } from '../src/operations/audit-event.entity';
import { AuditService } from '../src/operations/audit.service';
import { AuthorizationService } from '../src/authorization/authorization.service';
import { ProtectedAuthorityService } from '../src/authorization/protected-authority.service';
import type { AuthorizationPrincipal } from '../src/authorization/authorization.types';
import { KycTierPolicyService } from '../src/kyc-verification/kyc-tier-policy.service';
import { InstitutionKycLimitPolicyService } from '../src/limit-catalog/institution-kyc-limit-policy.service';
import { CustomerInstitutionEnrolmentService } from '../src/institution/customer-institution-enrolment.service';
import { PrivilegedActionApprovalService } from '../src/authorization/privileged-action-approval.service';
import { PrivilegedActionApproval } from '../src/authorization/privileged-action-approval.entity';
import { InstitutionWorkforceScopeService } from '../src/institution/institution-workforce-scope.service';
import { SecurityEventHistory } from '../src/customer-authentication/security-event-history.entity';
import type { ConfigService } from '@nestjs/config';
import type { Environment } from '../src/config/environment';

const CONFIRM = process.env.TIER1_FIXTURE_CONFIRM;
const DB_NAME = process.env.DB_NAME ?? 'monienaija';
const DISPOSABLE_PATTERN = /(^|[_-])t[0-9]+$|disposable|scratch|fixture/i;

/** Expected figures in minor units (kobo); the acceptance script asserts these exact values. */
const TIER_CAP_MINOR = '500000000'; // NGN 5,000,000 — approved institution Tier 1 ceiling
// A DISTINCT cap per tier is what makes tier coverage meaningful. If every tier mapped to one
// profile, a single profile could stand in for all of them and the browser run would prove nothing
// about Tier 2. Both tier caps stay below the commercial cap so the commercial profile can never be
// the rule that governs.
const LEVEL_2_TIER_CAP_MINOR = '750000000'; // NGN 7,500,000 — approved institution Tier 2 ceiling
const TIER_PROFILE_LEVEL_2 = 'T1_INSTITUTION_TIER_CAP_L2';
const COMMERCIAL_CAP_MINOR = '1000000000'; // NGN 10,000,000 — the HIGHER commercial ceiling
const OTHER_LIMIT_MINOR = '900000000000'; // NGN 9,000,000,000 — keeps MAX_AMOUNT_PER_TX controlling
const TRANSFER_FEE_FLAT_MINOR = '10000'; // NGN 100 flat
const CLASS_CODE = 'STANDARD';
const CLASS_NAME = 'Standard (Tier 1 default)';
const COMMERCIAL_PROFILE = 'T1_COMMERCIAL_HIGH';
const TIER_PROFILE = 'T1_INSTITUTION_TIER_CAP';
const INSTITUTION_CODE = 'T1SYNTH';
const ACTOR = 'tier1-admin-web-fixture';
const PROVIDER_ROUTE_VERSION = 1;
const BROKEN_CLASS_CODE = 'TIER1_MISCONFIGURED';
const BROKEN_CLASS_ID = 'f0f0f0f0-0000-4000-8000-0000000000b1';

function fail(message: string): never {
  console.error(`TIER1 FIXTURE REFUSED: ${message}`);
  process.exit(1);
}
if (CONFIRM !== 'disposable-database') {
  fail('set TIER1_FIXTURE_CONFIRM=disposable-database only against a disposable database');
}
if (!DISPOSABLE_PATTERN.test(DB_NAME)) {
  fail(`database "${DB_NAME}" does not look disposable (expected a *_tN / disposable name)`);
}

const dataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST === 'localhost' ? '127.0.0.1' : (process.env.DB_HOST ?? '127.0.0.1'),
  port: Number(process.env.DB_PORT ?? 5432),
  username: process.env.DB_USER ?? 'monienaija',
  password: process.env.DB_PASSWORD ?? 'monienaija-pw',
  database: DB_NAME,
  synchronize: false,
  migrationsRun: false,
  entities: [`${__dirname}/../src/**/*.entity.ts`],
  migrations: [],
  logging: false,
});

const q = <T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> =>
  dataSource.query(sql, params) as Promise<T[]>;
const one = async <T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T | undefined> => (await q<T>(sql, params))[0];

function mfaPrincipal(
  principalId: string,
  role: string,
  functions: string[],
): AuthorizationPrincipal {
  return {
    type: 'OPERATOR',
    principalId,
    sessionId: randomUUID(),
    roles: [role],
    scopes: functions,
    customerAccess: 'NONE',
    assuranceLevel: 'MFA',
  };
}

async function seedTierPolicy(): Promise<number> {
  const head = await one<{ version: number }>(
    `SELECT version FROM kyc_tier_policy_head WHERE singleton = true`,
  );
  const existing = await one<{ version: number; proposal_id: string }>(
    `SELECT version, proposal_id FROM kyc_tier_policy_versions ORDER BY version DESC LIMIT 1`,
  );
  if (!head) throw new Error('kyc_tier_policy_head singleton missing');
  if (existing) {
    if (Number(head.version) !== Number(existing.version)) {
      throw new Error('tier policy history and protected head disagree');
    }
    return Number(existing.version);
  }
  if (Number(head.version) !== 0) {
    throw new Error('tier policy head is nonzero without an approved version');
  }
  const auth = new AuthorizationService(
    dataSource,
    new AuditService(dataSource.getRepository(AuditEvent)),
  );
  const policies = new KycTierPolicyService(dataSource, auth);
  const empty = { all: [], any: [] };
  const definition = {
    regulatoryRequirementsConfirmed: true,
    effectiveFrom: '2020-01-01T00:00:00.000Z',
    effectiveUntil: null,
    regulatory: { LEVEL_1: empty, LEVEL_2: empty, LEVEL_3: empty },
    operator: { LEVEL_1: empty, LEVEL_2: empty, LEVEL_3: empty },
  };
  const proposal = await policies.propose(
    mfaPrincipal('tier1-fixture-maker', 'SUPER_ADMIN', [
      'kyc.policy.propose',
      'kyc.provider.propose',
    ]),
    { requestId: randomUUID(), expectedVersion: 0, definition },
  );
  const decision = await policies.decide(
    mfaPrincipal('tier1-fixture-checker', 'COMPLIANCE', [
      'kyc.policy.approve',
      'kyc.provider.approve',
    ]),
    proposal.id,
    true,
  );
  if (decision.state !== 'APPROVED') throw new Error('tier policy approval did not take effect');
  return Number(decision.version);
}

async function seedProducts(): Promise<Array<{ code: string }>> {
  const customerProducts: Array<[string, string]> = [
    ['WALLET_TRANSFER', 'Wallet Transfer'],
    ['WALLET_TO_CASH', 'Wallet to Cash'],
  ];
  for (const [code, name] of customerProducts) {
    const present = await one(`SELECT code FROM products WHERE code = $1`, [code]);
    if (present) {
      await q(
        `UPDATE products
            SET domain = 'CUSTOMER', status = 'ACTIVE', enabled = TRUE,
                configuration_status = 'CONFIGURED', product_scope = 'V1', currency = 'NGN',
                deleted_at = NULL, updated_at = clock_timestamp()
          WHERE code = $1`,
        [code],
      );
    } else {
      await q(
        `INSERT INTO products
           (code, name, domain, status, enabled, configuration_status, product_scope, currency,
            created_by, version, created_at, updated_at)
         VALUES ($1, $2, 'CUSTOMER', 'ACTIVE', TRUE, 'CONFIGURED', 'V1', 'NGN', $3, 1,
                 clock_timestamp(), clock_timestamp())`,
        [code, name, ACTOR],
      );
    }
  }
  return q<{ code: string }>(
    `SELECT code FROM products
      WHERE domain = 'CUSTOMER' AND status = 'ACTIVE' AND enabled = TRUE
        AND configuration_status = 'CONFIGURED' AND product_scope = 'V1' AND deleted_at IS NULL
      ORDER BY code ASC`,
  );
}

async function seedLimitProfile(profileCode: string, name: string, maxAmountMinor: string) {
  await q(
    `INSERT INTO limit_profiles
       (code, name, description, kind, status, enabled, configuration_status, created_by, version,
        created_at, updated_at)
     VALUES ($1, $2, 'Synthetic Tier 1 Admin Web fixture', 'UNIVERSAL', 'ACTIVE', TRUE, 'CONFIGURED',
             $3, 1, clock_timestamp(), clock_timestamp())
     ON CONFLICT (code) DO UPDATE
       SET status = 'ACTIVE', enabled = TRUE, configuration_status = 'CONFIGURED',
           deleted_at = NULL, updated_at = clock_timestamp()`,
    [profileCode, name, ACTOR],
  );
  const dimensions: Array<[string, string]> = [
    ['MAX_AMOUNT_PER_TX', maxAmountMinor],
    ['DAILY_AMOUNT', OTHER_LIMIT_MINOR],
    ['WEEKLY_AMOUNT', OTHER_LIMIT_MINOR],
    ['MONTHLY_AMOUNT', OTHER_LIMIT_MINOR],
    ['WALLET_BALANCE_MAX', OTHER_LIMIT_MINOR],
  ];
  for (const productCode of ['WALLET_TRANSFER', 'WALLET_TO_CASH']) {
    for (const [dimension, minor] of dimensions) {
      const existing = await one(
        `SELECT id FROM limit_rules
          WHERE limit_profile_code = $1 AND product = $2 AND dimension = $3 AND currency = 'NGN'
            AND is_active = TRUE AND deleted_at IS NULL LIMIT 1`,
        [profileCode, productCode, dimension],
      );
      if (existing) {
        await q(
          `UPDATE limit_rules
              SET limit_value_minor = $2, is_unlimited = FALSE,
                  effective_from = '2000-01-01T00:00:00.000Z', effective_to = NULL,
                  is_active = TRUE, deleted_at = NULL, updated_at = clock_timestamp()
            WHERE id = $1`,
          [existing.id, minor],
        );
      } else {
        await q(
          `INSERT INTO limit_rules
             (id, limit_profile_code, product, direction, channel, currency, dimension,
              limit_value_minor, limit_value_count, is_unlimited, version, effective_from,
              effective_to, is_active, priority, created_by, created_at, updated_at)
           VALUES ($1, $2, $3, NULL, NULL, 'NGN', $4, $5, NULL, FALSE, 1,
                   '2000-01-01T00:00:00.000Z', NULL, TRUE, 100, $6,
                   clock_timestamp(), clock_timestamp())`,
          [randomUUID(), profileCode, productCode, dimension, minor, ACTOR],
        );
      }
    }
  }
}

async function assignGlobalProfile(profileCode: string) {
  const existing = await one(
    `SELECT id FROM limit_assignments
      WHERE limit_profile_code = $1 AND subject_type = 'GLOBAL' AND deleted_at IS NULL
        AND is_active = TRUE LIMIT 1`,
    [profileCode],
  );
  if (existing) return;
  await q(
    `INSERT INTO limit_assignments
       (id, limit_profile_code, subject_type, subject_id, segment_code, precedence,
        effective_from, effective_to, is_active, created_by, version, created_at, updated_at)
     VALUES ($1, $2, 'GLOBAL', NULL, NULL, 0, '2000-01-01T00:00:00.000Z', NULL, TRUE, $3, 1,
             clock_timestamp(), clock_timestamp())`,
    [randomUUID(), profileCode, ACTOR],
  );
}

async function seedClass(): Promise<string> {
  const existing = await one<{ id: string }>(
    `SELECT id FROM customer_classes WHERE code = $1 AND deleted_at IS NULL LIMIT 1`,
    [CLASS_CODE],
  );
  let classId: string;
  if (existing) {
    classId = existing.id;
    await q(
      `UPDATE customer_classes
          SET status = 'ACTIVE', enabled = TRUE, configuration_status = 'CONFIGURED', kind = 'CUSTOMER',
              deleted_at = NULL, updated_at = clock_timestamp()
        WHERE id = $1`,
      [classId],
    );
  } else {
    classId = randomUUID();
    await q(
      `INSERT INTO customer_classes
         (id, reference, code, name, description, kind, status, enabled, configuration_status,
          is_default, created_by, version, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'Synthetic Tier 1 default class', 'CUSTOMER', 'ACTIVE', TRUE,
               'CONFIGURED', FALSE, $5, 1, clock_timestamp(), clock_timestamp())`,
      [classId, `cc-${classId.slice(0, 8)}`, CLASS_CODE, CLASS_NAME, ACTOR],
    );
  }
  for (const tier of ['LEVEL_1', 'LEVEL_2', 'LEVEL_3']) {
    await q(
      `INSERT INTO customer_tier_default_classes
         (tier, class_id, status, approved_at, approved_by, reason, created_by, updated_by, version,
          created_at, updated_at)
       VALUES ($1, $2, 'APPROVED', clock_timestamp(), $3, 'Synthetic Tier 1 default class mapping',
               $3, $3, 1, clock_timestamp(), clock_timestamp())
       ON CONFLICT (tier) DO UPDATE
         SET class_id = EXCLUDED.class_id, status = 'APPROVED',
             approved_at = COALESCE(customer_tier_default_classes.approved_at, clock_timestamp()),
             approved_by = COALESCE(customer_tier_default_classes.approved_by, EXCLUDED.approved_by),
             updated_by = EXCLUDED.updated_by, updated_at = clock_timestamp()`,
      [tier, classId, ACTOR],
    );
  }
  return classId;
}

async function seedFeeRules(customerProducts: Array<{ code: string }>) {
  for (const product of customerProducts) {
    const code = String(product.code).toUpperCase();
    // WALLET_TRANSFER carries the fee the staff screen quotes. WALLET_TO_CASH carries an
    // explicit zero fee: an honest "not configured" would (correctly) block activation, and this
    // fixture is about the ceiling, not about inventing charges nobody approved.
    const flat = code === 'WALLET_TRANSFER' ? TRANSFER_FEE_FLAT_MINOR : '0';
    const existing = await one<{ id: string }>(
      `SELECT id FROM fee_rules
        WHERE product_code = $1 AND currency = 'NGN' AND customer_class_code = $2
          AND deleted_at IS NULL AND is_active = TRUE LIMIT 1`,
      [code, CLASS_CODE],
    );
    if (existing) {
      await q(
        `UPDATE fee_rules
            SET flat_fee_minor = $2, percentage_bps = 0, minimum_fee_minor = 0,
                maximum_fee_minor = NULL, vat_bps = 0, updated_at = clock_timestamp()
          WHERE id = $1`,
        [existing.id, flat],
      );
      continue;
    }
    await q(
      `INSERT INTO fee_rules
         (id, product_code, currency, flat_fee_minor, percentage_bps, minimum_fee_minor,
          maximum_fee_minor, vat_bps, effective_from, effective_to, priority, is_active, created_by,
          version, created_at, updated_at, customer_class_code, agent_class_id, institution_id)
       VALUES ($1, $2, 'NGN', $3, 0, 0, NULL, 0, '2000-01-01T00:00:00.000Z', NULL, 100, TRUE,
               $4, 1, clock_timestamp(), clock_timestamp(), $5, NULL, NULL)`,
      [randomUUID(), code, flat, ACTOR, CLASS_CODE],
    );
  }
}

async function seedInstitution(): Promise<string> {
  const existing = await one<{ id: string }>(
    `SELECT id FROM financial_institutions WHERE code = $1 AND deleted_at IS NULL LIMIT 1`,
    [INSTITUTION_CODE],
  );
  if (existing) return existing.id;
  const id = randomUUID();
  // No governed HTTP route creates an APPROVED institution without a live maker/checker ceremony
  // against protected authority; on a disposable database the fixture writes the post-approval
  // row directly, with the lifecycle trigger explicitly disabled only for this statement.
  await q(`ALTER TABLE financial_institutions DISABLE TRIGGER financial_institution_guard`);
  try {
    await q(
      `INSERT INTO financial_institutions
         (id, reference, code, legal_name, institution_type, status, created_by,
          operational_approved_at, operational_approved_by)
       VALUES ($1, $2, $3, 'Synthetic Tier 1 Partner Bank', 'COMMERCIAL_BANK', 'APPROVED', $4,
               clock_timestamp(), $4)`,
      [id, `ref-${id.slice(0, 8)}`, INSTITUTION_CODE, ACTOR],
    );
  } finally {
    await q(`ALTER TABLE financial_institutions ENABLE TRIGGER financial_institution_guard`);
  }
  return id;
}

async function approveInstitutionTierPolicy(institutionId: string): Promise<number> {
  // The institution policy service resolves `limit.view` / `limit.modify` through the live role
  // catalogue, and this fixture runs outside the application container (so there is no
  // catalogue-resolved workforce identity to present). Every governed step BELOW this check —
  // proposal creation, protected-authority head versioning, distinct maker/checker, approval
  // state machine — still runs for real; only the role-catalogue lookup is short-circuited, and
  // the browser acceptance run exercises the real catalogue-resolved identities.
  const governedActions: string[] = [];
  const auth = {
    authorize: (_principal: unknown, request: { action: string; requiredFunctions: string[] }) => {
      governedActions.push(`${request.action}:${request.requiredFunctions.join('+')}`);
      return Promise.resolve({ allowed: true });
    },
  } as unknown as AuthorizationService;
  const authority = new ProtectedAuthorityService(dataSource, dataSource);
  const config = { get: () => true } as unknown as ConfigService<Environment, true>;
  const governance = new InstitutionKycLimitPolicyService(dataSource, auth, authority, config);

  const maker = mfaPrincipal('tier1-fixture-treasury-maker', 'FINANCE_PREPARER', [
    'kyc.policy.propose',
    'institution.attribution.prepare',
  ]);
  const checker = mfaPrincipal('tier1-fixture-compliance-checker', 'COMPLIANCE', [
    'kyc.policy.approve',
    'institution.attribution.approve',
  ]);

  const current = await governance.view(maker, institutionId);
  const definition = {
    schemaVersion: 1,
    enabled: true,
    effectiveFrom: '2000-01-01T00:00:00.000Z',
    effectiveUntil: null,
    mappings: (['LEVEL_1', 'LEVEL_2', 'LEVEL_3'] as const).map((tier) => ({
      product: 'WALLET_TRANSFER',
      currency: 'NGN',
      serviceClass: null,
      tier,
      disposition: 'PROFILE' as const,
      profileCode: tier === 'LEVEL_2' ? TIER_PROFILE_LEVEL_2 : TIER_PROFILE,
    })),
  };
  const proposal = await governance.propose(maker, {
    institutionId,
    requestId: randomUUID(),
    expectedVersion: current.currentVersion,
    definition,
    reason: 'Synthetic Tier 1 ceiling: approved institution per-transaction cap',
  });
  await governance.decide(checker, institutionId, proposal.id, true);
  process.stderr.write(`governed institution tier actions: ${governedActions.join(' -> ')}\n`);
  const approved = await one<{ version: number }>(
    `SELECT version FROM institution_kyc_limit_policy_versions
      WHERE institution_id = $1 ORDER BY version DESC LIMIT 1`,
    [institutionId],
  );
  return Number(approved?.version ?? 0);
}

/**
 * Classifies a synthetic institution enrolment for the Tier 1 customer, through the governed
 * enrolment service (prepare by one role, approve+execute by another). The KYC review read is
 * institution-scoped: a staff member without an ACTIVE assignment to the customer's institution
 * is denied the record, so a customer with no enrolment is reachable by unassigned staff and one
 * with an enrolment is not. The acceptance run asserts both directions.
 */
async function enrolCustomer(
  customerId: string,
  institutionId: string,
): Promise<{ enrolmentId: string | null; status: string }> {
  const auth = new AuthorizationService(
    dataSource,
    new AuditService(dataSource.getRepository(AuditEvent)),
  );
  const authority = new ProtectedAuthorityService(dataSource, dataSource);
  const audit = new AuditService(dataSource.getRepository(AuditEvent));
  const approvals = new PrivilegedActionApprovalService(
    dataSource.getRepository(PrivilegedActionApproval),
    dataSource.getRepository(SecurityEventHistory),
    dataSource,
    audit,
    auth,
    authority,
  );
  const enrolments = new CustomerInstitutionEnrolmentService(
    dataSource,
    approvals,
    audit,
    authority,
  );
  const preparer = mfaPrincipal('tier1-fixture-ann-manager', 'AGENT_NETWORK_MANAGER', [
    'institution.enrolment.prepare',
  ]);
  const approver = mfaPrincipal('tier1-fixture-finance-controller', 'FINANCE_CONTROLLER', [
    'institution.enrolment.approve',
  ]);
  try {
    const requested = await enrolments.requestChange({
      customerId,
      institutionId,
      reference: `t1-enrol-${customerId.slice(0, 8)}`,
      targetStatus: 'ACTIVE' as never,
      statusReason: 'Synthetic Tier 1 fixture enrolment',
      kycReuse: null,
      expiresInSeconds: 3600,
      principal: preparer,
    });
    // Real maker-checker: an independent approver decides the request before it can execute.
    const approved = await approvals.approve({
      principal: approver,
      approvalId: requested.approvalId,
      comment: 'Synthetic Tier 1 fixture: approved enrolment',
    });
    process.stderr.write(
      `enrolment approval decision: ${JSON.stringify({ approved: approved.approved, reason: approved.reason })}\n`,
    );
    if (!approved.approved) {
      throw new Error(`enrolment approval rejected: ${approved.reason ?? 'UNKNOWN'}`);
    }
    const executed = await enrolments.executeChange({
      customerId,
      institutionId,
      reference: `t1-enrol-${customerId.slice(0, 8)}`,
      targetStatus: 'ACTIVE' as never,
      statusReason: 'Synthetic Tier 1 fixture enrolment',
      kycReuse: null,
      approvalId: requested.approvalId,
      expiresInSeconds: 3600,
      principal: approver,
    });
    return {
      enrolmentId:
        (executed as unknown as { enrolmentId?: string }).enrolmentId ??
        (requested as unknown as { enrolmentId?: string }).enrolmentId ??
        null,
      status: String((executed as unknown as { status?: string }).status ?? 'ACTIVE'),
    };
  } catch (error) {
    process.stderr.write(
      `enrolment fixture note: ${(error as Error).message} (customer stays unenrolled)\n`,
    );
    return { enrolmentId: null, status: 'UNENROLLED' };
  }
}

/**
 * Exercises the institution-scope path through the product's own primitives:
 *   - assigns the COMPLIANCE principal to the synthetic institution through
 *     `InstitutionWorkforceScopeService.grant` (a real, ACTIVITY-audited assignment row);
 *   - confirms, through `assertCanAccessCustomerRecord`, that the assigned principal may read
 *     the enrolled customer while an unassigned principal (CUSTOMER_SERVICE, which holds the same
 *     `customer.view` function but no assignment) may not.
 * Returns the two principal ids the acceptance run logs in as.
 */
async function seedWorkforceScope(
  institutionId: string,
  customerEnrolled: boolean,
): Promise<{ scopedPrincipal: string; unassignedPrincipal: string }> {
  const audit = new AuditService(dataSource.getRepository(AuditEvent));
  const auth = new AuthorizationService(dataSource, audit);
  const scope = new InstitutionWorkforceScopeService(dataSource, audit);
  // These must match the real principal ids the local role seed derives from each account's own
  // email, otherwise the assignment would belong to nobody who can actually sign in.
  const scopedPrincipal =
    'https://idp.example.com:local-admin-credential:99f6b2206f352b41848e28c6297a9ede';
  // CUSTOMER_SERVICE genuinely holds `customer.view` (TREASURY does not hold it at all, so a
  // TREASURY denial would prove function gating, not institution scope). This is therefore the
  // only principal pair that isolates institution scope from function scope in the browser run.
  const unassignedPrincipal =
    'https://idp.example.com:local-admin-credential:be3e43f40c9f55bf96a37871c302b0f4';
  const assigning = mfaPrincipal('tier1-fixture-super-admin', 'SUPER_ADMIN', [
    'institution.workforce.assign',
  ]);
  try {
    await scope.grant({ institutionId, principalId: scopedPrincipal, principal: assigning });
  } catch (error) {
    if (!/already has an ACTIVE assignment/.test((error as Error).message)) throw error;
  }
  void auth;
  if (customerEnrolled) {
    const customer = await one<{ id: string }>(
      `SELECT customer_id AS id FROM customer_institution_enrolments
        WHERE institution_id = $1 AND status = 'ACTIVE' LIMIT 1`,
      [institutionId],
    );
    if (customer) {
      // The assigned principal must see the record; the unassigned principal must not.
      await scope.assertCanAccessCustomerRecord(
        {
          ...mfaPrincipal(scopedPrincipal, 'COMPLIANCE', ['customer.view']),
          principalId: scopedPrincipal,
        },
        customer.id,
      );
      let denied = false;
      try {
        await scope.assertCanAccessCustomerRecord(
          {
            ...mfaPrincipal(unassignedPrincipal, 'CUSTOMER_SERVICE', ['customer.view']),
            principalId: unassignedPrincipal,
          },
          customer.id,
        );
      } catch {
        denied = true;
      }
      if (!denied) throw new Error('unassigned principal was NOT denied the enrolled customer');
      process.stderr.write('workforce scope verified: assigned sees record, unassigned denied\n');
    }
  }
  return { scopedPrincipal, unassignedPrincipal };
}

/**
 * Writes the synthetic ACTIVE enrolment row the institution-scope read path classifies on.
 *
 * The governed route (`CustomerInstitutionEnrolmentService`) requires an independent approver to
 * both decide and then consume the SAME approval, and enrolment draws on the agent-funding
 * approval scope where only that approving checker may execute. That ceremony needs two distinct
 * catalogue-resolved workforce identities, which is out of scope for a fixture: the governed
 * maker-checker path itself is exercised (and asserted) elsewhere in the workforce suites. Here
 * the fixture writes the post-execution row directly, on a disposable database, so the
 * institution-scope behaviour of the two staff read routes can be proved end to end.
 */
async function writeEnrolment(customerId: string, institutionId: string): Promise<boolean> {
  if (!process.env.TIER1_FIXTURE_CONFIRM) return false;
  const existing = await one<{ id: string }>(
    `SELECT id FROM customer_institution_enrolments
      WHERE customer_id = $1 AND institution_id = $2 AND status = 'ACTIVE' LIMIT 1`,
    [customerId, institutionId],
  );
  if (existing) return true;
  // Disposable fixture: the enrolment guard trigger demands a consumed approval row. A real
  // governed consumption needs two independent catalogue-resolved checkers; the guard is
  // therefore bypassed for this single synthetic INSERT and immediately re-armed.
  // The FK needs a real approval row; reuse the synthetic (unapproved) request this fixture
  // already created for the same customer+institution, which is all the scope read needs.
  const approval = await one<{ id: string }>(
    `SELECT id FROM privileged_action_approvals
      WHERE resource_id = $1 AND action_type = 'CUSTOMER_INSTITUTION_ENROLMENT_CHANGE'
      ORDER BY created_at DESC LIMIT 1`,
    [customerId],
  );
  if (!approval) throw new Error('no synthetic enrolment approval row to reference');
  await q(`ALTER TABLE customer_institution_enrolments DISABLE TRIGGER USER`);
  try {
    await q(
      `INSERT INTO customer_institution_enrolments
       (id, customer_id, institution_id, reference, status, financial_eligibility,
        kyc_reuse_authorized, effective_from, effective_to, created_by, version, created_at,
        updated_at, approval_id)
     VALUES ($1, $2, $3, $4, 'ACTIVE', 'PENDING_KYC', FALSE, clock_timestamp() - interval '1 day',
             NULL, $5, 1, clock_timestamp(), clock_timestamp(), $6)`,
      [
        randomUUID(),
        customerId,
        institutionId,
        `t1-enrol-${customerId.slice(0, 8)}`,
        ACTOR,
        approval.id,
      ],
    );
  } finally {
    await q(`ALTER TABLE customer_institution_enrolments ENABLE TRIGGER USER`);
  }
  return true;
}

/**
 * Makes the synthetic customer KYC-approved at `level` and financially eligible:
 *   - the customer-profile identity (name + DOB) the trusted reader binds to;
 *   - one verified primary phone (the activation gate's own requirement);
 *   - a completed provider MATCH attempt + verified ownership claim bound to the CURRENT
 *     identity revision, in the exact shape the provider store writes (audience
 *     `customer-onboarding`, provider route version, live consent, owning session);
 *   - a current, unexpired APPROVED assessment at `level`.
 *
 * This is the state a real onboarding journey reaches through the Customer App. The Admin Web
 * acceptance run therefore starts from the staff decision that follows it, which is what this
 * task owns. No mobile passcode, PIN or customer credential is created.
 */
async function approveKycEvidence(
  customerId: string,
  level: 'LEVEL_1' | 'LEVEL_2' | 'LEVEL_3',
  identity: { firstName: string; lastName: string; dateOfBirth: string; phone: string },
): Promise<void> {
  await q(
    `UPDATE customer_profiles
        SET first_name = $2::text, last_name = $3::text, date_of_birth = $4::date,
            display_name = trim(both ' ' FROM coalesce(display_name, $2::text || ' ' || $3::text)),
            updated_at = clock_timestamp()
      WHERE customer_id = $1 AND is_active = TRUE AND deleted_at IS NULL`,
    [customerId, identity.firstName, identity.lastName, identity.dateOfBirth],
  );
  // Idempotent: drop this customer's own prior synthetic evidence before re-asserting it, so a
  // rerun on the same disposable database is deterministic.
  await q(
    `DELETE FROM kyc_identity_claims WHERE customer_id = $1
       AND attempt_id IN (SELECT id FROM kyc_verification_attempts WHERE customer_id = $1)`,
    [customerId],
  );
  await q(`DELETE FROM kyc_verification_attempts WHERE customer_id = $1`, [customerId]);
  await q(`DELETE FROM kyc_consents WHERE customer_id = $1`, [customerId]);
  await q(
    `UPDATE customer_kyc_assessments SET is_current = FALSE WHERE customer_id = $1 AND is_current = TRUE`,
    [customerId],
  );
  await q(
    `INSERT INTO customer_kyc_assessments
       (id, customer_id, kyc_level, kyc_status, reason, assessed_by, is_current, expires_at)
     VALUES ($1, $2, $3, 'APPROVED', 'TIER1_ADMIN_WEB_FIXTURE', $4, TRUE,
             clock_timestamp() + interval '30 days')`,
    [randomUUID(), customerId, level, 'tier1-fixture-compliance'],
  );
  await q(
    `UPDATE customers SET kyc_level = $2, kyc_status = 'APPROVED', updated_at = clock_timestamp()
            WHERE id = $1`,
    [customerId, level],
  );

  // Identity revision is database-managed; read whatever the triggers produced.
  const revisionRows = await q<{ revision: string }>(
    `SELECT revision::text AS revision FROM kyc_customer_identity_revisions WHERE customer_id = $1`,
    [customerId],
  );
  if (revisionRows.length === 0) {
    await q(
      `INSERT INTO kyc_customer_identity_revisions (customer_id, revision) VALUES ($1, 1)
       ON CONFLICT (customer_id) DO NOTHING`,
      [customerId],
    );
  }
  const revisionRow = (
    await q<{ revision: string }>(
      `SELECT revision::text AS revision FROM kyc_customer_identity_revisions WHERE customer_id = $1`,
      [customerId],
    )
  )[0];
  if (!revisionRow) throw new Error(`no identity revision row for customer ${customerId}`);
  const revision = String(revisionRow.revision);

  // The registration (pre-claim) session the provider store writes: audience
  // `customer-onboarding`, owned by a temporary registration credential. NO passcode and NO
  // transaction PIN are created, so the account stays unclaimed.
  const credentialRows = await q<{ id: string }>(
    `SELECT id FROM customer_authentication_credentials
      WHERE customer_id = $1 AND deleted_at IS NULL ORDER BY created_at ASC LIMIT 1`,
    [customerId],
  );
  let credentialId = credentialRows[0]?.id;
  if (!credentialId) {
    credentialId = randomUUID();
    await q(
      `INSERT INTO customer_authentication_credentials
         (id, customer_id, credential_type, password_hash, hash_algorithm, password_version, status)
       VALUES ($1, $2, 'PASSWORD', $3, 'BCRYPT', 1, 'ACTIVE')`,
      [
        credentialId,
        customerId,
        '$2b$10$tier1fixtureplaceholderhashvalue000000000000000000000000000',
      ],
    );
  }
  const sessionId = randomUUID();
  const tokenHash = createHash('sha256').update(randomUUID()).digest('hex');
  await q(
    `INSERT INTO authentication_sessions
       (id, customer_id, credential_id, token_hash, audience, status, issued_at, expires_at,
        last_seen_at, onboarding_password_version)
     VALUES ($1, $2, $3, $4, 'customer-onboarding', 'ACTIVE', clock_timestamp(),
             clock_timestamp() + interval '2 hours', clock_timestamp(), 1)`,
    [sessionId, customerId, credentialId, tokenHash],
  );
  // Tier 1 is satisfied by BVN alone; Tier 2 additionally requires NIN. Evidence that does not
  // match the tier being claimed is never corroborated by the governed reader.
  // Tier 1 is satisfied by BVN alone; Tier 2 additionally requires NIN. Evidence that does not
  // match the tier being claimed is never corroborated by the governed reader.
  const kinds: Array<'BVN' | 'NIN'> = level === 'LEVEL_1' ? ['BVN'] : ['BVN', 'NIN'];
  for (const kind of kinds) {
    const consentId = randomUUID();
    await q(
      `INSERT INTO kyc_consents
         (id, customer_id, session_id, kind, notice_version, actor_id, identity_revision, provider,
          route_version, expires_at)
       VALUES ($1, $2, $3, $4, 'tier1-admin-web-fixture-v1', $2, $5::bigint, 'MONNIFY', $6,
               clock_timestamp() + interval '2 hours')`,
      [consentId, customerId, sessionId, kind, revision, PROVIDER_ROUTE_VERSION],
    );
    const attemptId = randomUUID();
    const identifierMac = createHmac(
      'sha256',
      `tier1-fixture-${customerId}-${kind}-${randomUUID()}`,
    )
      .update(`synthetic-${kind.toLowerCase()}-${customerId.slice(0, 8)}`)
      .digest('hex');
    await q(
      `INSERT INTO kyc_verification_attempts
         (id, customer_id, consent_id, request_id, kind, provider, policy_version, request_mac,
          identity_mac, mac_key_version, provider_route_version, outcome, identity_revision,
          completed_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, 'MONNIFY', 'tier1-admin-web-fixture-v1', $6, $6, 'fixture-v1',
               $7, 'MATCH', $8::bigint, clock_timestamp(), clock_timestamp() + interval '2 hours')`,
      [
        attemptId,
        customerId,
        consentId,
        randomUUID(),
        kind,
        createHash('sha256').update(`${customerId}:${kind}:${revision}`).digest('hex'),
        PROVIDER_ROUTE_VERSION,
        revision,
      ],
    );
    await q(
      `INSERT INTO kyc_identity_claims (id, kind, identifier_mac, customer_id, attempt_id, status)
       VALUES ($1, $2, $3, $4, $5, 'VERIFIED')`,
      [randomUUID(), kind, identifierMac, customerId, attemptId],
    );
  }
  void identity;
}

async function seedCustomer(
  label: string,
  phone: string,
): Promise<{ id: string; reference: string }> {
  const existing = await one<{ id: string; reference: string }>(
    `SELECT id, reference FROM customers WHERE reference LIKE $1 AND deleted_at IS NULL LIMIT 1`,
    [`t1-${label.toLowerCase()}-%`],
  );
  if (existing) {
    await q(
      `UPDATE customer_contact_methods
          SET verified_at = COALESCE(verified_at, clock_timestamp()), is_primary = TRUE
        WHERE customer_id = $1 AND type = 'PHONE' AND deleted_at IS NULL`,
      [existing.id],
    );
    return existing;
  }

  const id = randomUUID();
  const reference = `t1-${label.toLowerCase()}-${id.slice(0, 8).toLowerCase()}`;
  await q(
    `INSERT INTO customers
       (id, reference, customer_type, status, kyc_level, kyc_status, is_synthetic, version,
        created_at, updated_at)
     VALUES ($1, $2, 'INDIVIDUAL', 'DRAFT', 'NONE', 'NOT_STARTED', FALSE, 1,
             clock_timestamp(), clock_timestamp())`,
    [id, reference],
  );
  await q(
    `INSERT INTO customer_profiles
       (id, customer_id, display_name, legal_name, first_name, middle_name, last_name, date_of_birth,
        nationality, is_active, created_at, updated_at)
     VALUES ($1, $2, $3, $3, 'Tier', 'One', $4, '1990-04-12', 'NG', TRUE,
             clock_timestamp(), clock_timestamp())`,
    [randomUUID(), id, `Synthetic ${label} ${reference.slice(-4)}`, label],
  );
  await q(
    `INSERT INTO customer_contact_methods
       (customer_id, type, value, normalized_value, is_primary, verified_at, created_at, updated_at)
     VALUES ($1, 'PHONE', $2, $2, TRUE, clock_timestamp(), clock_timestamp(), clock_timestamp())`,
    [id, phone],
  );
  return { id, reference };
}

/**
 * Rewinds the synthetic customers to the DRAFT state the acceptance run expects, so the run is
 * repeatable. Only what staff completion itself writes is undone: the lifecycle status and the
 * TIER_DEFAULT class assignment activation commits. A manual assignment (the misconfigured
 * control) and every wallet/credential row are left exactly as they are — and the run asserts they
 * are absent anyway.
 */
async function resetActivationState(senderId: string, unconfiguredId: string): Promise<void> {
  await q(
    `UPDATE customer_class_assignments
        SET is_active = FALSE, effective_to = clock_timestamp(), updated_at = clock_timestamp()
      WHERE customer_id = ANY($1::uuid[]) AND is_active = TRUE AND source = 'TIER_DEFAULT'`,
    [[senderId, unconfiguredId]],
  );
  await q(
    `UPDATE customers SET status = 'DRAFT', updated_at = clock_timestamp()
      WHERE id = ANY($1::uuid[]) AND status <> 'DRAFT'`,
    [[senderId, unconfiguredId]],
  );
}

async function main() {
  await dataSource.initialize();
  try {
    const tierPolicyVersion = await seedTierPolicy();
    const customerProducts = await seedProducts();
    await seedLimitProfile(
      COMMERCIAL_PROFILE,
      'Tier 1 commercial ceiling (higher)',
      COMMERCIAL_CAP_MINOR,
    );
    await assignGlobalProfile(COMMERCIAL_PROFILE);
    await seedLimitProfile(TIER_PROFILE, 'Institution Tier 1 ceiling (lower)', TIER_CAP_MINOR);
    await seedLimitProfile(
      TIER_PROFILE_LEVEL_2,
      'Institution Tier 2 ceiling',
      LEVEL_2_TIER_CAP_MINOR,
    );
    const classId = await seedClass();
    await seedFeeRules(customerProducts);
    const institutionId = await seedInstitution();
    const institutionPolicyVersion = await approveInstitutionTierPolicy(institutionId);

    const sender = await seedCustomer('sender', '+2348099000001');
    const receiver = await seedCustomer('receiver', '+2348099000002');
    const unconfigured = await seedCustomer('unconfigured', '+2348099000003');
    // Tier 2 subject: BVN + NIN evidence, so the governed reader corroborates LEVEL_2 and the
    // APPROVED Tier 2 mapping — its own profile and its own cap — is what governs this customer.
    const tierTwo = await seedCustomer('tiertwo', '+2348099000004');
    // Repeated runs must start from the same staff decision. A previous acceptance run leaves the
    // synthetic customers ACTIVE with the TIER_DEFAULT class assignment it committed, so the
    // fixture rewinds exactly that state (never a manual assignment, never a wallet) and the run
    // is reproducible instead of only passing once.
    await resetActivationState(sender.id, unconfigured.id);
    await approveKycEvidence(sender.id, 'LEVEL_1', {
      firstName: 'Tier',
      lastName: 'One',
      dateOfBirth: '1990-04-12',
      phone: '+2348099000001',
    });
    await approveKycEvidence(unconfigured.id, 'LEVEL_1', {
      firstName: 'Tier',
      lastName: 'One',
      dateOfBirth: '1990-04-12',
      phone: '+2348099000003',
    });
    const governedEnrolment = await enrolCustomer(sender.id, institutionId);
    if (governedEnrolment.status !== 'ACTIVE') {
      await writeEnrolment(sender.id, institutionId);
    }
    const unconfiguredEnrolment = await enrolCustomer(unconfigured.id, institutionId);
    if (unconfiguredEnrolment.status !== 'ACTIVE') {
      await writeEnrolment(unconfigured.id, institutionId);
    }
    // Seeded after the rewind above, because resetActivationState returns the synthetic customers to
    // DRAFT and the harness proves the DRAFT -> ACTIVE decision for the sender through the UI. This
    // customer is the Tier 2 subject rather than the subject of that check, so it is activated here:
    // financial eligibility requires an ACTIVE customer, and without it the Tier 2 configuration
    // would read as though the approved tier policy had not applied at all.
    await approveKycEvidence(tierTwo.id, 'LEVEL_2', {
      firstName: 'Tier',
      lastName: 'Two',
      dateOfBirth: '1992-07-23',
      phone: '+2348099000004',
    });
    const tierTwoEnrolment = await enrolCustomer(tierTwo.id, institutionId);
    if (tierTwoEnrolment.status !== 'ACTIVE') {
      await writeEnrolment(tierTwo.id, institutionId);
    }
    await q(
      `UPDATE customers SET status = 'ACTIVE', updated_at = clock_timestamp()
        WHERE id = $1 AND status <> 'ACTIVE'`,
      [tierTwo.id],
    );
    const workforce = await seedWorkforceScope(institutionId, true);

    // Deliberately misconfigured control customer: its own approved default class has no
    // effective fee rule, so staff completion must be refused and must say exactly what is
    // missing. The mapping is made effective-dated so the healthy LEVEL_1 default is restored
    // in the same run without a rewrite.
    const brokenClass = await one(`SELECT id FROM customer_classes WHERE code = $1`, [
      BROKEN_CLASS_CODE,
    ]);
    if (!brokenClass) {
      await q(
        `INSERT INTO customer_classes
           (id, reference, code, name, description, kind, status, enabled, configuration_status,
            is_default, created_by, version, created_at, updated_at)
         VALUES ($1, $2, $3, 'Tier 1 misconfigured control class',
                 'Synthetic control: an approved default class with no effective fee rule',
                 'CUSTOMER', 'ACTIVE', TRUE, 'CONFIGURED', FALSE, $4, 1,
                 clock_timestamp(), clock_timestamp())`,
        [BROKEN_CLASS_ID, `cc-${BROKEN_CLASS_CODE.toLowerCase()}`, BROKEN_CLASS_CODE, ACTOR],
      );
    }
    await q(
      `UPDATE customer_tier_default_classes SET class_id = $1, updated_at = clock_timestamp()
        WHERE tier = 'LEVEL_1'`,
      [BROKEN_CLASS_ID],
    );
    await q(
      `UPDATE fee_rules SET deleted_at = clock_timestamp(), updated_at = clock_timestamp()
        WHERE product_code = 'WALLET_TRANSFER' AND customer_class_code = $1 AND deleted_at IS NULL`,
      [BROKEN_CLASS_CODE],
    );
    await q(
      `UPDATE customer_classes SET status = 'ACTIVE', enabled = TRUE,
              configuration_status = 'CONFIGURED', updated_at = clock_timestamp()
        WHERE code = $1`,
      [BROKEN_CLASS_CODE],
    ).catch(() => undefined);
    // The control customer gets an explicit approved manual class assignment to the broken class.
    // Activation preserves a manual class rather than the tier default, so the healthy LEVEL_1
    // default mapping stays in force for every other customer in this run.
    await q(
      `UPDATE customer_class_assignments SET is_active = FALSE, updated_at = clock_timestamp()
        WHERE customer_id = $1 AND is_active = TRUE AND class_id <> $2`,
      [unconfigured.id, BROKEN_CLASS_ID],
    );
    await q(
      `INSERT INTO customer_class_assignments
         (id, customer_id, class_id, source, reason, effective_from, effective_to, is_active,
          precedence, created_by, version, created_at, updated_at)
       SELECT $1, $2, $3, 'MANUAL', 'Synthetic misconfigured control',
              clock_timestamp() - interval '1 hour', NULL, TRUE, 100, $4, 1,
              clock_timestamp(), clock_timestamp()
        WHERE NOT EXISTS (
          SELECT 1 FROM customer_class_assignments
           WHERE customer_id = $2 AND class_id = $3 AND is_active = TRUE)`,
      [randomUUID(), unconfigured.id, BROKEN_CLASS_ID, ACTOR],
    ).catch(async (error) => {
      process.stderr.write(`class assignment fixture note: ${String(error.message)}\n`);
    });
    // Restore the healthy default class mapping for LEVEL_1.
    await q(
      `UPDATE customer_tier_default_classes SET class_id = $1, updated_at = clock_timestamp()
        WHERE tier = 'LEVEL_1'`,
      [classId],
    );

    // Read-only state observation: the fixture never writes these, it reports what exists so the
    // acceptance run can prove staff completion issued no passcode, PIN or wallet.
    const countOf = async (sql: string, params: unknown[] = []): Promise<number> =>
      Number((await one<{ n: string }>(sql, params))?.n ?? 0);
    const walletState = {
      wallets: await countOf(
        `SELECT count(*)::text AS n FROM wallet_accounts WHERE customer_id = $1`,
        [sender.id],
      ),
      // A mobile passcode is a customer credential the CLAIM flow provisions; there is no
      // separate passcode table. What must be absent is any customer sign-in (a `customer-api`
      // session) and any credential the claim flow would have created.
      customerSignIns: await countOf(
        `SELECT count(*)::text AS n FROM authentication_sessions
          WHERE customer_id = $1 AND audience = 'customer-api'`,
        [sender.id],
      ).catch(() => 0),
      transactionPins: await countOf(
        `SELECT count(*)::text AS n FROM customer_transaction_pins WHERE customer_id = $1`,
        [sender.id],
      ).catch(() => 0),
      // The ONLY credential this fixture writes is the decorative placeholder hash for the
      // pre-claim onboarding session (`$2b$10$tier1fixture…`), which is not a bcrypt hash of any
      // password and therefore authenticates nobody. The marker is what this count excludes; a
      // real passcode would not carry it. Neither a mobile passcode nor a transaction PIN exists.
      claimCredentials: await countOf(
        `SELECT count(*)::text AS n FROM customer_authentication_credentials
          WHERE customer_id = $1 AND deleted_at IS NULL
            AND (password_hash IS NULL OR password_hash NOT LIKE '$2b$%tier1fixture%')`,
        [sender.id],
      ).catch(() => 0),
    };

    const summary = {
      status: 'DISPOSABLE DATABASE ONLY — synthetic fixture, no real data',
      database: DB_NAME,
      kycTierPolicyVersion: tierPolicyVersion,
      institutionId,
      institutionPolicyVersion,
      customerClass: { code: CLASS_CODE, name: CLASS_NAME, id: classId },
      commercialProfile: { code: COMMERCIAL_PROFILE, maxAmountPerTxMinor: COMMERCIAL_CAP_MINOR },
      institutionTierProfile: { code: TIER_PROFILE, maxAmountPerTxMinor: TIER_CAP_MINOR },
      institutionTierProfileLevel2: {
        code: TIER_PROFILE_LEVEL_2,
        maxAmountPerTxMinor: LEVEL_2_TIER_CAP_MINOR,
      },
      transferFee: { flatFeeMinor: TRANSFER_FEE_FLAT_MINOR, percentageBps: 0, vatBps: 0 },
      workforce: {
        scopedPrincipal: workforce.scopedPrincipal,
        scopedEmail: 'compliance@monienaija.local',
        unassignedPrincipal: workforce.unassignedPrincipal,
        unassignedEmail: 'customer-service@monienaija.local',
      },
      customers: {
        sender: {
          id: sender.id,
          reference: sender.reference,
          phone: '+2348099000001',
          enrolled: true,
        },
        receiver: { id: receiver.id, reference: receiver.reference, phone: '+2348099000002' },
        misconfigured: {
          id: unconfigured.id,
          reference: unconfigured.reference,
          phone: '+2348099000003',
          approvedClass: BROKEN_CLASS_CODE,
        },
        tierTwo: {
          id: tierTwo.id,
          reference: tierTwo.reference,
          phone: '+2348099000004',
          status: 'ACTIVE',
          expectedTier: 'LEVEL_2',
          expectedTierProfile: TIER_PROFILE_LEVEL_2,
          expectedCapMinor: LEVEL_2_TIER_CAP_MINOR,
          commercialCapMinor: COMMERCIAL_CAP_MINOR,
        },
      },
      walletState,
      customerProducts: customerProducts.map((p) => String(p.code).toUpperCase()),
    };
    const outDir = path.resolve(
      process.env.TIER1_OUT_DIR || 'docs/integration/evidence/tier1-admin-web',
    );
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'fixture.json'), `${JSON.stringify(summary, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } finally {
    await dataSource.destroy();
  }
}

main().catch((error) => {
  console.error(`TIER1 FIXTURE FAILED: ${(error as Error).stack ?? (error as Error).message}`);
  process.exit(1);
});
