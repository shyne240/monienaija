import { randomUUID } from 'node:crypto';
import { ConflictException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { A5ArControlAccountProvisioningService } from '../src/ledger/ar-control-account-provisioning.service';
import type { A5ArControlAccountDefinitionV1 } from '../src/ledger/ar-control-account-provisioning.types';
import { LedgerAccountType, LedgerNormalBalance } from '../src/ledger/ledger.enums';

class MemoryIdempotency {
  records = new Map<
    string,
    { id: string; requestHash: string; responseBody: Record<string, unknown> | null }
  >();
  async reserve(
    _manager: EntityManager,
    command: { scope: string; key: string; requestHash: string },
  ) {
    await Promise.resolve();
    const mapKey = `${command.scope}:${command.key}`;
    const existing = this.records.get(mapKey);
    if (existing) {
      if (existing.requestHash !== command.requestHash)
        throw new ConflictException('changed payload');
      return { kind: 'REPLAY' as const, record: existing };
    }
    const record = { id: randomUUID(), requestHash: command.requestHash, responseBody: null };
    this.records.set(mapKey, record);
    return { kind: 'NEW' as const, record };
  }
  async complete(
    _manager: EntityManager,
    id: string,
    command: { responseBody: Record<string, unknown> },
  ) {
    await Promise.resolve();
    this.find(id).responseBody = command.responseBody;
  }
  async fail(
    manager: EntityManager,
    id: string,
    command: { responseBody: Record<string, unknown> },
  ) {
    return this.complete(manager, id, command);
  }
  private find(id: string) {
    return [...this.records.values()].find((record) => record.id === id)!;
  }
}

const principal = {
  type: 'PRIVILEGED' as const,
  principalId: 'finance-controller',
  roles: ['FINANCE_CONTROLLER'],
  scopes: ['privileged:execute'],
  customerAccess: 'NONE' as const,
  assuranceLevel: 'MFA' as const,
};
const context = { requestId: randomUUID(), correlationId: randomUUID(), traceId: randomUUID() };

describe('A5T11 AR control account provisioning service', () => {
  let service: A5ArControlAccountProvisioningService;
  let accounts: Array<{
    id: string;
    code: string;
    name: string;
    accountType: LedgerAccountType;
    normalBalance: LedgerNormalBalance;
    currency: string;
    accountingUnit: string;
    allowNegativeBalance: boolean;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
  }>;
  let approvalAllowed: boolean;
  let approvalReason: 'CONSUMED' | 'RESOURCE_MISMATCH';
  let controlAllowed: boolean;
  let createMode: 'OK' | 'THROW_AFTER_CREATE' | 'THROW_BEFORE_CREATE';
  let audits: string[];
  let events: string[];
  let createCalls: number;

  beforeEach(() => {
    accounts = [];
    approvalAllowed = true;
    approvalReason = 'CONSUMED';
    controlAllowed = true;
    createMode = 'OK';
    audits = [];
    events = [];
    createCalls = 0;
    const manager = {} as EntityManager;
    const dataSource = {
      transaction: async (
        _isolation: string,
        callback: (value: EntityManager) => Promise<unknown>,
      ) => callback(manager),
    };
    const ledger = {
      listAccounts: async () => {
        await Promise.resolve();
        return [...accounts];
      },
      createAccount: async (definition: A5ArControlAccountDefinitionV1) => {
        await Promise.resolve();
        createCalls += 1;
        if (createMode === 'THROW_BEFORE_CREATE') throw new Error('timeout before commit');
        const account = {
          id: randomUUID(),
          ...definition,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        accounts.push(account);
        if (createMode === 'THROW_AFTER_CREATE') throw new Error('lost response after commit');
        return account;
      },
      getAccount: async (id: string) => {
        await Promise.resolve();
        const account = accounts.find((candidate) => candidate.id === id);
        if (!account) throw new Error('not found');
        return account;
      },
    };
    const idempotency = new MemoryIdempotency();
    service = new A5ArControlAccountProvisioningService(
      dataSource as never,
      ledger as never,
      idempotency as never,
      {
        consumeInTransaction: async (
          _manager: unknown,
          input: { approvalId: string; actionFingerprint: string },
        ) => {
          void _manager;
          await Promise.resolve();
          return {
            approved: approvalAllowed,
            reason: approvalReason,
            approval: {
              id: input.approvalId,
              actionType: 'FINANCE_A5_AR_ACCOUNT_PROVISION',
              resourceType: 'A5_AR_CONTROL_ACCOUNT_PROVISION',
              resourceId: 'FINANCE-ACCOUNTS_RECEIVABLE-NGN',
              actionFingerprint: input.actionFingerprint,
              requesterPrincipalId: 'finance-maker',
              approvedBy: principal.principalId,
              status: 'CONSUMED',
              policy: { requiredRoles: ['FINANCE_PREPARER'] },
            },
          };
        },
      } as never,
      {
        evaluateInTransaction: async (_manager: unknown) => {
          void _manager;
          await Promise.resolve();
          return {
            outcome: controlAllowed ? 'ALLOW' : 'DENY',
            decisionReference: 'b2f-control-a5-ar',
            reasons: controlAllowed ? [] : ['CONTROL_DENIED'],
          };
        },
      } as never,
      {
        record: async (_manager: EntityManager, command: { action: string }) => {
          await Promise.resolve();
          audits.push(command.action);
          return { id: randomUUID() };
        },
      } as never,
      {
        enqueueOnce: async (_manager: EntityManager, command: { eventType: string }) => {
          await Promise.resolve();
          events.push(command.eventType);
          return {};
        },
      } as never,
      { increment: async () => Promise.resolve() } as never,
    );
  });

  const command = (
    definition: Partial<A5ArControlAccountDefinitionV1> = {},
    idempotencyKey = randomUUID(),
  ) => ({
    definition: { ...service.getAuthorizedDefinition(), ...definition },
    idempotencyKey,
    approvalId: randomUUID(),
    principal,
    requestContext: context,
    causationId: randomUUID(),
    now: new Date('2026-08-10T00:00:00.000Z'),
  });

  it('freezes the authorized contract definition', () => {
    expect(service.getAuthorizedDefinition()).toEqual({
      code: 'FINANCE-ACCOUNTS_RECEIVABLE-NGN',
      name: 'Finance accounts receivable control NGN',
      accountType: LedgerAccountType.ASSET,
      normalBalance: LedgerNormalBalance.DEBIT,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      allowNegativeBalance: false,
    });
  });

  it.each([
    [{ accountType: LedgerAccountType.LIABILITY }, 'ACCOUNT_TYPE_INVALID'],
    [{ normalBalance: LedgerNormalBalance.CREDIT }, 'NORMAL_BALANCE_INVALID'],
    [{ currency: 'USD' }, 'CURRENCY_INVALID'],
    [{ accountingUnit: 'PLATFORM_FUNDS' }, 'ACCOUNTING_UNIT_INVALID'],
    [{ allowNegativeBalance: true }, 'NEGATIVE_BALANCE_POLICY_INVALID'],
  ] as const)('rejects invalid account definition %o', async (definition, code) => {
    const result = await service.provision(command(definition));
    expect(result.failure?.code).toBe(code);
    expect(createCalls).toBe(0);
  });

  it('provisions and canonically verifies one A5 account', async () => {
    const result = await service.provision(command());
    expect(result.outcome).toBe('PROVISIONED');
    expect(result.evidence).toMatchObject({
      canonicalA5AccountId: accounts[0]!.id,
      accountCode: 'FINANCE-ACCOUNTS_RECEIVABLE-NGN',
      accountType: 'ASSET',
      normalBalance: 'DEBIT',
      readyForB2F03Mapping: true,
    });
    expect(audits).toEqual(['AR_CONTROL_ACCOUNT_PROVISIONED']);
    expect(events).toEqual(['A5ArControlAccountProvisioned']);
  });

  it('replays the exact idempotent result and prevents duplicate creation', async () => {
    const key = randomUUID();
    const first = await service.provision(command({}, key));
    const replay = await service.provision(command({}, key));
    expect(replay.outcome).toBe('REPLAYED');
    expect(replay.evidence?.canonicalA5AccountId).toBe(first.evidence?.canonicalA5AccountId);
    expect(createCalls).toBe(1);
  });

  it('rejects changed semantic payload under the same idempotency key', async () => {
    const key = randomUUID();
    await service.provision(command({}, key));
    await expect(
      service.provision(command({ name: 'Changed account name' }, key)),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects a conflicting duplicate account code', async () => {
    accounts.push({
      id: randomUUID(),
      ...service.getAuthorizedDefinition(),
      name: 'Wrong name',
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const result = await service.provision(command());
    expect(result.failure?.code).toBe('ACCOUNT_CODE_CONFLICT');
    expect(createCalls).toBe(0);
  });

  it('fails closed when A2 approval or B2F06 control denies', async () => {
    approvalAllowed = false;
    approvalReason = 'RESOURCE_MISMATCH';
    expect((await service.provision(command())).failure?.code).toBe('APPROVAL_REJECTED');
    approvalAllowed = true;
    controlAllowed = false;
    expect((await service.provision(command({}, randomUUID()))).failure?.code).toBe(
      'FINANCE_CONTROL_DENIED',
    );
    expect(createCalls).toBe(0);
  });

  it('rejects stale or reused approval when no canonical account exists to recover', async () => {
    approvalAllowed = false;
    approvalReason = 'CONSUMED';
    const result = await service.provision(command());
    expect(result.failure?.code).toBe('APPROVAL_REJECTED');
    expect(createCalls).toBe(0);
  });

  it('recovers a lost response by verifying the canonical account before retrying', async () => {
    createMode = 'THROW_AFTER_CREATE';
    const result = await service.provision(command());
    expect(result.outcome).toBe('RECOVERED');
    expect(result.evidence?.canonicalA5AccountId).toBe(accounts[0]!.id);
    expect(createCalls).toBe(1);
    expect(audits).toEqual(['AR_CONTROL_ACCOUNT_RECOVERED']);
  });

  it('surfaces an unknown outcome when no canonical account can be verified', async () => {
    createMode = 'THROW_BEFORE_CREATE';
    await expect(service.provision(command())).rejects.toThrow('provisioning outcome is unknown');
    expect(accounts).toHaveLength(0);
    expect(events).toHaveLength(0);
  });

  it('recovers an exact preexisting account without creating a duplicate', async () => {
    accounts.push({
      id: randomUUID(),
      ...service.getAuthorizedDefinition(),
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const result = await service.provision(command());
    expect(result.outcome).toBe('RECOVERED');
    expect(createCalls).toBe(0);
    expect(accounts).toHaveLength(1);
  });

  it('does not expose journal, balance, mapping, AR, or controller authority', () => {
    expect(Object.keys(service)).not.toEqual(
      expect.arrayContaining([
        'postJournal',
        'reverseJournal',
        'balanceRepository',
        'accountMappingService',
        'receivableRepository',
        'controller',
      ]),
    );
  });
});
