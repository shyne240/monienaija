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
import { LedgerAccount } from '../src/ledger/ledger-account.entity';
import { LedgerAccountType, LedgerNormalBalance } from '../src/ledger/ledger.enums';
import type { PrivilegedActionApprovalService } from '../src/authorization/privileged-action-approval.service';
import type { AuditService } from '../src/operations/audit.service';
import { AuditEvent } from '../src/operations/audit-event.entity';
import type { AuditEventCommand } from '../src/operations/operations.types';
import { IdempotencyRecord } from '../src/operations/idempotency-record.entity';
import type { IdempotencyService } from '../src/operations/idempotency.service';
import type {
  CompleteIdempotencyCommand,
  IdempotencyCommand,
  IdempotencyReservation,
} from '../src/operations/operations.types';
import { IdempotencyRecordStatus } from '../src/operations/operations.enums';
import type { CustomerFinancialAccountReconciliationReport } from '../src/reconciliation/customer-financial-account-reconciliation.types';
import { CustomerFinancialAccountDiscrepancyType } from '../src/reconciliation/customer-financial-account-reconciliation.types';
import type { ReconciliationService } from '../src/reconciliation/reconciliation.service';
import { VerificationStatus } from '../src/reconciliation/reconciliation.types';
import type { RequestContext } from '../src/production/request-context';
import { CustomerFinancialAccountBinding } from '../src/wallet/customer-financial-account-binding.entity';
import { CustomerFinancialAccountBindingState } from '../src/wallet/customer-financial-account-binding.enums';
import { CustomerFinancialAccountBindingRepairAction } from '../src/wallet/customer-financial-account-binding-repair.enums';
import { CustomerFinancialAccountBindingRepairService } from '../src/wallet/customer-financial-account-binding-repair.service';
import type { CustomerFinancialAccountBindingRepairCommand } from '../src/wallet/customer-financial-account-binding-repair.types';
import { WalletAccount } from '../src/wallet/wallet-account.entity';
import { WalletStatus } from '../src/wallet/wallet.enums';

const CUSTOMER_ID = '00000000-0000-4000-8000-000000000001';
const CUSTOMER_WALLET_ID = '00000000-0000-4000-8000-000000000002';
const WALLET_ACCOUNT_ID = '00000000-0000-4000-8000-000000000003';
const LEDGER_ACCOUNT_ID = '00000000-0000-4000-8000-000000000004';
const BINDING_ID = '00000000-0000-4000-8000-000000000005';
const APPROVAL_ID = '00000000-0000-4000-8000-000000000006';
const REQUEST_CONTEXT: RequestContext = {
  requestId: 'repair-request-1',
  correlationId: 'repair-correlation-1',
  traceId: 'repair-trace-1',
};

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
}

class MemoryManager {
  constructor(private readonly repositories: Map<unknown, MemoryRepository<ObjectLiteral>>) {}

  getRepository<T extends ObjectLiteral>(target: EntityTarget<T>): Repository<T> {
    const repository = this.repositories.get(target);
    if (!repository) throw new Error('Unexpected repair repository');
    return repository as unknown as Repository<T>;
  }
}

class MemoryDataSource {
  readonly isolationLevels: string[] = [];
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly manager: MemoryManager) {}

  transaction<T>(
    isolationLevel: string,
    callback: (manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    this.isolationLevels.push(isolationLevel);
    const result = this.queue.then(() => callback(this.manager as unknown as EntityManager));
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
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
    void resource;
    if (policy) this.policies.push(policy);
    return Promise.resolve({
      allowed: this.allowed,
      reason: this.allowed ? undefined : 'SCOPE_MISSING',
      principalType: 'PRIVILEGED',
      principalId: 'repair-operator',
      resourceType: policy?.resourceType ?? 'unknown',
      action: policy?.action ?? 'unknown',
      evaluatedAt: new Date(),
      requiredScopes: policy?.requiredScopes ?? [],
      requiredRoles: policy?.requiredRoles ?? [],
    });
  }
}

class FakePrivilegedApprovalService {
  approved = true;
  consumeCalls = 0;

  consume(): Promise<{ approved: boolean; reason: 'CONSUMED' | 'APPROVAL_SCOPE_MISSING' }> {
    this.consumeCalls += 1;
    return Promise.resolve({
      approved: this.approved,
      reason: this.approved ? 'CONSUMED' : 'APPROVAL_SCOPE_MISSING',
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
        throw new ConflictException('The idempotency key was already used for another repair');
      }
      if (existing.status === IdempotencyRecordStatus.IN_PROGRESS) {
        throw new ConflictException('The repair is already in progress');
      }
      existing.hitCount += 1;
      return { kind: 'REPLAY', record: existing };
    }
    const record = Object.assign(new IdempotencyRecord(), {
      id: `repair-idempotency-${this.records.size + 1}`,
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
    if (!record) throw new Error('Repair idempotency record not found');
    record.status = IdempotencyRecordStatus.COMPLETED;
    record.responseStatusCode = command.statusCode;
    record.responseBody = command.responseBody;
    record.resourceType = command.resourceType ?? null;
    record.resourceId = command.resourceId ?? null;
  }
}

class FakeReconciliationService {
  reports: CustomerFinancialAccountReconciliationReport[] = [];
  calls = 0;

  getBindingReconciliation(): Promise<CustomerFinancialAccountReconciliationReport> {
    this.calls += 1;
    return Promise.resolve(
      this.reports.shift() ?? {
        status: VerificationStatus.PASS,
        generatedAt: new Date().toISOString(),
        summary: {
          bindingsChecked: 1,
          activeBindingsChecked: 0,
          customerWalletsChecked: 1,
          financialWalletsChecked: 1,
          discrepancies: 0,
          errors: 0,
          warnings: 0,
          byType: {},
        },
        discrepancies: [],
        repairPerformed: false,
      },
    );
  }
}

interface Fixture {
  service: CustomerFinancialAccountBindingRepairService;
  repositories: {
    bindings: MemoryRepository<CustomerFinancialAccountBinding>;
    customers: MemoryRepository<Customer>;
    customerWallets: MemoryRepository<CustomerWallet>;
    wallets: MemoryRepository<WalletAccount>;
    ledgers: MemoryRepository<LedgerAccount>;
  };
  authorization: FakeAuthorizationService;
  approval: FakePrivilegedApprovalService;
  reconciliation: FakeReconciliationService;
  audit: FakeAuditService;
  idempotency: FakeIdempotencyService;
  dataSource: MemoryDataSource;
}

const principal: AuthorizationPrincipal = {
  type: 'PRIVILEGED',
  principalId: 'repair-operator',
  roles: ['wallet-operations'],
  scopes: ['wallet:account-binding:repair'],
  customerAccess: 'ANY',
  assuranceLevel: 'MFA',
};

function makeReport(
  discrepancies: CustomerFinancialAccountReconciliationReport['discrepancies'] = [],
): CustomerFinancialAccountReconciliationReport {
  const errors = discrepancies.filter((item) => item.severity === 'ERROR').length;
  const warnings = discrepancies.filter((item) => item.severity === 'WARNING').length;
  return {
    status:
      errors > 0
        ? VerificationStatus.ERROR
        : warnings > 0
          ? VerificationStatus.WARNING
          : VerificationStatus.PASS,
    generatedAt: new Date().toISOString(),
    summary: {
      bindingsChecked: 1,
      activeBindingsChecked: 1,
      customerWalletsChecked: 1,
      financialWalletsChecked: 1,
      discrepancies: discrepancies.length,
      errors,
      warnings,
      byType: {},
    },
    discrepancies,
    repairPerformed: false,
  };
}

function makeFixture(state = CustomerFinancialAccountBindingState.REPAIR_REQUIRED): Fixture {
  const repositories = {
    bindings: new MemoryRepository<CustomerFinancialAccountBinding>(),
    customers: new MemoryRepository<Customer>(),
    customerWallets: new MemoryRepository<CustomerWallet>(),
    wallets: new MemoryRepository<WalletAccount>(),
    ledgers: new MemoryRepository<LedgerAccount>(),
  };
  const map = new Map<unknown, MemoryRepository<ObjectLiteral>>([
    [
      CustomerFinancialAccountBinding,
      repositories.bindings as unknown as MemoryRepository<ObjectLiteral>,
    ],
    [Customer, repositories.customers as unknown as MemoryRepository<ObjectLiteral>],
    [CustomerWallet, repositories.customerWallets as unknown as MemoryRepository<ObjectLiteral>],
    [WalletAccount, repositories.wallets as unknown as MemoryRepository<ObjectLiteral>],
    [LedgerAccount, repositories.ledgers as unknown as MemoryRepository<ObjectLiteral>],
  ]);
  const authorization = new FakeAuthorizationService();
  const approval = new FakePrivilegedApprovalService();
  const reconciliation = new FakeReconciliationService();
  const audit = new FakeAuditService();
  const idempotency = new FakeIdempotencyService();
  const dataSource = new MemoryDataSource(new MemoryManager(map));
  const service = new CustomerFinancialAccountBindingRepairService(
    repositories.bindings as unknown as Repository<CustomerFinancialAccountBinding>,
    repositories.customers as unknown as Repository<Customer>,
    repositories.customerWallets as unknown as Repository<CustomerWallet>,
    repositories.wallets as unknown as Repository<WalletAccount>,
    repositories.ledgers as unknown as Repository<LedgerAccount>,
    dataSource as unknown as DataSource,
    authorization as unknown as AuthorizationService,
    approval as unknown as PrivilegedActionApprovalService,
    reconciliation as unknown as ReconciliationService,
    audit as unknown as AuditService,
    idempotency as unknown as IdempotencyService,
  );

  repositories.customers.records.set(
    CUSTOMER_ID,
    Object.assign(new Customer(), {
      id: CUSTOMER_ID,
      reference: 'repair-customer',
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
      accountType: LedgerAccountType.LIABILITY,
      normalBalance: LedgerNormalBalance.CREDIT,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      allowNegativeBalance: false,
      isActive: true,
    }),
  );
  repositories.bindings.records.set(
    BINDING_ID,
    Object.assign(new CustomerFinancialAccountBinding(), {
      id: BINDING_ID,
      customerId: CUSTOMER_ID,
      customerWalletId: CUSTOMER_WALLET_ID,
      walletAccountId: WALLET_ACCOUNT_ID,
      ledgerAccountId: LEDGER_ACCOUNT_ID,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      state,
      sourceCustomerVersion: 1,
      sourceCustomerWalletVersion: 2,
      version: 4,
      createdBy: 'binding-service',
      updatedBy: 'binding-service',
      closedAt: state === CustomerFinancialAccountBindingState.CLOSED ? new Date() : null,
    }),
  );
  return {
    service,
    repositories,
    authorization,
    approval,
    reconciliation,
    audit,
    idempotency,
    dataSource,
  };
}

function command(
  overrides: Partial<CustomerFinancialAccountBindingRepairCommand> = {},
): CustomerFinancialAccountBindingRepairCommand {
  return {
    action: CustomerFinancialAccountBindingRepairAction.RESOLVE_TO_PENDING,
    bindingId: BINDING_ID,
    approvalId: APPROVAL_ID,
    actionFingerprint: 'a'.repeat(64),
    reason: 'Validated source state after controlled review',
    idempotencyKey: 'repair-request-1',
    expectedBindingVersion: 4,
    principal,
    requestContext: REQUEST_CONTEXT,
    ...overrides,
  };
}

describe('CustomerFinancialAccountBindingRepairService', () => {
  it('requires authorization and privileged approval before changing binding metadata', async () => {
    const fixture = makeFixture();
    fixture.authorization.allowed = false;

    await expect(fixture.service.repair(command())).rejects.toBeInstanceOf(ForbiddenException);
    expect(fixture.approval.consumeCalls).toBe(0);
    expect(fixture.repositories.bindings.records.get(BINDING_ID)?.state).toBe(
      CustomerFinancialAccountBindingState.REPAIR_REQUIRED,
    );
  });

  it('rejects a repair when privileged approval is denied', async () => {
    const fixture = makeFixture();
    fixture.approval.approved = false;
    fixture.reconciliation.reports = [makeReport()];

    await expect(fixture.service.repair(command())).rejects.toBeInstanceOf(ForbiddenException);
    expect(fixture.approval.consumeCalls).toBe(1);
    expect(fixture.repositories.bindings.records.get(BINDING_ID)?.state).toBe(
      CustomerFinancialAccountBindingState.REPAIR_REQUIRED,
    );
  });

  it('resolves a repair-required binding to PENDING with approval, audit, idempotency, and reconciliation evidence', async () => {
    const fixture = makeFixture();
    fixture.reconciliation.reports = [makeReport(), makeReport()];

    const result = await fixture.service.repair(command());

    expect(result).toMatchObject({
      outcome: 'REPAIRED_TO_PENDING',
      action: CustomerFinancialAccountBindingRepairAction.RESOLVE_TO_PENDING,
      bindingId: BINDING_ID,
      previousState: CustomerFinancialAccountBindingState.REPAIR_REQUIRED,
      state: CustomerFinancialAccountBindingState.PENDING,
      idempotencyReplay: false,
      reconciliationBefore: { status: 'PASS', discrepancies: 0 },
      reconciliationAfter: { status: 'PASS', discrepancies: 0 },
    });
    expect(fixture.approval.consumeCalls).toBe(1);
    expect(fixture.audit.events.map((event) => event.action)).toContain('REPAIRED_TO_PENDING');
    expect(fixture.idempotency.records.size).toBe(1);
    expect(fixture.dataSource.isolationLevels).toEqual(['SERIALIZABLE']);
  });

  it('closes a repair-required binding without modifying financial source records', async () => {
    const fixture = makeFixture();
    fixture.reconciliation.reports = [makeReport(), makeReport()];
    const ledgerBefore = { ...fixture.repositories.ledgers.records.get(LEDGER_ACCOUNT_ID) };
    const walletBefore = { ...fixture.repositories.wallets.records.get(WALLET_ACCOUNT_ID) };

    const result = await fixture.service.repair(
      command({
        action: CustomerFinancialAccountBindingRepairAction.CLOSE,
        idempotencyKey: 'repair-close-1',
      }),
    );

    expect(result.outcome).toBe('CLOSED');
    expect(result.state).toBe(CustomerFinancialAccountBindingState.CLOSED);
    expect(fixture.repositories.ledgers.records.get(LEDGER_ACCOUNT_ID)).toEqual(ledgerBefore);
    expect(fixture.repositories.wallets.records.get(WALLET_ACCOUNT_ID)).toEqual(walletBefore);
  });

  it('does not resolve stale source state to PENDING', async () => {
    const fixture = makeFixture();
    const customerWallet = fixture.repositories.customerWallets.records.get(CUSTOMER_WALLET_ID)!;
    customerWallet.currency = 'USD';
    fixture.reconciliation.reports = [makeReport(), makeReport()];

    await expect(fixture.service.repair(command())).rejects.toBeInstanceOf(ConflictException);
    expect(fixture.approval.consumeCalls).toBe(0);
    expect(fixture.repositories.bindings.records.get(BINDING_ID)?.state).toBe(
      CustomerFinancialAccountBindingState.REPAIR_REQUIRED,
    );
  });

  it('replays an identical repair without consuming approval or mutating twice', async () => {
    const fixture = makeFixture();
    fixture.reconciliation.reports = [makeReport(), makeReport(), makeReport()];

    const first = await fixture.service.repair(command());
    const second = await fixture.service.repair(command());

    expect(first.outcome).toBe('REPAIRED_TO_PENDING');
    expect(second).toMatchObject({
      outcome: 'REPLAYED',
      bindingId: BINDING_ID,
      state: CustomerFinancialAccountBindingState.PENDING,
      idempotencyReplay: true,
    });
    expect(fixture.approval.consumeCalls).toBe(1);
    expect(fixture.repositories.bindings.records.get(BINDING_ID)?.version).toBe(5);
  });

  it('rejects changed repair payloads under the same idempotency key', async () => {
    const fixture = makeFixture();
    fixture.reconciliation.reports = [makeReport(), makeReport()];
    await fixture.service.repair(command());

    await expect(
      fixture.service.repair(command({ reason: 'Different repair reason' })),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(fixture.approval.consumeCalls).toBe(1);
    expect(fixture.repositories.bindings.records.get(BINDING_ID)?.version).toBe(5);
  });

  it('rejects unavailable reconciliation evidence before approval consumption', async () => {
    const fixture = makeFixture();
    fixture.reconciliation.reports = [
      makeReport([
        {
          key: 'query',
          type: CustomerFinancialAccountDiscrepancyType.QUERY_UNAVAILABLE,
          severity: 'ERROR',
          owner: 'RECONCILIATION',
          recoveryState: 'MANUAL_REVIEW_REQUIRED',
          bindingId: null,
          customerId: null,
          customerWalletId: null,
          walletAccountId: null,
          ledgerAccountId: null,
          currency: null,
          accountingUnit: null,
          scopeValue: 'A3T07',
          message: 'Unavailable',
        },
      ]),
    ];

    await expect(fixture.service.repair(command())).rejects.toBeInstanceOf(ConflictException);
    expect(fixture.approval.consumeCalls).toBe(0);
    expect(fixture.repositories.bindings.records.get(BINDING_ID)?.state).toBe(
      CustomerFinancialAccountBindingState.REPAIR_REQUIRED,
    );
  });
});
