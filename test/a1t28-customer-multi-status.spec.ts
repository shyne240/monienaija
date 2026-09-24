import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { In } from 'typeorm';
import type { FindManyOptions, Repository } from 'typeorm';

import { RoutePolicyRegistry } from '../src/authorization/route-policy-registry';
import { CustomerController } from '../src/customer/customer.controller';
import { Customer } from '../src/customer/customer.entity';
import {
  CustomerKycLevel,
  CustomerKycStatus,
  CustomerStatus,
  CustomerType,
} from '../src/customer/customer.enums';
import { CustomerQueryDto } from '../src/customer/dto/customer-query.dto';
import { CustomerService } from '../src/customer/customer.service';

/**
 * A1T28 — unit coverage for multi-status customer querying.
 *
 * Persistence is proven separately against real PostgreSQL in
 * `a1t28-customer-multi-status.integration.spec.ts`.
 */
describe('A1T28 customer multi-status (unit)', () => {
  function buildService() {
    const findCalls: FindManyOptions<Customer>[] = [];
    const writes: string[] = [];
    const repo = {
      find: (options: FindManyOptions<Customer>): Promise<Customer[]> => {
        findCalls.push(options);
        return Promise.resolve([]);
      },
      findOne: () => Promise.resolve(null),
      save: (e: unknown) => {
        writes.push('save');
        return Promise.resolve(e);
      },
    };
    const service = new CustomerService(
      repo as unknown as Repository<Customer>,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return { service, findCalls, writes };
  }

  function parse(query: Record<string, unknown>) {
    const dto = plainToInstance(CustomerQueryDto, query, { enableImplicitConversion: false });
    return { dto, errors: validateSync(dto, { whitelist: true, forbidNonWhitelisted: true }) };
  }

  describe('query DTO', () => {
    it('accepts a single value on every status dimension', () => {
      const { dto, errors } = parse({
        status: 'ACTIVE',
        kycStatus: 'APPROVED',
        kycLevel: 'LEVEL_2',
        type: 'INDIVIDUAL',
      });
      expect(errors).toHaveLength(0);
      expect(dto.status).toEqual([CustomerStatus.ACTIVE]);
      expect(dto.kycStatus).toEqual([CustomerKycStatus.APPROVED]);
      expect(dto.kycLevel).toEqual([CustomerKycLevel.LEVEL_2]);
      expect(dto.type).toEqual([CustomerType.INDIVIDUAL]);
    });

    it('accepts comma-separated multi-values', () => {
      const { dto, errors } = parse({ status: 'ACTIVE,SUSPENDED' });
      expect(errors).toHaveLength(0);
      expect(dto.status).toEqual([CustomerStatus.ACTIVE, CustomerStatus.SUSPENDED]);
    });

    it('accepts repeated query parameters', () => {
      const { dto, errors } = parse({ status: ['ACTIVE', 'CLOSED'] });
      expect(errors).toHaveLength(0);
      expect(dto.status).toEqual([CustomerStatus.ACTIVE, CustomerStatus.CLOSED]);
    });

    it('trims whitespace around values', () => {
      const { dto, errors } = parse({ status: ' ACTIVE , SUSPENDED ' });
      expect(errors).toHaveLength(0);
      expect(dto.status).toEqual([CustomerStatus.ACTIVE, CustomerStatus.SUSPENDED]);
    });

    it('treats an empty dimension as no filter', () => {
      const { dto, errors } = parse({ status: '' });
      expect(errors).toHaveLength(0);
      expect(dto.status).toBeUndefined();
    });

    it('omits absent optional dimensions', () => {
      const { dto, errors } = parse({});
      expect(errors).toHaveLength(0);
      expect(dto.status).toBeUndefined();
      expect(dto.kycStatus).toBeUndefined();
      expect(dto.kycLevel).toBeUndefined();
      expect(dto.type).toBeUndefined();
    });

    it('rejects an unknown value in any dimension', () => {
      for (const bad of [
        { status: 'NOT_A_STATUS' },
        { kycStatus: 'MAYBE' },
        { kycLevel: 'LEVEL_9' },
        { type: 'ROBOT' },
        { status: 'ACTIVE,NOPE' },
      ]) {
        expect(parse(bad).errors.length).toBeGreaterThan(0);
      }
    });

    it('still validates pagination', () => {
      expect(parse({ page: 0 }).errors.length).toBeGreaterThan(0);
      expect(parse({ limit: 101 }).errors.length).toBeGreaterThan(0);
      expect(parse({ page: 2, limit: 25 }).errors).toHaveLength(0);
    });
  });

  describe('service filtering', () => {
    it('applies no constraint when no dimension is supplied', async () => {
      const { service, findCalls } = buildService();
      await service.list();
      expect(findCalls[0]?.where).toEqual({});
    });

    it('uses an exact match for a single value', async () => {
      const { service, findCalls } = buildService();
      await service.list({ status: [CustomerStatus.ACTIVE] });
      expect(findCalls[0]?.where).toEqual({ status: CustomerStatus.ACTIVE });
    });

    it('ORs multiple values within one dimension', async () => {
      const { service, findCalls } = buildService();
      await service.list({ status: [CustomerStatus.ACTIVE, CustomerStatus.SUSPENDED] });
      expect(findCalls[0]?.where).toEqual({
        status: In([CustomerStatus.ACTIVE, CustomerStatus.SUSPENDED]),
      });
    });

    it('keeps each status dimension independent and ANDs across them', async () => {
      const { service, findCalls } = buildService();
      await service.list({
        status: [CustomerStatus.ACTIVE],
        kycStatus: [CustomerKycStatus.APPROVED, CustomerKycStatus.PENDING],
        kycLevel: [CustomerKycLevel.LEVEL_2],
        type: [CustomerType.INDIVIDUAL],
      });

      expect(findCalls[0]?.where).toEqual({
        status: CustomerStatus.ACTIVE,
        kycStatus: In([CustomerKycStatus.APPROVED, CustomerKycStatus.PENDING]),
        kycLevel: CustomerKycLevel.LEVEL_2,
        type: CustomerType.INDIVIDUAL,
      });
    });

    it('never infers one status dimension from another', async () => {
      const { service, findCalls } = buildService();
      await service.list({ status: [CustomerStatus.ACTIVE] });

      const where = findCalls[0]?.where as Record<string, unknown>;
      expect(where).not.toHaveProperty('kycStatus');
      expect(where).not.toHaveProperty('kycLevel');
      expect(where).not.toHaveProperty('type');
    });

    it('preserves the established pagination behaviour', async () => {
      const { service, findCalls } = buildService();
      await service.list({ page: 3, limit: 10 });
      expect(findCalls[0]?.skip).toBe(20);
      expect(findCalls[0]?.take).toBe(10);

      await service.list();
      expect(findCalls[1]?.skip).toBe(0);
      expect(findCalls[1]?.take).toBe(50);

      await service.list({ limit: 5000 });
      expect(findCalls[2]?.take).toBe(100);
    });

    it('performs no write while listing', async () => {
      const { service, writes } = buildService();
      await service.list({ status: [CustomerStatus.ACTIVE] });
      expect(writes).toEqual([]);
    });
  });

  describe('authorization boundary', () => {
    it('keeps the customer list surface internal-only', () => {
      const registry = new RoutePolicyRegistry();
      const resolution = registry.resolve({
        method: 'GET',
        url: '/api/v1/customers?status=ACTIVE,SUSPENDED',
      });

      expect(resolution.public).toBe(false);
      expect(resolution.policy?.requiredScopes).toEqual(['internal:access']);
      expect(resolution.policy?.allowedPrincipalTypes).not.toContain('CUSTOMER');
      expect(resolution.policy?.customerAccess).toBe('NONE');
    });

    it('leaves the per-customer SELF surface unchanged', () => {
      const registry = new RoutePolicyRegistry();
      const single = registry.resolve({ method: 'GET', url: '/api/v1/customers/abc' });

      expect(single.policy?.customerAccess).toBe('SELF');
      expect(single.policy?.allowedPrincipalTypes).toContain('CUSTOMER');
    });
  });

  describe('response projection', () => {
    it('exposes the status dimensions and no security material', () => {
      const customer = new Customer();
      Object.assign(customer, {
        id: '11111111-2222-4333-8444-555555555555',
        reference: 'cust-1',
        type: CustomerType.INDIVIDUAL,
        status: CustomerStatus.ACTIVE,
        kycLevel: CustomerKycLevel.LEVEL_2,
        kycStatus: CustomerKycStatus.APPROVED,
        version: 1,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        deletedAt: null,
      });

      const keys = Object.keys(customer).sort();
      expect(keys).toEqual(
        [
          'id',
          'reference',
          'type',
          'status',
          'kycLevel',
          'kycStatus',
          'version',
          'createdAt',
          'updatedAt',
          'deletedAt',
        ].sort(),
      );

      const serialized = JSON.stringify(customer).toLowerCase();
      for (const secret of [
        'password',
        'passwordhash',
        'pin',
        'otp',
        'mfa',
        'secret',
        'token',
        'credential',
        'hash',
      ]) {
        expect(serialized).not.toContain(secret);
      }
    });
  });

  describe('controller', () => {
    it('passes the whole query through and changes no other handler', async () => {
      const received: unknown[] = [];
      const service = {
        list: (query: unknown) => {
          received.push(query);
          return Promise.resolve([]);
        },
      };
      const controller = new CustomerController(service as unknown as CustomerService);
      const query: CustomerQueryDto = {
        status: [CustomerStatus.ACTIVE],
        kycStatus: [CustomerKycStatus.APPROVED],
        page: 2,
        limit: 10,
      };

      await controller.list(query);
      expect(received).toEqual([query]);

      for (const existing of ['create', 'get', 'update']) {
        expect(Object.getOwnPropertyNames(CustomerController.prototype)).toContain(existing);
      }
    });
  });
});
