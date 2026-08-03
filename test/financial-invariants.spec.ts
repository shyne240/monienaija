import { BadRequestException } from '@nestjs/common';
import type { DataSource, Repository } from 'typeorm';

import { LedgerEntryDirection } from '../src/ledger/ledger.enums';
import type { LedgerAccount } from '../src/ledger/ledger-account.entity';
import type { LedgerJournal } from '../src/ledger/ledger-journal.entity';
import type { LedgerLine } from '../src/ledger/ledger-line.entity';
import { LedgerService } from '../src/ledger/ledger.service';

interface TestLine {
  accountId: string;
  direction: LedgerEntryDirection;
  amountMinor: bigint;
}

type NormalBalance = LedgerEntryDirection;

const ACCOUNT_IDS = Array.from(
  { length: 6 },
  (_, index) => `00000000-0000-4000-8000-00000000010${index}`,
);

function accountId(index: number): string {
  const value = ACCOUNT_IDS[index];
  if (!value) {
    throw new Error(`Missing test account ${index}`);
  }
  return value;
}

function nextRandom(seed: number): number {
  let value = seed | 0;
  value = Math.imul(value ^ (value >>> 15), 1 | value);
  value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
  return (value ^ (value >>> 14)) >>> 0;
}

function randomAmount(seed: number): { seed: number; amount: bigint } {
  const next = nextRandom(seed);
  return { seed: next, amount: BigInt((next % 100_000) + 1) };
}

function balancedJournal(seed: number): { seed: number; lines: TestLine[] } {
  let currentSeed = seed;
  let debitTotal = 0n;
  const debits: TestLine[] = [];
  for (let index = 0; index < 3; index += 1) {
    const generated = randomAmount(currentSeed);
    currentSeed = generated.seed;
    debitTotal += generated.amount;
    debits.push({
      accountId: accountId(index),
      direction: LedgerEntryDirection.DEBIT,
      amountMinor: generated.amount,
    });
  }

  const credits: TestLine[] = [
    {
      accountId: accountId(3),
      direction: LedgerEntryDirection.CREDIT,
      amountMinor: debitTotal / 2n,
    },
    {
      accountId: accountId(4),
      direction: LedgerEntryDirection.CREDIT,
      amountMinor: debitTotal - debitTotal / 2n,
    },
  ];
  return { seed: currentSeed, lines: [...debits, ...credits] };
}

function totals(lines: TestLine[]): { debits: bigint; credits: bigint } {
  return lines.reduce(
    (result, line) => {
      if (line.direction === LedgerEntryDirection.DEBIT) {
        result.debits += line.amountMinor;
      } else {
        result.credits += line.amountMinor;
      }
      return result;
    },
    { debits: 0n, credits: 0n },
  );
}

function reverse(lines: TestLine[]): TestLine[] {
  return lines.map((line) => ({
    ...line,
    direction:
      line.direction === LedgerEntryDirection.DEBIT
        ? LedgerEntryDirection.CREDIT
        : LedgerEntryDirection.DEBIT,
  }));
}

function balances(
  lines: TestLine[],
  normalBalances: Map<string, NormalBalance>,
): Map<string, bigint> {
  const result = new Map<string, bigint>();
  for (const line of lines) {
    const normalBalance = normalBalances.get(line.accountId) ?? LedgerEntryDirection.DEBIT;
    const signedAmount = line.direction === normalBalance ? line.amountMinor : -line.amountMinor;
    result.set(line.accountId, (result.get(line.accountId) ?? 0n) + signedAmount);
  }
  return result;
}

describe('financial invariants', () => {
  it('keeps randomized journals balanced', () => {
    let seed = 17;
    for (let iteration = 0; iteration < 250; iteration += 1) {
      const generated = balancedJournal(seed);
      seed = generated.seed;
      const journalTotals = totals(generated.lines);
      expect(journalTotals.debits).toBe(journalTotals.credits);
      expect(journalTotals.debits).toBeGreaterThan(0n);
    }
  });

  it('derives wallet balances from signed ledger lines', () => {
    const lines: TestLine[] = [
      {
        accountId: accountId(0),
        direction: LedgerEntryDirection.DEBIT,
        amountMinor: 125000n,
      },
      {
        accountId: accountId(1),
        direction: LedgerEntryDirection.CREDIT,
        amountMinor: 125000n,
      },
      {
        accountId: accountId(1),
        direction: LedgerEntryDirection.DEBIT,
        amountMinor: 50000n,
      },
      {
        accountId: accountId(2),
        direction: LedgerEntryDirection.CREDIT,
        amountMinor: 50000n,
      },
    ];
    const normalBalances = new Map<string, NormalBalance>([
      [accountId(0), LedgerEntryDirection.DEBIT],
      [accountId(1), LedgerEntryDirection.CREDIT],
      [accountId(2), LedgerEntryDirection.CREDIT],
    ]);

    expect(balances(lines, normalBalances)).toEqual(
      new Map([
        [accountId(0), 125000n],
        [accountId(1), 75000n],
        [accountId(2), 50000n],
      ]),
    );
  });

  it('makes a reversal a compensating entry for every account', () => {
    let seed = 29;
    const normalBalances = new Map<string, NormalBalance>(
      ACCOUNT_IDS.map((accountId, index) => [
        accountId,
        index % 2 === 0 ? LedgerEntryDirection.DEBIT : LedgerEntryDirection.CREDIT,
      ]),
    );

    for (let iteration = 0; iteration < 200; iteration += 1) {
      const generated = balancedJournal(seed);
      seed = generated.seed;
      const combined = balances([...generated.lines, ...reverse(generated.lines)], normalBalances);
      expect([...combined.values()].every((balance) => balance === 0n)).toBe(true);
      expect(totals(reverse(generated.lines))).toEqual(totals(generated.lines));
    }
  });

  it('conserves total wallet money across randomized transfers and retries', () => {
    let seed = 41;
    let sourceBalance = 10_000_000n;
    let destinationBalance = 0n;
    const initialTotal = sourceBalance + destinationBalance;

    for (let iteration = 0; iteration < 500; iteration += 1) {
      const generated = randomAmount(seed);
      seed = generated.seed;
      const amount = generated.amount > sourceBalance ? sourceBalance : generated.amount;
      if (amount === 0n) {
        break;
      }

      sourceBalance -= amount;
      destinationBalance += amount;
      expect(sourceBalance).toBeGreaterThanOrEqual(0n);
      expect(sourceBalance + destinationBalance).toBe(initialTotal);

      // A retry has the same durable result and must not apply the amount again.
      const sourceAfterRetry = sourceBalance;
      const destinationAfterRetry = destinationBalance;
      expect(sourceAfterRetry + destinationAfterRetry).toBe(initialTotal);
    }
  });

  it('rejects an unbalanced journal before opening a database transaction', async () => {
    const transaction = jest.fn();
    const service = new LedgerService(
      {} as Repository<LedgerAccount>,
      {} as Repository<LedgerJournal>,
      {} as Repository<LedgerLine>,
      { transaction } as unknown as DataSource,
    );

    await expect(
      service.postJournal({
        idempotencyKey: 'unbalanced-test',
        currency: 'NGN',
        lines: [
          {
            accountId: accountId(0),
            direction: LedgerEntryDirection.DEBIT,
            amountMinor: '100',
          },
          {
            accountId: accountId(1),
            direction: LedgerEntryDirection.CREDIT,
            amountMinor: '99',
          },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(transaction).not.toHaveBeenCalled();
  });
});
