import { ConflictException, ForbiddenException } from '@nestjs/common';
import type {
  DataSource,
  DeepPartial,
  EntityManager,
  EntityTarget,
  ObjectLiteral,
  Repository,
} from 'typeorm';

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
import { WalletOwnership } from '../src/customer-wallet/wallet-ownership.entity';
import { LedgerAccount } from '../src/ledger/ledger-account.entity';
import { LedgerAccountType, LedgerNormalBalance } from '../src/ledger/ledger.enums';
import { LedgerLine } from '../src/ledger/ledger-line.entity';
import { AuditEvent } from '../src/operations/audit-event.entity';
import type { AuditService } from '../src/operations/audit.service';
import type { AuditEventCommand } from '../src/operations/operations.types';
import { IdempotencyRecord } from '../src/operations/idempotency-record.entity';
import type { IdempotencyService } from '../src/operations/idempotency.service';
import type {
  CompleteIdempotencyCommand,
  IdempotencyCommand,
  IdempotencyReservation,
} from '../src/operations/operations.types';
import { IdempotencyRecordStatus } from '../src/operations/operations.enums';
import type { RequestContext } from '../src/production/request-context';
import { CustomerFinancialAccountBinding } from '../src/wallet/customer-financial-account-binding.entity';
import { CustomerFinancialAccountBindingService } from '../src/wallet/customer-financial-account-binding.service';
import {
  CustomerFinancialAccountBindingMode,
  CustomerFinancialAccountBindingState,
} from '../src/wallet/customer-financial-account-binding.enums';
import type { CustomerFinancialAccountBindingCommand } from '../src/wallet/customer-financial-account-binding.types';
import { WalletAccount } from '../src/wallet/wallet-account.entity';
import { WalletStatus } from '../src/wallet/wallet.enums';
import type { CreateWalletCommand } from '../src/wallet/wallet.types';
import type { WalletService } from '../src/wallet/wallet.service';

const CUSTOMER_ID = '00000000-0000-4000-8000-000000000001';
const CUSTOMER_WALLET_ID = '00000000-0000-4000-8000-000000000002';
const WALLET_ACCOUNT_ID = '00000000-0000-4000-8000-000000000003';
const LEDGER_ACCOUNT_ID = '00000000-0000-4000-8000-000000000004';
const REQUEST_CONTEXT: RequestContext = {
  requestId: 'request-binding-1',
  correlationId: 'correlation-binding-1',
  traceId: 'trace-binding-1',
};

class MemoryRepository<T extends ObjectLiteral> {
  readonly records = new Map<string, T>();
  private sequence = 0;

  create(input: DeepPartial<T>): T {
    return input as T;
  }

  save(entity: T): Promise<T> {
    const record = entity as Record<string, unknown>;
    if (typeof record.id !== 'string' || record.id.length === 0) {
      this.sequence += 1;
      record.id = `00000000-0000-4000-8000-000000000${String(this.sequence).padStart(3, '0')}`;
    }
    this.records.set(String(record.id), entity);
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
}

class MemoryManager {
  constructor(private readonly repositories: Map<unknown, MemoryRepository<ObjectLiteral>>) {}

  getRepository<T extends ObjectLiteral>(target: EntityTarget<T>): Repository<T> {
    const repository = this.repositories.get(target);
    if (!repository) {
      const targetName =
        typeof target === 'string' ? target : target instanceof Function ? target.name : 'unknown';
      throw new Error(`Unexpected repository ${targetName}`);
    }
    return repository as unknown as Repository<T>;
  }
}

class MemoryDataSource {
  readonly isolationLevels: string[] = [];
  private transactionQueue: Promise<void> = Promise.resolve();

  constructor(private readonly manager: MemoryManager) {}

  transaction<T>(
    isolationOrCallback: string | ((manager: EntityManager) => Promise<T>),
    maybeCallback?: (manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    const callback =
      typeof isolationOrCallback === 'function' ? isolationOrCallback : maybeCallback;
    if (!callback) {
      throw new Error('Missing transaction callback');
    }
    if (typeof isolationOrCallback === 'string') {
      this.isolationLevels.push(isolationOrCallback);
    }
    const result = this.transactionQueue.then(() =>
      callback(this.manager as unknown as EntityManager),
    );
    this.transactionQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

class FakeAuthorizationService {
  allowed = true;
  readonly policies: AuthorizationPolicy[] = [];
  readonly resources: AuthorizationResource[] = [];

  authorize(
    _principal: AuthorizationPrincipal | undefined,
    policy: AuthorizationPolicy | undefined,
    resource: AuthorizationResource,
  ): Promise<AuthorizationDecision> {
    if (policy) this.policies.push(policy);
    this.resources.push(resource);
    return Promise.resolve({
      allowed: this.allowed,
      reason: this.allowed ? undefined : 'SCOPE_MISSING',
      principalType: 'SERVICE',
      principalId: 'binding-service',
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

class FakeAuditService {
  readonly events: AuditEvent[] = [];

  record(_manager: EntityManager, command: AuditEventCommand): Promise<AuditEvent> {
    const event = Object.assign(new AuditEvent(), {
      id: `audit-${this.events.length + 1}`,
      ...command,
      correlationId: command.correlationId ?? null,
      requestId: command.requestId ?? null,
      previousValues: command.previousValues ?? null,
      newValues: command.newValues ?? null,
      occurredAt: command.occurredAt ?? new Date(),
    });
    this.events.push(event);
    return Promise.resolve(event);
  }
}

class FakeIdempotencyService {
  readonly records = new Map<string, IdempotencyRecord>();

  async reserve(
    _manager: EntityManager,
    command: IdempotencyCommand,
  ): Promise<IdempotencyReservation> {
    await Promise.resolve();
    const key = `${command.scope}:${command.key}`;
    const existing = this.records.get(key);
    if (existing) {
      if (existing.requestHash !== command.requestHash) {
        throw new ConflictException('The idempotency key was already used for another request');
      }
      if (existing.status === IdempotencyRecordStatus.IN_PROGRESS) {
        throw new ConflictException('The idempotent request is already in progress');
      }
      existing.hitCount += 1;
      return { kind: 'REPLAY', record: existing };
    }

    const record = Object.assign(new IdempotencyRecord(), {
      id: `idempotency-${this.records.size + 1}`,
      scope: command.scope,
      idempotencyKey: command.key,
      requestHash: command.requestHash,
      status: IdempotencyRecordStatus.IN_PROGRESS,
      responseStatusCode: null,
      responseBody: null,
      resourceType: null,
      resourceId: null,
      hitCount: 0,
      lastSeenAt: new Date(),
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    this.records.set(key, record);
    return { kind: 'NEW', record };
  }

  async complete(
    _manager: EntityManager,
    recordId: string,
    command: CompleteIdempotencyCommand,
  ): Promise<void> {
    await Promise.resolve();
    const record = [...this.records.values()].find((candidate) => candidate.id === recordId);
    if (!record) throw new Error('Idempotency record not found');
    record.status = IdempotencyRecordStatus.COMPLETED;
    record.responseStatusCode = command.statusCode;
    record.responseBody = command.responseBody;
    record.resourceType = command.resourceType ?? null;
    record.resourceId = command.resourceId ?? null;
  }
}

class FakeWalletService {
  readonly calls: CreateWalletCommand[] = [];

  async createWalletInTransaction(
    manager: EntityManager,
    command: CreateWalletCommand,
  ): Promise<WalletAccount> {
    this.calls.push(command);
    const ledgerRepository = manager.getRepository(LedgerAccount);
    const walletRepository = manager.getRepository(WalletAccount);
    const ledgerAccount = await ledgerRepository.save(
      ledgerRepository.create({
        id: LEDGER_ACCOUNT_ID,
        code: `WALLET-${WALLET_ACCOUNT_ID}`,
        name: `Customer wallet ${WALLET_ACCOUNT_ID}`,
        accountType: LedgerAccountType.LIABILITY,
        normalBalance: LedgerNormalBalance.CREDIT,
        currency: command.currency,
        accountingUnit: 'CUSTOMER_FUNDS',
        allowNegativeBalance: false,
        isActive: true,
      }),
    );
    return walletRepository.save(
      walletRepository.create({
        id: WALLET_ACCOUNT_ID,
        customerId: command.customerId,
        currency: command.currency,
        status: WalletStatus.ACTIVE,
        ledgerAccountId: ledgerAccount.id,
        creationIdempotencyKey: command.idempotencyKey,
      }),
    );
  }
}

interface Fixture {
  service: CustomerFinancialAccountBindingService;
  repositories: {
    customers: MemoryRepository<Customer>;
    customerWallets: MemoryRepository<CustomerWallet>;
    ownerships: MemoryRepository<WalletOwnership>;
    wallets: MemoryRepository<WalletAccount>;
    ledgers: MemoryRepository<LedgerAccount>;
    lines: MemoryRepository<LedgerLine>;
    bindings: MemoryRepository<CustomerFinancialAccountBinding>;
  };
  dataSource: MemoryDataSource;
  authorization: FakeAuthorizationService;
  audit: FakeAuditService;
  idempotency: FakeIdempotencyService;
  walletService: FakeWalletService;
}

const principal: AuthorizationPrincipal = {
  type: 'SERVICE',
  principalId: 'binding-service',
  roles: ['wallet-operations'],
  scopes: ['wallet:account-binding:write'],
  customerAccess: 'ANY',
  audience: 'internal',
};

function makeFixture(): Fixture {
  const repositories = {
    customers: new MemoryRepository<Customer>(),
    customerWallets: new MemoryRepository<CustomerWallet>(),
    ownerships: new MemoryRepository<WalletOwnership>(),
    wallets: new MemoryRepository<WalletAccount>(),
    ledgers: new MemoryRepository<LedgerAccount>(),
    lines: new MemoryRepository<LedgerLine>(),
    bindings: new MemoryRepository<CustomerFinancialAccountBinding>(),
  };
  const repositoryMap = new Map<unknown, MemoryRepository<ObjectLiteral>>([
    [Customer, repositories.customers as unknown as MemoryRepository<ObjectLiteral>],
    [CustomerWallet, repositories.customerWallets as unknown as MemoryRepository<ObjectLiteral>],
    [WalletOwnership, repositories.ownerships as unknown as MemoryRepository<ObjectLiteral>],
    [WalletAccount, repositories.wallets as unknown as MemoryRepository<ObjectLiteral>],
    [LedgerAccount, repositories.ledgers as unknown as MemoryRepository<ObjectLiteral>],
    [LedgerLine, repositories.lines as unknown as MemoryRepository<ObjectLiteral>],
    [
      CustomerFinancialAccountBinding,
      repositories.bindings as unknown as MemoryRepository<ObjectLiteral>,
    ],
  ]);
  const dataSource = new MemoryDataSource(new MemoryManager(repositoryMap));
  const authorization = new FakeAuthorizationService();
  const audit = new FakeAuditService();
  const idempotency = new FakeIdempotencyService();
  const walletService = new FakeWalletService();
  const service = new CustomerFinancialAccountBindingService(
    repositories.bindings as unknown as Repository<CustomerFinancialAccountBinding>,
    repositories.customers as unknown as Repository<Customer>,
    repositories.customerWallets as unknown as Repository<CustomerWallet>,
    repositories.ownerships as unknown as Repository<WalletOwnership>,
    repositories.wallets as unknown as Repository<WalletAccount>,
    repositories.ledgers as unknown as Repository<LedgerAccount>,
    repositories.lines as unknown as Repository<LedgerLine>,
    dataSource as unknown as DataSource,
    walletService as unknown as WalletService,
    authorization as unknown as AuthorizationService,
    audit as unknown as AuditService,
    idempotency as unknown as IdempotencyService,
  );

  repositories.customers.records.set(
    CUSTOMER_ID,
    Object.assign(new Customer(), {
      id: CUSTOMER_ID,
      reference: 'binding-customer',
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
  repositories.ownerships.records.set(
    '00000000-0000-4000-8000-000000000005',
    Object.assign(new WalletOwnership(), {
      id: '00000000-0000-4000-8000-000000000005',
      walletId: CUSTOMER_WALLET_ID,
      customerId: CUSTOMER_ID,
      version: 1,
      deletedAt: null,
    }),
  );

  return {
    service,
    repositories,
    dataSource,
    authorization,
    audit,
    idempotency,
    walletService,
  };
}

function command(
  overrides: Partial<CustomerFinancialAccountBindingCommand> = {},
): CustomerFinancialAccountBindingCommand {
  return {
    mode: CustomerFinancialAccountBindingMode.PROVISION_NEW,
    customerId: CUSTOMER_ID,
    customerWalletId: CUSTOMER_WALLET_ID,
    currency: 'ngn',
    accountingUnit: 'customer_funds',
    expectedCustomerVersion: 1,
    expectedCustomerWalletVersion: 2,
    idempotencyKey: 'binding-request-1',
    principal,
    requestContext: REQUEST_CONTEXT,
    ...overrides,
  };
}

describe('CustomerFinancialAccountBindingService', () => {
  it('authorizes, provisions, audits, and idempotently binds a new account without ledger entries', async () => {
    const fixture = makeFixture();

    const first = await fixture.service.bind(command());
    const second = await fixture.service.bind(command());

    expect(first).toMatchObject({
      outcome: 'PROVISIONED_AND_BOUND',
      bindingState: CustomerFinancialAccountBindingState.ACTIVE,
      customerId: CUSTOMER_ID,
      customerWalletId: CUSTOMER_WALLET_ID,
      walletAccountId: WALLET_ACCOUNT_ID,
      ledgerAccountId: LEDGER_ACCOUNT_ID,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      idempotencyReplay: false,
    });
    expect(second).toMatchObject({
      outcome: 'REPLAYED',
      bindingId: first.bindingId,
      idempotencyReplay: true,
    });
    expect(fixture.walletService.calls).toHaveLength(1);
    expect(fixture.repositories.bindings.records.size).toBe(1);
    expect(fixture.repositories.lines.records.size).toBe(0);
    expect(fixture.audit.events.map((event) => event.action)).toEqual([
      'PROVISIONED_AND_BOUND',
      'REPLAYED',
    ]);
    expect(fixture.dataSource.isolationLevels).toEqual(['SERIALIZABLE', 'SERIALIZABLE']);
    expect(fixture.authorization.policies[0]).toMatchObject({
      action: 'wallet:account-binding:write',
      requiredScopes: ['wallet:account-binding:write'],
    });
  });

  it('rejects a changed payload under the same idempotency key without another mutation', async () => {
    const fixture = makeFixture();
    await fixture.service.bind(command());

    await expect(fixture.service.bind(command({ currency: 'USD' }))).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(fixture.walletService.calls).toHaveLength(1);
    expect(fixture.repositories.bindings.records.size).toBe(1);
  });

  it('binds an explicitly identified empty existing wallet without provisioning or posting value', async () => {
    const fixture = makeFixture();
    fixture.repositories.ledgers.records.set(
      LEDGER_ACCOUNT_ID,
      Object.assign(new LedgerAccount(), {
        id: LEDGER_ACCOUNT_ID,
        code: 'WALLET-EXISTING',
        name: 'Existing customer wallet',
        accountType: LedgerAccountType.LIABILITY,
        normalBalance: LedgerNormalBalance.CREDIT,
        currency: 'NGN',
        accountingUnit: 'CUSTOMER_FUNDS',
        allowNegativeBalance: false,
        isActive: true,
      }),
    );
    fixture.repositories.wallets.records.set(
      WALLET_ACCOUNT_ID,
      Object.assign(new WalletAccount(), {
        id: WALLET_ACCOUNT_ID,
        customerId: CUSTOMER_ID,
        currency: 'NGN',
        status: WalletStatus.ACTIVE,
        ledgerAccountId: LEDGER_ACCOUNT_ID,
      }),
    );

    const result = await fixture.service.bind(
      command({
        mode: CustomerFinancialAccountBindingMode.BIND_EXISTING,
        targetWalletAccountId: WALLET_ACCOUNT_ID,
        idempotencyKey: 'existing-binding-1',
      }),
    );

    expect(result.outcome).toBe('BOUND_EXISTING');
    expect(fixture.walletService.calls).toHaveLength(0);
    expect(fixture.repositories.lines.records.size).toBe(0);
  });

  it('fails closed for authorization denial and does not mutate persistence', async () => {
    const fixture = makeFixture();
    fixture.authorization.allowed = false;

    await expect(fixture.service.bind(command())).rejects.toBeInstanceOf(ForbiddenException);
    expect(fixture.repositories.bindings.records.size).toBe(0);
    expect(fixture.walletService.calls).toHaveLength(0);
    expect(fixture.idempotency.records.size).toBe(0);
  });

  it('rejects existing opaque or financially active targets for controlled review', async () => {
    const fixture = makeFixture();
    fixture.repositories.ledgers.records.set(
      LEDGER_ACCOUNT_ID,
      Object.assign(new LedgerAccount(), {
        id: LEDGER_ACCOUNT_ID,
        accountType: LedgerAccountType.LIABILITY,
        normalBalance: LedgerNormalBalance.CREDIT,
        currency: 'NGN',
        accountingUnit: 'CUSTOMER_FUNDS',
        allowNegativeBalance: false,
        isActive: true,
      }),
    );
    fixture.repositories.wallets.records.set(
      WALLET_ACCOUNT_ID,
      Object.assign(new WalletAccount(), {
        id: WALLET_ACCOUNT_ID,
        customerId: 'legacy-reference',
        currency: 'NGN',
        status: WalletStatus.ACTIVE,
        ledgerAccountId: LEDGER_ACCOUNT_ID,
      }),
    );

    await expect(
      fixture.service.bind(
        command({
          mode: CustomerFinancialAccountBindingMode.BIND_EXISTING,
          targetWalletAccountId: WALLET_ACCOUNT_ID,
          idempotencyKey: 'opaque-existing-1',
        }),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(fixture.repositories.bindings.records.size).toBe(0);
  });

  it('allows only one concurrent canonical customer-currency mapping', async () => {
    const fixture = makeFixture();
    const outcomes = await Promise.allSettled([
      fixture.service.bind(command({ idempotencyKey: 'concurrent-binding-1' })),
      fixture.service.bind(command({ idempotencyKey: 'concurrent-binding-2' })),
    ]);

    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1);
    expect(fixture.repositories.bindings.records.size).toBe(1);
    expect(fixture.walletService.calls).toHaveLength(1);
  });
});
