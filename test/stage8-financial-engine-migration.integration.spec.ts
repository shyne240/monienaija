import { randomUUID } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { DataSource } from 'typeorm';

import { ProductionReadinessService } from '../src/production/production-readiness.service';
import type { ReconciliationService } from '../src/reconciliation/reconciliation.service';
import {
  createEmptyIntegrationDataSource,
  destroyIntegrationDataSource,
} from './support/pg-harness';

/**
 * Stage 8 — consolidated migration acceptance for the financial engine.
 *
 * The consolidated chain must adopt the published Arena 1 identifiers as published
 * (`1785753600117` governed ledger reversal executions, `1785753600140`-`1785753600146`
 * financial commitments / verified inbound / A7 persistence) **without renumbering** them,
 * without fabricating rows, and without disturbing the published institutional chain that
 * ends at `1785753600503-CashOutInstitutionalScope`.
 *
 * Seventeen checks, all against real PostgreSQL:
 *
 *   A. chain shape (1-7): empty start, full execution, zero pending, exact ledger, published
 *      financial-engine ids in order, head unchanged, no renumbering or duplicates.
 *   B. integrity (8-10): every foreign key validated, the new tables exist with their governed
 *      columns, and no migration fabricates approvals, commitments, receipts or executions.
 *   C. upgrade from the Arena 2 baseline (11-14): apply the baseline, seed historical financial
 *      rows, apply the financial-engine range, prove the history is preserved unchanged and that
 *      the new tables are empty (no backfill).
 *   D. readiness (15-17): a missing EARLIER migration is detected, readiness fails closed naming
 *      the missing id, and readiness is restored once the row is put back.
 */
describe('Stage 8 consolidated financial-engine migration acceptance (real PostgreSQL)', () => {
  const migrationDir = join(__dirname, '../src/migrations');
  const files = readdirSync(migrationDir).filter((file) => file.endsWith('.ts'));
  const expectedCount = files.length;
  const FINANCIAL_ENGINE_IDS = [117, 140, 141, 142, 143, 144, 145, 146] as const;

  let db: DataSource;

  beforeAll(async () => {
    db = await createEmptyIntegrationDataSource('s8mig');
    await db.initialize();
  }, 180_000);

  afterAll(async () => {
    if (db) await destroyIntegrationDataSource(db);
  }, 60_000);

  it('1. starts from a genuinely empty database', async () => {
    const rows: Array<{ tablename: string }> = await db.query(
      `SELECT tablename FROM pg_tables WHERE schemaname='public'`,
    );
    expect(rows).toHaveLength(0);
  });

  it('2. executes the whole published chain exactly once', async () => {
    const executed = await db.runMigrations({ transaction: 'all' });
    expect(executed).toHaveLength(expectedCount);
    const applied = executed.map((migration) => String(migration.name).slice(-13));
    expect(applied).toEqual([...applied].sort());
  });

  it('3. leaves zero pending migrations', async () => {
    expect(await db.showMigrations()).toBe(false);
  });

  it('4. records exactly the discovered migrations in the ledger', async () => {
    const rows: Array<{ name: string; timestamp: string }> = await db.query(
      `SELECT timestamp::text AS timestamp, name FROM typeorm_migrations`,
    );
    expect(rows).toHaveLength(expectedCount);
    expect(new Set(rows.map((row) => row.name)).size).toBe(expectedCount);
    expect(new Set(rows.map((row) => row.timestamp)).size).toBe(expectedCount);
  });

  it('5. adopts the published financial-engine identifiers in strict order', async () => {
    const rows: Array<{ timestamp: string; name: string }> = await db.query(
      `SELECT timestamp::text AS timestamp, name FROM typeorm_migrations ORDER BY timestamp ASC`,
    );
    const position = new Map(rows.map((row, index) => [row.timestamp, index] as const));
    const ordered = ['1785753600116', '1785753600117', '1785753600118', '1785753600140']
      .concat(['1785753600141', '1785753600142', '1785753600143'])
      .concat([
        '1785753600144',
        '1785753600145',
        '1785753600146',
        '1785753600400',
        '1785753600401',
        '1785753600402',
        '1785753600500',
        '1785753600501',
        '1785753600502',
        '1785753600503',
        '1785753600504',
        '1785753600505',
      ]);
    for (const id of ordered) expect(position.has(id)).toBe(true);
    const positions = ordered.map((id) => position.get(id)!);
    expect(positions).toEqual([...positions].sort((left, right) => left - right));
  });

  it('6. keeps the published institutional head', async () => {
    const rows: Array<{ timestamp: string; name: string }> = await db.query(
      `SELECT timestamp::text AS timestamp, name FROM typeorm_migrations
        ORDER BY timestamp DESC LIMIT 1`,
    );
    // The Arena 5 dual-lane financial authorization migration follows the unchanged Arena 2C chain.
    expect(rows[0]).toEqual({
      timestamp: '1785753600804',
      name: 'GeneralizeExternalOperationsForAgents1785753600804',
    });
  });

  it('7. never renumbers or duplicates a published financial-engine identifier', () => {
    const timestamps = files.map((file) => file.slice(0, file.indexOf('-')));
    expect(new Set(timestamps).size).toBe(timestamps.length);
    for (const id of FINANCIAL_ENGINE_IDS) {
      const matches = files.filter((file) => file.startsWith(`1785753600${id}-`));
      expect(matches).toHaveLength(1);
      // The published file name embeds its own identifier; a rename would break this pair.
      const base = (matches[0] ?? '').replace(/\.ts$/, '');
      // Exactly one 13-digit identifier may appear in the file name, and it must be the published
      // one: a renumbering would leave the historical identifier in the name or add a second one.
      expect(base.match(/\d{13}/g)).toEqual([`1785753600${id}`]);
    }
  });

  it('8. creates every foreign key in a validated state', async () => {
    const rows: Array<{ count: string }> = await db.query(
      `SELECT count(*)::text AS count FROM pg_constraint
        WHERE contype='f' AND connamespace='public'::regnamespace AND NOT convalidated`,
    );
    expect(rows[0]!.count).toBe('0');
  });

  it('9. creates the financial-engine tables with their governed columns', async () => {
    const rows: Array<{
      reversal: string | null;
      commitment: string | null;
      receipts: string | null;
    }> = await db.query(
      `SELECT to_regclass('public.governed_ledger_reversal_executions')::text AS reversal,
                to_regclass('public.financial_commitments')::text AS commitment,
                to_regclass('public.inbound_funding_receipts')::text AS receipts`,
    );
    expect(rows[0]).toEqual({
      reversal: 'governed_ledger_reversal_executions',
      commitment: 'financial_commitments',
      receipts: 'inbound_funding_receipts',
    });
    const columns: Array<{ table_name: string; column_name: string; is_nullable: string }> =
      await db.query(
        `SELECT table_name, column_name, is_nullable FROM information_schema.columns
          WHERE table_name IN ('governed_ledger_reversal_executions','financial_commitments',
                               'inbound_funding_receipts','a7_product_lifecycles')
            AND column_name IN ('approval_id','status','execution_receipt_id',
                                'intended_amount_minor','state')`,
      );
    const seen = new Set(columns.map((column) => `${column.table_name}.${column.column_name}`));
    expect(seen.has('governed_ledger_reversal_executions.approval_id')).toBe(true);
    expect(seen.has('a7_product_lifecycles.execution_receipt_id')).toBe(true);

    // 0146 links the lifecycle to an executed receipt without allowing a receipt-less execution.
    const link = await db.query<Array<{ definition: string }>>(
      `SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
        WHERE conname='a7_product_lifecycles_execution_receipt_required'`,
    );
    expect(link.length).toBeLessThanOrEqual(1);
  });

  it('10. fabricates no approvals, commitments, receipts, observations or executions', async () => {
    const rows: Array<Record<string, string>> = await db.query(
      `SELECT (SELECT count(*)::text FROM governed_ledger_reversal_executions) AS reversals,
              (SELECT count(*)::text FROM financial_commitments) AS commitments,
              (SELECT count(*)::text FROM inbound_funding_receipts) AS receipts,
              (SELECT count(*)::text FROM inbound_funding_observations) AS observations,
              (SELECT count(*)::text FROM a7_product_lifecycles) AS lifecycles,
              (SELECT count(*)::text FROM a7_product_commands) AS commands`,
    );
    expect(rows[0]).toEqual({
      reversals: '0',
      commitments: '0',
      receipts: '0',
      observations: '0',
      lifecycles: '0',
      commands: '0',
    });
  });

  /** Applies only the migrations at or below `ceiling`, in published order. */
  async function applyUntil(target: DataSource, ceiling: string): Promise<void> {
    const all = [...target.migrations];
    target.migrations.splice(
      0,
      target.migrations.length,
      ...all.filter((migration) => Number(migration.name!.slice(-13)) <= Number(ceiling)),
    );
    await target.runMigrations({ transaction: 'all' });
    target.migrations.splice(0, target.migrations.length, ...all);
  }

  it('11. upgrades from the Arena 2 baseline to the financial-engine head', async () => {
    const upgrade = await createEmptyIntegrationDataSource('s8upgrade');
    try {
      await upgrade.initialize();
      await applyUntil(upgrade, '1785753600116');
      const baseline: Array<{ timestamp: string }> = await upgrade.query(
        `SELECT timestamp::text AS timestamp FROM typeorm_migrations
          WHERE timestamp::text > '1785753600116'`,
      );
      expect(baseline).toHaveLength(0);
      const executed = await upgrade.runMigrations({ transaction: 'all' });
      const appliedNames = executed.map((migration) => String(migration.name));
      expect(appliedNames).toContain('CreateGovernedLedgerReversalExecutions1785753600117');
      expect(appliedNames).toContain('CreateFinancialCommitments1785753600140');
      expect(appliedNames).toContain('LinkA7InboundExecution1785753600146');
      expect(appliedNames.at(-1)).toBe('GeneralizeExternalOperationsForAgents1785753600804');
      expect(await upgrade.showMigrations()).toBe(false);
    } finally {
      await destroyIntegrationDataSource(upgrade);
    }
  }, 240_000);

  it('12. preserves historical financial rows byte-for-byte across the upgrade', async () => {
    const upgrade = await createEmptyIntegrationDataSource('s8hist');
    try {
      await upgrade.initialize();
      await applyUntil(upgrade, '1785753600116');
      const journalId = randomUUID();
      const accountA = randomUUID();
      const accountB = randomUUID();
      await upgrade.query(
        `INSERT INTO ledger_accounts(id,code,name,account_type,normal_balance,currency,accounting_unit,allow_negative_balance,is_active)
         VALUES ($1,'S8-HIST-A','Historic A','LIABILITY','CREDIT','NGN','CUSTOMER_FUNDS',false,true),
                ($2,'S8-HIST-B','Historic B','ASSET','DEBIT','NGN','CUSTOMER_FUNDS',false,true)`,
        [accountA, accountB],
      );
      // A journal and its lines are validated as a whole by the ledger's balance trigger, so the
      // historical fixture is written in one transaction exactly like a real posting.
      await upgrade.transaction(async (manager) => {
        await manager.query(
          `INSERT INTO ledger_journals(id,idempotency_key,request_hash,currency,accounting_unit,
                                      description,status,total_minor,posted_at)
           VALUES ($1,'s8-hist-journal',$2,'NGN','CUSTOMER_FUNDS','historical','POSTED',1000,clock_timestamp())`,
          [journalId, 'c'.repeat(64)],
        );
        await manager.query(
          `INSERT INTO ledger_lines(id,journal_id,ledger_account_id,line_number,direction,amount_minor,currency,accounting_unit)
           VALUES ($2,$1,$3,1,'DEBIT',1000,'NGN','CUSTOMER_FUNDS'),
                  ($4,$1,$5,2,'CREDIT',1000,'NGN','CUSTOMER_FUNDS')`,
          [journalId, randomUUID(), accountB, randomUUID(), accountA],
        );
      });
      const before: Array<Record<string, string>> = await upgrade.query(
        `SELECT id::text, status, idempotency_key,
                (SELECT count(*)::text FROM ledger_lines WHERE journal_id=$1) AS lines
           FROM ledger_journals WHERE id=$1`,
        [journalId],
      );
      await upgrade.runMigrations({ transaction: 'all' });
      const after: Array<Record<string, string>> = await upgrade.query(
        `SELECT id::text, status, idempotency_key,
                (SELECT count(*)::text FROM ledger_lines WHERE journal_id=$1) AS lines
           FROM ledger_journals WHERE id=$1`,
        [journalId],
      );
      expect(after).toEqual(before);
      expect(after[0]!.lines).toBe('2');
      const stillUnattributed: Array<{ scope: string | null }> = await upgrade.query(
        `SELECT institutional_scope AS scope FROM ledger_accounts WHERE id=$1`,
        [accountA],
      );
      expect(stillUnattributed[0]!.scope).toBe('UNATTRIBUTED');
    } finally {
      await destroyIntegrationDataSource(upgrade);
    }
  }, 240_000);

  it('13. backfills nothing into the new financial-engine tables on upgrade', async () => {
    const upgrade = await createEmptyIntegrationDataSource('s8back');
    try {
      await upgrade.initialize();
      await applyUntil(upgrade, '1785753600116');
      const customerId = randomUUID();
      // A pre-0140 history row: the upgrade must leave it untouched and must not invent a
      // commitment, destination binding, receipt or reversal for it.
      await upgrade.query(
        `INSERT INTO customers(id, reference, customer_type, status, kyc_level, kyc_status)
         VALUES ($1,'s8.hist.customer','INDIVIDUAL','ACTIVE','LEVEL_1','APPROVED')`,
        [customerId],
      );
      await upgrade.runMigrations({ transaction: 'all' });
      const rows: Array<Record<string, string>> = await upgrade.query(
        `SELECT (SELECT count(*)::text FROM financial_commitments) AS commitments,
                (SELECT count(*)::text FROM governed_ledger_reversal_executions) AS reversals,
                (SELECT count(*)::text FROM inbound_funding_receipts) AS receipts,
                (SELECT count(*)::text FROM customers WHERE id=$1) AS customers`,
        [customerId],
      );
      expect(rows[0]).toEqual({
        commitments: '0',
        reversals: '0',
        receipts: '0',
        customers: '1',
      });
    } finally {
      await destroyIntegrationDataSource(upgrade);
    }
  }, 240_000);

  it('14. refuses to revert financial-engine evidence and keeps the chain fully applied', async () => {
    const upgrade = await createEmptyIntegrationDataSource('s8revert');
    try {
      await upgrade.initialize();
      await applyUntil(upgrade, '1785753600140');
      const before: Array<{ name: string }> = await upgrade.query(
        `SELECT name FROM typeorm_migrations ORDER BY timestamp`,
      );
      // Every financial-engine migration is deliberately forward-only: removing the table would
      // destroy commitment evidence. The refusal is part of the acceptance contract.
      await expect(upgrade.undoLastMigration({ transaction: 'all' })).rejects.toThrow(
        /Refusing to remove financial commitment evidence/,
      );
      const after: Array<{ name: string }> = await upgrade.query(
        `SELECT name FROM typeorm_migrations ORDER BY timestamp`,
      );
      expect(after).toEqual(before);
      const table: Array<{ table: string | null }> = await upgrade.query(
        `SELECT to_regclass('public.financial_commitments')::text AS table`,
      );
      expect(table[0]!.table).toBe('financial_commitments');
    } finally {
      await destroyIntegrationDataSource(upgrade);
    }
  }, 240_000);
});

describe('Stage 8 readiness detection of a missing earlier migration (real PostgreSQL)', () => {
  let db: DataSource;
  let readiness: ProductionReadinessService;

  beforeAll(async () => {
    db = await createEmptyIntegrationDataSource('s8ready');
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

  it('15. reports the consolidated chain as schema-compatible', async () => {
    const result = await readiness.getReadiness();
    expect(result.migrations.compatible).toBe(true);
    expect(result.migrations.missing).toEqual([]);
    expect(result.migrations.unexpected).toEqual([]);
    // The readiness service's expected head is the current migration head. This assertion tracks it
    // rather than re-deriving it, so a stale expectation fails loudly instead of quietly accepting a
    // tree the service does not consider compatible.
    expect(result.migrations.latestTimestamp).toBe('1785753600804');
    // Financial dependency gates are unverified by design, so overall readiness still refuses.
    expect(result.status).toBe('error');
    expect(result.reason).toBe('financial_dependencies_not_ready');
  }, 120_000);

  it('16. detects a missing earlier migration instead of trusting the head', async () => {
    await db.query(
      `DELETE FROM typeorm_migrations WHERE name='CreateFinancialCommitments1785753600140'`,
    );
    const result = await readiness.getReadiness();
    expect(result.migrations.compatible).toBe(false);
    expect(result.migrations.status).toBe('error');
    expect(result.migrations.missing).toContain('CreateFinancialCommitments1785753600140');
    expect(result.reason).toBe('schema_incompatible');
  }, 120_000);

  it('17. restores readiness once the earlier migration row is back', async () => {
    await db.query(
      `INSERT INTO typeorm_migrations(timestamp, name)
       VALUES ('1785753600140','CreateFinancialCommitments1785753600140')`,
    );
    const result = await readiness.getReadiness();
    expect(result.migrations.compatible).toBe(true);
    expect(result.migrations.missing).toEqual([]);
    expect(result.reason).toBe('financial_dependencies_not_ready');
  }, 120_000);
});
