import { randomUUID } from 'node:crypto';

import { ConflictException } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';

import {
  CommercialDecisionSnapshotService,
  type RecordCommercialDecisionInput,
} from '../src/commercial-decision/commercial-decision-snapshot.service';

function makeInput(
  overrides: Partial<RecordCommercialDecisionInput> = {},
): RecordCommercialDecisionInput {
  const suffix = randomUUID().slice(0, 8);
  return {
    idempotencyKey: `snap-idem-${suffix}`,
    product: 'WALLET_TRANSFER',
    direction: 'OUTGOING',
    channel: 'APP',
    principalType: 'CUSTOMER',
    principalId: randomUUID(),
    currency: 'NGN',
    principalAmountMinor: '10000',
    transactionReference: `TX-${suffix}`,
    createdBy: 'unit-test',
    feeDecision: {
      status: 'APPLIED',
      amountMinor: '10000',
      feeMinor: '50',
      vatMinor: '3',
      totalMinor: '10053',
    },
    commissionDecision: { status: 'NONE' },
    rewardDecision: { status: 'NONE' },
    limitDecision: { status: 'APPROVED' },
    ...overrides,
  };
}

function makeSerializationFailure(
  code = '40001',
  message = 'could not serialize access due to read/write dependencies among transactions',
): QueryFailedError {
  return new QueryFailedError(
    'INSERT INTO commercial_decision_snapshots',
    [],
    Object.assign(new Error(message), { code }) as never,
  );
}

describe('CommercialDecisionSnapshotService — concurrency & conflict classification', () => {
  describe('recordDecision SERIALIZABLE retry with jittered backoff', () => {
    it('retries retryable 40001/40P01 errors with bounded attempts and succeeds when contention clears', async () => {
      const insertedRow = { id: randomUUID(), idempotency_key: 'snap-retry-ok' };
      const transactionMock = jest
        .fn()
        .mockRejectedValueOnce(makeSerializationFailure('40001'))
        .mockRejectedValueOnce(makeSerializationFailure('40P01', 'deadlock detected'))
        .mockResolvedValueOnce({ snapshot: insertedRow, replayed: false });

      const service = new CommercialDecisionSnapshotService({
        transaction: transactionMock,
      } as never);

      const result = await service.recordDecision(
        makeInput({ idempotencyKey: 'snap-retry-ok', transactionReference: 'TX-RETRY-OK' }),
      );

      expect(result).toEqual({ snapshot: insertedRow, replayed: false });
      expect(transactionMock).toHaveBeenCalledTimes(3);
      for (const call of transactionMock.mock.calls as Array<[string, unknown]>) {
        expect(call[0]).toBe('SERIALIZABLE');
      }
    });

    it('rethrows after exhausting all 5 SERIALIZABLE attempts', async () => {
      const failure = makeSerializationFailure('40001');
      const transactionMock = jest.fn().mockRejectedValue(failure);
      const service = new CommercialDecisionSnapshotService({
        transaction: transactionMock,
      } as never);

      await expect(service.recordDecision(makeInput())).rejects.toBe(failure);
      expect(transactionMock).toHaveBeenCalledTimes(5);
    });

    it('does not retry non-serialization ConflictException errors', async () => {
      const conflict = new ConflictException('COMMERCIAL_DECISION_IDEMPOTENCY_CONFLICT');
      const transactionMock = jest.fn().mockRejectedValue(conflict);
      const service = new CommercialDecisionSnapshotService({
        transaction: transactionMock,
      } as never);

      await expect(service.recordDecision(makeInput())).rejects.toBe(conflict);
      expect(transactionMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('recordDecisionWithManager insert-first (no pre-insert SIReadLock)', () => {
    it('inserts fresh distinct keys in a single INSERT ... ON CONFLICT DO NOTHING RETURNING query without pre-reading idempotency_key', async () => {
      const input = makeInput();
      const insertedRow = {
        id: randomUUID(),
        idempotency_key: input.idempotencyKey,
        transaction_reference: input.transactionReference,
      };
      const queryMock = jest.fn().mockResolvedValueOnce([insertedRow]);
      const manager = { query: queryMock };
      const service = new CommercialDecisionSnapshotService({} as never);

      const result = await service.recordDecisionWithManager(manager as never, input);

      expect(result).toEqual({ snapshot: insertedRow, replayed: false });
      expect(queryMock).toHaveBeenCalledTimes(1);
      const [sql] = queryMock.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('INSERT INTO commercial_decision_snapshots');
      expect(sql).toContain('ON CONFLICT DO NOTHING');
      expect(sql).toContain('RETURNING');
    });

    it('replays existing snapshot when ON CONFLICT DO NOTHING returns empty and request_hash matches', async () => {
      const input = makeInput();
      const service = new CommercialDecisionSnapshotService({} as never);

      let capturedRequestHash = '';
      const firstManager = {
        query: jest.fn().mockImplementationOnce((_sql: string, params: unknown[]) => {
          capturedRequestHash = String(params[1]);
          return Promise.resolve([
            {
              id: 'existing-id',
              idempotency_key: input.idempotencyKey,
              request_hash: capturedRequestHash,
            },
          ]);
        }),
      };
      await service.recordDecisionWithManager(firstManager as never, input);

      const existingRow = {
        id: 'existing-id',
        idempotency_key: input.idempotencyKey,
        request_hash: capturedRequestHash,
        transaction_reference: input.transactionReference,
      };
      const replayQueryMock = jest
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([existingRow]);
      const replayResult = await service.recordDecisionWithManager(
        { query: replayQueryMock } as never,
        input,
      );

      expect(replayResult).toEqual({ snapshot: existingRow, replayed: true });
      expect(replayQueryMock).toHaveBeenCalledTimes(2);
    });

    it('throws COMMERCIAL_DECISION_IDEMPOTENCY_CONFLICT when idempotency_key exists with a different request_hash', async () => {
      const input = makeInput();
      const service = new CommercialDecisionSnapshotService({} as never);

      const queryMock = jest
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          {
            id: randomUUID(),
            idempotency_key: input.idempotencyKey,
            request_hash: 'different-hash',
          },
        ]);

      await expect(
        service.recordDecisionWithManager({ query: queryMock } as never, input),
      ).rejects.toThrow(/COMMERCIAL_DECISION_IDEMPOTENCY_CONFLICT/);
      expect(queryMock).toHaveBeenCalledTimes(2);
    });

    it('throws COMMERCIAL_DECISION_REFERENCE_CONFLICT when idempotency_key is fresh but active (product, transaction_reference) already exists', async () => {
      const input = makeInput({ supersedesSnapshotId: null });
      const service = new CommercialDecisionSnapshotService({} as never);

      const queryMock = jest
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: randomUUID() }]);

      await expect(
        service.recordDecisionWithManager({ query: queryMock } as never, input),
      ).rejects.toThrow(/COMMERCIAL_DECISION_REFERENCE_CONFLICT/);
      expect(queryMock).toHaveBeenCalledTimes(3);
    });
  });
});
