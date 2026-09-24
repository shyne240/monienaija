import { BadRequestException } from '@nestjs/common';

import { RoutePolicyRegistry } from '../src/authorization/route-policy-registry';
import {
  CustomerFinancialAccountDiscrepancyType,
  type CustomerFinancialAccountDiscrepancy,
  type CustomerFinancialAccountReconciliationReport,
} from '../src/reconciliation/customer-financial-account-reconciliation.types';
import { ReconciliationController } from '../src/reconciliation/reconciliation.controller';
import { ReconciliationService } from '../src/reconciliation/reconciliation.service';
import { VerificationStatus } from '../src/reconciliation/reconciliation.types';

/**
 * A5T14 — unit coverage for the read-only reconciliation break surface.
 *
 * Persistence and the read-only guarantee are proven separately against real
 * PostgreSQL in `a5t14-reconciliation-breaks.integration.spec.ts`.
 */
describe('A5T14 reconciliation breaks (unit)', () => {
  function discrepancy(index: number): CustomerFinancialAccountDiscrepancy {
    return {
      key: `break-${index}`,
      type: CustomerFinancialAccountDiscrepancyType.ORPHANED_BINDING,
      severity: index % 2 === 0 ? 'WARNING' : 'ERROR',
      owner: 'RECONCILIATION',
      recoveryState: 'MANUAL_REVIEW_REQUIRED',
      bindingId: `binding-${index}`,
      customerId: `customer-${index}`,
      customerWalletId: `wallet-${index}`,
      walletAccountId: `account-${index}`,
      ledgerAccountId: `ledger-${index}`,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      scopeValue: null,
      message: `discrepancy ${index}`,
    };
  }

  function buildService(count: number) {
    const calls: string[] = [];
    const report: CustomerFinancialAccountReconciliationReport = {
      status: count === 0 ? VerificationStatus.PASS : VerificationStatus.ERROR,
      generatedAt: '2026-01-01T00:00:00.000Z',
      summary: {
        bindingsChecked: 10,
        activeBindingsChecked: 8,
        customerWalletsChecked: 9,
        financialWalletsChecked: 9,
        discrepancies: count,
        errors: Math.floor(count / 2),
        warnings: count - Math.floor(count / 2),
        byType: { ORPHANED_BINDING: count },
      },
      discrepancies: Array.from({ length: count }, (_, i) => discrepancy(i + 1)),
      repairPerformed: false,
    };

    const service = new ReconciliationService({} as never, {} as never);
    jest
      .spyOn(service, 'getBindingReconciliation')
      .mockImplementation(() => {
        calls.push('getBindingReconciliation');
        return Promise.resolve(report);
      });
    return { service, calls, report };
  }

  describe('listing', () => {
    it('returns the established pagination envelope', async () => {
      const { service } = buildService(5);
      const result = await service.listBindingReconciliationBreaks({ page: 1, limit: 2 });

      expect(result.items).toHaveLength(2);
      expect(result.pagination).toEqual({
        page: 1,
        limit: 2,
        total: 5,
        totalPages: 3,
        hasNextPage: true,
      });
    });

    it('defaults to page 1 and limit 50', async () => {
      const { service } = buildService(3);
      const result = await service.listBindingReconciliationBreaks();

      expect(result.pagination.page).toBe(1);
      expect(result.pagination.limit).toBe(50);
      expect(result.items).toHaveLength(3);
    });

    it('returns an empty result without dividing by zero', async () => {
      const { service } = buildService(0);
      const result = await service.listBindingReconciliationBreaks();

      expect(result.items).toEqual([]);
      expect(result.pagination.total).toBe(0);
      expect(result.pagination.totalPages).toBe(0);
      expect(result.pagination.hasNextPage).toBe(false);
      expect(result.status).toBe(VerificationStatus.PASS);
    });

    it('rejects invalid pagination', async () => {
      const { service } = buildService(3);
      for (const bad of [0, -1, 1.5, Number.NaN]) {
        await expect(
          service.listBindingReconciliationBreaks({ page: bad }),
        ).rejects.toBeInstanceOf(BadRequestException);
      }
      for (const bad of [0, -1, 101, 2.5]) {
        await expect(
          service.listBindingReconciliationBreaks({ limit: bad }),
        ).rejects.toBeInstanceOf(BadRequestException);
      }
    });

    it('pages without overlap or omission', async () => {
      const { service } = buildService(5);
      const one = await service.listBindingReconciliationBreaks({ page: 1, limit: 2 });
      const two = await service.listBindingReconciliationBreaks({ page: 2, limit: 2 });
      const three = await service.listBindingReconciliationBreaks({ page: 3, limit: 2 });

      const keys = [...one.items, ...two.items, ...three.items].map((b) => b.key);
      expect(keys).toHaveLength(5);
      expect(new Set(keys).size).toBe(5);
      expect(three.pagination.hasNextPage).toBe(false);
    });

    it('keeps the summary describing the complete pass, not the page', async () => {
      const { service } = buildService(5);
      const page = await service.listBindingReconciliationBreaks({ page: 1, limit: 1 });

      expect(page.items).toHaveLength(1);
      expect(page.summary.discrepancies).toBe(5);
      expect(page.pagination.total).toBe(5);
    });

    it('delegates to the existing reconciliation pass rather than re-implementing it', async () => {
      const { service, calls } = buildService(2);
      await service.listBindingReconciliationBreaks();
      expect(calls).toEqual(['getBindingReconciliation']);
    });
  });

  describe('read-only and projection', () => {
    it('always reports repairPerformed as false', async () => {
      const { service } = buildService(4);
      const result = await service.listBindingReconciliationBreaks();
      expect(result.repairPerformed).toBe(false);
    });

    it('reuses the existing discrepancy projection unchanged', async () => {
      const { service } = buildService(1);
      const [item] = (await service.listBindingReconciliationBreaks()).items;

      expect(Object.keys(item ?? {}).sort()).toEqual(
        [
          'key',
          'type',
          'severity',
          'owner',
          'recoveryState',
          'bindingId',
          'customerId',
          'customerWalletId',
          'walletAccountId',
          'ledgerAccountId',
          'currency',
          'accountingUnit',
          'scopeValue',
          'message',
        ].sort(),
      );
    });

    it('exposes no credential, key or token material', async () => {
      const { service } = buildService(3);
      const serialized = JSON.stringify(await service.listBindingReconciliationBreaks()).toLowerCase();

      for (const secret of [
        'password',
        'secret',
        'token',
        'credential',
        'pin',
        'otp',
        'privatekey',
        'signing',
        'apikey',
        'hash',
      ]) {
        expect(serialized).not.toContain(secret);
      }
    });

    it('does not expose a resolution or remediation operation', () => {
      const surface = Object.getOwnPropertyNames(ReconciliationService.prototype);
      for (const forbidden of ['resolveBreak', 'repair', 'remediate', 'clearBreak']) {
        expect(surface).not.toContain(forbidden);
      }
    });
  });

  describe('authorization boundary', () => {
    it('keeps the break surface internal-only', () => {
      const registry = new RoutePolicyRegistry();
      const resolution = registry.resolve({
        method: 'GET',
        url: '/api/v1/internal/reconciliation/report/breaks?page=1',
      });

      expect(resolution.public).toBe(false);
      expect(resolution.policy?.requiredScopes).toEqual(['internal:access']);
      expect(resolution.policy?.allowedPrincipalTypes).not.toContain('CUSTOMER');
      expect(resolution.policy?.customerAccess).toBe('NONE');
    });

    it('matches the boundary already protecting the existing reconciliation routes', () => {
      const registry = new RoutePolicyRegistry();
      const breaks = registry.resolve({
        method: 'GET',
        url: '/api/v1/internal/reconciliation/report/breaks',
      });
      const report = registry.resolve({
        method: 'GET',
        url: '/api/v1/internal/reconciliation/report',
      });

      expect(breaks.policy?.requiredScopes).toEqual(report.policy?.requiredScopes);
      expect(breaks.policy?.allowedPrincipalTypes).toEqual(report.policy?.allowedPrincipalTypes);
      expect(breaks.policy?.customerAccess).toBe(report.policy?.customerAccess);
    });
  });

  describe('controller', () => {
    it('passes the query through and leaves existing routes intact', async () => {
      const received: unknown[] = [];
      const service = {
        listBindingReconciliationBreaks: (query: unknown) => {
          received.push(query);
          return Promise.resolve({ items: [] });
        },
      };
      const controller = new ReconciliationController(
        service as unknown as ReconciliationService,
      );

      await controller.getReportBreaks({ page: 2, limit: 10 });
      expect(received).toEqual([{ page: 2, limit: 10 }]);

      const handlers = Object.getOwnPropertyNames(ReconciliationController.prototype);
      for (const existing of [
        'getReport',
        'getTrialBalance',
        'getFinanceVerification',
        'getAccountActivity',
      ]) {
        expect(handlers).toContain(existing);
      }
      expect(handlers).toContain('getReportBreaks');
    });
  });
});
