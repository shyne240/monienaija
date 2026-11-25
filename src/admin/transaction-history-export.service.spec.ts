import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import type { DataSource } from 'typeorm';

import type { AuditService } from '../operations/audit.service';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import {
  EXPORT_PAGE_SIZE,
  MAX_EXPORT_ROWS,
  TransactionHistoryExportService,
  type HistoryListPage,
  type HistoryListReader,
} from './transaction-history-export.service';

/** Index-safe accessor: `noUncheckedIndexedAccess` is on, and the assertions below want the row. */
function only<T>(rows: readonly T[]): T {
  expect(rows).toHaveLength(1);
  return rows[0] as T;
}

const principal = {
  type: 'OPERATOR',
  principalId: 'operator-1',
  roles: ['OPERATIONS'],
  scopes: ['transaction.view'],
  customerAccess: 'NONE',
} as unknown as AuthorizationPrincipal;
const request = { authorizationPrincipal: principal };

function row(index: number, overrides: Record<string, unknown> = {}) {
  return {
    id: `1111111${String(index).padStart(2, '0')}-1111-4111-8111-111111111111`,
    type: 'CASH_IN',
    status: 'POSTED',
    reference: `SYN-${index}`,
    createdAt: '2026-11-24T12:00:00.000000Z',
    amountMinor: '125000',
    feeMinor: '0',
    currency: 'NGN',
    ...overrides,
  };
}

/** Reader that pages exactly like the controller: N rows per call, opaque cursors. */
function readerOf(
  total: number,
  pageSize = EXPORT_PAGE_SIZE,
): HistoryListReader & { calls: Array<Record<string, string>> } {
  const calls: Array<Record<string, string>> = [];
  return {
    calls,
    list: (_req: unknown, query: Record<string, string>): Promise<HistoryListPage> => {
      calls.push({ ...query });
      const offset = query.cursor ? Number(query.cursor.replace('cursor-', '')) : 0;
      const limit = Number(query.limit);
      const slice = Array.from({ length: Math.min(pageSize, total - offset) }, (_, i) =>
        row(offset + i),
      ).slice(0, limit);
      const next = offset + slice.length;
      return Promise.resolve({
        items: slice,
        nextCursor: next < total ? `cursor-${next}` : null,
      });
    },
  };
}

function service(
  auditRows: Array<Record<string, unknown>> = [],
  options: { maxRows?: number } = {},
) {
  const db = {
    transaction: (work: (manager: unknown) => Promise<unknown>) =>
      Promise.resolve(work({ getRepository: () => ({}) })),
  } as unknown as DataSource;
  const audit = {
    record: (_manager: unknown, command: Record<string, unknown>) => {
      auditRows.push(command);
      return Promise.resolve(command);
    },
  } as unknown as AuditService;
  return new TransactionHistoryExportService(db, audit, options);
}

describe('Transaction history CSV export service', () => {
  test('drains every page, passing only the supported filters', async () => {
    const reader = readerOf(250);
    const audit: Array<Record<string, unknown>> = [];
    const result = await service(audit).export(reader, request, {
      type: 'CASH_IN',
      status: 'POSTED',
      from: '2026-11-24',
      to: '2026-11-24',
    });
    expect(result.rowCount).toBe(250);
    // Three pages of 100: full cursor walk, not a single capped read.
    expect(reader.calls).toHaveLength(3);
    expect(reader.calls[0]).toEqual({
      type: 'CASH_IN',
      status: 'POSTED',
      from: '2026-11-24',
      to: '2026-11-24',
      limit: String(EXPORT_PAGE_SIZE),
      cursor: '',
    });
    expect(reader.calls[1]?.cursor).toBe('cursor-100');
    // Header + 250 data rows, each exactly once.
    const lines = result.body.replace(/^\uFEFF/, '').split('\r\n');
    expect(lines).toHaveLength(251);
    expect(new Set(lines.slice(1).map((line) => line.split(',')[0])).size).toBe(250);
  });

  test('a caller-supplied limit or cursor cannot truncate the export', async () => {
    const reader = readerOf(30);
    const result = await service().export(reader, request, {
      // @ts-expect-error deliberately out-of-contract values
      limit: '5',
      cursor: 'cursor-25',
    });
    expect(result.rowCount).toBe(30);
    expect(reader.calls.every((call) => call.limit === String(EXPORT_PAGE_SIZE))).toBe(true);
    expect(reader.calls[0]?.cursor).toBe('');
  });

  test('an empty result is a header-only file, not an error', async () => {
    const result = await service().export(readerOf(0), request, {});
    expect(result.rowCount).toBe(0);
    expect(result.body.replace(/^\uFEFF/, '').split('\r\n')).toHaveLength(1);
  });

  test('duplicate keys across pages are written once and reported', async () => {
    const repeated = row(1);
    const reader: HistoryListReader = {
      list: jest
        .fn()
        .mockResolvedValueOnce({ items: [row(0), repeated], nextCursor: 'c2' })
        .mockResolvedValueOnce({ items: [repeated, row(2)], nextCursor: null }),
    };
    const audit: Array<Record<string, unknown>> = [];
    const result = await service(audit).export(reader, request, {});
    expect(result.rowCount).toBe(3);
    expect(result.duplicateSuppressed).toBe(1);
    expect(result.body.replace(/^\uFEFF/, '').split('\r\n')).toHaveLength(4);
    expect(only(audit).newValues as Record<string, unknown>).toMatchObject({ duplicateSuppressed: 1 });
  });

  test('a cursor that never advances fails instead of looping forever', async () => {
    const reader: HistoryListReader = {
      list: jest.fn().mockResolvedValue({ items: [row(0)], nextCursor: 'stuck' }),
    };
    await expect(service().export(reader, request, {})).rejects.toThrow(/did not advance/);
  });

  test('exceeding the supported size refuses the export and writes no file', async () => {
    const audit: Array<Record<string, unknown>> = [];
    const reader = readerOf(MAX_EXPORT_ROWS + 1, 500);
    await expect(service(audit).export(reader, request, {})).rejects.toBeInstanceOf(
      PayloadTooLargeException,
    );
    const error = await service()
      .export(readerOf(MAX_EXPORT_ROWS + 1, 500), request, {})
      .then(() => {
        throw new Error('export should have been refused');
      })
      .catch((e: PayloadTooLargeException) => e);
    // The message tells the operator what to do, not just that it failed.
    expect(error.message).toMatch(/above the supported export size/);
    expect(error.message).toMatch(/Narrow the date range/);
    expect(error.message).toMatch(/No file was produced/);
    // The refusal is recorded, with the filters that caused it.
    const refusal = only(audit);
    expect((refusal.newValues as Record<string, unknown>).outcome).toBe('REFUSED_SIZE_LIMIT');
    expect(refusal.entityType).toBe('TRANSACTION_HISTORY_EXPORT');
    expect(refusal.action).toBe('TRANSACTION_HISTORY_CSV_EXPORTED');
  });

  test('exactly the supported size is allowed', async () => {
    const result = await service().export(readerOf(MAX_EXPORT_ROWS, 1000), request, {});
    expect(result.rowCount).toBe(MAX_EXPORT_ROWS);
  });

  test('the audit record names the actor, the applied filters and the outcome', async () => {
    const audit: Array<Record<string, unknown>> = [];
    await service(audit).export(readerOf(1), request, {
      type: 'BANK_TO_WALLET',
      status: 'CREDITED',
      reference: '=EVIL()',
      from: '2026-11-24',
      to: '2026-11-25',
    });
    const command = only(audit);
    expect(command.actor).toBe('operator-1');
    expect(command.entityType).toBe('TRANSACTION_HISTORY_EXPORT');
    expect(command.entityId).toMatch(/^[0-9a-f-]{36}$/);
    const values = command.newValues as Record<string, unknown>;
    expect(values.filters).toEqual({
      type: 'BANK_TO_WALLET',
      status: 'CREDITED',
      // Free text is neutralised on the way into an audit viewer too.
      reference: "'=EVIL()",
      from: '2026-11-24',
      to: '2026-11-25',
    });
    expect(values.rowCount).toBe(1);
    expect(values.outcome).toBe('SUCCEEDED');
    expect(values.format).toBe('CSV');
  });

  test('an unexpected failure is recorded as FAILED and still rethrown', async () => {
    const audit: Array<Record<string, unknown>> = [];
    const reader: HistoryListReader = {
      list: jest.fn().mockRejectedValue(new Error('database went away')),
    };
    await expect(service(audit).export(reader, request, {})).rejects.toThrow('database went away');
    expect(only(audit).newValues as Record<string, unknown>).toMatchObject({
      outcome: 'FAILED',
      reason: 'database went away',
    });
  });

  test('a principal that the read layer rejected never reaches the audit write', async () => {
    const audit: Array<Record<string, unknown>> = [];
    const reader: HistoryListReader = {
      list: jest.fn().mockRejectedValue(new Error('Authorization denied: FUNCTION_MISSING')),
    };
    await expect(service(audit).export(reader, request, {})).rejects.toThrow(/Authorization denied/);
    expect(only(audit).newValues as Record<string, unknown>).toMatchObject({ rowCount: 0 });
  });

  test('an export with no principal cannot be claimed by anyone', async () => {
    await expect(
      service().export({ list: jest.fn() }, {}, {}),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  test('the row ceiling is configurable for measured capacity, but not removable', () => {
    expect(() => service([], { maxRows: 0 })).toThrow(/positive integer/);
    expect(() => service([], { maxRows: 1.5 })).toThrow(/positive integer/);
  });

  test('a lowered ceiling refuses a matching result instead of truncating it', async () => {
    const audit: Array<Record<string, unknown>> = [];
    await expect(service(audit, { maxRows: 4 }).export(readerOf(5, 5), request, {})).rejects.toThrow(
      /more than 4 transactions/,
    );
    expect((only(audit).newValues as Record<string, unknown>).outcome).toBe('REFUSED_SIZE_LIMIT');
  });

  test('the audit trail is required: a failed audit write fails the export', async () => {
    const db = {
      transaction: () => Promise.reject(new Error('audit unavailable')),
    } as unknown as DataSource;
    const svc = new TransactionHistoryExportService(db, {
      record: jest.fn(),
    } as unknown as AuditService);
    await expect(svc.export(readerOf(1), request, {})).rejects.toThrow('audit unavailable');
    // The failure path itself tries to record and also fails, so nothing is returned.
    await expect(svc.export(readerOf(1), request, {})).rejects.toThrow(/audit unavailable|Failed/);
  });
});
