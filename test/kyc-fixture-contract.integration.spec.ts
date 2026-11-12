import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { createIntegrationDataSource, truncateAllTables } from './support/pg-harness';
import {
  KYC_INITIAL_SINGLETON_STATE,
  makeCustomerFinanciallyEligible,
  restoreKycSingletons,
  seedGovernedTierPolicy,
} from './support/kyc-test-fixtures';
import { createTestEvidenceReader } from './support/kyc-test-evidence-reader';
import { CustomerFinancialEligibilityService } from '../src/kyc-verification/customer-financial-eligibility.service';
import { KycTierPolicyService } from '../src/kyc-verification/kyc-tier-policy.service';
import type { AuthorizationService } from '../src/authorization/authorization.service';

/**
 * Contract tests for the shared PostgreSQL fixtures themselves.
 *
 * Every integration suite depends on three pieces of test infrastructure:
 *
 *   1. `truncateAllTables` restores the migration-seeded KYC singletons after a wholesale
 *      `TRUNCATE ... CASCADE`, so governance behaviour never depends on suite ordering.
 *   2. `createTestEvidenceReader` supplies *test-only* trusted evidence and stays fail-closed
 *      (`UNAVAILABLE`) unless a suite explicitly asks for `ELIGIBLE`.
 *   3. `makeCustomerFinanciallyEligible` turns an old-style raw-SQL customer into one the
 *      governed `CustomerFinancialEligibilityService.require()` gate accepts.
 *
 * If any of those regress, dozens of suites fail with misleading business-logic errors. These
 * tests make such a regression local and explicit. They also pin the *negative* direction: the
 * fixtures must never make an unapproved, evidence-less or policy-less customer eligible.
 */
describe('Shared KYC fixtures (real PostgreSQL)', () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = await createIntegrationDataSource('kycfix');
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  beforeEach(async () => {
    await truncateAllTables(dataSource);
  });

  /** `effective()` is a pure read of the policy tables; it never touches authorization. */
  function serviceUsing(reader: { read: (...args: never[]) => unknown }) {
    const policies = new KycTierPolicyService(dataSource, {} as AuthorizationService);
    return new CustomerFinancialEligibilityService(policies, reader as never);
  }

  async function createRawCustomer(): Promise<string> {
    const rows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO customers (reference, customer_type, status, kyc_level, kyc_status)
       VALUES ($1,'INDIVIDUAL','ACTIVE','LEVEL_1','APPROVED') RETURNING id`,
      [`cust-fixture-${randomUUID().slice(0, 8)}`],
    );
    const customerId = rows[0]!.id;
    await dataSource.query(
      `INSERT INTO customer_profiles (customer_id, display_name, is_active) VALUES ($1,'Fixture',true)`,
      [customerId],
    );
    await dataSource.query(
      `INSERT INTO customer_contact_methods
         (customer_id, type, value, normalized_value, is_primary, verified_at)
       VALUES ($1,'PHONE',$2,$2,true,clock_timestamp())`,
      [customerId, `+23480${Math.floor(10_000_000 + Math.random() * 89_999_999)}`],
    );
    return customerId;
  }

  async function requireEligible(
    service: CustomerFinancialEligibilityService,
    customerId: string,
  ): Promise<void> {
    await dataSource.transaction((manager) => service.require(manager, customerId));
  }

  it('restores the migration-seeded KYC singletons after a wholesale truncate', async () => {
    const lock: Array<{ provider: string }> = await dataSource.query(
      'SELECT provider FROM kyc_registration_synthetic_provider_lock ORDER BY provider',
    );
    expect(lock.map((row) => row.provider)).toEqual([
      ...KYC_INITIAL_SINGLETON_STATE.syntheticProviderLock,
    ]);

    const head: Array<{ version: number }> = await dataSource.query(
      'SELECT version FROM kyc_tier_policy_head WHERE singleton=true',
    );
    expect(head[0]!.version).toBe(KYC_INITIAL_SINGLETON_STATE.tierPolicyVersion);

    const config: Array<{ version: number; configuration: unknown }> = await dataSource.query(
      'SELECT version, configuration FROM kyc_provider_configuration WHERE singleton=true',
    );
    expect(config[0]!.version).toBe(KYC_INITIAL_SINGLETON_STATE.providerConfigurationVersion);
    expect(config[0]!.configuration).toEqual(KYC_INITIAL_SINGLETON_STATE.providerConfiguration);
  });

  it('restores those singletons even when a suite deleted them', async () => {
    await dataSource.query('DELETE FROM kyc_registration_synthetic_provider_lock');
    await dataSource.query('DELETE FROM kyc_provider_configuration');
    await dataSource.query('DELETE FROM kyc_tier_policy_head');
    await restoreKycSingletons(dataSource);
    const lock: Array<{ provider: string }> = await dataSource.query(
      'SELECT provider FROM kyc_registration_synthetic_provider_lock',
    );
    expect(lock).toHaveLength(1);
    const config: Array<{ version: number }> = await dataSource.query(
      'SELECT version FROM kyc_provider_configuration WHERE singleton=true',
    );
    expect(config).toHaveLength(1);
    const head: Array<{ version: number }> = await dataSource.query(
      'SELECT version FROM kyc_tier_policy_head WHERE singleton=true',
    );
    expect(head).toHaveLength(1);
  });

  it('makes a raw-SQL customer pass the governed eligibility gate', async () => {
    const handle = createTestEvidenceReader({ mode: 'ELIGIBLE' });
    const customerId = await createRawCustomer();
    await makeCustomerFinanciallyEligible(dataSource, customerId, handle);
    await expect(requireEligible(serviceUsing(handle.reader), customerId)).resolves.toBeUndefined();
  });

  it('is idempotent: a second call leaves one current assessment and one evidence set', async () => {
    const handle = createTestEvidenceReader({ mode: 'ELIGIBLE' });
    const customerId = await createRawCustomer();
    await makeCustomerFinanciallyEligible(dataSource, customerId, handle);
    await makeCustomerFinanciallyEligible(dataSource, customerId, handle);
    const assessments: Array<{ count: string }> = await dataSource.query(
      `SELECT count(*)::text AS count FROM customer_kyc_assessments
        WHERE customer_id=$1 AND is_current=true`,
      [customerId],
    );
    expect(assessments[0]!.count).toBe('1');
    const attempts: Array<{ count: string }> = await dataSource.query(
      'SELECT count(*)::text AS count FROM kyc_verification_attempts WHERE customer_id=$1',
      [customerId],
    );
    expect(attempts[0]!.count).toBe('1');
    await expect(requireEligible(serviceUsing(handle.reader), customerId)).resolves.toBeUndefined();
  });

  it('does not leak eligibility: the default reader is UNAVAILABLE and keeps the gate closed', async () => {
    const handle = createTestEvidenceReader();
    expect(handle.mode).toBe('UNAVAILABLE');
    const customerId = await createRawCustomer();
    await seedGovernedTierPolicy(dataSource);
    await expect(handle.reader.read(dataSource.manager, customerId)).resolves.toBeNull();
    await makeCustomerFinanciallyEligible(dataSource, customerId, handle);
    await expect(requireEligible(serviceUsing(handle.reader), customerId)).rejects.toThrow(
      /Trusted KYC evidence is unavailable/,
    );
  });

  it('keeps the gate closed when the customer is not APPROVED', async () => {
    const handle = createTestEvidenceReader({ mode: 'ELIGIBLE' });
    const customerId = await createRawCustomer();
    await makeCustomerFinanciallyEligible(dataSource, customerId, handle);
    await dataSource.query(`UPDATE customers SET kyc_status='REJECTED' WHERE id=$1`, [customerId]);
    await expect(requireEligible(serviceUsing(handle.reader), customerId)).rejects.toThrow(
      /not eligible for financial access/,
    );
  });

  it('keeps the gate closed when no governed tier policy is in force', async () => {
    const handle = createTestEvidenceReader({ mode: 'ELIGIBLE' });
    const customerId = await createRawCustomer();
    await makeCustomerFinanciallyEligible(dataSource, customerId, handle);
    // Return the governance tables to their migration-seeded "no approved policy" state.
    await dataSource.query('DELETE FROM kyc_tier_policy_versions');
    await dataSource.query('UPDATE kyc_tier_policy_head SET version=0 WHERE singleton=true');
    await expect(requireEligible(serviceUsing(handle.reader), customerId)).rejects.toThrow(
      /not eligible for financial access|DISABLED/,
    );
  });

  it('keeps the gate closed when the seeded evidence has expired', async () => {
    const handle = createTestEvidenceReader({ mode: 'ELIGIBLE' });
    const customerId = await createRawCustomer();
    await makeCustomerFinanciallyEligible(dataSource, customerId, handle);
    await dataSource.query(
      `UPDATE kyc_verification_attempts SET expires_at=clock_timestamp()-INTERVAL '1 second'
        WHERE customer_id=$1`,
      [customerId],
    );
    await expect(requireEligible(serviceUsing(handle.reader), customerId)).rejects.toThrow(
      /not eligible for financial access/,
    );
  });
});
