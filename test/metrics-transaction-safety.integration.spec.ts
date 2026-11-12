import { testWalletFinancialBoundary } from './support/test-wallet-financial-boundary';
import { randomUUID } from 'node:crypto';
import { ConflictException } from '@nestjs/common';
import type { DataSource } from 'typeorm';

import { LedgerAccount } from '../src/ledger/ledger-account.entity';
import { LedgerJournal } from '../src/ledger/ledger-journal.entity';
import { LedgerLine } from '../src/ledger/ledger-line.entity';
import {
  LedgerAccountType,
  LedgerEntryDirection,
  LedgerNormalBalance,
} from '../src/ledger/ledger.enums';
import { LedgerService } from '../src/ledger/ledger.service';
import { MetricsService } from '../src/operations/metrics.service';
import { createIntegrationDataSource, destroyIntegrationDataSource } from './support/pg-harness';

describe('Metrics transaction safety (real PostgreSQL)', () => {
  let dataSource: DataSource;
  let metrics: MetricsService;
  let ledger: LedgerService;

  beforeAll(async () => {
    dataSource = await createIntegrationDataSource('metricstxsafety');
    metrics = new MetricsService(dataSource);
    ledger = new LedgerService(
      dataSource.getRepository(LedgerAccount),
      dataSource.getRepository(LedgerJournal),
      dataSource.getRepository(LedgerLine),
      dataSource,
      testWalletFinancialBoundary,
      metrics,
    );
    await dataSource.query('CREATE TABLE metrics_test_marker (id integer PRIMARY KEY)');
    await dataSource.query('CREATE TABLE metrics_test_control (mode text NOT NULL)');
    await dataSource.query("INSERT INTO metrics_test_control (mode) VALUES ('always')");
    // A sequence is deliberately nontransactional, so a failed first attempt is observable
    // to the next attempt even though PostgreSQL rolls back the entire journal transaction.
    await dataSource.query('CREATE SEQUENCE metrics_test_attempt');
    await dataSource.query(`
      CREATE FUNCTION metrics_test_failure() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE failure_mode text;
      BEGIN
        IF NEW.metric_name = 'journals.posted' THEN
          SELECT mode INTO failure_mode FROM metrics_test_control;
          IF failure_mode = 'always' OR
             (failure_mode = 'once' AND nextval('metrics_test_attempt') = 1) THEN
            RAISE EXCEPTION 'synthetic serialization failure' USING ERRCODE = '40001';
          END IF;
        ELSIF NEW.metric_name IN ('test.best_effort', 'test.transaction_error') THEN
          RAISE EXCEPTION 'synthetic metrics failure' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
      END;
      $$
    `);
    await dataSource.query(`
      CREATE TRIGGER metrics_test_failure_trigger
      BEFORE INSERT OR UPDATE ON operational_metrics
      FOR EACH ROW EXECUTE FUNCTION metrics_test_failure()
    `);
  }, 180000);

  afterAll(async () => {
    if (dataSource) await destroyIntegrationDataSource(dataSource);
  }, 60000);

  it('keeps nontransactional metrics best-effort', async () => {
    await expect(metrics.increment(undefined, 'test.best_effort')).resolves.toBeUndefined();
    await expect(
      metrics.increment(dataSource.manager, 'test.best_effort'),
    ).resolves.toBeUndefined();
  });

  it('propagates transactional metrics errors so unrelated writes cannot silently roll back', async () => {
    await expect(
      dataSource.transaction(async (manager) => {
        await manager.query('INSERT INTO metrics_test_marker (id) VALUES (1)');
        await metrics.increment(manager, 'test.transaction_error');
      }),
    ).rejects.toMatchObject({ driverError: { code: '23514' } });

    const markers: Array<{ count: number }> = await dataSource.query(
      'SELECT count(*)::int AS count FROM metrics_test_marker',
    );
    expect(markers[0]?.count).toBe(0);
  });

  async function createLedgerAccounts() {
    const debit = await ledger.createAccount({
      code: `METRICS-TEST-DEBIT-${randomUUID()}`,
      name: 'Synthetic metrics test debit',
      accountType: LedgerAccountType.ASSET,
      normalBalance: LedgerNormalBalance.DEBIT,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      allowNegativeBalance: true,
    });
    const credit = await ledger.createAccount({
      code: `METRICS-TEST-CREDIT-${randomUUID()}`,
      name: 'Synthetic metrics test credit',
      accountType: LedgerAccountType.LIABILITY,
      normalBalance: LedgerNormalBalance.CREDIT,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      allowNegativeBalance: false,
    });
    return { debit, credit };
  }

  it('retries serialization errors without reporting a rolled-back ledger journal as posted', async () => {
    await dataSource.query("UPDATE metrics_test_control SET mode='always'");
    const { debit, credit } = await createLedgerAccounts();
    const key = `metrics-transaction-regression-${randomUUID()}`;
    const metricSpy = jest.spyOn(metrics, 'increment');
    try {
      const result: unknown = await ledger
        .postJournal({
          idempotencyKey: key,
          currency: 'NGN',
          accountingUnit: 'CUSTOMER_FUNDS',
          lines: [
            { accountId: debit.id, direction: LedgerEntryDirection.DEBIT, amountMinor: '1000' },
            { accountId: credit.id, direction: LedgerEntryDirection.CREDIT, amountMinor: '1000' },
          ],
        })
        .catch((error: unknown) => error);
      expect(result).toBeInstanceOf(ConflictException);
      expect(result).toMatchObject({ code: 'TRANSACTION_CONTENTION_RETRY_EXHAUSTED' });
      expect(metricSpy).toHaveBeenCalledTimes(3);
    } finally {
      metricSpy.mockRestore();
    }

    const journals: Array<{ count: number }> = await dataSource.query(
      'SELECT count(*)::int AS count FROM ledger_journals WHERE idempotency_key=$1',
      [key],
    );
    expect(journals[0]?.count).toBe(0);
    expect((await ledger.getAccountBalance(debit.id)).balanceMinor).toBe('0');
    expect((await ledger.getAccountBalance(credit.id)).balanceMinor).toBe('0');
  });

  it('retries the whole journal after a transient metrics serialization failure', async () => {
    await dataSource.query("UPDATE metrics_test_control SET mode='once'");
    await dataSource.query('ALTER SEQUENCE metrics_test_attempt RESTART WITH 1');
    const { debit, credit } = await createLedgerAccounts();
    const key = `metrics-transaction-retry-${randomUUID()}`;
    const metricSpy = jest.spyOn(metrics, 'increment');
    try {
      const journal = await ledger.postJournal({
        idempotencyKey: key,
        currency: 'NGN',
        accountingUnit: 'CUSTOMER_FUNDS',
        lines: [
          { accountId: debit.id, direction: LedgerEntryDirection.DEBIT, amountMinor: '1000' },
          { accountId: credit.id, direction: LedgerEntryDirection.CREDIT, amountMinor: '1000' },
        ],
      });
      expect(metricSpy).toHaveBeenCalledTimes(2);
      const rows: Array<{ journals: number; lines: number }> = await dataSource.query(
        `SELECT count(DISTINCT j.id)::int AS journals, count(l.id)::int AS lines
         FROM ledger_journals j LEFT JOIN ledger_lines l ON l.journal_id=j.id
         WHERE j.idempotency_key=$1 AND j.id=$2`,
        [key, journal.id],
      );
      expect(rows[0]).toEqual({ journals: 1, lines: 2 });
      expect((await ledger.getAccountBalance(debit.id)).balanceMinor).toBe('1000');
      expect((await ledger.getAccountBalance(credit.id)).balanceMinor).toBe('1000');
    } finally {
      metricSpy.mockRestore();
    }
  });

  it('records successful metrics inside the surrounding transaction', async () => {
    await dataSource.transaction(async (manager) =>
      metrics.increment(manager, 'test.saved_metric'),
    );
    const rows: Array<{ value: string }> = await dataSource.query(
      'SELECT value::text AS value FROM operational_metrics WHERE metric_name=$1',
      ['test.saved_metric'],
    );
    expect(rows[0]?.value).toBe('1');
  });
});
