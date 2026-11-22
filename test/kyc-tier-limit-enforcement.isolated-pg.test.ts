import { randomBytes, randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';

import { ProtectedAuthorityService } from '../src/authorization/protected-authority.service';
import type { AuthorizationPrincipal } from '../src/authorization/authorization.types';
import type { AuthorizationService } from '../src/authorization/authorization.service';
import type { ConfigService } from '@nestjs/config';
import type { Environment } from '../src/config/environment';
import { CustomerFinancialEligibilityService } from '../src/kyc-verification/customer-financial-eligibility.service';
import { KycTierPolicyService } from '../src/kyc-verification/kyc-tier-policy.service';
import { KycTierEvidenceReader } from '../src/kyc-verification/kyc-tier-evidence.reader';
import { KycProviderGovernance1785753600109 } from '../src/migrations/1785753600109-KycProviderGovernance';
import { KycTierPolicy1785753600110 } from '../src/migrations/1785753600110-KycTierPolicy';
import { KycGovernanceProtectedAuthority1785753600300 } from '../src/migrations/1785753600300-KycGovernanceProtectedAuthority';
import { InstitutionKycTierLimitGovernance1785753600504 } from '../src/migrations/1785753600504-InstitutionKycTierLimitGovernance';
import { CreateLimitProfileCatalogue1785753600067 } from '../src/migrations/1785753600067-CreateLimitProfileCatalogue';
import { CreateLimitAssignments1785753600068 } from '../src/migrations/1785753600068-CreateLimitAssignments';
import { CreateLimitUsages1785753600069 } from '../src/migrations/1785753600069-CreateLimitUsages';
import { InstitutionKycLimitPolicyService } from '../src/limit-catalog/institution-kyc-limit-policy.service';
import { LimitEnforcementService } from '../src/limit-catalog/limit-enforcement.service';
import { LimitProfileResolverService } from '../src/limit-catalog/limit-profile-resolver.service';
import { LimitUsageService } from '../src/limit-catalog/limit-usage.service';
import { LimitUsage } from '../src/limit-catalog/limit-usage.entity';
import { LimitReservation } from '../src/limit-catalog/limit-reservation.entity';
import { assertIsolatedKycCluster, isolatedKycCluster } from './support/kyc-isolated-cluster';

/**
 * Authoritative tier-to-limit acceptance.
 *
 * This suite exists because the recovered position was: "tier-to-limit mapping exists in code,
 * but no test proves it governs admission". Everything below drives the real production services
 * against real PostgreSQL. The only things that are synthetic are (a) the monetary values, which
 * are invented acceptance data explicitly not operational thresholds, and (b) the provider
 * evidence, which uses the same identity-bound fixture shape the other isolated KYC suites use.
 *
 * The suite is intentionally adversarial about the failure modes the mission names:
 *   - missing mapping / missing profile / missing rule must refuse, never mean "unlimited";
 *   - an explicitly approved non-applicability is NOT the same as a missing mapping;
 *   - a mapping bound to a different tier, currency or service class must not match;
 *   - activation-flag semantics must not let production skip tier limiting;
 *   - concurrent admissions must not both consume one cumulative window.
 */
const cluster = isolatedKycCluster();
/**
 * This suite runs in `public`, not a per-suite schema, and that is deliberate.
 *
 * Migration 1785753600504 (`InstitutionKycTierLimitGovernance`) is the first migration to define
 * the institution tier-limit tables, and it references them as `public.…` from its foreign keys,
 * digest function and protected-authority decision table. No other isolated suite applies it, so
 * there is no established per-schema contract to follow: running it in `public` is what the
 * migration actually supports. The cluster itself is the disposable, socket-only, marker-guarded
 * one created by `scripts/run-isolated-kyc-tests.js`, and `--runInBand` gives this suite exclusive
 * use of it.
 */
const db = new DataSource({
  type: 'postgres',
  host: cluster.socketDirectory,
  port: cluster.port,
  username: 'kyc_synthetic',
  database: 'postgres',
  synchronize: false,
  logging: false,
});

const INSTITUTION = randomUUID();
const PRODUCT = 'WALLET_TO_CASH';
const CURRENCY = 'NGN';
const TIER_PROFILE = 'KYC_TIER_ACCEPTANCE';
const PRODUCT_PROFILE = 'KYC_PRODUCT_FLOOR';

const maker: AuthorizationPrincipal = {
  type: 'PRIVILEGED',
  principalId: 'tl-fixture-maker',
  sessionId: randomUUID(),
  roles: ['SUPER_ADMIN'],
  scopes: ['kyc.policy.propose', 'kyc.provider.propose'],
  customerAccess: 'NONE',
  assuranceLevel: 'MFA',
};
const checker: AuthorizationPrincipal = {
  type: 'OPERATOR',
  principalId: 'tl-fixture-checker',
  sessionId: randomUUID(),
  roles: ['COMPLIANCE'],
  scopes: ['kyc.policy.approve', 'kyc.provider.approve'],
  customerAccess: 'NONE',
  assuranceLevel: 'MFA',
};
const fixtureAuthorization = {
  authorize: () => Promise.resolve({ allowed: true }),
} as unknown as AuthorizationService;

let governance: InstitutionKycLimitPolicyService;
let enforcement: LimitEnforcementService;

/** Build an enforcement service bound to an explicit activation flag. */
function enforcementWith(activated: boolean, nodeEnv = 'test'): LimitEnforcementService {
  const config = {
    get: (key: string) => (key === 'NODE_ENV' ? nodeEnv : activated),
  } as unknown as ConfigService<Environment, true>;
  return new LimitEnforcementService(
    db,
    new LimitProfileResolverService(db),
    new LimitUsageService(db.getRepository(LimitUsage), db.getRepository(LimitReservation), db),
    new InstitutionKycLimitPolicyService(db, fixtureAuthorization, authority(), config),
    new CustomerFinancialEligibilityService(
      new KycTierPolicyService(db, fixtureAuthorization, authority()),
      new KycTierEvidenceReader(),
    ),
    config,
  );
}

function authority(): ProtectedAuthorityService {
  return new ProtectedAuthorityService(db, db);
}

const tierDefinition = () => ({
  regulatoryRequirementsConfirmed: true,
  effectiveFrom: '2020-01-01T00:00:00.000Z',
  effectiveUntil: null,
  regulatory: {
    LEVEL_1: { all: [], any: [] },
    LEVEL_2: { all: [], any: [] },
    LEVEL_3: { all: [], any: [] },
  },
  operator: {
    LEVEL_1: { all: [], any: [] },
    LEVEL_2: { all: [], any: [] },
    LEVEL_3: { all: [], any: [] },
  },
});

/**
 * Create a customer that the authoritative eligibility gate considers eligible at `level`.
 *
 * This deliberately does NOT shortcut the gate. The customer must satisfy every structural
 * precondition the production service checks — active, non-synthetic, APPROVED, a recognised
 * kyc_level, exactly one verified primary phone, no open identity conflict, no manual hold — and
 * must carry identity-bound provider evidence that the real `KycTierEvidenceReader` SQL accepts,
 * including the live consent, owning session, completed attempt, verified claim and the monotonic
 * identity revision. Only the tier-transition worker is skipped, because that has its own suite.
 */
async function assessedCustomer(level: 'LEVEL_1' | 'LEVEL_2' | 'LEVEL_3'): Promise<string> {
  const id = randomUUID();
  const revision = '1';
  await db.query(
    `INSERT INTO customers(id,status,kyc_level,kyc_status) VALUES($1,'ACTIVE',$2,'APPROVED')`,
    [id, level],
  );
  await db.query(
    `INSERT INTO kyc_customer_identity_revisions(customer_id,revision) VALUES($1,$2)`,
    [id, revision],
  );
  await db.query(
    `INSERT INTO customer_profiles(customer_id,first_name,last_name,date_of_birth) VALUES($1,'Synthetic','Test','2000-01-01')`,
    [id],
  );
  await db.query(
    `INSERT INTO customer_contact_methods(id,customer_id,type,normalized_value,is_primary,verified_at) VALUES($1,$2,'PHONE','+2348000000000',true,clock_timestamp())`,
    [randomUUID(), id],
  );

  // The gate also requires exactly one current, unexpired, APPROVED managed assessment at exactly
  // the customer's recorded level -- the authoritative assessment, not just the denormalised column.
  await db.query(
    `INSERT INTO customer_kyc_assessments(id,customer_id,kyc_level,kyc_status,reason,assessed_by,is_current,expires_at)
     VALUES($1,$2,$3,'APPROVED','TIER_2_REQUIREMENTS_MET','SYSTEM_KYC_EVALUATOR',true,clock_timestamp()+interval '30 days')`,
    [randomUUID(), id, level],
  );

  const kinds: Array<'BVN' | 'NIN'> = level === 'LEVEL_1' ? ['BVN'] : ['BVN', 'NIN'];
  for (const kind of kinds) {
    const sessionId = randomUUID();
    await db.query(
      `INSERT INTO authentication_sessions(id,customer_id,audience) VALUES($1,$2,'customer-api')`,
      [sessionId, id],
    );
    const consent = randomUUID();
    await db.query(
      `INSERT INTO kyc_consents(id,customer_id,session_id,kind,actor_id,identity_revision,provider,route_version,expires_at)
       VALUES($1,$2,$3,$4,$2,$5,'MONNIFY',1,clock_timestamp()+interval '1 hour')`,
      [consent, id, sessionId, kind, revision],
    );
    const attempt = randomUUID();
    await db.query(
      `INSERT INTO kyc_verification_attempts(id,customer_id,consent_id,kind,provider,provider_route_version,outcome,identity_revision,completed_at,expires_at)
       VALUES($1,$2,$3,$4,'MONNIFY',1,'MATCH',$5,clock_timestamp(),clock_timestamp()+interval '1 hour')`,
      [attempt, id, consent, kind, revision],
    );
    await db.query(
      `INSERT INTO kyc_identity_claims(attempt_id,customer_id,kind,status) VALUES($1,$2,$3,'VERIFIED')`,
      [attempt, id, kind],
    );
  }
  return id;
}

/**
 * Approve an institution tier-limit policy through the real maker/checker services. `mappings`
 * are accepted verbatim so a test can express a partial or deliberately wrong policy.
 */
async function approveTierLimitPolicy(
  mappings: Array<{
    product: string;
    currency: string;
    serviceClass: string | null;
    tier: 'LEVEL_1' | 'LEVEL_2' | 'LEVEL_3';
    disposition: 'PROFILE' | 'NOT_APPLICABLE';
    profileCode: string | null;
  }>,
  options: { enabled?: boolean } = {},
): Promise<number> {
  const current = await governance.view(maker, INSTITUTION);
  const proposal = await governance.propose(maker, {
    institutionId: INSTITUTION,
    requestId: randomUUID(),
    expectedVersion: current.currentVersion,
    definition: {
      schemaVersion: 1,
      enabled: options.enabled ?? true,
      effectiveFrom: '2000-01-01T00:00:00.000Z',
      effectiveUntil: null,
      // `profileDigest` is bound by the service from the live profile; the proposal payload must
      // not carry it (the service computes and verifies it).
      mappings: mappings.map((m) => ({ ...m })),
    },
    reason: 'Synthetic isolated acceptance policy for tier-bound financial admission',
  });
  const decided = await governance.decide(checker, INSTITUTION, proposal.id, true);
  return decided.version;
}

/** One rule per direction so direction-specific refusal can be proven. */
async function seedProfile(
  profileCode: string,
  rules: Array<{
    direction: 'INCOMING' | 'OUTGOING' | 'BOTH';
    dimension: string;
    value: string;
    currency?: string;
  }>,
): Promise<void> {
  await db.query(
    `INSERT INTO limit_profiles(code,name,description,kind,status,enabled,configuration_status,created_by)
     VALUES($1,$2,'Synthetic acceptance-only profile','UNIVERSAL','ACTIVE',true,'CONFIGURED','isolated-kyc-test')
     ON CONFLICT(code) DO NOTHING`,
    [profileCode, `Synthetic acceptance profile ${profileCode}`],
  );
  for (const rule of rules) {
    await db.query(
      `INSERT INTO limit_rules(id,limit_profile_code,product,direction,channel,currency,dimension,limit_value_minor,limit_value_count,effective_from,effective_to,is_active,priority,created_by)
       VALUES($1,$2,$3,$4,NULL,$5,$6,$7,NULL,'2000-01-01T00:00:00.000Z',NULL,true,0,'isolated-kyc-test')`,
      [
        randomUUID(),
        profileCode,
        PRODUCT,
        rule.direction,
        rule.currency ?? CURRENCY,
        rule.dimension,
        rule.value,
      ],
    );
  }
  await db.query(
    `INSERT INTO limit_assignments(id,limit_profile_code,subject_type,subject_id,segment_code,precedence,effective_from,effective_to,is_active,created_by)
     VALUES($1,$2,'GLOBAL',NULL,NULL,0,'2000-01-01T00:00:00.000Z',NULL,true,'isolated-kyc-test')`,
    [randomUUID(), profileCode],
  );
}

/** A single-tier mapping convenience. */
const tierMapping = (
  tier: 'LEVEL_1' | 'LEVEL_2' | 'LEVEL_3',
  profileCode: string | null,
  disposition: 'PROFILE' | 'NOT_APPLICABLE' = 'PROFILE',
  overrides: Partial<{ product: string; currency: string; serviceClass: string | null }> = {},
) => ({
  product: overrides.product ?? PRODUCT,
  currency: overrides.currency ?? CURRENCY,
  serviceClass: overrides.serviceClass ?? null,
  tier,
  disposition,
  profileCode: disposition === 'PROFILE' ? profileCode : null,
});

const admission = (
  overrides: Partial<Parameters<LimitEnforcementService['enforceWithManager']>[1]> = {},
) => ({
  principalType: 'CUSTOMER',
  principalId: '',
  product: PRODUCT,
  currency: CURRENCY,
  direction: 'OUTGOING',
  amountMinor: '1000',
  idempotencyKey: `tl-${randomUUID()}`,
  requestHash: randomBytes(32).toString('hex'),
  institutionId: INSTITUTION,
  serviceClass: null,
  requireKycTierPolicy: true,
  ...overrides,
});

/** Run `fn` inside one transaction against the shared manager. */
async function inTransaction<T>(fn: (m: DataSource['manager']) => Promise<T>): Promise<T> {
  return db.transaction(fn);
}

/**
 * Assert a fail-closed refusal. Captures the rejection once so both the HTTP status and the
 * LimitFailureCode can be asserted without re-running (and re-reserving) the admission.
 */
async function expectRefusal(
  promise: Promise<unknown>,
  matcher: { status: number; code?: string },
): Promise<void> {
  const error = await promise.then(
    () => null,
    (reason: unknown) => reason as { status?: number; response?: { code?: string } },
  );
  expect(error).not.toBeNull();
  expect(error?.status).toBe(matcher.status);
  if (matcher.code) expect(error?.response?.code).toBe(matcher.code);
}

beforeAll(async () => {
  await db.initialize();
  await assertIsolatedKycCluster(db, cluster);

  // --- Minimal but faithful column shapes for the tables the real services read. ---
  await db.query(
    `CREATE TABLE customers(id uuid PRIMARY KEY,status varchar(20) NOT NULL DEFAULT 'ACTIVE',kyc_level varchar(20) NOT NULL DEFAULT 'NONE',kyc_status varchar(20) NOT NULL DEFAULT 'NOT_STARTED',is_synthetic boolean NOT NULL DEFAULT false,version int NOT NULL DEFAULT 1,updated_at timestamptz NOT NULL DEFAULT now(),deleted_at timestamptz)`,
  );
  await db.query(
    `CREATE TABLE kyc_customer_identity_revisions(customer_id uuid PRIMARY KEY,revision bigint NOT NULL CHECK(revision>0))`,
  );
  await db.query(
    `CREATE TABLE kyc_consents(id uuid PRIMARY KEY,customer_id uuid,session_id uuid,kind varchar(3),actor_id uuid,identity_revision bigint,provider varchar(32),route_version int,created_at timestamptz DEFAULT now(),expires_at timestamptz,withdrawn_at timestamptz)`,
  );
  await db.query(
    `CREATE TABLE kyc_verification_attempts(id uuid PRIMARY KEY,customer_id uuid,consent_id uuid,kind varchar(3),provider varchar(32),provider_route_version int,outcome varchar(24),identity_revision bigint,identity_mac char(64),mac_key_version varchar(64),created_at timestamptz DEFAULT now(),completed_at timestamptz,expires_at timestamptz)`,
  );
  await db.query(
    `CREATE TABLE kyc_identity_claims(attempt_id uuid,customer_id uuid,kind varchar(3),status varchar(12))`,
  );
  await db.query(
    `CREATE TABLE authentication_sessions(id uuid PRIMARY KEY,customer_id uuid,audience varchar(40))`,
  );
  // Read by LimitEnforcementService for the reservation idempotency scope.
  await db.query(
    `CREATE TABLE idempotency_records(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),scope varchar(120) NOT NULL,idempotency_key varchar(255) NOT NULL,request_hash char(64) NOT NULL,status varchar(20) NOT NULL,response_status_code smallint,response_body jsonb,resource_type varchar(80),resource_id uuid,hit_count int NOT NULL DEFAULT 0,last_seen_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),CONSTRAINT uq_idem_scope_key UNIQUE(scope,idempotency_key))`,
  );
  // Read by KycTierPolicyService's identity-claim cross-check.
  await db.query(
    `CREATE TABLE customer_profiles(customer_id uuid,first_name varchar(100),last_name varchar(100),date_of_birth date,is_active boolean NOT NULL DEFAULT true,deleted_at timestamptz)`,
  );
  await db.query(
    `CREATE TABLE customer_contact_methods(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),customer_id uuid,type varchar(10) NOT NULL DEFAULT 'PHONE',normalized_value text,is_primary boolean NOT NULL DEFAULT true,verified_at timestamptz NOT NULL DEFAULT now(),deleted_at timestamptz)`,
  );
  // Read by KycTierPolicyService.effective() for the current managed assessment.
  await db.query(
    `CREATE TABLE customer_kyc_assessments(id uuid PRIMARY KEY,customer_id uuid,kyc_level varchar(20),kyc_status varchar(20),reason text,assessed_by text,is_current boolean,expires_at timestamptz,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now())`,
  );
  await db.query(
    `CREATE UNIQUE INDEX current_assessment ON customer_kyc_assessments(customer_id) WHERE is_current`,
  );
  await db.query(
    `CREATE TABLE kyc_identity_conflicts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),requester_customer_id uuid,claimed_customer_id uuid,kind varchar(16),status varchar(16) NOT NULL DEFAULT 'OPEN',created_at timestamptz NOT NULL DEFAULT clock_timestamp(),resolved_at timestamptz)`,
  );
  // ARENA 5 §6: CustomerFinancialEligibilityService.require() admits active FROZEN/BLACKLISTED
  // administrative restrictions inside the same transaction. This suite owns a hand-built
  // schema, so the table migration 1785753600010 creates must exist here with the same column
  // shape and the same (customer_id, type) uniqueness the real writer relies on.
  await db.query(
    `CREATE TABLE customer_restrictions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),customer_id uuid NOT NULL,type varchar(20) NOT NULL,is_active boolean NOT NULL DEFAULT true,reason varchar(500),version integer NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),deleted_at timestamptz,CONSTRAINT chk_customer_restrictions_type CHECK (type IN ('NONE','LIMITED','MANUAL_REVIEW','FROZEN','BLACKLISTED')),CONSTRAINT chk_customer_restrictions_version CHECK (version > 0))`,
  );
  await db.query(
    `CREATE UNIQUE INDEX uq_customer_restrictions_customer_type ON customer_restrictions(customer_id,type) WHERE deleted_at IS NULL`,
  );

  // Required by migration 1785753600110 (KycTierPolicy), which alters rather than creates it.
  await db.query(
    `CREATE TABLE kyc_evaluation_refresh(customer_id uuid PRIMARY KEY,revision bigint NOT NULL DEFAULT 1,requested_at timestamptz NOT NULL DEFAULT clock_timestamp())`,
  );
  await db.query(
    `CREATE TABLE financial_institutions(id uuid PRIMARY KEY,status varchar(24) NOT NULL DEFAULT 'ACTIVE',deleted_at timestamptz)`,
  );

  const runner = db.createQueryRunner();
  // Real limit-catalogue schema rather than a hand-written approximation.
  await new CreateLimitProfileCatalogue1785753600067().up(runner);
  await new CreateLimitAssignments1785753600068().up(runner);
  await new CreateLimitUsages1785753600069().up(runner);
  await new KycProviderGovernance1785753600109().up(runner);
  await new KycTierPolicy1785753600110().up(runner);
  await new KycGovernanceProtectedAuthority1785753600300().up(runner);
  await new InstitutionKycTierLimitGovernance1785753600504().up(runner);
  await runner.release();

  // `resolveWithManager` requires an APPROVED institution, not merely an existing one.
  await db.query(`INSERT INTO financial_institutions(id,status) VALUES($1,'APPROVED')`, [
    INSTITUTION,
  ]);

  // Approve a tier policy so the trusted-eligibility gate has a policy to evaluate against.
  const policyService = new KycTierPolicyService(db, fixtureAuthorization, authority());
  const proposal = await policyService.propose(maker, {
    requestId: randomUUID(),
    expectedVersion: 0,
    definition: tierDefinition(),
  });
  await policyService.decide(checker, proposal.id, true);

  governance = new InstitutionKycLimitPolicyService(db, fixtureAuthorization, authority(), {
    get: () => true,
  } as unknown as ConfigService<Environment, true>);
  enforcement = enforcementWith(true);
}, 180000);

afterAll(async () => {
  // Never drop `public` on this cluster: drop only what this suite created, in dependency order.
  if (db.isInitialized) {
    for (const table of [
      'financial_institutions',
      'authentication_sessions',
      'kyc_identity_claims',
      'kyc_verification_attempts',
      'kyc_consents',
      'kyc_customer_identity_revisions',
      'customers',
      'customer_kyc_assessments',
      'customer_profiles',
      'customer_contact_methods',
      'idempotency_records',
      'kyc_identity_conflicts',
      'kyc_evaluation_refresh',
    ]) {
      await db.query(`DROP TABLE IF EXISTS ${table} CASCADE`).catch(() => undefined);
    }
    await db.destroy();
  }
});

beforeEach(async () => {
  // The real catalogue has RESTRICT foreign keys, so truncate dependants first.
  await db.query(
    `TRUNCATE limit_reservations, limit_usages, limit_assignments, limit_rules, limit_profiles CASCADE`,
  );
});

describe('tier-to-limit mapping is authoritative', () => {
  it('admits a Level 2 customer through the mapping bound to that exact tier', async () => {
    await seedProfile(TIER_PROFILE, [
      { direction: 'OUTGOING', dimension: 'MAX_AMOUNT_PER_TX', value: '500000' },
      { direction: 'BOTH', dimension: 'DAILY_AMOUNT', value: '5000000' },
    ]);
    // NOTE (recorded deliberately): the two profiles must not both contribute a windowed rule for
    // the same product/direction/dimension/currency. `uq_limit_reservations_window_idempotent`
    // keys reservations by (idempotency_key, principal, product, direction, channel, dimension,
    // currency, window_key) and therefore cannot distinguish two profiles reserving the same
    // window under one idempotency key. That is a real constraint of the accepted limit-catalogue
    // schema, not something this suite should paper over. The product floor is expressed with a
    // non-windowed dimension for exactly that reason, and the conjunctive test below asserts the
    // tighter rule wins.
    await seedProfile(PRODUCT_PROFILE, [
      { direction: 'BOTH', dimension: 'MIN_AMOUNT_PER_TX', value: '100' },
    ]);
    await approveTierLimitPolicy([
      tierMapping('LEVEL_1', PRODUCT_PROFILE),
      tierMapping('LEVEL_2', TIER_PROFILE),
      tierMapping('LEVEL_3', TIER_PROFILE),
    ]);
    const customerId = await assessedCustomer('LEVEL_2');

    const result = await inTransaction((m) =>
      enforcement.enforceWithManager(m, admission({ principalId: customerId })),
    );
    expect(result.allowed).toBe(true);
    expect(result.customerKycTier).toBe('LEVEL_2');
    expect(result.tierPolicyVersion).toBe(1);
    // The tier-derived profile, not the global product floor, must be the one enforced.
    expect(result.limitProfileCode).toBe(TIER_PROFILE);
  }, 120000);

  it('refuses when the approved policy has no mapping for the assessed tier', async () => {
    await seedProfile(PRODUCT_PROFILE, [
      { direction: 'BOTH', dimension: 'DAILY_AMOUNT', value: '9000000' },
    ]);
    // Level 2 is deliberately absent: an assessed Level 2 customer has no applicable mapping.
    await approveTierLimitPolicy([
      tierMapping('LEVEL_1', PRODUCT_PROFILE),
      tierMapping('LEVEL_3', PRODUCT_PROFILE),
    ]);
    const customerId = await assessedCustomer('LEVEL_2');

    await expectRefusal(
      inTransaction((m) =>
        enforcement.enforceWithManager(m, admission({ principalId: customerId })),
      ),
      { status: 503, code: 'LIMIT_PROFILE_MISSING' },
    );
  }, 120000);

  it('refuses a mapping approved for a different currency', async () => {
    // The floor must carry a USD rule too, otherwise the PROPOSAL is rejected for referencing a
    // profile with no USD rules and the admission path is never reached. The point of this test is
    // the admission-time currency-key mismatch, so the proposal has to be valid.
    await seedProfile(PRODUCT_PROFILE, [
      { direction: 'BOTH', dimension: 'DAILY_AMOUNT', value: '9000000' },
      { direction: 'BOTH', dimension: 'DAILY_AMOUNT', value: '9000000', currency: 'USD' },
    ]);
    await approveTierLimitPolicy([
      tierMapping('LEVEL_2', PRODUCT_PROFILE, 'PROFILE', { currency: 'USD' }),
    ]);
    const customerId = await assessedCustomer('LEVEL_2');

    await expectRefusal(
      inTransaction((m) =>
        enforcement.enforceWithManager(m, admission({ principalId: customerId })),
      ),
      { status: 503, code: 'LIMIT_PROFILE_MISSING' },
    );
  }, 120000);

  it('refuses a mapping approved for a different service class', async () => {
    await seedProfile(PRODUCT_PROFILE, [
      { direction: 'BOTH', dimension: 'DAILY_AMOUNT', value: '9000000' },
    ]);
    // The approved key is the classified key; the admission is unclassified (null).
    await approveTierLimitPolicy([
      tierMapping('LEVEL_2', PRODUCT_PROFILE, 'PROFILE', { serviceClass: 'PREMIUM' }),
    ]);
    const customerId = await assessedCustomer('LEVEL_2');

    await expectRefusal(
      inTransaction((m) =>
        enforcement.enforceWithManager(m, admission({ principalId: customerId })),
      ),
      { status: 503, code: 'LIMIT_PROFILE_MISSING' },
    );
  }, 120000);

  it('treats an explicitly approved NOT_APPLICABLE mapping as non-applicable, not unlimited', async () => {
    // The product floor still applies and is the only source of rules. An explicit non-applicability
    // means "no tier profile", never "no limit at all".
    await seedProfile(PRODUCT_PROFILE, [
      { direction: 'BOTH', dimension: 'DAILY_AMOUNT', value: '9000000' },
    ]);
    await approveTierLimitPolicy([tierMapping('LEVEL_2', null, 'NOT_APPLICABLE')]);
    const customerId = await assessedCustomer('LEVEL_2');

    const result = await inTransaction((m) =>
      enforcement.enforceWithManager(m, admission({ principalId: customerId })),
    );
    expect(result.allowed).toBe(true);
    expect(result.limitProfileCode).toBe(PRODUCT_PROFILE);
    expect(result.customerKycTier).toBe('LEVEL_2');
  }, 120000);

  it('refuses an explicit non-applicability when no product profile exists either', async () => {
    await approveTierLimitPolicy([tierMapping('LEVEL_2', null, 'NOT_APPLICABLE')]);
    const customerId = await assessedCustomer('LEVEL_2');

    await expectRefusal(
      inTransaction((m) =>
        enforcement.enforceWithManager(m, admission({ principalId: customerId })),
      ),
      { status: 503, code: 'LIMIT_PROFILE_MISSING' },
    );
  }, 120000);

  it('refuses when the mapped profile has no rule for the transaction direction', async () => {
    await seedProfile(TIER_PROFILE, [
      { direction: 'INCOMING', dimension: 'MAX_AMOUNT_PER_TX', value: '500000' },
    ]);
    await approveTierLimitPolicy([tierMapping('LEVEL_2', TIER_PROFILE)]);
    const customerId = await assessedCustomer('LEVEL_2');

    // OUTGOING admission against an INCOMING-only profile must not be read as unlimited.
    await expectRefusal(
      inTransaction((m) =>
        enforcement.enforceWithManager(m, admission({ principalId: customerId })),
      ),
      { status: 503, code: 'LIMIT_PROFILE_MISSING' },
    );
  }, 120000);

  it('refuses a customer that is not financially eligible', async () => {
    await seedProfile(TIER_PROFILE, [
      { direction: 'BOTH', dimension: 'DAILY_AMOUNT', value: '9000000' },
    ]);
    await approveTierLimitPolicy([tierMapping('LEVEL_2', TIER_PROFILE)]);
    // Assessed at NONE: the tier is not established, so the gate must refuse before any limit math.
    const customerId = randomUUID();
    await db.query(
      `INSERT INTO customers(id,status,kyc_level,kyc_status) VALUES($1,'ACTIVE','NONE','NOT_STARTED')`,
      [customerId],
    );

    await expect(
      inTransaction((m) =>
        enforcement.enforceWithManager(m, admission({ principalId: customerId })),
      ),
    ).rejects.toMatchObject({ status: 409 });
  }, 120000);

  it('rejects a tier-bound admission that supplies no institution scope', async () => {
    await seedProfile(TIER_PROFILE, [
      { direction: 'BOTH', dimension: 'DAILY_AMOUNT', value: '9000000' },
    ]);
    await approveTierLimitPolicy([tierMapping('LEVEL_2', TIER_PROFILE)]);
    const customerId = await assessedCustomer('LEVEL_2');

    await expectRefusal(
      inTransaction((m) =>
        enforcement.enforceWithManager(
          m,
          admission({ principalId: customerId, institutionId: null }),
        ),
      ),
      { status: 503, code: 'LIMIT_PROFILE_MISSING' },
    );
  }, 120000);

  it('rejects an agent principal on the tier-bound path', async () => {
    await seedProfile(TIER_PROFILE, [
      { direction: 'BOTH', dimension: 'DAILY_AMOUNT', value: '9000000' },
    ]);
    await approveTierLimitPolicy([tierMapping('LEVEL_2', TIER_PROFILE)]);
    const customerId = await assessedCustomer('LEVEL_2');

    // Agent operational limits are a different control; conflating them with customer regulatory
    // tiers is exactly the failure mode this guard prevents.
    await expectRefusal(
      inTransaction((m) =>
        enforcement.enforceWithManager(
          m,
          admission({ principalId: customerId, principalType: 'AGENT' }),
        ),
      ),
      { status: 503, code: 'LIMIT_PROFILE_MISSING' },
    );
  }, 120000);
});

describe('enforcement is conjunctive with the existing product floor', () => {
  it('applies the tier profile and the product floor together, refusing on the tighter one', async () => {
    await seedProfile(TIER_PROFILE, [
      { direction: 'OUTGOING', dimension: 'MAX_AMOUNT_PER_TX', value: '1000' },
    ]);
    await seedProfile(PRODUCT_PROFILE, [
      { direction: 'BOTH', dimension: 'MIN_AMOUNT_PER_TX', value: '1' },
    ]);
    await approveTierLimitPolicy([tierMapping('LEVEL_2', TIER_PROFILE)]);
    const customerId = await assessedCustomer('LEVEL_2');

    await expectRefusal(
      inTransaction((m) =>
        enforcement.enforceWithManager(
          m,
          admission({ principalId: customerId, amountMinor: '1001' }),
        ),
      ),
      { status: 422, code: 'LIMIT_MAX_AMOUNT_EXCEEDED' },
    );
    const allowed = await inTransaction((m) =>
      enforcement.enforceWithManager(
        m,
        admission({ principalId: customerId, amountMinor: '1000' }),
      ),
    );
    expect(allowed.allowed).toBe(true);
  }, 120000);

  it('accumulates a cumulative window across sequential admissions and refuses past it', async () => {
    await seedProfile(TIER_PROFILE, [
      { direction: 'OUTGOING', dimension: 'MAX_AMOUNT_PER_TX', value: '1000000' },
      { direction: 'BOTH', dimension: 'DAILY_AMOUNT', value: '3000' },
    ]);
    await approveTierLimitPolicy([tierMapping('LEVEL_2', TIER_PROFILE)]);
    const customerId = await assessedCustomer('LEVEL_2');

    for (const amountMinor of ['1000', '1000', '1000']) {
      const ok = await inTransaction((m) =>
        enforcement.enforceWithManager(m, admission({ principalId: customerId, amountMinor })),
      );
      expect(ok.allowed).toBe(true);
    }
    // The daily window is now exactly full.
    await expectRefusal(
      inTransaction((m) =>
        enforcement.enforceWithManager(m, admission({ principalId: customerId, amountMinor: '1' })),
      ),
      { status: 422, code: 'LIMIT_DAILY_AMOUNT_EXCEEDED' },
    );
  }, 180000);
});

describe('reservation races do not destroy the surrounding transaction', () => {
  it('survives a duplicate reservation insert and still commits the admission', async () => {
    // The two profiles contribute the same windowed dimension, which the reservation unique index
    // cannot distinguish, so the second insert necessarily conflicts. PostgreSQL aborts the
    // transaction on any statement error unless the insert is savepoint-guarded; without that guard
    // this admission fails with 25P02 and a legitimate payment is refused.
    await seedProfile(TIER_PROFILE, [
      { direction: 'BOTH', dimension: 'DAILY_AMOUNT', value: '100000' },
    ]);
    await seedProfile(PRODUCT_PROFILE, [
      { direction: 'BOTH', dimension: 'DAILY_AMOUNT', value: '100000' },
    ]);
    await approveTierLimitPolicy([tierMapping('LEVEL_2', TIER_PROFILE)]);
    const customerId = await assessedCustomer('LEVEL_2');

    const result = await inTransaction((m) =>
      enforcement.enforceWithManager(m, admission({ principalId: customerId, amountMinor: '500' })),
    );
    expect(result.allowed).toBe(true);
    // And the transaction is still usable afterwards.
    const after = await inTransaction((m) =>
      m.query<Array<{ n: number }>>('SELECT count(*)::int AS n FROM limit_reservations'),
    );
    expect(after[0]?.n ?? 0).toBeGreaterThanOrEqual(1);
  }, 120000);
});

describe('activation semantics never degrade production', () => {
  it('keeps the accepted legacy contract when the rollout flag is off outside production', async () => {
    // No mapping, no profile, nothing configured at all.
    const legacy = enforcementWith(false, 'test');
    const customerId = await assessedCustomer('LEVEL_2');

    const result = await inTransaction((m) =>
      legacy.enforceWithManager(m, admission({ principalId: customerId })),
    );
    // Pre-existing obligations must not be stranded by a rollout that is not activated.
    expect(result.allowed).toBe(true);
    expect(result.limitProfileCode).toBeNull();
    expect(result.customerKycTier).toBeUndefined();
  }, 120000);

  it('refuses when the rollout flag is off in production', async () => {
    const production = enforcementWith(false, 'production');
    const customerId = await assessedCustomer('LEVEL_2');

    await expectRefusal(
      inTransaction((m) =>
        production.enforceWithManager(m, admission({ principalId: customerId })),
      ),
      { status: 503, code: 'LIMIT_PROFILE_MISSING' },
    );
  }, 120000);

  it('enforces normally when activated in production', async () => {
    await seedProfile(TIER_PROFILE, [
      { direction: 'BOTH', dimension: 'DAILY_AMOUNT', value: '9000000' },
    ]);
    await approveTierLimitPolicy([tierMapping('LEVEL_2', TIER_PROFILE)]);
    const production = enforcementWith(true, 'production');
    const customerId = await assessedCustomer('LEVEL_2');

    const result = await inTransaction((m) =>
      production.enforceWithManager(m, admission({ principalId: customerId })),
    );
    expect(result.allowed).toBe(true);
    expect(result.customerKycTier).toBe('LEVEL_2');
  }, 120000);

  it('refuses a disabled institutional policy even when the flag is on', async () => {
    await seedProfile(TIER_PROFILE, [
      { direction: 'BOTH', dimension: 'DAILY_AMOUNT', value: '9000000' },
    ]);
    await approveTierLimitPolicy([tierMapping('LEVEL_2', TIER_PROFILE)], { enabled: false });
    const customerId = await assessedCustomer('LEVEL_2');

    await expectRefusal(
      inTransaction((m) =>
        enforcement.enforceWithManager(m, admission({ principalId: customerId })),
      ),
      { status: 503, code: 'LIMIT_PROFILE_MISSING' },
    );
  }, 120000);
});

describe('protected governance is enforced for tier-limit policy', () => {
  it('refuses a proposal from the same principal that would check it', async () => {
    await seedProfile(PRODUCT_PROFILE, [
      { direction: 'BOTH', dimension: 'DAILY_AMOUNT', value: '9000000' },
    ]);
    const self = { ...maker, scopes: ['kyc.policy.propose', 'kyc.policy.approve'] };
    const current = await governance.view(maker, INSTITUTION);
    const proposal = await governance.propose(self, {
      institutionId: INSTITUTION,
      requestId: randomUUID(),
      expectedVersion: current.currentVersion,
      definition: {
        schemaVersion: 1,
        enabled: true,
        effectiveFrom: '2000-01-01T00:00:00.000Z',
        effectiveUntil: null,
        mappings: [tierMapping('LEVEL_2', PRODUCT_PROFILE)],
      },
      reason: 'maker and checker must differ',
    });
    await expect(governance.decide(self, INSTITUTION, proposal.id, true)).rejects.toBeTruthy();
  }, 120000);

  it('refuses to decide the same proposal twice', async () => {
    await seedProfile(PRODUCT_PROFILE, [
      { direction: 'BOTH', dimension: 'DAILY_AMOUNT', value: '9000000' },
    ]);
    const current = await governance.view(maker, INSTITUTION);
    const proposal = await governance.propose(maker, {
      institutionId: INSTITUTION,
      requestId: randomUUID(),
      expectedVersion: current.currentVersion,
      definition: {
        schemaVersion: 1,
        enabled: true,
        effectiveFrom: '2000-01-01T00:00:00.000Z',
        effectiveUntil: null,
        mappings: [tierMapping('LEVEL_2', PRODUCT_PROFILE)],
      },
      reason: 'single-use decision',
    });
    await governance.decide(checker, INSTITUTION, proposal.id, true);
    await expect(governance.decide(checker, INSTITUTION, proposal.id, true)).rejects.toBeTruthy();
  }, 120000);

  it('refuses a stale expected version', async () => {
    await seedProfile(PRODUCT_PROFILE, [
      { direction: 'BOTH', dimension: 'DAILY_AMOUNT', value: '9000000' },
    ]);
    const current = await governance.view(maker, INSTITUTION);
    await expect(
      governance.propose(maker, {
        institutionId: INSTITUTION,
        requestId: randomUUID(),
        expectedVersion: current.currentVersion + 41,
        definition: {
          schemaVersion: 1,
          enabled: true,
          effectiveFrom: '2000-01-01T00:00:00.000Z',
          effectiveUntil: null,
          mappings: [tierMapping('LEVEL_2', PRODUCT_PROFILE)],
        },
        reason: 'version conflict',
      }),
    ).rejects.toBeTruthy();
  }, 120000);

  it('rejects a direct runtime insert of an APPROVED tier-limit proposal', async () => {
    // Ordinary runtime credentials must not be able to manufacture a privileged decision.
    await expect(
      db.query(
        `INSERT INTO institution_kyc_limit_policy_proposals(id,request_id,expected_version,definition,fingerprint,institution_id,maker_id,maker_session_id,checker_id,checker_session_id,state)
         VALUES($1,$2,0,'{}'::jsonb,$3,$4,'forged','${randomUUID()}','forged','${randomUUID()}','APPROVED')`,
        [randomUUID(), randomUUID(), 'f'.repeat(64), INSTITUTION],
      ),
    ).rejects.toBeTruthy();
  }, 120000);
});
