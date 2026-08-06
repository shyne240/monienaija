import { ForbiddenException } from '@nestjs/common';
import type { DeepPartial, ObjectLiteral, Repository } from 'typeorm';

import type {
  AuthorizationDecision,
  AuthorizationPolicy,
  AuthorizationPrincipal,
  AuthorizationResource,
} from '../src/authorization/authorization.types';
import type { AuthorizationService } from '../src/authorization/authorization.service';
import { Customer } from '../src/customer/customer.entity';
import { CustomerStatus, CustomerType } from '../src/customer/customer.enums';
import { CustomerWallet } from '../src/customer-wallet/customer-wallet.entity';
import {
  CustomerWalletStatus,
  CustomerWalletType,
} from '../src/customer-wallet/customer-wallet.enums';
import { LedgerAccount } from '../src/ledger/ledger-account.entity';
import { LedgerAccountType, LedgerNormalBalance } from '../src/ledger/ledger.enums';
import type { LedgerAccountBalance } from '../src/ledger/ledger.types';
import type { LedgerService } from '../src/ledger/ledger.service';
import { CustomerFinancialAccountBinding } from '../src/wallet/customer-financial-account-binding.entity';
import { CustomerFinancialAccountBindingState } from '../src/wallet/customer-financial-account-binding.enums';
import { CustomerFinancialAccountReadService } from '../src/wallet/customer-financial-account-read.service';
import { WalletAccount } from '../src/wallet/wallet-account.entity';
import { WalletStatus } from '../src/wallet/wallet.enums';

const CUSTOMER_ID = '00000000-0000-4000-8000-000000000001';
const CUSTOMER_WALLET_ID = '00000000-0000-4000-8000-000000000002';
const WALLET_ACCOUNT_ID = '00000000-0000-4000-8000-000000000003';
const LEDGER_ACCOUNT_ID = '00000000-0000-4000-8000-000000000004';
const OTHER_CUSTOMER_ID = '00000000-0000-4000-8000-000000000099';

class MemoryRepository<T extends ObjectLiteral> {
  readonly records = new Map<string, T>();

  create(input: DeepPartial<T>): T {
    return input as T;
  }

  save(entity: T): Promise<T> {
    const id = String((entity as Record<string, unknown>).id);
    this.records.set(id, entity);
    return Promise.resolve(entity);
  }

  findOne(options: { where?: Record<string, unknown> }): Promise<T | null> {
    const conditions = options.where ?? {};
    return Promise.resolve(
      [...this.records.values()].find((entity) =>
        Object.entries(conditions).every(([key, expected]) => {
          if (expected === undefined) return true;
          return (entity as Record<string, unknown>)[key] === expected;
        }),
      ) ?? null,
    );
  }

  find(options?: { where?: Record<string, unknown> }): Promise<T[]> {
    const conditions = options?.where ?? {};
    return Promise.resolve(
      [...this.records.values()].filter((entity) =>
        Object.entries(conditions).every(([key, expected]) => {
          if (expected === undefined) return true;
          return (entity as Record<string, unknown>)[key] === expected;
        }),
      ),
    );
  }
}

class FakeAuthorizationService {
  allowed = true;
  readonly policies: AuthorizationPolicy[] = [];

  authorize(
    _principal: AuthorizationPrincipal | undefined,
    policy: AuthorizationPolicy | undefined,
    resource: AuthorizationResource,
  ): Promise<AuthorizationDecision> {
    if (policy) this.policies.push(policy);
    return Promise.resolve({
      allowed: this.allowed,
      reason: this.allowed ? undefined : 'CUSTOMER_SCOPE_MISMATCH',
      principalType: 'CUSTOMER',
      principalId: CUSTOMER_ID,
      resourceType: resource.type,
      resourceId: resource.id,
      customerId: resource.customerId,
      action: policy?.action ?? 'UNKNOWN',
      evaluatedAt: new Date(),
      requiredScopes: policy?.requiredScopes ?? [],
      requiredRoles: policy?.requiredRoles ?? [],
    });
  }
}

class FakeLedgerService {
  readonly calls: string[] = [];
  balanceMinor = '125000';
  unavailable = false;

  getAccountBalance(accountId: string): Promise<LedgerAccountBalance> {
    this.calls.push(accountId);
    if (this.unavailable) return Promise.reject(new Error('ledger unavailable'));
    return Promise.resolve({
      accountId,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      balanceMinor: this.balanceMinor,
    });
  }
}

interface Fixture {
  service: CustomerFinancialAccountReadService;
  repositories: {
    customers: MemoryRepository<Customer>;
    customerWallets: MemoryRepository<CustomerWallet>;
    bindings: MemoryRepository<CustomerFinancialAccountBinding>;
    wallets: MemoryRepository<WalletAccount>;
    ledgers: MemoryRepository<LedgerAccount>;
  };
  authorization: FakeAuthorizationService;
  ledger: FakeLedgerService;
}

const customerPrincipal: AuthorizationPrincipal = {
  type: 'CUSTOMER',
  principalId: CUSTOMER_ID,
  customerId: CUSTOMER_ID,
  roles: [],
  scopes: [],
  customerAccess: 'SELF',
};

function makeFixture(): Fixture {
  const repositories = {
    customers: new MemoryRepository<Customer>(),
    customerWallets: new MemoryRepository<CustomerWallet>(),
    bindings: new MemoryRepository<CustomerFinancialAccountBinding>(),
    wallets: new MemoryRepository<WalletAccount>(),
    ledgers: new MemoryRepository<LedgerAccount>(),
  };
  const authorization = new FakeAuthorizationService();
  const ledger = new FakeLedgerService();
  const service = new CustomerFinancialAccountReadService(
    repositories.bindings as unknown as Repository<CustomerFinancialAccountBinding>,
    repositories.customers as unknown as Repository<Customer>,
    repositories.customerWallets as unknown as Repository<CustomerWallet>,
    repositories.wallets as unknown as Repository<WalletAccount>,
    repositories.ledgers as unknown as Repository<LedgerAccount>,
    ledger as unknown as LedgerService,
    authorization as unknown as AuthorizationService,
  );

  repositories.customers.records.set(
    CUSTOMER_ID,
    Object.assign(new Customer(), {
      id: CUSTOMER_ID,
      reference: 'read-customer',
      type: CustomerType.INDIVIDUAL,
      status: CustomerStatus.ACTIVE,
      version: 1,
      deletedAt: null,
    }),
  );
  repositories.customerWallets.records.set(
    CUSTOMER_WALLET_ID,
    Object.assign(new CustomerWallet(), {
      id: CUSTOMER_WALLET_ID,
      customerId: CUSTOMER_ID,
      type: CustomerWalletType.PRIMARY,
      currency: 'NGN',
      status: CustomerWalletStatus.ACTIVE,
      version: 2,
      deletedAt: null,
    }),
  );
  repositories.wallets.records.set(
    WALLET_ACCOUNT_ID,
    Object.assign(new WalletAccount(), {
      id: WALLET_ACCOUNT_ID,
      customerId: CUSTOMER_ID,
      currency: 'NGN',
      status: WalletStatus.ACTIVE,
      ledgerAccountId: LEDGER_ACCOUNT_ID,
    }),
  );
  repositories.ledgers.records.set(
    LEDGER_ACCOUNT_ID,
    Object.assign(new LedgerAccount(), {
      id: LEDGER_ACCOUNT_ID,
      code: 'WALLET-READ',
      name: 'Read model wallet',
      accountType: LedgerAccountType.LIABILITY,
      normalBalance: LedgerNormalBalance.CREDIT,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      allowNegativeBalance: false,
      isActive: true,
    }),
  );

  return { service, repositories, authorization, ledger };
}

function addBinding(
  fixture: Fixture,
  overrides: Partial<CustomerFinancialAccountBinding> = {},
): CustomerFinancialAccountBinding {
  const binding = Object.assign(new CustomerFinancialAccountBinding(), {
    id: '00000000-0000-4000-8000-000000000005',
    customerId: CUSTOMER_ID,
    customerWalletId: CUSTOMER_WALLET_ID,
    walletAccountId: WALLET_ACCOUNT_ID,
    ledgerAccountId: LEDGER_ACCOUNT_ID,
    currency: 'NGN',
    accountingUnit: 'CUSTOMER_FUNDS',
    state: CustomerFinancialAccountBindingState.ACTIVE,
    sourceCustomerVersion: 1,
    sourceCustomerWalletVersion: 2,
    ...overrides,
  });
  fixture.repositories.bindings.records.set(binding.id, binding);
  return binding;
}

describe('CustomerFinancialAccountReadService', () => {
  it('returns a ledger-derived balance for an authorized active binding', async () => {
    const fixture = makeFixture();
    addBinding(fixture);

    const result = await fixture.service.getCustomerFinancialAccounts({
      customerId: CUSTOMER_ID,
      principal: customerPrincipal,
    });

    expect(result.customerId).toBe(CUSTOMER_ID);
    expect(result.accounts).toHaveLength(1);
    expect(result.accounts[0]).toMatchObject({
      bindingId: '00000000-0000-4000-8000-000000000005',
      readState: 'ACTIVE',
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      balanceMinor: '125000',
      warnings: [],
    });
    expect(fixture.ledger.calls).toEqual([LEDGER_ACCOUNT_ID]);
    expect(fixture.authorization.policies[0]).toMatchObject({
      action: 'wallet:account-binding:read',
      allowedPrincipalTypes: ['CUSTOMER'],
      customerAccess: 'SELF',
    });
  });

  it('does not return another customer account when authorization is denied', async () => {
    const fixture = makeFixture();
    addBinding(fixture);
    fixture.authorization.allowed = false;

    await expect(
      fixture.service.getCustomerFinancialAccounts({
        customerId: CUSTOMER_ID,
        principal: { ...customerPrincipal, customerId: OTHER_CUSTOMER_ID },
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(fixture.ledger.calls).toHaveLength(0);
  });

  it('supports an authorized assigned support principal without changing the read boundary', async () => {
    const fixture = makeFixture();
    addBinding(fixture);

    const result = await fixture.service.getCustomerFinancialAccounts({
      customerId: CUSTOMER_ID,
      principal: {
        type: 'SUPPORT',
        principalId: 'support-1',
        roles: ['support'],
        scopes: ['wallet:account-binding:read'],
        customerAccess: 'ASSIGNED',
        assignedCustomerIds: [CUSTOMER_ID],
      },
    });

    expect(result.accounts[0]?.readState).toBe('ACTIVE');
    expect(fixture.authorization.policies[0]).toMatchObject({
      requiredScopes: ['wallet:account-binding:read'],
      customerAccess: 'ASSIGNED',
    });
  });

  it('represents a missing binding without fabricating an account or balance', async () => {
    const fixture = makeFixture();

    const result = await fixture.service.getCustomerFinancialAccounts({
      customerId: CUSTOMER_ID,
      principal: customerPrincipal,
    });

    expect(result.accounts).toEqual([
      expect.objectContaining({
        bindingId: null,
        customerWalletId: CUSTOMER_WALLET_ID,
        walletAccountId: null,
        ledgerAccountId: null,
        readState: 'MISSING_BINDING',
        currency: 'NGN',
        accountingUnit: null,
        balanceMinor: null,
      }),
    ]);
    expect(result.warnings).toContain(
      `Customer wallet ${CUSTOMER_WALLET_ID} has no financial account binding`,
    );
    expect(fixture.ledger.calls).toHaveLength(0);
  });

  it('represents a stale active binding without returning a balance', async () => {
    const fixture = makeFixture();
    addBinding(fixture, { sourceCustomerWalletVersion: 1 });

    const result = await fixture.service.getCustomerFinancialAccounts({
      customerId: CUSTOMER_ID,
      principal: customerPrincipal,
    });

    expect(result.accounts[0]).toMatchObject({
      readState: 'STALE_BINDING',
      balanceMinor: null,
    });
    expect(result.accounts[0]?.warnings).toContain('Customer wallet version is stale');
    expect(fixture.ledger.calls).toHaveLength(0);
  });

  it('represents non-active binding states without reading a balance', async () => {
    const fixture = makeFixture();
    addBinding(fixture, { state: CustomerFinancialAccountBindingState.REPAIR_REQUIRED });

    const result = await fixture.service.getCustomerFinancialAccounts({
      customerId: CUSTOMER_ID,
      principal: customerPrincipal,
    });

    expect(result.accounts[0]).toMatchObject({
      bindingState: CustomerFinancialAccountBindingState.REPAIR_REQUIRED,
      readState: 'REPAIR_REQUIRED',
      balanceMinor: null,
    });
    expect(fixture.ledger.calls).toHaveLength(0);
  });

  it('surfaces ledger read failure without fabricating a balance', async () => {
    const fixture = makeFixture();
    addBinding(fixture);
    fixture.ledger.unavailable = true;

    const result = await fixture.service.getCustomerFinancialAccounts({
      customerId: CUSTOMER_ID,
      principal: customerPrincipal,
    });

    expect(result.accounts[0]).toMatchObject({
      readState: 'LEDGER_UNAVAILABLE',
      balanceMinor: null,
    });
    expect(result.accounts[0]?.warnings).toEqual(['Ledger balance could not be read']);
  });
});
