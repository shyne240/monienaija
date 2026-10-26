import type { QueryRunner } from 'typeorm';

import { AddSecureCustomerProofOfAddressUploads1785753600094 } from '../src/migrations/1785753600094-AddSecureCustomerProofOfAddressUploads';

describe('secure Proof of Address migration 0094', () => {
  it('adds encrypted-storage lifecycle metadata and append-only history without storing document bytes or keys', async () => {
    const statements: string[] = [];
    const query = jest.fn((sql: string) => {
      statements.push(sql);
      return Promise.resolve(undefined);
    });

    await new AddSecureCustomerProofOfAddressUploads1785753600094().up({
      query,
    } as unknown as QueryRunner);
    const sql = statements.join('\n').toLowerCase();

    expect(statements).toHaveLength(7);
    expect(sql).toContain("add column document_status varchar(16) not null default 'quarantined'");
    expect(sql).toContain('add column encryption_key_version varchar(64)');
    expect(sql).toContain('create unique index uq_customer_poa_submission_customer_idempotency');
    expect(sql).toContain('create table customer_proof_of_address_document_history');
    expect(sql).toContain('foreign key (submission_id, customer_id)');
    expect(sql).toContain('prevent_customer_evidence_history_mutation()');
    expect(sql).not.toContain('bytea');
    expect(sql).not.toContain('encryption_key_material');
    expect(sql).not.toContain('tier_3');
    expect(sql).not.toContain('wallet');
  });

  it('reverts only the additive 0094 objects', async () => {
    const statements: string[] = [];
    const query = jest.fn((sql: string) => {
      statements.push(sql);
      return Promise.resolve(undefined);
    });

    await new AddSecureCustomerProofOfAddressUploads1785753600094().down({
      query,
    } as unknown as QueryRunner);
    const sql = statements.join('\n').toLowerCase();

    expect(sql).toContain('drop table if exists customer_proof_of_address_document_history');
    expect(sql).toContain('drop column if exists encryption_key_version');
    expect(sql).not.toContain('customer_proof_of_address_decision_history');
    expect(sql).not.toContain('customer_physical_address_verifications');
    expect(query).toHaveBeenCalledTimes(7);
  });
});
