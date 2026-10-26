import { randomUUID } from 'node:crypto';

import { ConflictException } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';

import { AgentCashToCashService } from '../src/agent/agent-cash-to-cash.service';
import { AgentService } from '../src/agent/agent-service.enum';
import { MAX_SERIALIZABLE_ATTEMPTS } from '../src/common/serializable-transaction';

import type { AuthorizationPrincipal } from '../src/authorization/authorization.types';

/**
 * V1-TEST-01 — deterministic regression test for the production defect found and fixed in
 * `AgentCashToCashService.execute()`.
 *
 * Root cause (see V1-TEST-01 baseline report): on bounded-retry exhaustion of the SERIALIZABLE
 * transaction (a genuine PostgreSQL `40001`/`40P01` after `MAX_SERIALIZABLE_ATTEMPTS`
 * consecutive attempts), the final `catch` previously rethrew the raw `QueryFailedError`
 * instead of converting it into a clean `ConflictException`, the same contract the shared
 * `runSerializableWithRetry` helper already guarantees elsewhere in this codebase. This test
 * does not depend on timing or real PostgreSQL contention — it deterministically forces every
 * attempt of `dataSource.transaction(...)` to reject with a retryable serialization failure and
 * asserts the service converts that into `ConflictException`, never leaking the driver error.
 */
describe('AgentCashToCashService — bounded SERIALIZABLE retry exhaustion (V1-TEST-01)', () => {
  const agentId = randomUUID();
  const principal: AuthorizationPrincipal = { type: 'AGENT', agentId } as AuthorizationPrincipal;

  function makeRetryableSerializationFailure(): QueryFailedError {
    // Mirrors what `pg` surfaces for a genuine serialization_failure: driverError.code '40001'
    // is exactly what `isRetryableTransactionError` checks for.
    return new QueryFailedError('SELECT 1', [], { code: '40001', message: 'could not serialize access' } as never);
  }

  function buildService(transactionMock: jest.Mock) {
    const dataSource = {
      query: jest.fn().mockResolvedValue([]), // agent_receiving_numbers lookup — no Agent recipient collision
      getRepository: jest.fn().mockImplementation((entity: { name?: string }) => {
        // LedgerAccount lookup (getUnclaimedAccount) and WalletAccount lookup (ensureWalletAccount)
        // both resolve to a present row so execution reaches the SERIALIZABLE retry loop.
        return {
          findOne: jest.fn().mockResolvedValue(
            entity?.name === 'WalletAccount'
              ? { id: randomUUID(), customerId: agentId, currency: 'NGN', ledgerAccountId: randomUUID() }
              : { id: randomUUID(), code: 'UNCLAIMED' },
          ),
        };
      }),
      transaction: transactionMock,
    } as const;

    const authorizationService = {
      authorize: jest.fn().mockResolvedValue({ allowed: true, context: {} }),
    };

    // Not invoked in this scenario: dataSource.transaction never reaches the ledger post /
    // audit record calls because it rejects before the callback body can run meaningfully.
    const ledgerService = {} as never;
    const idempotencyService = {} as never;
    const auditService = {} as never;

    return new AgentCashToCashService(
      dataSource as never,
      authorizationService as never,
      ledgerService,
      idempotencyService,
      auditService,
    );
  }

  it('converts exhaustion of all bounded retry attempts into a clean ConflictException, never the raw driver error', async () => {
    const transactionMock = jest.fn().mockRejectedValue(makeRetryableSerializationFailure());
    const service = buildService(transactionMock);

    await expect(
      service.execute({
        agentId,
        agentPrincipal: principal as never,
        agentPin: '1234',
        beneficiaryPhone: '8012345678',
        amountMinor: '1000',
        currency: 'NGN',
        idempotencyKey: `retry-exhaustion-${randomUUID()}`,
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    // Confirms the loop actually ran to its documented bound rather than failing fast or
    // retrying indefinitely — the fix must still respect the existing retry budget.
    expect(transactionMock).toHaveBeenCalledTimes(MAX_SERIALIZABLE_ATTEMPTS);
  });

  it('succeeds without converting to ConflictException once a retry attempt stops failing', async () => {
    const successResult = {
      status: 'COMPLETED' as const,
      transferId: randomUUID(),
      journalId: randomUUID(),
      agentId,
      beneficiaryPhone: '8012345678',
      principalMinor: '1000',
      feeMinor: '0',
      vatMinor: '0',
      totalMinor: '1000',
      currency: 'NGN',
      amountMinor: '1000',
      idempotencyKey: 'irrelevant',
      requestHash: 'irrelevant',
      replayed: false,
      correlationId: undefined,
      reference: 'irrelevant',
      createdAt: new Date().toISOString(),
    };
    const transactionMock = jest
      .fn()
      .mockRejectedValueOnce(makeRetryableSerializationFailure())
      .mockResolvedValueOnce(successResult);
    const service = buildService(transactionMock);

    const result = await service.execute({
      agentId,
      agentPrincipal: principal as never,
      agentPin: '1234',
      beneficiaryPhone: '8012345678',
      amountMinor: '1000',
      currency: 'NGN',
      idempotencyKey: `retry-then-success-${randomUUID()}`,
    });

    expect(result.status).toBe('COMPLETED');
    expect(transactionMock).toHaveBeenCalledTimes(2);
  });
});
