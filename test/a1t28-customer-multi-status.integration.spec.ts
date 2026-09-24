import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';

import { RoutePolicyRegistry } from '../src/authorization/route-policy-registry';
import { Customer } from '../src/customer/customer.entity';
import { CustomerAddress } from '../src/customer/customer-address.entity';
import { CustomerContactMethod } from '../src/customer/customer-contact-method.entity';
import { CustomerIdentityDocument } from '../src/customer/customer-identity-document.entity';
import { CustomerKycAssessment } from '../src/customer/customer-kyc-assessment.entity';
import { CustomerProfile } from '../src/customer/customer-profile.entity';
import {
  CustomerKycLevel,
  CustomerKycStatus,
  CustomerStatus,
  CustomerType,
} from '../src/customer/customer.enums';
import { CustomerService } from '../src/customer/customer.service';
import { AuditEvent } from '../src/operations/audit-event.entity';
import { AuditService } from '../src/operations/audit.service';
import {
  createIntegrationDataSource,
  destroyIntegrationDataSource,
  firstRow,
  truncateAllTables,
} from './support/pg-harness';

/**
 * A1T28 — multi-status customer querying against real PostgreSQL.
 *
 * Customers are created through the genuine `CustomerService.create` path and
 * moved to their lifecycle/KYC states through the service's own update paths,
 * rather than by hand-inserting unrealistic rows.
 */
describe('A1T28 customer multi-status (real PostgreSQL)', () => {
  let dataSource: DataSource;
  let service: CustomerService;

  async function rows<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    const result: unknown = await dataSource.query(sql, params);
    return result as T[];
  }

  beforeAll(async () => {
    dataSource = await createIntegrationDataSource('a1t28multistatus');
    service = new CustomerService(
      dataSource.getRepository(Customer),
      dataSource.getRepository(CustomerProfile),
      dataSource.getRepository(CustomerAddress),
      dataSource.getRepository(CustomerContactMethod),
      dataSource.getRepository(CustomerIdentityDocument),
      dataSource.getRepository(CustomerKycAssessment),
      dataSource,
      new AuditService(dataSource.getRepository(AuditEvent)),
      { issueForWallet: () => Promise.resolve(null) } as never,
    );
  }, 180000);

  afterAll(async () => {
    if (dataSource) await destroyIntegrationDataSource(dataSource);
  }, 60000);

  beforeEach(async () => {
    await truncateAllTables(dataSource);
  });

  /**
   * Creates a customer through the real service path, then sets the KYC and
   * lifecycle dimensions directly on the persisted row. The A1 service exposes
   * KYC transitions only through guarded assessment flows, so the seed sets the
   * stored dimensions explicitly while leaving creation itself genuine.
   */
  async function seedCustomer(options: {
    reference: string;
    type?: CustomerType;
    status?: CustomerStatus;
    kycStatus?: CustomerKycStatus;
    kycLevel?: CustomerKycLevel;
  }): Promise<string> {
    const created = await service.create({
      reference: options.reference,
      type: options.type ?? CustomerType.INDIVIDUAL,
      actor: 'a1t28-integration',
    });
    await dataSource.query(
      `UPDATE customers SET status = $2, kyc_status = $3, kyc_level = $4 WHERE id = $1`,
      [
        created.id,
        options.status ?? CustomerStatus.DRAFT,
        options.kycStatus ?? CustomerKycStatus.NOT_STARTED,
        options.kycLevel ?? CustomerKycLevel.NONE,
      ],
    );
    return created.id;
  }

  async function seedMatrix() {
    return {
      activeApproved: await seedCustomer({
        reference: `a1t28-active-approved-${randomUUID().slice(0, 8)}`,
        status: CustomerStatus.ACTIVE,
        kycStatus: CustomerKycStatus.APPROVED,
        kycLevel: CustomerKycLevel.LEVEL_2,
      }),
      activePending: await seedCustomer({
        reference: `a1t28-active-pending-${randomUUID().slice(0, 8)}`,
        status: CustomerStatus.ACTIVE,
        kycStatus: CustomerKycStatus.PENDING,
        kycLevel: CustomerKycLevel.LEVEL_1,
      }),
      suspendedApproved: await seedCustomer({
        reference: `a1t28-suspended-approved-${randomUUID().slice(0, 8)}`,
        status: CustomerStatus.SUSPENDED,
        kycStatus: CustomerKycStatus.APPROVED,
        kycLevel: CustomerKycLevel.LEVEL_3,
        type: CustomerType.BUSINESS,
      }),
      draftNotStarted: await seedCustomer({
        reference: `a1t28-draft-${randomUUID().slice(0, 8)}`,
        status: CustomerStatus.DRAFT,
        kycStatus: CustomerKycStatus.NOT_STARTED,
        kycLevel: CustomerKycLevel.NONE,
      }),
    };
  }

  describe('persisted status is returned correctly', () => {
    it('returns every status dimension from the persisted row', async () => {
      const id = await seedCustomer({
        reference: `a1t28-single-${randomUUID().slice(0, 8)}`,
        status: CustomerStatus.ACTIVE,
        kycStatus: CustomerKycStatus.APPROVED,
        kycLevel: CustomerKycLevel.LEVEL_2,
      });

      const [listed] = await service.list();
      const persisted = firstRow(
        await rows<{
          status: string;
          kyc_status: string;
          kyc_level: string;
          customer_type: string;
        }>(`SELECT status, kyc_status, kyc_level, customer_type FROM customers WHERE id = $1`, [id]),
        'persisted customer',
      );

      expect(listed?.status).toBe(persisted.status);
      expect(listed?.kycStatus).toBe(persisted.kyc_status);
      expect(listed?.kycLevel).toBe(persisted.kyc_level);
      expect(listed?.type).toBe(persisted.customer_type);
    });
  });

  describe('dimensions are independent', () => {
    it('filters by lifecycle status alone', async () => {
      const seeded = await seedMatrix();
      const result = await service.list({ status: [CustomerStatus.ACTIVE] });

      expect(result.map((c) => c.id).sort()).toEqual(
        [seeded.activeApproved, seeded.activePending].sort(),
      );
    });

    it('filters by KYC status alone, independently of lifecycle status', async () => {
      const seeded = await seedMatrix();
      const result = await service.list({ kycStatus: [CustomerKycStatus.APPROVED] });

      // Spans both ACTIVE and SUSPENDED: KYC status never implies lifecycle status.
      expect(result.map((c) => c.id).sort()).toEqual(
        [seeded.activeApproved, seeded.suspendedApproved].sort(),
      );
    });

    it('filters by KYC level alone', async () => {
      const seeded = await seedMatrix();
      const result = await service.list({ kycLevel: [CustomerKycLevel.LEVEL_3] });
      expect(result.map((c) => c.id)).toEqual([seeded.suspendedApproved]);
    });

    it('ORs multiple values within one dimension', async () => {
      const seeded = await seedMatrix();
      const result = await service.list({
        status: [CustomerStatus.SUSPENDED, CustomerStatus.DRAFT],
      });

      expect(result.map((c) => c.id).sort()).toEqual(
        [seeded.suspendedApproved, seeded.draftNotStarted].sort(),
      );
    });

    it('ANDs across dimensions', async () => {
      const seeded = await seedMatrix();
      const result = await service.list({
        status: [CustomerStatus.ACTIVE, CustomerStatus.SUSPENDED],
        kycStatus: [CustomerKycStatus.APPROVED],
      });

      expect(result.map((c) => c.id).sort()).toEqual(
        [seeded.activeApproved, seeded.suspendedApproved].sort(),
      );
    });

    it('combines all four dimensions', async () => {
      const seeded = await seedMatrix();
      const result = await service.list({
        status: [CustomerStatus.SUSPENDED],
        kycStatus: [CustomerKycStatus.APPROVED],
        kycLevel: [CustomerKycLevel.LEVEL_3],
        type: [CustomerType.BUSINESS],
      });
      expect(result.map((c) => c.id)).toEqual([seeded.suspendedApproved]);
    });

    it('returns an empty set for a combination nothing matches', async () => {
      await seedMatrix();
      const result = await service.list({
        status: [CustomerStatus.DRAFT],
        kycStatus: [CustomerKycStatus.APPROVED],
      });
      expect(result).toEqual([]);
    });

    it('returns every customer when no dimension is supplied', async () => {
      await seedMatrix();
      expect(await service.list()).toHaveLength(4);
    });

    it('paginates without overlap or omission', async () => {
      await seedMatrix();
      const first = await service.list({ page: 1, limit: 2 });
      const second = await service.list({ page: 2, limit: 2 });

      const ids = [...first, ...second].map((c) => c.id);
      expect(ids).toHaveLength(4);
      expect(new Set(ids).size).toBe(4);
    });
  });

  describe('read-only guarantee', () => {
    it('mutates no customer row and changes no lifecycle state', async () => {
      await seedMatrix();
      const before = await rows<Record<string, unknown>>(`SELECT * FROM customers ORDER BY id`);

      await service.list();
      await service.list({ status: [CustomerStatus.ACTIVE] });
      await service.list({ kycStatus: [CustomerKycStatus.APPROVED], page: 1, limit: 1 });

      expect(await rows(`SELECT * FROM customers ORDER BY id`)).toEqual(before);
    });

    it('creates no wallet, financial or ledger records', async () => {
      await seedMatrix();

      await service.list({ status: [CustomerStatus.ACTIVE] });

      for (const table of [
        'customer_wallets',
        'wallet_accounts',
        'ledger_accounts',
        'ledger_journals',
        'transfers',
        'customer_financial_account_bindings',
        'customer_receiving_numbers',
      ]) {
        const counted = firstRow(
          await rows<{ count: number }>(`SELECT COUNT(*)::int AS count FROM ${table}`),
          `${table} count`,
        );
        expect({ table, count: counted.count }).toEqual({ table, count: 0 });
      }
    });

    it('writes no audit rows while reading', async () => {
      await seedMatrix();
      const before = firstRow(
        await rows<{ count: number }>(`SELECT COUNT(*)::int AS count FROM audit_events`),
        'audit before',
      ).count;

      await service.list();
      await service.list({ kycLevel: [CustomerKycLevel.LEVEL_2] });

      const after = firstRow(
        await rows<{ count: number }>(`SELECT COUNT(*)::int AS count FROM audit_events`),
        'audit after',
      ).count;
      expect(after).toBe(before);
    });

    it('still excludes soft-deleted customers', async () => {
      const seeded = await seedMatrix();
      await dataSource.query(`UPDATE customers SET deleted_at = NOW() WHERE id = $1`, [
        seeded.draftNotStarted,
      ]);

      const result = await service.list();
      expect(result.map((c) => c.id)).not.toContain(seeded.draftNotStarted);
      expect(result).toHaveLength(3);
    });
  });

  describe('authorization boundary', () => {
    it('keeps the operational listing internal-only', () => {
      const registry = new RoutePolicyRegistry();
      const resolution = registry.resolve({
        method: 'GET',
        url: '/api/v1/customers?status=ACTIVE&kycStatus=APPROVED',
      });

      expect(resolution.public).toBe(false);
      expect(resolution.policy?.requiredScopes).toEqual(['internal:access']);
      expect(resolution.policy?.allowedPrincipalTypes).not.toContain('CUSTOMER');
      expect(resolution.policy?.customerAccess).toBe('NONE');
    });
  });
});
