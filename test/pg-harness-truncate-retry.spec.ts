import { QueryFailedError } from 'typeorm';
import { truncateWithDeadlockRetry } from './support/pg-harness';

function driverFailure(code: string): QueryFailedError {
  const driverError = Object.assign(new Error(`driver error ${code}`), { code });
  return new QueryFailedError('TRUNCATE "a", "b" RESTART IDENTITY CASCADE', undefined, driverError);
}

describe('truncateWithDeadlockRetry', () => {
  it('runs the truncate once when it succeeds', async () => {
    const calls: string[] = [];
    await truncateWithDeadlockRetry((statement) => {
      calls.push(statement);
      return Promise.resolve();
    }, 'TRUNCATE "a" RESTART IDENTITY CASCADE');
    expect(calls).toEqual(['TRUNCATE "a" RESTART IDENTITY CASCADE']);
  });

  it('retries a deadlock (40P01) and then succeeds', async () => {
    const calls: string[] = [];
    await truncateWithDeadlockRetry(
      (statement) => {
        calls.push(statement);
        return calls.length === 1 ? Promise.reject(driverFailure('40P01')) : Promise.resolve();
      },
      'TRUNCATE "a" RESTART IDENTITY CASCADE',
      { delayMs: 1 },
    );
    expect(calls).toHaveLength(2);
  });

  it('retries a serialization failure (40001) and then succeeds', async () => {
    const calls: string[] = [];
    await truncateWithDeadlockRetry(
      (statement) => {
        calls.push(statement);
        return calls.length === 1 ? Promise.reject(driverFailure('40001')) : Promise.resolve();
      },
      'TRUNCATE "a"',
      { delayMs: 1 },
    );
    expect(calls).toHaveLength(2);
  });

  it('propagates a non-retryable failure on the first attempt', async () => {
    let attempts = 0;
    const failure = driverFailure('23505');
    await expect(
      truncateWithDeadlockRetry(
        () => {
          attempts += 1;
          return Promise.reject(failure);
        },
        'TRUNCATE "a"',
        { delayMs: 1 },
      ),
    ).rejects.toBe(failure);
    expect(attempts).toBe(1);
  });

  it('gives up after the bounded attempt budget and rethrows the last deadlock', async () => {
    let attempts = 0;
    const failure = driverFailure('40P01');
    await expect(
      truncateWithDeadlockRetry(
        () => {
          attempts += 1;
          return Promise.reject(failure);
        },
        'TRUNCATE "a"',
        { attempts: 3, delayMs: 1 },
      ),
    ).rejects.toBe(failure);
    expect(attempts).toBe(3);
  });

  it('does not retry a plain (non-driver) error', async () => {
    let attempts = 0;
    const failure = new Error('connection terminated');
    await expect(
      truncateWithDeadlockRetry(
        () => {
          attempts += 1;
          return Promise.reject(failure);
        },
        'TRUNCATE "a"',
        { delayMs: 1 },
      ),
    ).rejects.toBe(failure);
    expect(attempts).toBe(1);
  });
});
