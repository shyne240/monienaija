import { createHash, randomUUID } from 'node:crypto';
import type { DataSource, EntityManager } from 'typeorm';

/**
 * Shared, real-PostgreSQL KYC fixtures.
 *
 * ## Why this exists
 *
 * The Batch 2C consolidation introduced a governed financial-eligibility gate
 * (`CustomerFinancialEligibilityService.require`) that every wallet and financial path now goes
 * through. Dozens of older integration suites create their customers with direct SQL against
 * `customers`/`customer_profiles`/`customer_contact_methods`, which is a perfectly reasonable
 * fixture style for tests that are about something else (limits, history, PIN hardening), but
 * such a customer has no trusted evidence, no current assessment and no governed tier policy —
 * so the gate correctly rejects it.
 *
 * The fix belongs in the fixtures, never in production authorization. These helpers build the
 * evidence *honestly*: real `kyc_consents`, real `kyc_verification_attempts`, real
 * `kyc_identity_claims`, written in exactly the columns the schema and the production read path
 * require, MAC-bound to the test reader's trust anchor. No application code is bypassed and
 * nothing is stubbed in the gate itself.
 *
 * ## The singleton problem
 *
 * `truncateAllTables` does a wholesale `TRUNCATE ... CASCADE`, which also empties three tables
 * that migrations seed exactly once:
 *
 *   - `kyc_tier_policy_head`                        (`{singleton, version=0}`)
 *   - `kyc_provider_configuration`                  (both providers disabled, no routes)
 *   - `kyc_registration_synthetic_provider_lock`    (`provider='SYNTHETIC'`)
 *
 * Without those rows, `KycTierPolicyService.effective()` throws `KYC foundation: DISABLED` and
 * provider governance behaves as though the platform were unconfigured. `restoreKycSingletons`
 * puts them back so suite order cannot matter.
 */

/**
 * The migration-seeded initial state of the KYC singleton tables. Transcribed from migrations
 * 1785753600104/0108/0109/0110 — the constants are asserted against a freshly truncated
 * database by `test/kyc-fixture-contract.integration.spec.ts`.
 */
export const KYC_INITIAL_SINGLETON_STATE = {
  syntheticProviderLock: ['SYNTHETIC'] as const,
  providerConfigurationVersion: 0,
  /**
   * Byte-for-byte the snapshot migration 1785753600109 inserts: both providers disabled, no
   * routes. Restoring anything else would silently change governance behaviour.
   */
  providerConfiguration: {
    providers: {
      MONNIFY: { enabled: false, capabilities: [] as string[] },
      SYNTHETIC: { enabled: false, capabilities: [] as string[] },
    },
    routes: {
      BVN: { primary: null, fallback: null },
      NIN: { primary: null, fallback: null },
    },
  },
  tierPolicyVersion: 0,
} as const;

async function tableExists(dataSource: DataSource, table: string): Promise<boolean> {
  const rows: Array<{ present: boolean }> = await dataSource.query(
    `SELECT to_regclass($1) IS NOT NULL AS present`,
    [`public.${table}`],
  );
  return rows[0]?.present === true;
}

/**
 * Restores the migration-seeded KYC singletons after a wholesale TRUNCATE.
 *
 * Idempotent, insert-if-absent only: a row that a test deliberately changed or removed is not
 * silently overwritten back to the initial state mid-test. Callers that want the initial state
 * back call `resetKycSingletons` explicitly instead.
 *
 * A no-op when the suite's schema predates the KYC migrations (some older suites create a
 * partial schema), so this can be called unconditionally from `truncateAllTables`.
 */
export async function restoreKycSingletons(dataSource: DataSource): Promise<void> {
  if (await tableExists(dataSource, 'kyc_registration_synthetic_provider_lock')) {
    for (const provider of KYC_INITIAL_SINGLETON_STATE.syntheticProviderLock) {
      await dataSource.query(
        `INSERT INTO kyc_registration_synthetic_provider_lock (provider) VALUES ($1)
         ON CONFLICT (provider) DO NOTHING`,
        [provider],
      );
    }
  }

  if (await tableExists(dataSource, 'kyc_provider_configuration')) {
    await dataSource.query(
      `INSERT INTO kyc_provider_configuration (singleton, version, configuration)
       VALUES (true, $1, $2::jsonb)
       ON CONFLICT (singleton) DO NOTHING`,
      [
        KYC_INITIAL_SINGLETON_STATE.providerConfigurationVersion,
        JSON.stringify(KYC_INITIAL_SINGLETON_STATE.providerConfiguration),
      ],
    );
  }

  if (await tableExists(dataSource, 'kyc_tier_policy_head')) {
    await dataSource.query(
      `INSERT INTO kyc_tier_policy_head (singleton, version) VALUES (true, $1)
       ON CONFLICT (singleton) DO NOTHING`,
      [KYC_INITIAL_SINGLETON_STATE.tierPolicyVersion],
    );
  }
}

/**
 * Forces the singletons back to their migration-seeded state, discarding any policy a test
 * approved. Only for tests that are specifically about "unconfigured" behaviour.
 */
export async function resetKycSingletons(dataSource: DataSource): Promise<void> {
  if (await tableExists(dataSource, 'kyc_tier_policy_versions')) {
    await dataSource.query('DELETE FROM kyc_tier_policy_versions');
  }
  if (await tableExists(dataSource, 'kyc_tier_policy_head')) {
    await dataSource.query('DELETE FROM kyc_tier_policy_head');
  }
  if (await tableExists(dataSource, 'kyc_provider_configuration')) {
    await dataSource.query('DELETE FROM kyc_provider_configuration');
  }
  if (await tableExists(dataSource, 'kyc_registration_synthetic_provider_lock')) {
    await dataSource.query('DELETE FROM kyc_registration_synthetic_provider_lock');
  }
  await restoreKycSingletons(dataSource);
}

export interface GovernedTierPolicyOptions {
  /** Overrides the policy definition. Defaults to `DEFAULT_GOVERNED_TIER_POLICY`. */
  definition?: Record<string, unknown>;
  makerId?: string;
  checkerId?: string;
}

/**
 * The policy definition a governed maker/checker pair would approve: deliberately permissive at
 * the operator layer, because `decideTier` already enforces the fixed mission floor (BVN or NIN
 * for tier 1; BVN *and* NIN for tier 2) independently of any policy. Fixture data for tests that
 * need a *governed* policy in force — not a policy recommendation, and it never bypasses the
 * approval path: rows are written in the shape the real `KycTierPolicyService.approve` writes
 * (proposal → version → head pointer), including the `maker_id <> checker_id` check.
 */
export const DEFAULT_GOVERNED_TIER_POLICY = {
  regulatoryRequirementsConfirmed: true,
  effectiveFrom: '2026-01-01T00:00:00.000Z',
  effectiveUntil: null,
  regulatory: {
    LEVEL_1: { all: [], any: [] },
    LEVEL_2: { all: ['PHONE'], any: [] },
  },
  operator: {
    LEVEL_1: { all: [], any: [] },
    LEVEL_2: { all: [], any: [] },
  },
} as const;

export interface GovernedTierPolicy {
  version: number;
  proposalId: string;
}

/**
 * Installs a governed (maker-checker approved) tier policy as version 1 and points the head at
 * it, exercising the real read path (`kyc_tier_policy_versions` + `kyc_tier_policy_head`).
 * Idempotent: if an approved version already exists, its version number is returned unchanged.
 */
export async function seedGovernedTierPolicy(
  dataSource: DataSource,
  options: GovernedTierPolicyOptions = {},
): Promise<GovernedTierPolicy> {
  const definition = options.definition ?? DEFAULT_GOVERNED_TIER_POLICY;
  const makerId = options.makerId ?? 'integration-harness-maker';
  const checkerId = options.checkerId ?? 'integration-harness-checker';
  if (makerId === checkerId) {
    throw new Error('Governed KYC policy fixtures require a distinct maker and checker');
  }
  const existing: Array<{ version: number; proposal_id: string }> = await dataSource.query(
    'SELECT version, proposal_id FROM kyc_tier_policy_versions ORDER BY version DESC LIMIT 1',
  );
  if (existing[0]) {
    await dataSource.query('UPDATE kyc_tier_policy_head SET version=$1 WHERE singleton=true', [
      existing[0].version,
    ]);
    return { version: existing[0].version, proposalId: existing[0].proposal_id };
  }
  const version = 1;
  const proposalId = randomUUID();
  await dataSource.query(
    `INSERT INTO kyc_tier_policy_proposals
       (id, request_id, expected_version, definition, fingerprint, maker_id, maker_session_id,
        checker_id, checker_session_id, state, decided_at)
     VALUES ($1, $2, 0, $3::jsonb, $4, $5, $2, $6, $2, 'APPROVED', clock_timestamp())`,
    [proposalId, randomUUID(), JSON.stringify(definition), '0'.repeat(64), makerId, checkerId],
  );
  await dataSource.query(
    `INSERT INTO kyc_tier_policy_versions
       (version, proposal_id, definition, maker_id, checker_id)
     VALUES ($1, $2, $3::jsonb, $4, $5)`,
    [version, proposalId, JSON.stringify(definition), makerId, checkerId],
  );
  await dataSource.query('UPDATE kyc_tier_policy_head SET version = $1 WHERE singleton = true', [
    version,
  ]);
  return { version, proposalId };
}

export interface SeedIdentityEvidenceOptions {
  kind?: 'BVN' | 'NIN';
  provider?: string;
  identityMac: string;
  macKeyVersion: string;
  validForSeconds?: number;
  claimStatus?: 'PENDING' | 'VERIFIED' | 'UNKNOWN' | 'REVIEW';
}

/**
 * Writes the three rows the trusted read path needs, in the shape the real orchestrator writes
 * them: a consent, a completed `MATCH` attempt bound to the identity MAC, and a verified claim.
 */
export async function seedIdentityEvidence(
  manager: EntityManager | DataSource,
  customerId: string,
  options: SeedIdentityEvidenceOptions,
): Promise<string> {
  const kind = options.kind ?? 'BVN';
  const provider = options.provider ?? 'ISOLATED_TRUSTED_FIXTURE';
  const validFor = options.validForSeconds ?? 3600;
  const consentRows: Array<{ id: string }> = await manager.query(
    `INSERT INTO kyc_consents
       (id, customer_id, kind, notice_version, actor_id, expires_at)
     VALUES (gen_random_uuid(), $1, $2, 'integration-fixture-v1', gen_random_uuid(),
             clock_timestamp() + ($3 || ' seconds')::interval)
     RETURNING id`,
    [customerId, kind, String(validFor)],
  );
  const consentId = consentRows[0]!.id;
  const attemptRows: Array<{ id: string }> = await manager.query(
    `INSERT INTO kyc_verification_attempts
       (id, customer_id, consent_id, request_id, kind, provider, policy_version, request_mac,
        identity_mac, mac_key_version, outcome, completed_at, expires_at)
     VALUES (gen_random_uuid(), $1, $2, gen_random_uuid(), $3, $4, 'integration-fixture-v1',
             $5, $5, $6, 'MATCH', clock_timestamp(),
             clock_timestamp() + ($7 || ' seconds')::interval)
     RETURNING id`,
    [
      customerId,
      consentId,
      kind,
      provider,
      options.identityMac,
      options.macKeyVersion,
      String(validFor),
    ],
  );
  const attemptId = attemptRows[0]!.id;
  await manager.query(
    `INSERT INTO kyc_identity_claims (id, kind, identifier_mac, customer_id, attempt_id, status)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5)`,
    [
      kind,
      // Unique per (kind, identifier_mac): derive from the attempt so fixtures never collide on
      // the schema's UNIQUE(kind, identifier_mac) index.
      createHash('sha256').update(`${kind}:${attemptId}`).digest('hex'),
      customerId,
      attemptId,
      options.claimStatus ?? 'VERIFIED',
    ],
  );
  return attemptId;
}

export interface EligibleCustomerOptions {
  /** KYC level the customer is approved for. Defaults to LEVEL_1. */
  level?: 'LEVEL_1' | 'LEVEL_2';
  /** Assessment expiry in seconds from now. Defaults to one hour. */
  assessmentValidForSeconds?: number;
  /** First/last name and date of birth used by the identity binding. */
  firstName?: string;
  lastName?: string;
  dateOfBirth?: string;
  /** E.164-ish phone recorded as the single verified primary contact. */
  phone?: string;
  /** `assessed_by` recorded on the seeded APPROVED assessment (e.g. `SERVICE`). */
  assessedBy?: string;
  kind?: 'BVN' | 'NIN';
}

/** Structural type of the pieces of a test evidence-reader handle this module needs. */
export interface FixtureEvidenceReader {
  keyVersion: string;
  identityMacFor(
    customerId: string,
    identity: { firstName: string; lastName: string; dateOfBirth: string; phone: string },
  ): string;
}

/**
 * What `makeCustomerFinanciallyEligible` accepts: either a `createTestEvidenceReader` handle
 * (which already satisfies `FixtureEvidenceReader`) or the reader itself.
 */
export type EligibleEvidenceSource = FixtureEvidenceReader | { reader: FixtureEvidenceReader };

/**
 * Turns an already-created customer into one that satisfies every precondition of
 * `CustomerFinancialEligibilityService.require()`, in one call.
 *
 * Use this only in suites that are *not* testing KYC rejection, and only alongside an installed
 * `ELIGIBLE` test evidence reader (see `createTestEvidenceReader`). It:
 *
 *   - completes the identity the trusted reader needs (first/last name, date of birth);
 *   - ensures exactly one verified primary phone contact, promoting/verifying an existing row in
 *     place rather than adding a second phone (so counterparty assertions still see the value the
 *     suite chose);
 *   - ensures a governed tier policy is in force;
 *   - adds a current, unexpired APPROVED assessment at the requested level;
 *   - adds identity evidence whose MAC matches the supplied reader's trust anchor.
 *
 * Idempotent: calling it twice leaves one current assessment and one evidence set, so a customer
 * helper and a KYC helper can both call it safely.
 */
export async function makeCustomerFinanciallyEligible(
  dataSource: DataSource,
  customerId: string,
  source: EligibleEvidenceSource,
  options: EligibleCustomerOptions = {},
): Promise<{ identityRevision: string }> {
  const reader: FixtureEvidenceReader =
    typeof (source as FixtureEvidenceReader).identityMacFor === 'function'
      ? (source as FixtureEvidenceReader)
      : (source as { reader: FixtureEvidenceReader }).reader;
  const level = options.level ?? 'LEVEL_1';
  const firstName = options.firstName ?? 'Ada';
  const lastName = options.lastName ?? 'Okafor';
  const dateOfBirth = options.dateOfBirth ?? '1990-04-12';
  const validForSeconds = options.assessmentValidForSeconds ?? 3600;
  const assessedBy = options.assessedBy ?? 'integration-harness';

  // Customer row must be ACTIVE / APPROVED at an allowed level.
  await dataSource.query(
    `UPDATE customers SET status='ACTIVE', kyc_status='APPROVED', kyc_level=$2 WHERE id=$1`,
    [customerId, level],
  );

  // Profile: fill the identity parts the reader binds to, creating the profile if absent.
  const profiles: Array<{ id: string; first_name: string | null }> = await dataSource.query(
    `SELECT id, first_name FROM customer_profiles
      WHERE customer_id=$1 AND is_active=true AND deleted_at IS NULL`,
    [customerId],
  );
  if (profiles[0]) {
    await dataSource.query(
      `UPDATE customer_profiles
          SET first_name=COALESCE(first_name,$2), last_name=COALESCE(last_name,$3),
              date_of_birth=COALESCE(date_of_birth,$4)
        WHERE id=$1`,
      [profiles[0].id, firstName, lastName, dateOfBirth],
    );
  } else {
    await dataSource.query(
      `INSERT INTO customer_profiles
         (customer_id, display_name, first_name, last_name, date_of_birth, is_active)
       VALUES ($1, $2, $3, $4, $5, true)`,
      [customerId, `${firstName} ${lastName}`, firstName, lastName, dateOfBirth],
    );
  }

  // Exactly one verified primary phone contact.
  const primary: Array<{ id: string; normalized_value: string }> = await dataSource.query(
    `SELECT id, normalized_value FROM customer_contact_methods
      WHERE customer_id=$1 AND type='PHONE' AND is_primary=true AND deleted_at IS NULL
      ORDER BY created_at, id`,
    [customerId],
  );
  if (primary.length > 1) {
    throw new Error(
      `Customer ${customerId} has ${primary.length} primary phones; the eligibility gate requires exactly one`,
    );
  }
  let phone: string;
  if (primary.length === 1) {
    phone = primary[0]!.normalized_value;
    // A verified timestamp is required; older fixtures inserted the row without one.
    await dataSource.query(
      `UPDATE customer_contact_methods SET verified_at=clock_timestamp()
        WHERE id=$1 AND verified_at IS NULL`,
      [primary[0]!.id],
    );
  } else {
    const phoneRows: Array<{ id: string; normalized_value: string }> = await dataSource.query(
      `SELECT id, normalized_value FROM customer_contact_methods
        WHERE customer_id=$1 AND type='PHONE' AND deleted_at IS NULL
        ORDER BY created_at, id`,
      [customerId],
    );
    if (phoneRows.length === 1) {
      phone = phoneRows[0]!.normalized_value;
      await dataSource.query(
        `UPDATE customer_contact_methods
            SET is_primary=true, verified_at=COALESCE(verified_at, clock_timestamp())
          WHERE id=$1`,
        [phoneRows[0]!.id],
      );
    } else if (phoneRows.length > 1) {
      throw new Error(
        `Customer ${customerId} has ${phoneRows.length} phone contacts and none is primary; ` +
          'the eligibility gate requires exactly one verified primary phone',
      );
    } else {
      phone = options.phone ?? `+2348${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
      await dataSource.query(
        `INSERT INTO customer_contact_methods
           (customer_id, type, value, normalized_value, is_primary, verified_at)
         VALUES ($1,'PHONE',$2,$2,true,clock_timestamp())`,
        [customerId, phone],
      );
    }
  }

  const identity = { firstName, lastName, dateOfBirth, phone };
  const identityRevision = reader.identityMacFor(customerId, identity);

  // Governed policy in force.
  await seedGovernedTierPolicy(dataSource);

  // Current, unexpired, APPROVED assessment at the requested level. Reused when the suite has
  // already created one, so the schema's "one current assessment per customer" invariant holds.
  const current: Array<{ id: string }> = await dataSource.query(
    `SELECT id FROM customer_kyc_assessments
      WHERE customer_id=$1 AND is_current=true AND kyc_status='APPROVED'
        AND kyc_level=$2 AND expires_at > clock_timestamp()`,
    [customerId, level],
  );
  if (current.length === 0) {
    await dataSource.query(
      `UPDATE customer_kyc_assessments SET is_current=false WHERE customer_id=$1 AND is_current=true`,
      [customerId],
    );
    await dataSource.query(
      `INSERT INTO customer_kyc_assessments
         (customer_id, kyc_level, kyc_status, reason, assessed_by, is_current, expires_at)
       VALUES ($1,$2,'APPROVED','integration fixture',$4,true,
               clock_timestamp() + ($3 || ' seconds')::interval)`,
      [customerId, level, String(validForSeconds), assessedBy],
    );
  }

  // Identity evidence bound to the reader's trust anchor; reused when still valid.
  const existing: Array<{ id: string }> = await dataSource.query(
    `SELECT id FROM kyc_verification_attempts
      WHERE customer_id=$1 AND identity_mac=$2 AND mac_key_version=$3
        AND outcome='MATCH' AND expires_at > clock_timestamp()
      LIMIT 1`,
    [customerId, identityRevision, reader.keyVersion],
  );
  if (existing.length === 0) {
    await seedIdentityEvidence(dataSource, customerId, {
      kind: options.kind ?? 'BVN',
      identityMac: identityRevision,
      macKeyVersion: reader.keyVersion,
      validForSeconds,
      claimStatus: 'VERIFIED',
    });
  }

  return { identityRevision };
}

export interface CreateEligibleCustomerOptions extends EligibleCustomerOptions {
  /** Customer `reference`; defaults to a unique `cust-fixture-<uuid>` value. */
  reference?: string;
  /** `customer_type`; defaults to INDIVIDUAL. */
  customerType?: string;
}

/**
 * Creates a customer row *and* makes it financially eligible in one call.
 *
 * For suites that only need "some customer with a wallet" — accounting, fee, commission,
 * transfer and limit suites — this replaces the old `randomUUID()` placeholder, which stopped
 * being a valid wallet owner when wallet owner classification landed
 * (`wallet_owner_class()` returns `REVIEW` for an id that is not a customer or agent, and
 * `WalletService.createWallet` then correctly refuses it).
 *
 * Unlike a bare `makeCustomerFinanciallyEligible` call, nothing else has to exist first: the
 * customer, its profile, its single verified primary phone, the governed tier policy, the
 * current APPROVED assessment and the MAC-bound identity evidence are all created here.
 */
export async function createEligibleCustomer(
  dataSource: DataSource,
  source: EligibleEvidenceSource,
  options: CreateEligibleCustomerOptions = {},
): Promise<{ customerId: string; identityRevision: string }> {
  const rows: Array<{ id: string }> = await dataSource.query(
    `INSERT INTO customers (reference, customer_type, status, kyc_level, kyc_status)
     VALUES ($1,$2,'ACTIVE',$3,'APPROVED') RETURNING id`,
    [
      options.reference ?? `cust-fixture-${randomUUID()}`,
      options.customerType ?? 'INDIVIDUAL',
      options.level ?? 'LEVEL_1',
    ],
  );
  const customerId = rows[0]!.id;
  const { identityRevision } = await makeCustomerFinanciallyEligible(
    dataSource,
    customerId,
    source,
    options,
  );
  return { customerId, identityRevision };
}
