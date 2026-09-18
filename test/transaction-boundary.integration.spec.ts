import { ConflictException } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { QueryFailedError } from 'typeorm';

import {
  isRetryableTransactionError,
  MAX_SERIALIZABLE_ATTEMPTS,
  runSerializableWithRetry,
} from '../src/common/serializable-transaction';
import {
  createIntegrationDataSource,
  destroyIntegrationDataSource,
  firstRow,
} from './support/pg-harness';

/**
 * Real-PostgreSQL transaction-boundary coverage.
 *
 * Proves the two properties the lost work established:
 *  1. a bounded SERIALIZABLE retry that retries only 40001/40P01;
 *  2. that a nested transaction opened on a second pooled connection cannot observe the
 *     caller's uncommitted writes — the defect that the `*InTransaction` APIs remove.
 */
describe('transaction boundaries (real PostgreSQL)', () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = await createIntegrationDataSource('txboundary');
    await dataSource.query(
      `CREATE TABLE tx_probe (id INTEGER PRIMARY KEY, note TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0)`,
    );
  }, 180000);

  afterAll(async () => {
    if (dataSource) await destroyIntegrationDataSource(dataSource);
  }, 60000);

  beforeEach(async () => {
    await dataSource.query('TRUNCATE tx_probe');
  });

  describe('runSerializableWithRetry', () => {
    it('commits a successful body on the first attempt', async () => {
      let attempts = 0;
      const result = await runSerializableWithRetry(dataSource, 'probe.insert', async (m) => {
        attempts += 1;
        await m.query(`INSERT INTO tx_probe (id, note) VALUES (1, 'committed')`);
        return 'ok';
      });
      expect(result).toBe('ok');
      expect(attempts).toBe(1);
      const rows: Array<Record<string, unknown>> = await dataSource.query(
        'SELECT note FROM tx_probe WHERE id = 1',
      );
      expect(firstRow(rows as Array<{ note: string }>, 'committed row').note).toBe('committed');
    });

    it('rolls the whole body back atomically when it throws', async () => {
      await expect(
        runSerializableWithRetry(dataSource, 'probe.rollback', async (m) => {
          await m.query(`INSERT INTO tx_probe (id, note) VALUES (2, 'first')`);
          await m.query(`INSERT INTO tx_probe (id, note) VALUES (3, 'second')`);
          throw new Error('business failure');
        }),
      ).rejects.toThrow('business failure');
      const rows: Array<Record<string, unknown>> =
        await dataSource.query('SELECT id FROM tx_probe');
      expect(rows).toEqual([]);
    });

    it('does not retry a business failure', async () => {
      let attempts = 0;
      await expect(
        runSerializableWithRetry(dataSource, 'probe.business', (): Promise<never> => {
          attempts += 1;
          throw new ConflictException('domain rule violated');
        }),
      ).rejects.toThrow('domain rule violated');
      expect(attempts).toBe(1);
    });

    it('does not retry a non-retryable database error such as a unique violation', async () => {
      await dataSource.query(`INSERT INTO tx_probe (id, note) VALUES (4, 'existing')`);
      let attempts = 0;
      await expect(
        runSerializableWithRetry(dataSource, 'probe.unique', async (m) => {
          attempts += 1;
          await m.query(`INSERT INTO tx_probe (id, note) VALUES (4, 'duplicate')`);
        }),
      ).rejects.toBeInstanceOf(QueryFailedError);
      expect(attempts).toBe(1);
    });

    it('retries a genuine serialization failure and then succeeds', async () => {
      await dataSource.query(`INSERT INTO tx_probe (id, note, n) VALUES (5, 'contended', 0)`);
      let attempts = 0;
      const result = await runSerializableWithRetry(dataSource, 'probe.retry', async (m) => {
        attempts += 1;
        if (attempts < 3) {
          // Raise the exact SQLSTATE PostgreSQL reports for write skew.
          await m.query(`DO $$ BEGIN RAISE EXCEPTION 'simulated' USING ERRCODE = '40001'; END $$;`);
        }
        await m.query(`UPDATE tx_probe SET n = n + 1 WHERE id = 5`);
        return attempts;
      });
      expect(result).toBe(3);
      expect(attempts).toBe(3);
      const rows: Array<Record<string, unknown>> = await dataSource.query(
        'SELECT n FROM tx_probe WHERE id = 5',
      );
      expect(firstRow(rows as Array<{ n: number }>, 'retried row').n).toBe(1);
    });

    it('bounds the retry budget and surfaces a conflict', async () => {
      let attempts = 0;
      await expect(
        runSerializableWithRetry(dataSource, 'probe.exhaust', async (m) => {
          attempts += 1;
          await m.query(`DO $$ BEGIN RAISE EXCEPTION 'simulated' USING ERRCODE = '40001'; END $$;`);
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(attempts).toBe(MAX_SERIALIZABLE_ATTEMPTS);
      expect(MAX_SERIALIZABLE_ATTEMPTS).toBe(3);
    });

    it('also retries deadlock_detected (40P01)', async () => {
      let attempts = 0;
      const result = await runSerializableWithRetry(dataSource, 'probe.deadlock', async (m) => {
        attempts += 1;
        if (attempts === 1) {
          await m.query(`DO $$ BEGIN RAISE EXCEPTION 'deadlock' USING ERRCODE = '40P01'; END $$;`);
        }
        return attempts;
      });
      expect(result).toBe(2);
    });

    it('leaves no partial rows behind after the retry budget is exhausted', async () => {
      await expect(
        runSerializableWithRetry(dataSource, 'probe.exhaust.rows', async (m) => {
          await m.query(`INSERT INTO tx_probe (id, note) VALUES (9, 'never')`);
          await m.query(`DO $$ BEGIN RAISE EXCEPTION 'simulated' USING ERRCODE = '40001'; END $$;`);
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      const rows: Array<Record<string, unknown>> = await dataSource.query(
        'SELECT id FROM tx_probe WHERE id = 9',
      );
      expect(rows).toEqual([]);
    });
  });

  describe('isRetryableTransactionError', () => {
    it('classifies only serialization failure and deadlock as retryable', async () => {
      const capture = async (code: string): Promise<unknown> => {
        try {
          await dataSource.query(
            `DO $$ BEGIN RAISE EXCEPTION 'x' USING ERRCODE = '${code}'; END $$;`,
          );
        } catch (error) {
          return error;
        }
        throw new Error('expected failure');
      };
      expect(isRetryableTransactionError(await capture('40001'))).toBe(true);
      expect(isRetryableTransactionError(await capture('40P01'))).toBe(true);
      expect(isRetryableTransactionError(await capture('23505'))).toBe(false);
      expect(isRetryableTransactionError(await capture('23514'))).toBe(false);
      expect(isRetryableTransactionError(new Error('plain'))).toBe(false);
      expect(isRetryableTransactionError(undefined)).toBe(false);
    });
  });

  describe('nested transaction visibility (the defect the *InTransaction APIs remove)', () => {
    it('cannot observe the caller uncommitted write from a second connection', async () => {
      const observed = await dataSource.transaction<Array<Record<string, unknown>>>(
        'SERIALIZABLE',
        async (manager) => {
          await manager.query(`INSERT INTO tx_probe (id, note) VALUES (7, 'uncommitted')`);
          // A nested `dataSource.transaction` acquires a *different* pooled connection,
          // exactly as `consume()` / `evaluate()` used to do inside a caller boundary.
          return dataSource.transaction<Array<Record<string, unknown>>>(
            async (other) => await other.query('SELECT id FROM tx_probe WHERE id = 7'),
          );
        },
      );
      expect(observed).toEqual([]);
    });

    it('does observe it when the caller manager is threaded through', async () => {
      const observed = await dataSource.transaction<Array<Record<string, unknown>>>(
        'SERIALIZABLE',
        async (manager) => {
          await manager.query(`INSERT INTO tx_probe (id, note) VALUES (8, 'uncommitted')`);
          // This is what consumeInTransaction/evaluateInTransaction do.
          return await manager.query('SELECT id FROM tx_probe WHERE id = 8');
        },
      );
      expect(observed).toHaveLength(1);
    });

    it('discards the nested write when the caller transaction rolls back', async () => {
      await expect(
        dataSource.transaction('SERIALIZABLE', async (manager) => {
          await manager.query(`INSERT INTO tx_probe (id, note) VALUES (10, 'inner')`);
          throw new Error('caller aborted');
        }),
      ).rejects.toThrow('caller aborted');
      const rows: Array<Record<string, unknown>> = await dataSource.query(
        'SELECT id FROM tx_probe WHERE id = 10',
      );
      expect(rows).toEqual([]);
    });
  });
});
