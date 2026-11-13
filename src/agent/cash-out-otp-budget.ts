import { HttpException, HttpStatus } from '@nestjs/common';
import type { EntityManager } from 'typeorm';

const MAX_ISSUANCES = 3;
const MAX_FAILURES = 5;

/** Rows are inserted and locked in the same deterministic order for every caller. */
export async function lockCashOutOtpBudget(
  manager: EntityManager,
  customerId: string,
  destinationHash: string,
): Promise<{ keys: string[]; issuanceCount: number; failures: number }> {
  const keys = [`customer:${customerId}`, `destination:${destinationHash}`].sort();
  for (const key of keys) {
    await manager.query(
      `INSERT INTO cash_out_otp_budgets(budget_key) VALUES($1) ON CONFLICT DO NOTHING`,
      [key],
    );
  }
  const rows = await manager.query<
    Array<{ budget_key: string; issuance_count: number; failed_attempts: number; expired: boolean }>
  >(
    `SELECT budget_key, issuance_count, failed_attempts, window_started_at <= clock_timestamp()-interval '15 minutes' AS expired
     FROM cash_out_otp_budgets WHERE budget_key=ANY($1::varchar[]) ORDER BY budget_key FOR UPDATE`,
    [keys],
  );
  for (const row of rows) {
    if (row.expired) {
      await manager.query(
        `UPDATE cash_out_otp_budgets SET window_started_at=clock_timestamp(),issuance_count=0,failed_attempts=0 WHERE budget_key=$1`,
        [row.budget_key],
      );
      row.issuance_count = 0;
      row.failed_attempts = 0;
    }
  }
  return {
    keys,
    issuanceCount: Math.max(...rows.map((row) => row.issuance_count)),
    failures: Math.max(...rows.map((row) => row.failed_attempts)),
  };
}

export async function reserveCashOutOtpIssuance(
  manager: EntityManager,
  customerId: string,
  destinationHash: string,
): Promise<void> {
  const budget = await lockCashOutOtpBudget(manager, customerId, destinationHash);
  if (budget.issuanceCount >= MAX_ISSUANCES || budget.failures >= MAX_FAILURES) {
    throw new HttpException('Cash-out OTP temporarily unavailable', HttpStatus.TOO_MANY_REQUESTS);
  }
  await manager.query(
    `UPDATE cash_out_otp_budgets SET issuance_count=issuance_count+1 WHERE budget_key=ANY($1::varchar[])`,
    [budget.keys],
  );
}

export async function cashOutOtpVerificationBudget(
  manager: EntityManager,
  customerId: string,
  destinationHash: string,
): Promise<string[] | null> {
  const budget = await lockCashOutOtpBudget(manager, customerId, destinationHash);
  return budget.failures >= MAX_FAILURES ? null : budget.keys;
}

export async function recordCashOutOtpFailure(
  manager: EntityManager,
  keys: string[],
): Promise<void> {
  await manager.query(
    `UPDATE cash_out_otp_budgets SET failed_attempts=failed_attempts+1 WHERE budget_key=ANY($1::varchar[])`,
    [keys],
  );
}
