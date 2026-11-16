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

/**
 * Delay before attempt `attempt + 1`.
 *
 * Immediate retries are close to useless for SERIALIZABLE contention: the competing transaction is
 * still holding its locks, so the next attempt collides again and a bounded budget of three burns out
 * in microseconds. Measured symptom: concurrent cash-to-cash initiation exhausted all three attempts
 * and returned a conflict although the same work succeeds when the competing load clears.
 *
 * Exponential with full jitter (the "binary exponential backoff" recommended for serialization
 * failures): base 5ms, doubling per attempt, capped at 100ms. Jitter is essential — without it every
 * retrying transaction wakes at the same instant and re-creates the collision it is trying to escape.
 * The total added latency is bounded by the cap times the attempt count, so this cannot hide a
 * persistent problem behind a hang.
 */
export function serializationRetryDelayMs(
  attempt: number,
  random: () => number = Math.random,
): number {
  const exponential = Math.min(100, 5 * 2 ** Math.max(0, attempt - 1));
  return Math.floor(random() * exponential);
}

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
      const delay = serializationRetryDelayMs(attempt);
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  /* istanbul ignore next -- the loop either returns or throws above */
  throw new ConflictException(`${operation} could not complete`);
}
