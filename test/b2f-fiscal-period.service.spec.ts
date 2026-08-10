import { randomUUID } from 'node:crypto';

import { ConflictException } from '@nestjs/common';
import type { DataSource, EntityManager } from 'typeorm';

import type { AuthorizationPrincipal } from '../src/authorization/authorization.types';
import type { B2FFinanceAccountingPeriod } from '../src/policy/b2f-accounting-period.entity';
import {
  B2F_ACCOUNTING_UNIT,
  B2F_BOOK_KEY,
  B2F_FUNCTIONAL_CURRENCY,
  B2F_LEGAL_ENTITY_REFERENCE,
} from '../src/policy/b2f-fiscal-period.constants';
import { B2FFiscalPeriodRepository } from '../src/policy/b2f-fiscal-period.repository';
import { B2FFiscalPeriodService } from '../src/policy/b2f-fiscal-period.service';
import type { B2FPeriodTransitionCommandV1 } from '../src/policy/b2f-fiscal-period.types';
import { B2FFinanceFiscalYear } from '../src/policy/b2f-fiscal-year.entity';

class MemoryRepository<T extends { id: string; recordVersion?: number }> {
  rows: T[] = [];
  lockUsed = false;

  create(value: Partial<T>): T {
    return value as T;
  }

  async save(value: T | T[]): Promise<T | T[]> {
    if (Array.isArray(value)) {
      const saved: T[] = [];
      for (const item of value) saved.push((await this.save(item)) as T);
      return saved;
    }
    if (!value.id) value.id = randomUUID();
    const index = this.rows.findIndex((row) => row.id === value.id);
    if (index >= 0) {
      if (value.recordVersion !== undefined) value.recordVersion += 1;
      this.rows[index] = value;
    } else this.rows.push(value);
    return value;
  }

  async findOne(options: { where: Record<string, unknown> }): Promise<T | null> {
    await Promise.resolve();
    return (
      this.rows.find((row) =>
        Object.entries(options.where).every(
          ([key, expected]) => (row as unknown as Record<string, unknown>)[key] === expected,
        ),
      ) ?? null
    );
  }

  async find(options: {
    where: Record<string, unknown>;
    order?: Record<string, string>;
  }): Promise<T[]> {
    await Promise.resolve();
    const rows = this.rows.filter((row) =>
      Object.entries(options.where).every(
        ([key, expected]) => (row as unknown as Record<string, unknown>)[key] === expected,
      ),
    );
    return rows.sort(
      (a, b) =>
        Number((a as unknown as Record<string, unknown>).periodNumber ?? 0) -
        Number((b as unknown as Record<string, unknown>).periodNumber ?? 0),
    );
  }

  createQueryBuilder(): {
    where: (_sql: string, values: { reference: string }) => unknown;
    setLock: (_mode: string) => unknown;
    getOne: () => Promise<T | null>;
  } {
    let reference = '';
    const builder = {
      where: (_sql: string, values: { reference: string }) => {
        reference = values.reference;
        return builder;
      },
      setLock: (mode: string) => {
        void mode;
        this.lockUsed = true;
        return builder;
      },
      getOne: async () => {
        await Promise.resolve();
        return (
          this.rows.find(
            (row) => (row as unknown as Record<string, unknown>).periodReference === reference,
          ) ?? null
        );
      },
    };
    return builder;
  }
}

class MemoryDatabase {
  fiscalYears = new MemoryRepository<B2FFinanceFiscalYear>();
  periods = new MemoryRepository<B2FFinanceAccountingPeriod>();
  manager = {
    getRepository: (entity: unknown) =>
      entity === B2FFinanceFiscalYear ? this.fiscalYears : this.periods,
  } as unknown as EntityManager;
  dataSource = {
    transaction: async (
      _isolation: string,
      callback: (manager: EntityManager) => Promise<unknown>,
    ) => callback(this.manager),
    getRepository: (entity: unknown) =>
      entity === B2FFinanceFiscalYear ? this.fiscalYears : this.periods,
  } as unknown as DataSource;
}

class MemoryIdempotency {
  records = new Map<
    string,
    {
      id: string;
      requestHash: string;
      responseBody: Record<string, unknown> | null;
      status: string;
    }
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
        throw new ConflictException('The idempotency key was already used for another request');
      return { kind: 'REPLAY' as const, record: existing };
    }
    const record = {
      id: randomUUID(),
      requestHash: command.requestHash,
      responseBody: null,
      status: 'IN_PROGRESS',
    };
    this.records.set(mapKey, record);
    return { kind: 'NEW' as const, record };
  }

  async complete(
    _manager: EntityManager,
    id: string,
    command: { responseBody: Record<string, unknown> },
  ) {
    await Promise.resolve();
    const record = [...this.records.values()].find((candidate) => candidate.id === id)!;
    record.responseBody = command.responseBody;
    record.status = 'COMPLETED';
  }

  async fail(
    _manager: EntityManager,
    id: string,
    command: { responseBody: Record<string, unknown> },
  ) {
    await Promise.resolve();
    const record = [...this.records.values()].find((candidate) => candidate.id === id)!;
    record.responseBody = command.responseBody;
    record.status = 'FAILED';
  }
}

const principal: AuthorizationPrincipal = {
  type: 'PRIVILEGED',
  principalId: 'finance-executor',
  roles: ['FINANCE_OPERATOR'],
  scopes: ['privileged:execute'],
  customerAccess: 'NONE',
  assuranceLevel: 'MFA',
};
const context = { requestId: randomUUID(), correlationId: randomUUID(), traceId: randomUUID() };

describe('B2F fiscal period service (B2F04)', () => {
  let database: MemoryDatabase;
  let idempotency: MemoryIdempotency;
  let audits: Array<Record<string, unknown>>;
  let approvals: { approved: boolean; calls: number };
  let service: B2FFiscalPeriodService;

  beforeEach(() => {
    database = new MemoryDatabase();
    idempotency = new MemoryIdempotency();
    audits = [];
    approvals = { approved: true, calls: 0 };
    service = new B2FFiscalPeriodService(
      database.dataSource,
      new B2FFiscalPeriodRepository(),
      idempotency as never,
      {
        record: async (_manager: EntityManager, command: Record<string, unknown>) => {
          await Promise.resolve();
          audits.push(command);
        },
      } as never,
      {
        consume: async () => {
          await Promise.resolve();
          approvals.calls += 1;
          return {
            approved: approvals.approved,
            reason: approvals.approved ? 'CONSUMED' : 'NOT_FOUND',
            approval: approvals.approved
              ? {
                  id: randomUUID(),
                  requesterPrincipalId: 'finance-maker',
                  approvedBy: principal.principalId,
                  resourceType: 'B2F_ACCOUNTING_PERIOD',
                  resourceId: null,
                  status: 'CONSUMED',
                  policy: { requiredRoles: ['FINANCE_PREPARER'] },
                }
              : undefined,
          };
        },
      } as never,
      {
        evaluate: async () => {
          await Promise.resolve();
          return { outcome: 'ALLOW', decisionReference: 'b2f-control-decision-test', reasons: [] };
        },
      } as never,
    );
  });

  async function createYear(key = randomUUID()) {
    return service.createFiscalYear({
      fiscalYear: 2027,
      idempotencyKey: key,
      principal,
      requestContext: context,
      now: new Date('2026-08-09T00:00:00.000Z'),
    });
  }

  function transition(
    periodReference: string,
    targetState: B2FPeriodTransitionCommandV1['targetState'],
    expectedRecordVersion: number,
    overrides: Partial<B2FPeriodTransitionCommandV1> = {},
  ): B2FPeriodTransitionCommandV1 {
    return {
      periodReference,
      targetState,
      expectedRecordVersion,
      idempotencyKey: randomUUID(),
      approvalId: randomUUID(),
      principal,
      reason: `Move period to ${targetState}`,
      controlEvidence: {
        legalEntityRatificationReference: 'legal-ratification-1',
        accountingPolicyApprovalReference: 'accounting-policy-approval-1',
        ...(targetState === 'HARD_CLOSED'
          ? { reconciliationReference: 'reconciliation-1', closeChecklistReference: 'close-1' }
          : {}),
        ...(targetState === 'REOPENED'
          ? { correctionScope: 'journal-correction-1', reopenExpiresAt: '2028-01-02T00:00:00.000Z' }
          : {}),
      },
      requestContext: context,
      now: new Date('2027-01-01T00:00:00.000Z'),
      ...overrides,
    };
  }

  it('creates and replays one fiscal year with twelve periods and audit evidence', async () => {
    const key = randomUUID();
    const created = await createYear(key);
    expect(created.outcome).toBe('CREATED');
    expect(created.fiscalYear?.periods).toHaveLength(12);
    expect(audits.filter((audit) => audit.action === 'ACCOUNTING_PERIOD_CREATED')).toHaveLength(12);
    const replay = await createYear(key);
    expect(replay.outcome).toBe('REPLAYED');
    expect(replay.replayed).toBe(true);
    expect(database.fiscalYears.rows).toHaveLength(1);
    expect(database.periods.rows).toHaveLength(12);
  });

  it('rejects a changed payload under the same idempotency key', async () => {
    const key = randomUUID();
    await createYear(key);
    await expect(
      service.createFiscalYear({
        fiscalYear: 2028,
        idempotencyKey: key,
        principal,
        requestContext: context,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('enforces approved state transitions and pessimistic locking', async () => {
    const created = await createYear();
    const period = created.fiscalYear!.periods[0]!;
    const opened = await service.transitionPeriod(
      transition(period.periodReference, 'OPEN', period.recordVersion),
    );
    expect(opened.outcome).toBe('APPLIED');
    expect(opened.resultingState).toBe('OPEN');
    expect(database.periods.lockUsed).toBe(true);
    expect(approvals.calls).toBe(1);
    expect(audits.some((audit) => audit.action === 'ACCOUNTING_PERIOD_OPENED')).toBe(true);
  });

  it('rejects invalid and stale transitions without changing history', async () => {
    const created = await createYear();
    const period = created.fiscalYear!.periods[0]!;
    const invalid = await service.transitionPeriod(
      transition(period.periodReference, 'HARD_CLOSED', period.recordVersion),
    );
    expect(invalid.outcome).toBe('REJECTED');
    expect(invalid.failure?.code).toBe('B2F_FISCAL_PERIOD_INVALID_TRANSITION');
    expect(database.periods.rows[0]!.state).toBe('PLANNED');

    const opened = await service.transitionPeriod(
      transition(period.periodReference, 'OPEN', period.recordVersion),
    );
    const stale = await service.transitionPeriod(
      transition(period.periodReference, 'SOFT_CLOSED', period.recordVersion),
    );
    expect(opened.outcome).toBe('APPLIED');
    expect(stale.failure?.code).toBe('B2F_FISCAL_PERIOD_VERSION_CONFLICT');
  });

  it('replays lifecycle decisions without consuming approval twice', async () => {
    const created = await createYear();
    const period = created.fiscalYear!.periods[0]!;
    const command = transition(period.periodReference, 'OPEN', period.recordVersion);
    const applied = await service.transitionPeriod(command);
    const replay = await service.transitionPeriod(command);
    expect(applied.outcome).toBe('APPLIED');
    expect(replay.outcome).toBe('REPLAYED');
    expect(replay.decisionReference).toBe(applied.decisionReference);
    expect(approvals.calls).toBe(1);
  });

  it('fails closed when privileged approval is denied', async () => {
    approvals.approved = false;
    const created = await createYear();
    const period = created.fiscalYear!.periods[0]!;
    const decision = await service.transitionPeriod(
      transition(period.periodReference, 'OPEN', period.recordVersion),
    );
    expect(decision.outcome).toBe('REJECTED');
    expect(decision.failure?.code).toBe('B2F_FISCAL_PERIOD_APPROVAL_REQUIRED');
    expect(database.periods.rows[0]!.state).toBe('PLANNED');
  });

  it('supports controlled hard close and reopen without deleting history', async () => {
    const created = await createYear();
    const original = created.fiscalYear!.periods[0]!;
    let decision = await service.transitionPeriod(
      transition(original.periodReference, 'OPEN', original.recordVersion),
    );
    decision = await service.transitionPeriod(
      transition(original.periodReference, 'SOFT_CLOSED', decision.recordVersion),
    );
    decision = await service.transitionPeriod(
      transition(original.periodReference, 'HARD_CLOSED', decision.recordVersion),
    );
    expect(decision.resultingState).toBe('HARD_CLOSED');
    const reopened = await service.transitionPeriod(
      transition(original.periodReference, 'REOPENED', decision.recordVersion),
    );
    expect(reopened.resultingState).toBe('REOPENED');
    expect(database.periods.rows).toHaveLength(12);
    expect(database.periods.rows[0]!.hardClosedAt).not.toBeNull();
    expect(database.periods.rows[0]!.reopenedAt).not.toBeNull();
  });

  it('exposes a read-only admission consumer port and never injects Ledger or B1 services', async () => {
    const created = await createYear();
    const period = created.fiscalYear!.periods[0]!;
    await service.transitionPeriod(
      transition(period.periodReference, 'OPEN', period.recordVersion),
    );
    const ports = service.getConsumerPorts();
    const admission = await ports.checkAdmission({
      periodKey: period.periodKey,
      accountingDate: '2027-01-15',
      admissionKind: 'ORDINARY',
      expectedBookKey: B2F_BOOK_KEY,
      expectedBookVersion: 1,
      expectedLegalEntityReference: B2F_LEGAL_ENTITY_REFERENCE,
      expectedCurrency: B2F_FUNCTIONAL_CURRENCY,
      expectedAccountingUnit: B2F_ACCOUNTING_UNIT,
      evaluatedAt: '2027-01-15T00:00:00.000Z',
    });
    expect(admission).toMatchObject({ outcome: 'ADMISSIBLE', readOnly: true });
    expect(Object.keys(service)).not.toContain('ledgerService');
    expect(Object.keys(service)).not.toContain('b1CommercialService');
  });
});
