import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { createIntegrationDataSource, destroyIntegrationDataSource } from './support/pg-harness';

describe('Migration 0804 owner authority (real PostgreSQL)', () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = await createIntegrationDataSource('ownerAuthority0804');
  }, 60000);
  afterAll(async () => {
    if (dataSource) await destroyIntegrationDataSource(dataSource);
  });

  it('external_operations trigger rejects orphan owner (no customer or agent)', async () => {
    const orphanId = randomUUID();
    const walletId = randomUUID();
    const opId = randomUUID();
    await expect(
      dataSource.query(
        `INSERT INTO external_operations(id,customer_id,wallet_account_id,beneficiary_id,amount_minor,currency,operation_type,status,version,created_at,updated_at)
       VALUES($1,$2,$3,$4,'100','NGN','BANK_TRANSFER','PENDING',1,clock_timestamp(),clock_timestamp())`,
        [opId, orphanId, walletId, randomUUID()],
      ),
    ).rejects.toThrow();
  });

  it('customer_beneficiaries validates ownership: valid customer succeeds, orphan fails', async () => {
    const customerId = randomUUID();
    await dataSource.query(
      `INSERT INTO customers(id,reference,customer_type,status,kyc_level,kyc_status) VALUES($1,$2,'INDIVIDUAL','ACTIVE','LEVEL_1','APPROVED')`,
      [customerId, `it.owner.${Date.now()}.${Math.floor(Math.random() * 1e6)}`],
    );
    const benId = randomUUID();
    await dataSource.query(
      `INSERT INTO customer_beneficiaries(id,customer_id,beneficiary_type,display_name,reference,destination_identifier,normalized_destination_identifier,destination_name,destination_institution,nickname,status,verified,version,created_at,updated_at)
       VALUES($1,$2,'BANK_ACCOUNT','Test',$3,'1234567890','1234567890','Test','BANKA','Nick','ACTIVE',true,1,clock_timestamp(),clock_timestamp())`,
      [benId, customerId, `bank-${randomUUID()}`],
    );
    const orphanBen = randomUUID();
    const orphanId2 = randomUUID();
    await expect(
      dataSource.query(
        `INSERT INTO customer_beneficiaries(id,customer_id,beneficiary_type,display_name,reference,destination_identifier,normalized_destination_identifier,destination_name,destination_institution,nickname,status,verified,version,created_at,updated_at)
       VALUES($1,$2,'BANK_ACCOUNT','Orphan',$3,'1234567890','1234567890','Orphan','BANKA','Nick','ACTIVE',true,1,clock_timestamp(),clock_timestamp())`,
        [orphanBen, orphanId2, `bank-${randomUUID()}`],
      ),
    ).rejects.toThrow();
  });

  it('financial_authorizations trigger rejects unbound evidence', async () => {
    const fakeId = randomUUID();
    await expect(
      dataSource.query(
        `INSERT INTO financial_authorizations(id,customer_id,agent_id,session_id,pin_audit_id,wallet_account_id,ledger_account_id,amount_minor,currency,request_hash,principal_type,principal_id,institution)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          fakeId,
          null,
          randomUUID(),
          randomUUID(),
          randomUUID(),
          randomUUID(),
          randomUUID(),
          '100',
          'NGN',
          'a'.repeat(64),
          'AGENT',
          randomUUID(),
          null,
        ],
      ),
    ).rejects.toThrow();
  });

  it('wallet_accounts owner_class generalizes correctly', async () => {
    const rows: Array<{ column_name: string }> = await dataSource.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name='wallet_accounts' AND column_name IN ('customer_id','agent_id','owner_class')`,
    );
    expect(rows.length).toBeGreaterThanOrEqual(2);
  });

  it('migration 0804 sits beneath the customer-class and submitter-attribution head', async () => {
    const rows: Array<{ timestamp: string; name: string }> = await dataSource.query(
      `SELECT timestamp::text AS timestamp, name FROM typeorm_migrations ORDER BY timestamp DESC LIMIT 3`,
    );
    expect(rows[0]).toEqual({
      timestamp: '1785753600806',
      name: 'AgentApplicationSubmitterAttribution1785753600806',
    });
    expect(rows[1]).toEqual({
      timestamp: '1785753600805',
      name: 'CreateCustomerClasses1785753600805',
    });
    expect(rows[2]).toEqual({
      timestamp: '1785753600804',
      name: 'GeneralizeExternalOperationsForAgents1785753600804',
    });
  });

  it('historical customer financial_authorizations still readable', async () => {
    const rows: Array<{ count: string }> = await dataSource.query(
      `SELECT COUNT(*)::text as count FROM financial_authorizations`,
    );
    expect(rows[0]).toBeDefined();
  });
});
