import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';

import { createIntegrationDataSource } from './support/pg-harness';

/**
 * Structural acceptance for migration `1785753600600`.
 *
 * These assertions are deliberately made at the database, not through a service. The point of a
 * protected-authority boundary is that it holds even when application code is wrong, bypassed, or an
 * attacker has obtained the ordinary runtime credential. A service-level test cannot demonstrate
 * that; it can only demonstrate that the service is polite.
 */
describe('banking provider governance schema (real PostgreSQL)', () => {
  let db: DataSource;
  let institutionId: string;

  beforeAll(async () => {
    db = await createIntegrationDataSource('bkpgov00');
    // A fresh template database contains no institution; the governance tables are institution-scoped
    // by foreign key, so the fixture supplies one rather than weakening the constraint.
    institutionId = randomUUID();
    // `fn_financial_institution_guard` requires an institution to be created as REGISTERED; it is
    // promoted through the governed lifecycle, never inserted directly as APPROVED. These structural
    // assertions do not depend on the institution's lifecycle state, so REGISTERED is sufficient.
    const suffix = institutionId.replace(/-/g, '').slice(0, 8).toUpperCase();
    await db.query(
      `INSERT INTO financial_institutions (id,reference,code,legal_name,institution_type,created_by)
       VALUES ($1,$2,$3,'Banking governance fixture','PARTNER','fixture')`,
      [institutionId, `BKGOV-${suffix}`, `BKGOV_${suffix}`],
    );
  }, 120000);

  afterAll(async () => {
    if (db?.isInitialized) await db.destroy();
  });

  async function makeProposal(over: { state?: string; providerKey?: string } = {}) {
    const id = randomUUID();
    await db.query(
      `INSERT INTO banking_provider_configuration_heads(institution_id) VALUES($1)
       ON CONFLICT (institution_id) DO NOTHING`,
      [institutionId],
    );
    await db.query(
      `INSERT INTO banking_provider_configuration_proposals
        (id,institution_id,request_id,expected_version,provider_key,environment,capabilities,
         routing_approved,operational_ready,definition,fingerprint,reason,maker_id,maker_session_id,
         expires_at)
       VALUES($1,$2,$3,0,$4,'sandbox','{}'::jsonb,false,false,'{}'::jsonb,$5,
              'structural acceptance fixture',$6,$7,clock_timestamp()+interval '15 minutes')`,
      [
        id,
        institutionId,
        randomUUID(),
        over.providerKey ?? 'MONNIFY',
        'a'.repeat(64),
        'maker-fixture',
        randomUUID(),
      ],
    );
    if (over.state === 'APPROVED') {
      await db.query(
        `UPDATE banking_provider_configuration_proposals
            SET state='APPROVED',checker_id='checker-fixture',
                checker_session_id=$2,decided_at=clock_timestamp()
          WHERE id=$1`,
        [id, randomUUID()],
      );
    }
    return id;
  }

  it('creates the governance tables with no seeded configuration', async () => {
    for (const table of [
      'banking_provider_configuration_heads',
      'banking_provider_configuration_proposals',
      'banking_provider_configuration_versions',
      'banking_provider_disengagements',
    ]) {
      const [row] = await db.query<Array<{ c: string }>>(
        `SELECT count(*)::text AS c FROM information_schema.tables
          WHERE table_schema='public' AND table_name=$1`,
        [table],
      );
      expect(row!.c).toBe('1');
    }
    // Nothing may be pre-approved: an empty database must not imply capability.
    const [versions] = await db.query<Array<{ c: string }>>(
      `SELECT count(*)::text AS c FROM banking_provider_configuration_versions`,
    );
    expect(versions!.c).toBe('0');
  });

  it('puts the decision table in the protected schema, unreachable by runtime', async () => {
    const [row] = await db.query<Array<{ present: string; owner: string }>>(
      `SELECT 'yes' AS present, tableowner AS owner FROM pg_tables
        WHERE schemaname='protected_authority' AND tablename='banking_provider_decisions'`,
    );
    expect(row?.present).toBe('yes');
    expect(row?.owner).toBe('monienaija_authority_core');
  });

  it('REFUSES a runtime credential forging an approval decision', async () => {
    const proposalId = await makeProposal();
    // The runtime role lacks INSERT on the protected table AND the trigger independently checks
    // membership. Either refusal is correct; what must not happen is a successful insert.
    await expect(
      db.query(
        `SET ROLE monienaija_runtime;
         INSERT INTO protected_authority.banking_provider_decisions
           (proposal_id,institution_id,expected_version,payload_digest,decision,
            maker_principal_id,maker_session_id,checker_principal_id,checker_session_id,
            assurance_level,decided_at,expires_at)
         VALUES($1,$2,0,$3,'APPROVED','maker-fixture',$4,'checker-fixture',$5,'MFA',
                clock_timestamp(),clock_timestamp()+interval '10 minutes');
         RESET ROLE;`,
        [proposalId, institutionId, 'b'.repeat(64), randomUUID(), randomUUID()],
      ),
    ).rejects.toThrow();
    const [count] = await db.query<Array<{ c: string }>>(
      `SELECT count(*)::text AS c FROM protected_authority.banking_provider_decisions
        WHERE proposal_id=$1`,
      [proposalId],
    );
    expect(count!.c).toBe('0');
  });

  it('makes an approved proposal immutable, so a decided record cannot be rewritten', async () => {
    const proposalId = await makeProposal({ state: 'APPROVED' });
    await expect(
      db.query(
        `UPDATE banking_provider_configuration_proposals
            SET provider_key='OTHERPROVIDER' WHERE id=$1`,
        [proposalId],
      ),
    ).rejects.toThrow(/immutable/i);
  });

  it('still allows a REQUESTED proposal to be decided (the guard is not a blanket freeze)', async () => {
    const proposalId = await makeProposal();
    await db.query(
      `UPDATE banking_provider_configuration_proposals
          SET state='APPROVED',checker_id='checker-fixture',
              checker_session_id=$2,decided_at=clock_timestamp()
        WHERE id=$1`,
      [proposalId, randomUUID()],
    );
    const [row] = await db.query<Array<{ state: string }>>(
      `SELECT state FROM banking_provider_configuration_proposals WHERE id=$1`,
      [proposalId],
    );
    expect(row!.state).toBe('APPROVED');
  });

  it('rejects a provider configuration whose maker and checker are the same principal', async () => {
    // The CHECK constraint is the last line of defence for independent approval.
    await expect(
      db.query(
        `INSERT INTO banking_provider_configuration_versions
          (institution_id,version,proposal_id,provider_key,environment,capabilities,
           routing_approved,operational_ready,definition,maker_id,checker_id,approved_at)
         VALUES($1,9001,$2,'MONNIFY','sandbox','{}'::jsonb,true,true,'{}'::jsonb,
                'same-actor','same-actor',clock_timestamp())`,
        [institutionId, randomUUID()],
      ),
    ).rejects.toThrow();
  });

  it('permits at most ONE open disengagement per institution/provider/environment', async () => {
    const providerKey = `TEST${randomUUID().slice(0, 6).toUpperCase()}`;
    const insert = () =>
      db.query(
        `INSERT INTO banking_provider_disengagements
          (institution_id,provider_key,environment,reason,engaged_by,engaged_by_session_id)
         VALUES($1,$2,'production','operator halted new admissions','operator-fixture',$3)`,
        [institutionId, providerKey, randomUUID()],
      );
    await insert();
    // A second concurrent "disable" must fail rather than leave two ambiguous open records.
    await expect(insert()).rejects.toThrow();
  });

  it('allows re-engagement and then a fresh disengagement', async () => {
    const providerKey = `REENG${randomUUID().slice(0, 5).toUpperCase()}`;
    const session = randomUUID();
    await db.query(
      `INSERT INTO banking_provider_disengagements
        (institution_id,provider_key,environment,reason,engaged_by,engaged_by_session_id)
       VALUES($1,$2,'production','incident','operator-fixture',$3)`,
      [institutionId, providerKey, session],
    );
    await db.query(
      `UPDATE banking_provider_disengagements
          SET reengaged_at=clock_timestamp(),reengaged_by='operator-fixture',
              reengaged_by_session_id=$2
        WHERE institution_id=$1 AND provider_key=$3 AND reengaged_at IS NULL`,
      [institutionId, randomUUID(), providerKey],
    );
    await db.query(
      `INSERT INTO banking_provider_disengagements
        (institution_id,provider_key,environment,reason,engaged_by,engaged_by_session_id)
       VALUES($1,$2,'production','second incident','operator-fixture',$3)`,
      [institutionId, providerKey, randomUUID()],
    );
    const [open] = await db.query<Array<{ c: string }>>(
      `SELECT count(*)::text AS c FROM banking_provider_disengagements
        WHERE institution_id=$1 AND provider_key=$2 AND reengaged_at IS NULL`,
      [institutionId, providerKey],
    );
    expect(open!.c).toBe('1');
  });

  it('keeps the digest function owned by the authority role', async () => {
    const [fn] = await db.query<Array<{ owner: string }>>(
      `SELECT pg_get_userbyid(proowner) AS owner FROM pg_proc p
         JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='protected_authority'
          AND p.proname='banking_provider_payload_digest'`,
    );
    expect(fn!.owner).toBe('monienaija_authority_core');
  });
});
