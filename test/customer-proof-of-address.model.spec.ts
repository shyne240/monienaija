import { getMetadataArgsStorage } from 'typeorm';
import type { QueryRunner } from 'typeorm';

import { CANDIDATE_PROOF_OF_ADDRESS_TYPES } from '../src/customer-proof-of-address/customer-proof-of-address.constants';
import { CustomerPhysicalAddressVerification } from '../src/customer-proof-of-address/customer-physical-address-verification.entity';
import { CustomerPhysicalAddressVerificationHistory } from '../src/customer-proof-of-address/customer-physical-address-verification-history.entity';
import { CustomerProofOfAddressDecisionHistory } from '../src/customer-proof-of-address/customer-proof-of-address-decision-history.entity';
import { CustomerProofOfAddressSubmission } from '../src/customer-proof-of-address/customer-proof-of-address-submission.entity';
import { CreateCustomerProofOfAddressWorkflows1785753600093 } from '../src/migrations/1785753600093-CreateCustomerProofOfAddressWorkflows';

describe('Customer Proof of Address policy-neutral persistence', () => {
  it('marks every seeded evidence type as a configurable candidate, not an approved rule', () => {
    expect(CANDIDATE_PROOF_OF_ADDRESS_TYPES.map(({ type }) => type)).toEqual([
      'UTILITY_BILL',
      'TAX_ASSESSMENT',
      'BANK_STATEMENT',
      'PUBLIC_AUTHORITY_LETTER',
    ]);
    expect(
      CANDIDATE_PROOF_OF_ADDRESS_TYPES.every((candidate) => candidate.policyApproved === false),
    ).toBe(true);
  });

  it('declares separate documentary, decision-history, and physical-verification entities', () => {
    expect(CustomerProofOfAddressSubmission).toBeDefined();
    expect(CustomerProofOfAddressDecisionHistory).toBeDefined();
    expect(CustomerPhysicalAddressVerification).toBeDefined();
    expect(CustomerPhysicalAddressVerificationHistory).toBeDefined();
  });

  it('creates additive, customer/address-scoped metadata tables and immutable histories without storing file bytes', async () => {
    const statements: string[] = [];
    const query = jest.fn((sql: string) => {
      statements.push(sql);
      return Promise.resolve(undefined);
    });
    const queryRunner = { query } as unknown as QueryRunner;

    await new CreateCustomerProofOfAddressWorkflows1785753600093().up(queryRunner);
    const sql = statements.join('\n').toLowerCase();

    expect(sql).toContain('create table customer_proof_of_address_submissions');
    expect(sql).toContain('create table customer_proof_of_address_decision_history');
    expect(sql).toContain('create table customer_physical_address_verifications');
    expect(sql).toContain('create table customer_physical_address_verification_history');
    expect(sql).toContain('foreign key (residential_address_id, customer_id)');
    expect(sql).toContain("review_status in ('pending', 'verified', 'rejected')");
    expect(sql).toContain('reviewed_by_principal_id <> uploaded_by_principal_id');
    expect(sql).toContain('decided_by_principal_id <> assigned_officer_principal_id');
    expect(sql).toContain('create trigger trg_customer_poa_decision_history_immutable');
    expect(sql).toContain('create trigger trg_customer_physical_verification_history_immutable');

    const workflowEntityTargets = new Set<object>([
      CustomerProofOfAddressSubmission,
      CustomerProofOfAddressDecisionHistory,
      CustomerPhysicalAddressVerification,
      CustomerPhysicalAddressVerificationHistory,
    ]);
    const entityCheckNames = getMetadataArgsStorage()
      .checks.filter(
        (check) => typeof check.target !== 'string' && workflowEntityTargets.has(check.target),
      )
      .map((check) => check.name)
      .filter((checkName): checkName is string => Boolean(checkName));
    expect(entityCheckNames.length).toBeGreaterThan(0);
    const checksAddedBy0094 = new Set([
      'chk_customer_poa_document_status',
      'chk_customer_poa_scanner_result',
      'chk_customer_poa_available_requires_clean_scan',
      'chk_customer_poa_withdrawal_metadata',
      'chk_customer_poa_archive_metadata',
      'chk_customer_poa_idempotency_hash',
    ]);
    for (const checkName of entityCheckNames) {
      // This specification intentionally validates the immutable 0093 migration; lifecycle
      // constraints added by 0094 have their own additive-migration specification.
      if (checksAddedBy0094.has(checkName)) continue;
      expect(sql).toContain(`constraint ${checkName.toLowerCase()}`);
    }

    expect(sql).not.toContain('bytea');
    expect(sql).not.toContain('freshness_days');
    expect(sql).not.toContain('tier_3_eligible');
  });

  it('reverts only the additive PoA tables and their address index support', async () => {
    const statements: string[] = [];
    const query = jest.fn((sql: string) => {
      statements.push(sql);
      return Promise.resolve(undefined);
    });
    const queryRunner = { query } as unknown as QueryRunner;

    await new CreateCustomerProofOfAddressWorkflows1785753600093().down(queryRunner);
    const sql = statements.join('\n').toLowerCase();
    expect(sql).toContain('drop table if exists customer_proof_of_address_submissions');
    expect(sql).toContain('drop table if exists customer_physical_address_verifications');
    expect(sql).toContain('drop constraint if exists uq_customer_addresses_id_customer');
    expect(sql).not.toContain('drop table if exists customers');
    expect(query).toHaveBeenCalledTimes(8);
  });
});
