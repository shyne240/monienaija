import { ConflictException } from '@nestjs/common';
import type { DataSource, EntityManager } from 'typeorm';

import type { CommercialAccountingService } from '../src/commercial-accounting/commercial-accounting.service';
import { CustomerClassService } from '../src/customer-class/customer-class.service';
import type { CustomerClass } from '../src/customer-class/customer-class.entity';
import type { CustomerClassResolverService } from '../src/customer-class/customer-class-resolver.service';
import {
  CustomerClassConfigurationStatus,
  CustomerClassStatus,
} from '../src/customer-class/customer-class.enums';
import type { FeeRuleCalculatorService } from '../src/fee-rules/fee-rule-calculator.service';
import type { FeeRuleResolverService } from '../src/fee-rules/fee-rule-resolver.service';
import { CustomerLimitViewService } from '../src/limit-catalog/customer-limit-view.service';
import { LimitEnforcementService } from '../src/limit-catalog/limit-enforcement.service';
import type { LimitProfileResolverService } from '../src/limit-catalog/limit-profile-resolver.service';
import type { LimitUsageService } from '../src/limit-catalog/limit-usage.service';
import type { AuditService } from '../src/operations/audit.service';
import { TransferPricingService } from '../src/transfer/transfer-pricing.service';

const CUSTOMER_UUID = '00000000-0000-4000-8000-000000000099';

describe('Phase 4 Configurable Administration — Customer Class & Runtime Policy Wiring', () => {
  it('CustomerClassService.update blocks disabling or deprecating a class referenced by active SEGMENT limit_assignments', async () => {
    const existing: CustomerClass = {
      id: '00000000-0000-4000-8000-000000000001',
      reference: 'CLASS-PREMIUM',
      code: 'PREMIUM',
      name: 'Premium',
      description: 'Premium customers',
      kind: 'CUSTOMER',
      status: CustomerClassStatus.ACTIVE,
      enabled: true,
      configurationStatus: CustomerClassConfigurationStatus.CONFIGURED,
      isDefault: false,
      version: 1,
      createdBy: 'admin',
      updatedBy: 'admin',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      deletedAt: null,
    };
    const manager = {
      getRepository: jest.fn().mockReturnValue({
        createQueryBuilder: () => ({
          setLock: () => ({
            where: () => ({
              getOne: () => Promise.resolve(existing),
            }),
          }),
        }),
      }),
      query: jest.fn().mockImplementation((sql: string) => {
        if (sql.includes('FROM customer_classes'))
          return Promise.resolve([
            {
              id: '00000000-0000-4000-8000-000000000001',
              reference: 'CLASS-PREMIUM',
              code: 'PREMIUM',
              name: 'Premium',
              description: 'Premium customers',
              kind: 'CUSTOMER',
              status: CustomerClassStatus.ACTIVE,
              enabled: true,
              configuration_status: CustomerClassConfigurationStatus.CONFIGURED,
              is_default: false,
              version: 1,
              created_by: 'admin',
              updated_by: 'admin',
              created_at: new Date('2026-01-01T00:00:00.000Z'),
              updated_at: new Date('2026-01-01T00:00:00.000Z'),
              deleted_at: null,
            },
          ]);
        if (sql.includes('FROM fee_rules')) return Promise.resolve([]);
        if (sql.includes('FROM limit_assignments')) return Promise.resolve([{ id: 'assign-1' }]);
        return Promise.resolve([]);
      }),
    };
    const dataSource = {
      transaction: (cb: (m: EntityManager) => Promise<unknown>) =>
        cb(manager as unknown as EntityManager),
    } as unknown as DataSource;
    const auditService = { record: jest.fn() } as unknown as AuditService;
    const service = new CustomerClassService(dataSource, auditService);

    await expect(
      service.update('00000000-0000-4000-8000-000000000001', {
        status: CustomerClassStatus.DEPRECATED,
        expectedVersion: 1,
        actor: 'operator-1',
      }),
    ).rejects.toThrow(ConflictException);
    expect(manager.query).toHaveBeenCalledWith(expect.stringContaining('FROM limit_assignments'), [
      'PREMIUM',
    ]);
  });

  it('CustomerLimitViewService resolves segmentCodes via CustomerClassResolverService when getMyLimits is called', async () => {
    const resolveClassCodeInManager = jest.fn().mockResolvedValue('PREMIUM');
    const resolver = {
      resolveClassCodeInManager,
    } as unknown as CustomerClassResolverService;
    const resolveProfile = jest.fn().mockResolvedValue(null);
    const profileResolver = {
      resolve: resolveProfile,
    } as unknown as LimitProfileResolverService;
    const manager = {} as unknown as EntityManager;
    const dataSource = {
      manager,
    } as unknown as DataSource;

    const viewService = new CustomerLimitViewService(dataSource, profileResolver, resolver);
    const now = new Date('2026-05-01T00:00:00.000Z');
    await viewService.getMyLimits(CUSTOMER_UUID, 'NGN', now);

    expect(resolveClassCodeInManager).toHaveBeenCalledWith(manager, CUSTOMER_UUID, now);
    expect(resolveProfile).toHaveBeenCalledWith(manager, {
      principalType: 'CUSTOMER',
      principalId: CUSTOMER_UUID,
      segmentCodes: ['PREMIUM'],
      now,
    });
  });

  it('LimitEnforcementService resolves customer class segmentCodes via CustomerClassResolverService for CUSTOMER principals', async () => {
    const resolveClassCodeInManager = jest.fn().mockResolvedValue('VIP');
    const resolver = {
      resolveClassCodeInManager,
    } as unknown as CustomerClassResolverService;
    const resolveProfile = jest.fn().mockResolvedValue(null);
    const profileResolver = {
      resolve: resolveProfile,
    } as unknown as LimitProfileResolverService;
    const usageService = {} as unknown as LimitUsageService;
    const manager = {
      query: jest.fn().mockResolvedValue([]),
    };
    const enforcement = new LimitEnforcementService(
      {} as unknown as DataSource,
      profileResolver,
      usageService,
      undefined,
      undefined,
      undefined,
      resolver,
    );

    const now = new Date('2026-05-01T00:00:00.000Z');
    const decision = await enforcement.enforceWithManager(manager as unknown as EntityManager, {
      principalType: 'CUSTOMER',
      principalId: CUSTOMER_UUID,
      product: 'WALLET_TRANSFER',
      direction: 'OUTGOING',
      currency: 'NGN',
      amountMinor: '5000',
      idempotencyKey: 'idem-1',
      requestHash: 'hash-1',
      now,
    });

    expect(decision.allowed).toBe(true);
    expect(resolveClassCodeInManager).toHaveBeenCalledWith(manager, CUSTOMER_UUID, now);
    expect(resolveProfile).toHaveBeenCalledWith(
      manager,
      expect.objectContaining({
        principalType: 'CUSTOMER',
        principalId: CUSTOMER_UUID,
        segmentCodes: ['VIP'],
        now,
      }),
    );
  });

  it('TransferPricingService forwards resolved customerClassCode to FeeRuleResolverService', async () => {
    const resolveClassCodeInManager = jest.fn().mockResolvedValue('PREMIUM');
    const resolver = {
      resolveClassCodeInManager,
    } as unknown as CustomerClassResolverService;
    const resolveWithManager = jest.fn().mockResolvedValue({
      status: 'RESOLVED',
      selectedRule: { id: 'fee-rule-premium', version: 1 },
    });
    const feeResolver = {
      resolveWithManager,
    } as unknown as FeeRuleResolverService;
    const calculator = {
      compute: jest.fn().mockReturnValue({
        status: 'APPLIED',
        feeMinor: '250',
        vatMinor: '0',
      }),
    } as unknown as FeeRuleCalculatorService;
    const accounting = {
      quoteFeeDebit: jest.fn().mockReturnValue({
        feeMinor: '250',
        vatMinor: '0',
        debitMinor: '250',
      }),
    } as unknown as CommercialAccountingService;
    const pricing = new TransferPricingService(feeResolver, calculator, accounting, resolver);
    const manager = {} as unknown as EntityManager;
    const at = new Date('2026-05-01T00:00:00.000Z');

    const breakdown = await pricing.priceWithManager(manager, {
      amountMinor: '10000',
      currency: 'NGN',
      customerId: CUSTOMER_UUID,
      at,
    });

    expect(resolveClassCodeInManager).toHaveBeenCalledWith(manager, CUSTOMER_UUID, at);
    expect(resolveWithManager).toHaveBeenCalledWith(
      manager,
      expect.objectContaining({
        productCode: 'WALLET_TRANSFER',
        currency: 'NGN',
        customerClassCode: 'PREMIUM',
        at,
      }),
    );
    expect(breakdown.feeMinor).toBe('250');
    expect(breakdown.totalDebitMinor).toBe('10250');
  });
});
