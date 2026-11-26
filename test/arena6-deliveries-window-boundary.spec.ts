import { BadRequestException } from '@nestjs/common';
import type { DataSource } from 'typeorm';

import { AdminNotificationController } from '../src/admin/admin-notification.controller';
import type { AuthorizationService } from '../src/authorization/authorization.service';

/**
 * ARENA 6 — the queue's upper bound, and why it has two meanings now.
 *
 * The dashboard exception card aggregates over a half-open window (`created_at >= from AND created_at < to`).
 * The delivery queue has always filtered inclusively (`<= to`). Those two definitions differ by exactly the
 * rows stamped at `to`, which is precisely the row an operator chasing a count cannot find: the card says
 * three, the queue it links to says four, and nothing on either screen is lying.
 *
 * The product decision is to keep both. An ordinary queue visit and every existing API caller keep the
 * inclusive bound — changing it would silently restate a published contract — and a drill-down opts into the
 * half-open interval with an explicit parameter. These tests pin all three outcomes, including the one that
 * is easy to get wrong: an unrecognized value is a bad request, never a filter quietly ignored.
 */

interface CapturedQuery {
  sql: string;
  params: unknown[];
}

const makeController = (captured: CapturedQuery[]) => {
  const dataSource = {
    query: jest.fn((sql: string, params: unknown[] = []): Promise<unknown> => {
      captured.push({ sql, params });
      return Promise.resolve(sql.includes('count(*)') ? [{ count: '7' }] : []);
    }),
  } as unknown as DataSource;
  const auth = {
    requireFunction: jest.fn((): Promise<string> => Promise.resolve('granted')),
  } as unknown as AuthorizationService;
  const req = { authorizationPrincipal: { principalId: 'arena6-boundary-probe' } };
  return new AdminNotificationController(dataSource, auth).listDeliveries(
    // The controller reads only `authorizationPrincipal` from the request, which the fake above supplies.
    req as Parameters<AdminNotificationController['listDeliveries']>[0],
    '1',
    '20',
    'FAILED',
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
  );
};

const appliedConditions = (captured: CapturedQuery[]): string => {
  const countQuery = captured.find((entry) => entry.sql.includes('count(*)'));
  const where = countQuery?.sql.match(/WHERE (.*)$/)?.[1] ?? '';
  return where.replace(/\s+/g, ' ').trim();
};

describe('ARENA 6 — delivery queue upper bound', () => {
  it('keeps the inclusive bound for an ordinary windowed visit', async () => {
    const captured: CapturedQuery[] = [];
    const controller = new AdminNotificationController(
      {
        query: jest.fn((sql: string, params: unknown[] = []): Promise<unknown> => {
          captured.push({ sql, params });
          return Promise.resolve(sql.includes('count(*)') ? [{ count: '4' }] : []);
        }),
      } as unknown as DataSource,
      {
        requireFunction: jest.fn((): Promise<string> => Promise.resolve('granted')),
      } as unknown as AuthorizationService,
    );

    const from = '2026-11-04T00:00:00.000Z';
    const to = '2026-11-05T00:00:00.000Z';
    const result = await controller.listDeliveries(
      { authorizationPrincipal: { principalId: 'p' } } as never,
      '1',
      '20',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      from,
      to,
    );

    expect(appliedConditions(captured)).toBe('created_at >= $1 AND created_at <= $2');
    expect(result.window).toEqual({
      from,
      to,
      upperBound: 'inclusive',
      boundary: 'created_at >= from AND created_at <= to (inclusive upper bound, UTC)',
    });
  });

  it('switches to the card half-open window only when the caller asks for it', async () => {
    const captured: CapturedQuery[] = [];
    const controller = new AdminNotificationController(
      {
        query: jest.fn((sql: string, params: unknown[] = []): Promise<unknown> => {
          captured.push({ sql, params });
          return Promise.resolve(sql.includes('count(*)') ? [{ count: '3' }] : []);
        }),
      } as unknown as DataSource,
      {
        requireFunction: jest.fn((): Promise<string> => Promise.resolve('granted')),
      } as unknown as AuthorizationService,
    );

    const to = '2026-11-05T00:00:00.000Z';
    const result = await controller.listDeliveries(
      { authorizationPrincipal: { principalId: 'p' } } as never,
      '1',
      '20',
      'FAILED',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      '2026-11-04T00:00:00.000Z',
      to,
      'true',
    );

    const where = appliedConditions(captured);
    // Placeholders follow the order the conditions are pushed in, which is the queue's own ordering;
    // what matters here is the operator beside `created_at`, and that `to` is the one it binds to.
    expect(where).toBe('status = $1 AND created_at >= $2 AND created_at < $3');
    expect(where).not.toContain('<=');
    expect(result.window).toMatchObject({ to, upperBound: 'exclusive' });
    // The bound the reader is told about is the bound that ran, not the one the client hoped for.
    expect(String(result.window.boundary)).toMatch(/half-open/);
  });

  it('states the window it applied even when there is no upper bound to qualify', async () => {
    const controller = new AdminNotificationController(
      {
        query: jest.fn(
          (sql: string): Promise<unknown> =>
            Promise.resolve(sql.includes('count(*)') ? [{ count: '0' }] : []),
        ),
      } as unknown as DataSource,
      {
        requireFunction: jest.fn((): Promise<string> => Promise.resolve('granted')),
      } as unknown as AuthorizationService,
    );

    const openEnded = await controller.listDeliveries(
      { authorizationPrincipal: { principalId: 'p' } } as never,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      '2026-11-04T00:00:00.000Z',
      undefined,
      // Asking to exclude a bound that was never supplied is a no-op, not an error: the flag is a
      // modifier of `to`, and `to` is absent.
      'true',
    );
    expect(openEnded.window).toMatchObject({
      from: '2026-11-04T00:00:00.000Z',
      to: null,
      upperBound: 'none',
    });
    expect(String(openEnded.window.boundary)).toMatch(/no upper bound/);

    const unwindowed = await controller.listDeliveries(
      { authorizationPrincipal: { principalId: 'p' } } as never,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    );
    expect(String(unwindowed.window.boundary)).toMatch(/no time window applied/);
  });

  it('refuses a bound flag it cannot interpret rather than ignoring it', async () => {
    await expect(makeControllerWithFlag('sometimes')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('exposes the window on the page payload the queue renders', async () => {
    const captured: CapturedQuery[] = [];
    const result = await makeController(captured);
    expect(result.total).toBe(7);
    // An absent bound is reported as absent, not as an empty string a reader could mistake for midnight.
    expect(result.window.to).toBeNull();
    expect(result.window.from).toBeNull();
    expect(result.window.upperBound).toBe('none');
  });

  function makeControllerWithFlag(flag: string): Promise<unknown> {
    const dataSource = {
      query: jest.fn((): Promise<unknown> => Promise.resolve([{ count: '0' }])),
    } as unknown as DataSource;
    const controller = new AdminNotificationController(dataSource, {
      requireFunction: jest.fn((): Promise<string> => Promise.resolve('granted')),
    } as unknown as AuthorizationService);
    return controller.listDeliveries(
      { authorizationPrincipal: { principalId: 'p' } } as never,
      '1',
      '20',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      '2026-11-04T00:00:00.000Z',
      '2026-11-05T00:00:00.000Z',
      flag,
    );
  }
});
