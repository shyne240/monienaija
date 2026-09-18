import { ConflictException } from '@nestjs/common';
import type { DataSource, EntityManager } from 'typeorm';
import { QueryFailedError } from 'typeorm';

/**
 * Maximum number of attempts for a SERIALIZABLE transaction body.
 *
 * The bound is deliberate: PostgreSQL reports genuine write skew and deadlock as retryable,
 * but an unbounded loop would convert a persistent contention problem into a hang. Three
 * attempts matches the bound already established for the A5 Ledger post path.
 */
export const MAX_SERIALIZABLE_ATTEMPTS = 3;

/**
 * PostgreSQL error codes that represent a transaction the caller may safely retry.
 *
 * - `40001` serialization_failure
 * - `40P01` deadlock_detected
 *
 * Every other failure — including business rule violations, CHECK/FK violations and
 * unique-constraint conflicts — is a real outcome and must propagate unchanged.
 */
const RETRYABLE_TRANSACTION_CODES = new Set(['40001', '40P01']);

export function isRetryableTransactionError(error: unknown): boolean {
  if (!(error instanceof QueryFailedError)) {
    return false;
  }
  const driverError = error.driverError as { code?: string } | undefined;
  return driverError?.code !== undefined && RETRYABLE_TRANSACTION_CODES.has(driverError.code);
}

/**
 * Runs `work` inside a SERIALIZABLE transaction, retrying only on PostgreSQL serialization
 * failure or deadlock, at most {@link MAX_SERIALIZABLE_ATTEMPTS} times.
 *
 * Business failures propagate unchanged on the first attempt. When the retry budget is
 * exhausted the caller receives a `ConflictException` rather than a driver error, so the
 * contention is surfaced as a retryable conflict to the client.
 */
export async function runSerializableWithRetry<T>(
  dataSource: DataSource,
  operation: string,
  work: (manager: EntityManager) => Promise<T>,
): Promise<T> {
  for (let attempt = 1; attempt <= MAX_SERIALIZABLE_ATTEMPTS; attempt += 1) {
    try {
      return await dataSource.transaction('SERIALIZABLE', (manager) => work(manager));
    } catch (error) {
      if (!isRetryableTransactionError(error)) {
        throw error;
      }
      if (attempt >= MAX_SERIALIZABLE_ATTEMPTS) {
        throw new ConflictException(
          `${operation} exhausted ${MAX_SERIALIZABLE_ATTEMPTS} bounded transaction attempts`,
        );
      }
    }
  }
  /* istanbul ignore next -- the loop either returns or throws above */
  throw new ConflictException(`${operation} could not complete`);
}
