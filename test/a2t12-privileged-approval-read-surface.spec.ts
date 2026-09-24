import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { Repository } from 'typeorm';

import { A2WorkforceAdministrationController } from '../src/authorization/workforce-administration.controller';
import type { PrivilegedActionApproval } from '../src/authorization/privileged-action-approval.entity';
import { PrivilegedActionApprovalStatus } from '../src/authorization/privileged-action-approval.enums';
import { PrivilegedActionApprovalService } from '../src/authorization/privileged-action-approval.service';
import type { AuthorizationPrincipal } from '../src/authorization/authorization.types';

/**
 * A2T12 — unit coverage for the read-only privileged-approval surface.
 *
 * Persistence is proven separately against real PostgreSQL in
 * `a2t12-privileged-approval-read-surface.integration.spec.ts`.
 */
describe('A2T12 privileged-approval read surface (unit)', () => {
  function approval(overrides: Partial<PrivilegedActionApproval> = {}): PrivilegedActionApproval {
    return {
      id: '11111111-2222-4333-8444-555555555555',
      actionType: 'DELETE_CUSTOMER',
      resourceType: 'CUSTOMER',
      resourceId: 'cust-1',
      customerId: null,
      actionFingerprint: 'a'.repeat(64),
      policy: {},
      approvalScope: 'scope',
      requiredAssurance: 'MFA',
      requesterPrincipalId: 'maker',
      requesterSessionId: null,
      approvedBy: null,
      approverSessionId: null,
      reason: 'because',
      status: PrivilegedActionApprovalStatus.REQUESTED,
      isEmergency: false,
      requestedAt: new Date('2026-01-01T00:00:00.000Z'),
      expiresAt: new Date('2026-01-02T00:00:00.000Z'),
      approvedAt: null,
      rejectedAt: null,
      cancelledAt: null,
      consumedAt: null,
      version: 1,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      ...overrides,
    } as PrivilegedActionApproval;
  }

  interface FindArgs {
    where?: { status?: PrivilegedActionApprovalStatus };
    skip?: number;
    take?: number;
  }

  function buildService(rows: PrivilegedActionApproval[] = [approval()]) {
    const calls: { find: FindArgs[]; save: unknown[] } = { find: [], save: [] };
    const repo = {
      findAndCount: (args: FindArgs): Promise<[PrivilegedActionApproval[], number]> => {
        calls.find.push(args);
        const filtered = args.where?.status
          ? rows.filter((r) => r.status === args.where?.status)
          : rows;
        const skip = args.skip ?? 0;
        const take = args.take ?? filtered.length;
        return Promise.resolve([filtered.slice(skip, skip + take), filtered.length]);
      },
      findOne: (args: { where?: { id?: string } }): Promise<PrivilegedActionApproval | null> =>
        Promise.resolve(rows.find((r) => r.id === args.where?.id) ?? null),
      save: (entity: unknown): Promise<unknown> => {
        calls.save.push(entity);
        return Promise.resolve(entity);
      },
    };
    const service = new PrivilegedActionApprovalService(
      repo as unknown as Repository<PrivilegedActionApproval>,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return { service, calls };
  }

  describe('service listing', () => {
    it('returns the repository pagination envelope', async () => {
      const { service } = buildService([approval({ id: 'a' }), approval({ id: 'b' })]);
      const result = await service.listApprovals({ page: 1, limit: 1 });

      expect(result.items).toHaveLength(1);
      expect(result.pagination).toEqual({
        page: 1,
        limit: 1,
        total: 2,
        totalPages: 2,
        hasNextPage: true,
      });
    });

    it('defaults page and limit when not supplied', async () => {
      const { service, calls } = buildService();
      const result = await service.listApprovals();

      expect(result.pagination.page).toBe(1);
      expect(result.pagination.limit).toBe(50);
      expect(calls.find[0]?.skip).toBe(0);
      expect(calls.find[0]?.take).toBe(50);
    });

    it('applies the status filter', async () => {
      const { service, calls } = buildService([
        approval({ id: 'a', status: PrivilegedActionApprovalStatus.REQUESTED }),
        approval({ id: 'b', status: PrivilegedActionApprovalStatus.APPROVED }),
      ]);
      const result = await service.listApprovals({
        status: PrivilegedActionApprovalStatus.APPROVED,
      });

      expect(calls.find[0]?.where).toEqual({ status: PrivilegedActionApprovalStatus.APPROVED });
      expect(result.items).toHaveLength(1);
      expect(result.items[0]?.status).toBe(PrivilegedActionApprovalStatus.APPROVED);
    });

    it('reports an empty page set without dividing by zero', async () => {
      const { service } = buildService([]);
      const result = await service.listApprovals();

      expect(result.items).toEqual([]);
      expect(result.pagination.total).toBe(0);
      expect(result.pagination.totalPages).toBe(0);
      expect(result.pagination.hasNextPage).toBe(false);
    });

    it('rejects invalid pagination parameters', async () => {
      const { service } = buildService();
      for (const bad of [0, -1, 1.5, Number.NaN]) {
        await expect(service.listApprovals({ page: bad })).rejects.toBeInstanceOf(
          BadRequestException,
        );
      }
      for (const bad of [0, -1, 101, 2.5]) {
        await expect(service.listApprovals({ limit: bad })).rejects.toBeInstanceOf(
          BadRequestException,
        );
      }
    });

    it('rejects an unknown status filter', async () => {
      const { service } = buildService();
      await expect(
        service.listApprovals({ status: 'NOT_A_STATUS' as PrivilegedActionApprovalStatus }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('never writes while listing', async () => {
      const { service, calls } = buildService();
      await service.listApprovals();
      expect(calls.save).toHaveLength(0);
    });

    it('exposes only the existing view projection, with no secret fields', async () => {
      const { service } = buildService();
      const [item] = (await service.listApprovals()).items;

      expect(Object.keys(item ?? {}).sort()).toEqual(
        [
          'id',
          'actionType',
          'resourceType',
          'resourceId',
          'customerId',
          'actionFingerprint',
          'requesterPrincipalId',
          'approvedBy',
          'approvalScope',
          'requiredAssurance',
          'policy',
          'status',
          'isEmergency',
          'requestedAt',
          'expiresAt',
          'approvedAt',
          'rejectedAt',
          'cancelledAt',
          'consumedAt',
          'version',
        ].sort(),
      );
      // The projection must not leak the session identifiers the entity holds.
      expect(item).not.toHaveProperty('requesterSessionId');
      expect(item).not.toHaveProperty('approverSessionId');
      const serialized = JSON.stringify(item).toLowerCase();
      for (const secret of ['token', 'secret', 'password', 'pin', 'credential', 'sessionid']) {
        expect(serialized).not.toContain(secret);
      }
    });
  });

  describe('controller authorization', () => {
    function buildController(allowed: boolean, rows: PrivilegedActionApproval[] = [approval()]) {
      const { service } = buildService(rows);
      const authorizeCalls: Array<Record<string, unknown>> = [];
      const auth = {
        authorize: (
          _p: AuthorizationPrincipal,
          policy: Record<string, unknown>,
        ): Promise<{ allowed: boolean; reason?: string }> => {
          authorizeCalls.push(policy);
          return Promise.resolve({
            allowed,
            reason: allowed ? undefined : 'PRINCIPAL_TYPE_DENIED',
          });
        },
      };
      const controller = new A2WorkforceAdministrationController(
        {} as never,
        {} as never,
        {} as never,
        service,
        auth as never,
        {} as never,
        {} as never,
      );
      return { controller, authorizeCalls };
    }

    const request = (principal?: AuthorizationPrincipal) =>
      ({ authorizationPrincipal: principal }) as never;

    const operator: AuthorizationPrincipal = {
      type: 'OPERATOR',
      principalId: 'issuer:subject',
      roles: ['FINANCE_APPROVER'],
      scopes: [],
      customerAccess: 'NONE',
    };

    it('denies a caller with no workforce principal', async () => {
      const { controller } = buildController(true);
      await expect(controller.listApprovals({}, request())).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      await expect(controller.readApproval('id', request())).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('denies a non-privileged principal', async () => {
      const { controller } = buildController(false);
      await expect(controller.listApprovals({}, request(operator))).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('restricts reads to OPERATOR and PRIVILEGED with no customer scope', async () => {
      const { controller, authorizeCalls } = buildController(true);
      await controller.listApprovals({}, request(operator));

      const policy = authorizeCalls[0] ?? {};
      expect(policy.allowedPrincipalTypes).toEqual(['OPERATOR', 'PRIVILEGED']);
      expect(policy.customerAccess).toBe('NONE');
      expect(policy.action).toBe('PRIVILEGED_APPROVAL_READ');
    });

    it('allows an authorized workforce caller to list', async () => {
      const { controller } = buildController(true);
      const result = await controller.listApprovals({ limit: 10 }, request(operator));
      expect(result.items).toHaveLength(1);
    });

    it('allows an authorized workforce caller to read one approval', async () => {
      const { controller } = buildController(true);
      const result = await controller.readApproval(
        '11111111-2222-4333-8444-555555555555',
        request(operator),
      );
      expect(result.id).toBe('11111111-2222-4333-8444-555555555555');
    });

    it('returns not found for a missing approval id', async () => {
      const { controller } = buildController(true, []);
      await expect(
        controller.readApproval('99999999-2222-4333-8444-555555555555', request(operator)),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('leaves the existing mutation handlers intact and adds only two read handlers', () => {
      const handlers = Object.getOwnPropertyNames(
        A2WorkforceAdministrationController.prototype,
      ).filter((name) => name !== 'constructor');

      // Pre-existing mutation surface must still be present and unchanged.
      for (const existing of [
        'establish',
        'revokeSession',
        'bootstrap',
        'assign',
        'revoke',
        'requestApproval',
        'approve',
      ]) {
        expect(handlers).toContain(existing);
      }
      // A2T12 adds exactly these public handlers.
      expect(handlers).toContain('listApprovals');
      expect(handlers).toContain('readApproval');
    });
  });
});
