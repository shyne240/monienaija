import { randomUUID } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import type { DataSource } from 'typeorm';

import { PrivilegedActionApproval } from '../src/authorization/privileged-action-approval.entity';
import { PrivilegedActionApprovalStatus } from '../src/authorization/privileged-action-approval.enums';
import { PrivilegedActionApprovalService } from '../src/authorization/privileged-action-approval.service';
import {
  createIntegrationDataSource,
  destroyIntegrationDataSource,
  firstRow,
  truncateAllTables,
} from './support/pg-harness';

/**
 * A2T12 — read-only privileged-approval surface against real PostgreSQL.
 *
 * Proves listing, single read, pagination and status filtering work against the
 * real `privileged_action_approvals` table, and — critically — that reads never
 * mutate approval state or maker/checker fields.
 */
describe('A2T12 privileged-approval read surface (real PostgreSQL)', () => {
  let dataSource: DataSource;
  let service: PrivilegedActionApprovalService;

  async function rows<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    const result: unknown = await dataSource.query(sql, params);
    return result as T[];
  }

  beforeAll(async () => {
    dataSource = await createIntegrationDataSource('a2t12approvalread');
    service = new PrivilegedActionApprovalService(
      dataSource.getRepository(PrivilegedActionApproval),
      {} as never,
      dataSource,
      {} as never,
      {} as never,
    );
  }, 180000);

  afterAll(async () => {
    if (dataSource) await destroyIntegrationDataSource(dataSource);
  }, 60000);

  beforeEach(async () => {
    await truncateAllTables(dataSource);
  });

  async function seedApproval(
    status: PrivilegedActionApprovalStatus,
    requestedAt: string,
  ): Promise<string> {
    const id = randomUUID();
    await dataSource.query(
      `INSERT INTO privileged_action_approvals (
         id, action_type, resource_type, resource_id, action_fingerprint, policy,
         approval_scope, required_assurance, requester_principal_id, reason, status,
         is_emergency, requested_at, expires_at
       ) VALUES ($1, 'DELETE_CUSTOMER', 'CUSTOMER', 'cust-1', $2, '{}'::jsonb,
         'scope', 'MFA', 'issuer:maker', 'because', $3, false, $4, $5)`,
      [
        id,
        'a'.repeat(64),
        status,
        requestedAt,
        new Date(new Date(requestedAt).getTime() + 86_400_000).toISOString(),
      ],
    );
    return id;
  }

  describe('authorized reads', () => {
    it('lists approvals from the real table', async () => {
      await seedApproval(PrivilegedActionApprovalStatus.REQUESTED, '2026-01-01T00:00:00.000Z');
      await seedApproval(PrivilegedActionApprovalStatus.APPROVED, '2026-01-02T00:00:00.000Z');

      const result = await service.listApprovals();
      expect(result.items).toHaveLength(2);
      expect(result.pagination.total).toBe(2);
      // Newest first.
      expect(result.items[0]?.status).toBe(PrivilegedActionApprovalStatus.APPROVED);
    });

    it('reads a single approval by id', async () => {
      const id = await seedApproval(
        PrivilegedActionApprovalStatus.REQUESTED,
        '2026-01-01T00:00:00.000Z',
      );
      const approval = await service.getApproval(id);

      expect(approval).not.toBeNull();
      expect(approval?.id).toBe(id);
      expect(approval?.actionType).toBe('DELETE_CUSTOMER');
    });

    it('returns null for an unknown approval id', async () => {
      await expect(service.getApproval(randomUUID())).resolves.toBeNull();
    });

    it('paginates deterministically without overlap or omission', async () => {
      for (let i = 1; i <= 5; i += 1) {
        await seedApproval(
          PrivilegedActionApprovalStatus.REQUESTED,
          `2026-01-0${i}T00:00:00.000Z`,
        );
      }

      const first = await service.listApprovals({ page: 1, limit: 2 });
      const second = await service.listApprovals({ page: 2, limit: 2 });
      const third = await service.listApprovals({ page: 3, limit: 2 });

      expect(first.pagination).toEqual({
        page: 1,
        limit: 2,
        total: 5,
        totalPages: 3,
        hasNextPage: true,
      });
      expect(third.pagination.hasNextPage).toBe(false);

      const ids = [...first.items, ...second.items, ...third.items].map((a) => a.id);
      expect(ids).toHaveLength(5);
      expect(new Set(ids).size).toBe(5);
    });

    it('filters by status', async () => {
      await seedApproval(PrivilegedActionApprovalStatus.REQUESTED, '2026-01-01T00:00:00.000Z');
      await seedApproval(PrivilegedActionApprovalStatus.APPROVED, '2026-01-02T00:00:00.000Z');
      await seedApproval(PrivilegedActionApprovalStatus.APPROVED, '2026-01-03T00:00:00.000Z');

      const approved = await service.listApprovals({
        status: PrivilegedActionApprovalStatus.APPROVED,
      });
      expect(approved.items).toHaveLength(2);
      expect(approved.items.every((a) => a.status === PrivilegedActionApprovalStatus.APPROVED)).toBe(
        true,
      );

      const rejected = await service.listApprovals({
        status: PrivilegedActionApprovalStatus.REJECTED,
      });
      expect(rejected.items).toHaveLength(0);
      expect(rejected.pagination.total).toBe(0);
    });

    it('rejects invalid pagination against the real table', async () => {
      await expect(service.listApprovals({ limit: 101 })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(service.listApprovals({ page: 0 })).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('read-only guarantee', () => {
    it('does not mutate approval state or maker/checker fields', async () => {
      const id = await seedApproval(
        PrivilegedActionApprovalStatus.REQUESTED,
        '2026-01-01T00:00:00.000Z',
      );

      const before = firstRow(
        await rows<Record<string, unknown>>(
          `SELECT * FROM privileged_action_approvals WHERE id = $1`,
          [id],
        ),
        'approval before read',
      );

      await service.listApprovals();
      await service.getApproval(id);
      await service.listApprovals({ status: PrivilegedActionApprovalStatus.REQUESTED });
      await service.listApprovals({ page: 1, limit: 1 });

      const after = firstRow(
        await rows<Record<string, unknown>>(
          `SELECT * FROM privileged_action_approvals WHERE id = $1`,
          [id],
        ),
        'approval after read',
      );

      expect(after).toEqual(before);
      expect(after.status).toBe(PrivilegedActionApprovalStatus.REQUESTED);
      expect(after.approved_by).toBeNull();
      expect(after.approved_at).toBeNull();
      expect(after.rejected_at).toBeNull();
      expect(after.consumed_at).toBeNull();
      expect(after.version).toBe(1);
    });

    it('creates no approval rows and deletes none', async () => {
      await seedApproval(PrivilegedActionApprovalStatus.REQUESTED, '2026-01-01T00:00:00.000Z');
      await seedApproval(PrivilegedActionApprovalStatus.CONSUMED, '2026-01-02T00:00:00.000Z');

      await service.listApprovals();
      await service.listApprovals({ status: PrivilegedActionApprovalStatus.CONSUMED });

      const counted = firstRow(
        await rows<{ count: number }>(
          `SELECT COUNT(*)::int AS count FROM privileged_action_approvals`,
        ),
        'approval count',
      );
      expect(counted.count).toBe(2);
    });

    it('writes no security-event or audit rows while reading', async () => {
      await seedApproval(PrivilegedActionApprovalStatus.REQUESTED, '2026-01-01T00:00:00.000Z');

      await service.listApprovals();

      for (const table of ['security_event_histories', 'audit_events']) {
        const counted = firstRow(
          await rows<{ count: number }>(`SELECT COUNT(*)::int AS count FROM ${table}`),
          `${table} count`,
        );
        expect({ table, count: counted.count }).toEqual({ table, count: 0 });
      }
    });
  });

  describe('exposure boundary', () => {
    it('never projects session identifiers held on the entity', async () => {
      const id = await seedApproval(
        PrivilegedActionApprovalStatus.REQUESTED,
        '2026-01-01T00:00:00.000Z',
      );
      await dataSource.query(
        `UPDATE privileged_action_approvals
            SET requester_session_id = $2, approver_session_id = $2 WHERE id = $1`,
        [id, randomUUID()],
      );

      const approval = await service.getApproval(id);
      const listed = (await service.listApprovals()).items[0];

      expect(approval).not.toHaveProperty('requesterSessionId');
      expect(approval).not.toHaveProperty('approverSessionId');
      expect(listed).not.toHaveProperty('requesterSessionId');
      expect(listed).not.toHaveProperty('approverSessionId');
    });
  });
});
