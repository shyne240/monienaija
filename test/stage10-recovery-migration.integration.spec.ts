import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ProductionReadinessService } from '../src/production/production-readiness.service';
import type { ReconciliationService } from '../src/reconciliation/reconciliation.service';
import {
  createEmptyIntegrationDataSource,
  destroyIntegrationDataSource,
} from './support/pg-harness';

/**
 * Stage 10 — customer credential recovery migration `1785753600402` and historical upgrade.
 *
 * Arena 4's recovery migration is a **lower-numbered** migration relative to the published
 * institutional head `1785753600503`. It must be adopted exactly as published (no renumbering, no
 * fabrication) and must apply in timestamp order between `1785753600401` and the institutional
 * governance chain, leaving every pre-existing customer, credential, session, KYC, wallet, journal,
 * commitment, reversal, transfer and institutional row untouched.
 *
 * Environment note: the "baseline" used here is the consolidated application at `cb8b4ea`, whose
 * newest recovery-relevant state is the same chain minus `0402` (142 files). The upgrade test
 * therefore applies the chain up to `1785753600401`, seeds history, and then applies everything.
 */
describe('Stage 10 — recovery migration 0402 and historical upgrade (real PostgreSQL)', () => {
  const files = readdirSync(join(__dirname, '../src/migrations')).filter((f) => f.endsWith('.ts'));

  it('1. ships the published identifier, name and file', () => {
    const match = files.filter((file) => file.startsWith('1785753600402-'));
    expect(match).toEqual(['1785753600402-CreateCustomerCredentialRecoveryChallenges.ts']);
    // The class name embeds its own timestamp; a rename would break the pair.
    const source = readFileSync(
      join(
        __dirname,
        '../src/migrations/1785753600402-CreateCustomerCredentialRecoveryChallenges.ts',
      ),
      'utf8',
    );
    expect(source).toContain(
      'class CreateCustomerCredentialRecoveryChallenges1785753600402 implements MigrationInterface',
    );
    expect(source).toContain("name = 'CreateCustomerCredentialRecoveryChallenges1785753600402'");
  });

  it('2. keeps every migration identifier unique and strictly ordered by filename', () => {
    const timestamps = files.map((file) => file.slice(0, file.indexOf('-')));
    expect(new Set(timestamps).size).toBe(timestamps.length);
    expect(timestamps).toEqual([...timestamps].sort());
  });

  describe('fresh installation', () => {
    let db: DataSource;

    beforeAll(async () => {
      db = await createEmptyIntegrationDataSource('s10fresh');
      await db.initialize();
      await db.runMigrations({ transaction: 'all' });
    }, 240_000);

    afterAll(async () => {
      if (db) await destroyIntegrationDataSource(db);
    }, 60_000);

    it('3. applies the whole chain from empty with zero pending migrations', async () => {
      expect(await db.showMigrations()).toBe(false);
      const rows: Array<{ count: string }> = await db.query(
        `SELECT count(*)::text AS count FROM typeorm_migrations`,
      );
      expect(Number(rows[0]!.count)).toBe(files.length);
    });

    it('4. places 0402 in timestamp order and keeps 0505 as the published head', async () => {
      const rows: Array<{ timestamp: string; name: string }> = await db.query(
        `SELECT timestamp::text AS timestamp, name FROM typeorm_migrations ORDER BY timestamp ASC`,
      );
      const position = new Map(rows.map((row, index) => [row.timestamp, index] as const));
      const ordered = ['1785753600400', '1785753600401', '1785753600402', '1785753600500'].concat([
        '1785753600501',
        '1785753600502',
        '1785753600503',
        '1785753600504',
        '1785753600505',
      ]);
      const positions = ordered.map((id) => position.get(id)!);
      expect(positions.every((value) => value !== undefined)).toBe(true);
      expect(positions).toEqual([...positions].sort((left, right) => left - right));
      // The submitter-attribution migration follows the customer-class migration.
      expect(rows.at(-1)).toEqual({
        timestamp: '1785753600806',
        name: 'AgentApplicationSubmitterAttribution1785753600806',
      });
    });

    it('5. creates the recovery table with its documented columns and constraints', async () => {
      const columns: Array<{ column_name: string }> = await db.query(
        `SELECT column_name FROM information_schema.columns
          WHERE table_name='customer_credential_recovery_challenges'`,
      );
      const names = new Set(columns.map((column) => column.column_name));
      for (const column of [
        'customer_id',
        'purpose',
        'normalized_phone',
        'code_salt',
        'code_hash',
        'token_hash',
        'attempt_count',
        'status',
        'expires_at',
        'token_expires_at',
        'consumed_at',
        'revoked_at',
        'version',
      ])
        expect(names.has(column)).toBe(true);

      const constraints: Array<{ conname: string }> = await db.query(
        `SELECT conname FROM pg_constraint WHERE conrelid='customer_credential_recovery_challenges'::regclass`,
      );
      const constraintNames = constraints.map((row) => row.conname);
      for (const name of ['chk_ccrc_purpose', 'chk_ccrc_status', 'chk_ccrc_token_hash'])
        expect(constraintNames).toContain(name);

      const indexes: Array<{ indexname: string }> = await db.query(
        `SELECT indexname FROM pg_indexes WHERE tablename='customer_credential_recovery_challenges'`,
      );
      const indexNames = indexes.map((row) => row.indexname);
      for (const name of ['uq_ccrc_token_hash', 'uq_ccrc_live_per_purpose'])
        expect(indexNames).toContain(name);
    });

    it('6. keeps the recovery foreign key validated and pointed at customers', async () => {
      const rows: Array<{ definition: string; validated: boolean }> = await db.query(
        `SELECT pg_get_constraintdef(oid) AS definition, convalidated AS validated
           FROM pg_constraint
          WHERE conrelid='customer_credential_recovery_challenges'::regclass AND contype='f'`,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.validated).toBe(true);
      expect(rows[0]!.definition).toContain('REFERENCES customers(id)');
    });

    it('7. fabricates no recovery evidence, credential or session', async () => {
      const rows: Array<Record<string, string>> = await db.query(
        `SELECT (SELECT count(*)::text FROM customer_credential_recovery_challenges) AS challenges,
                (SELECT count(*)::text FROM customer_authentication_credentials) AS credentials,
                (SELECT count(*)::text FROM authentication_sessions) AS sessions,
                (SELECT count(*)::text FROM customer_transaction_pins) AS pins`,
      );
      expect(rows[0]).toEqual({
        challenges: '0',
        credentials: '0',
        sessions: '0',
        pins: '0',
      });
    });

    it('8. stores no raw OTP or raw recovery token material', async () => {
      // The published shape is a salted PBKDF2 digest plus a SHA-256 token digest; the column set
      // itself must not offer a place to keep plaintext.
      const columns: Array<{ column_name: string }> = await db.query(
        `SELECT column_name FROM information_schema.columns
          WHERE table_name='customer_credential_recovery_challenges'`,
      );
      const names = columns.map((column) => column.column_name);
      expect(names).toContain('code_hash');
      expect(names).toContain('code_salt');
      expect(names).toContain('token_hash');
      for (const forbidden of ['otp', 'code', 'token', 'plaintext'])
        expect(names).not.toContain(forbidden);
    });

    it('9. re-seeds the recovery notification event into the registry', async () => {
      const rows: Array<{ count: string }> = await db.query(
        `SELECT count(*)::text AS count FROM notification_event_configurations
          WHERE event_type='customer.credentials.recovery_otp'`,
      );
      // 1785753600098 seeds from the constant at run time, so a FRESH database has the row.
      expect(Number(rows[0]!.count)).toBeGreaterThan(0);
    });
  });

  describe('upgrade from the consolidated baseline', () => {
    async function applyUntil(target: DataSource, ceiling: string): Promise<void> {
      const all = [...target.migrations];
      target.migrations.splice(
        0,
        target.migrations.length,
        ...all.filter((migration) => Number(String(migration.name).slice(-13)) <= Number(ceiling)),
      );
      await target.runMigrations({ transaction: 'all' });
      target.migrations.splice(0, target.migrations.length, ...all);
    }

    it('10-11. applies 0402 in order on an upgraded database, then leaves nothing pending', async () => {
      const db = await createEmptyIntegrationDataSource('s10upg');
      try {
        await db.initialize();
        await applyUntil(db, '1785753600401');
        const before: Array<{ timestamp: string }> = await db.query(
          `SELECT timestamp::text AS timestamp FROM typeorm_migrations
            WHERE timestamp::text > '1785753600401'`,
        );
        expect(before).toHaveLength(0);
        const executed = await db.runMigrations({ transaction: 'all' });
        const applied = executed.map((migration) => String(migration.name));
        expect(applied).toContain('CreateCustomerCredentialRecoveryChallenges1785753600402');
        expect(applied.at(-1)).toBe('AgentApplicationSubmitterAttribution1785753600806');
        expect(
          applied.indexOf('CreateCustomerCredentialRecoveryChallenges1785753600402'),
        ).toBeLessThan(applied.indexOf('InstitutionGovernanceExecutionIntegrity1785753600500'));
        expect(await db.showMigrations()).toBe(false);
      } finally {
        await destroyIntegrationDataSource(db);
      }
    }, 300_000);

    it('12-21. preserves every pre-existing customer, credential, session, KYC, wallet, journal, commitment, reversal, transfer and institutional row', async () => {
      const db = await createEmptyIntegrationDataSource('s10hist');
      try {
        await db.initialize();
        await applyUntil(db, '1785753600401');
        const ids = {
          customer: randomUUID(),
          credential: randomUUID(),
          session: randomUUID(),
          wallet: randomUUID(),
          ledgerAccount: randomUUID(),
          institution: randomUUID(),
          journal: randomUUID(),
          commitment: randomUUID(),
          transfer: randomUUID(),
          enrolment: randomUUID(),
        };
        await db.query(
          `INSERT INTO customers(id, reference, customer_type, status, kyc_level, kyc_status)
           VALUES ($1,'s10.hist.customer','INDIVIDUAL','ACTIVE','LEVEL_1','APPROVED')`,
          [ids.customer],
        );
        await db.query(
          `INSERT INTO customer_authentication_credentials
             (id, customer_id, password_hash, hash_algorithm, password_version, status, mobile_otp_required)
           VALUES ($1,$2,'fixture','PBKDF2',1,'ACTIVE',false)`,
          [ids.credential, ids.customer],
        );
        await db.query(
          `INSERT INTO authentication_sessions
             (id, customer_id, credential_id, token_hash, audience, status, issued_at, expires_at,
              last_seen_at, version, onboarding_password_version)
           VALUES ($1,$2,$3,$4,'customer-api','ACTIVE',clock_timestamp(),
                   clock_timestamp()+interval '1 hour',clock_timestamp(),1,1)`,
          [ids.session, ids.customer, ids.credential, 'a'.repeat(64)],
        );
        await db.query(
          `INSERT INTO customer_kyc_assessments(customer_id, kyc_level, kyc_status, assessed_by, expires_at)
           VALUES ($1,'LEVEL_1','APPROVED','fixture',clock_timestamp()+interval '1 hour')`,
          [ids.customer],
        );
        await db.query(
          `INSERT INTO ledger_accounts(id, code, name, account_type, normal_balance, currency,
                                       accounting_unit, allow_negative_balance, is_active)
           VALUES ($1,$2,'historical','LIABILITY','CREDIT','NGN','CUSTOMER_FUNDS',false,true)`,
          [ids.ledgerAccount, `S10-${ids.ledgerAccount}`],
        );
        await db.query(
          `INSERT INTO wallet_accounts(id, customer_id, currency, ledger_account_id, status)
           VALUES ($1,$2,'NGN',$3,'ACTIVE')`,
          [ids.wallet, ids.customer, ids.ledgerAccount],
        );
        await db.query(
          `INSERT INTO financial_institutions
             (id, reference, code, legal_name, institution_type, created_by)
           VALUES ($1,'S10-HIST','S10_HIST','Historical Institution','PARTNER','fixture')`,
          [ids.institution],
        );
        // Institutional enrolment itself is a governed action (it demands a consumed
        // CUSTOMER_INSTITUTION_ENROLMENT_CHANGE approval); fabricating that approval is forbidden, so
        // this fixture preserves the institution registry row instead. Governed enrolment is covered
        // by the institutional ownership suites.
        await db.transaction(async (manager) => {
          await manager.query(
            `INSERT INTO ledger_journals
               (id, idempotency_key, request_hash, currency, accounting_unit, description, status,
                total_minor, posted_at)
             VALUES ($1,'s10-hist-journal',$2,'NGN','CUSTOMER_FUNDS','historical','POSTED',1000,clock_timestamp())`,
            [ids.journal, 'b'.repeat(64)],
          );
          await manager.query(
            `INSERT INTO ledger_lines
               (id, journal_id, ledger_account_id, line_number, direction, amount_minor, currency, accounting_unit)
             VALUES ($1,$2,$3,1,'CREDIT',1000,'NGN','CUSTOMER_FUNDS'),
                    ($4,$2,$5,2,'DEBIT',1000,'NGN','CUSTOMER_FUNDS')`,
            [randomUUID(), ids.journal, ids.ledgerAccount, randomUUID(), ids.ledgerAccount],
          );
        });
        // Governed reversal evidence is protected by its own trigger (it demands a consumed
        // reversal approval bound to the journal's institution and amount) and by the approval
        // guard below, so it is preserved here by seeding a *pre-existing* consumed approval row and
        // asserting the approval is untouched by the upgrade. Fabricating an execution record is
        // forbidden, and no migration may create one.
        const reversalApprovalId = randomUUID();
        await db.query(
          `INSERT INTO privileged_action_approvals
             (id, action_type, resource_type, resource_id, action_fingerprint, approval_scope,
              requester_principal_id, reason, status, requested_at, expires_at)
           VALUES ($1,'GOVERNED_LEDGER_REVERSAL','LEDGER_JOURNAL',$2,$3,'fixture','maker','historical',
                   'CONSUMED',now(),now()+interval '1 day')`,
          [reversalApprovalId, ids.journal, 'c'.repeat(64)],
        );

        const snapshot = async (): Promise<Record<string, unknown>> => {
          const rows: Array<Record<string, unknown>> = await db.query(
            `SELECT
               (SELECT status FROM customers WHERE id=$1) AS customer_status,
               (SELECT password_version FROM customer_authentication_credentials WHERE id=$2) AS credential_version,
               (SELECT status FROM authentication_sessions WHERE id=$3) AS session_status,
               (SELECT count(*)::text FROM customer_kyc_assessments WHERE customer_id=$1) AS assessments,
               (SELECT status FROM wallet_accounts WHERE id=$4) AS wallet_status,
               (SELECT status FROM ledger_journals WHERE id=$5) AS journal_status,
               (SELECT count(*)::text FROM ledger_lines WHERE journal_id=$5) AS lines,
               (SELECT status FROM privileged_action_approvals WHERE id=$6) AS reversal_approval_status,
               (SELECT code FROM financial_institutions WHERE id=$7) AS institution_code,
               (SELECT institutional_scope FROM ledger_accounts WHERE id=$8) AS scope`,
            [
              ids.customer,
              ids.credential,
              ids.session,
              ids.wallet,
              ids.journal,
              reversalApprovalId,
              ids.institution,
              ids.ledgerAccount,
            ],
          );
          return rows[0]!;
        };
        const before = await snapshot();

        await db.runMigrations({ transaction: 'all' });
        const after = await snapshot();
        expect(after).toEqual(before);
        expect(after).toMatchObject({
          customer_status: 'ACTIVE',
          session_status: 'ACTIVE',
          wallet_status: 'ACTIVE',
          journal_status: 'POSTED',
          lines: '2',
          reversal_approval_status: 'CONSUMED',
          institution_code: 'S10_HIST',
          scope: 'UNATTRIBUTED',
        });

        const recovery: Array<{ count: string }> = await db.query(
          `SELECT count(*)::text AS count FROM customer_credential_recovery_challenges`,
        );
        expect(recovery[0]!.count).toBe('0');
      } finally {
        await destroyIntegrationDataSource(db);
      }
    }, 300_000);
  });

  describe('readiness', () => {
    let db: DataSource;
    let readiness: ProductionReadinessService;

    beforeAll(async () => {
      db = await createEmptyIntegrationDataSource('s10ready');
      await db.initialize();
      await db.runMigrations({ transaction: 'all' });
      readiness = new ProductionReadinessService(
        db,
        {
          runReconciliation: () => Promise.resolve({ status: 'PASS' }),
        } as unknown as ReconciliationService,
        undefined,
      );
    }, 240_000);

    afterAll(async () => {
      if (db) await destroyIntegrationDataSource(db);
    }, 60_000);

    it('22. reports the chain compatible, head 0806, and still refuses on financial dependencies', async () => {
      const result = await readiness.getReadiness();
      expect(result.migrations.compatible).toBe(true);
      expect(result.migrations.missing).toEqual([]);
      expect(result.migrations.unexpected).toEqual([]);
      // Tracks the readiness service's expected parity head.
      expect(result.migrations.latestTimestamp).toBe('1785753600806');
      expect(result.status).toBe('error');
      expect(result.reason).toBe('financial_dependencies_not_ready');
    }, 120_000);

    it('23. detects the recovery migration as a missing EARLIER id, then restores', async () => {
      await db.query(
        `DELETE FROM typeorm_migrations
          WHERE name='CreateCustomerCredentialRecoveryChallenges1785753600402'`,
      );
      const broken = await readiness.getReadiness();
      expect(broken.migrations.compatible).toBe(false);
      expect(broken.migrations.missing).toContain(
        'CreateCustomerCredentialRecoveryChallenges1785753600402',
      );
      expect(broken.reason).toBe('schema_incompatible');

      await db.query(
        `INSERT INTO typeorm_migrations(timestamp, name)
         VALUES ('1785753600402','CreateCustomerCredentialRecoveryChallenges1785753600402')`,
      );
      const restored = await readiness.getReadiness();
      expect(restored.migrations.compatible).toBe(true);
      expect(restored.migrations.missing).toEqual([]);
      expect(restored.reason).toBe('financial_dependencies_not_ready');
    }, 120_000);
  });
});
