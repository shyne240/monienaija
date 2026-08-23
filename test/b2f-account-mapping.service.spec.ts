import { randomUUID } from 'node:crypto';
import { ConflictException } from '@nestjs/common';
import type { DataSource, EntityManager } from 'typeorm';
import { LedgerAccountType, LedgerNormalBalance } from '../src/ledger/ledger.enums';
import type { B2FFinanceAccountMapping } from '../src/policy/b2f-account-mapping.entity';
import { B2FAccountMappingService } from '../src/policy/b2f-account-mapping.service';
import type {
  B2FAccountMappingCreateCommandV1,
  B2FAccountMappingLifecycleCommandV1,
} from '../src/policy/b2f-account-mapping.types';

class Repo {
  rows: B2FFinanceAccountMapping[] = [];
  create(v: Partial<B2FFinanceAccountMapping>) {
    return v as B2FFinanceAccountMapping;
  }
  async save(v: B2FFinanceAccountMapping) {
    await Promise.resolve();
    if (!v.id) v.id = randomUUID();
    const i = this.rows.findIndex((r) => r.id === v.id);
    if (i >= 0) {
      v.recordVersion++;
      this.rows[i] = v;
    } else this.rows.push(v);
    return v;
  }
  async findOne(o: { where: Record<string, unknown> }) {
    await Promise.resolve();
    return (
      this.rows.find((r) =>
        Object.entries(o.where).every(
          ([k, v]) => (r as unknown as Record<string, unknown>)[k] === v,
        ),
      ) ?? null
    );
  }
  async find(o: { where: Record<string, unknown> }) {
    await Promise.resolve();
    return this.rows.filter((r) =>
      Object.entries(o.where).every(([k, v]) => (r as unknown as Record<string, unknown>)[k] === v),
    );
  }
  createQueryBuilder() {
    let params: Record<string, unknown> = {};
    const q = {
      where: (_s: string, p: Record<string, unknown>) => {
        params = { ...params, ...p };
        return q;
      },
      andWhere: (_s: string, p: Record<string, unknown>) => {
        params = { ...params, ...p };
        return q;
      },
      setLock: (mode: string) => {
        void mode;
        return q;
      },
      getOne: async () => {
        await Promise.resolve();
        if (params.reference)
          return (
            this.rows.find(
              (r) => r.mappingReference === params.reference && r.mappingVersion === params.version,
            ) ?? null
          );
        if (params.accountId)
          return (
            this.rows.find(
              (r) =>
                r.bookKey === params.book &&
                r.a5LedgerAccountId === params.accountId &&
                r.status === 'ACTIVE' &&
                r.id !== params.id,
            ) ?? null
          );
        return null;
      },
    };
    return q;
  }
}
class Idem {
  m = new Map<
    string,
    { id: string; requestHash: string; responseBody: Record<string, unknown> | null }
  >();
  async reserve(_m: EntityManager, c: { scope: string; key: string; requestHash: string }) {
    await Promise.resolve();
    const k = c.scope + c.key,
      e = this.m.get(k);
    if (e) {
      if (e.requestHash !== c.requestHash) throw new ConflictException();
      return { kind: 'REPLAY' as const, record: e };
    }
    const r = { id: randomUUID(), requestHash: c.requestHash, responseBody: null };
    this.m.set(k, r);
    return { kind: 'NEW' as const, record: r };
  }
  async complete(_m: EntityManager, id: string, c: { responseBody: Record<string, unknown> }) {
    await Promise.resolve();
    [...this.m.values()].find((v) => v.id === id)!.responseBody = c.responseBody;
  }
  async fail(m: EntityManager, id: string, c: { responseBody: Record<string, unknown> }) {
    return this.complete(m, id, c);
  }
}
const assetId = '00000000-0000-4000-8000-000000000201',
  liabilityId = '00000000-0000-4000-8000-000000000203';
const principal = {
    type: 'PRIVILEGED' as const,
    principalId: 'checker',
    roles: ['FINANCE_CONTROLLER'],
    scopes: ['privileged:execute'],
    customerAccess: 'NONE' as const,
    assuranceLevel: 'MFA' as const,
  },
  ctx = { requestId: randomUUID(), correlationId: randomUUID(), traceId: randomUUID() };
const create = (
  overrides: Partial<B2FAccountMappingCreateCommandV1> = {},
): B2FAccountMappingCreateCommandV1 => ({
  mappingVersion: 1,
  classificationKey: 'finance.asset.settlement',
  classificationVersion: 1,
  a5LedgerAccountId: assetId,
  effectiveFrom: '2027-01-01T00:00:00.000Z',
  idempotencyKey: randomUUID(),
  principal: { ...principal, principalId: 'maker', roles: ['FINANCE_PREPARER'] },
  requestContext: ctx,
  ...overrides,
});
describe('B2F account mapping service prerequisite', () => {
  let repo: Repo,
    service: B2FAccountMappingService,
    accounts: Record<
      string,
      {
        id: string;
        code: string;
        name: string;
        accountType: LedgerAccountType;
        normalBalance: LedgerNormalBalance;
        currency: string;
        accountingUnit: string;
        isActive: boolean;
        allowNegativeBalance: boolean;
      }
    >,
    control: boolean,
    approval: boolean,
    audits: string[],
    events: string[];
  beforeEach(() => {
    repo = new Repo();
    control = true;
    approval = true;
    audits = [];
    events = [];
    accounts = {
      [assetId]: {
        id: assetId,
        code: 'PAYMENT-SETTLEMENT_ASSET-NGN',
        name: 'Settlement asset',
        accountType: LedgerAccountType.ASSET,
        normalBalance: LedgerNormalBalance.DEBIT,
        currency: 'NGN',
        accountingUnit: 'CUSTOMER_FUNDS',
        isActive: true,
        allowNegativeBalance: false,
      },
      [liabilityId]: {
        id: liabilityId,
        code: 'PAYMENT-SYSTEM_SUSPENSE-NGN',
        name: 'System suspense',
        accountType: LedgerAccountType.LIABILITY,
        normalBalance: LedgerNormalBalance.CREDIT,
        currency: 'NGN',
        accountingUnit: 'CUSTOMER_FUNDS',
        isActive: true,
        allowNegativeBalance: true,
      },
    };
    const manager = { getRepository: () => repo } as unknown as EntityManager,
      ds = {
        transaction: async (_i: string, cb: (m: EntityManager) => Promise<unknown>) => cb(manager),
        getRepository: () => repo,
      } as unknown as DataSource;
    service = new B2FAccountMappingService(
      ds,
      {
        getAccount: async (id: string) => {
          await Promise.resolve();
          const a = accounts[id];
          if (!a) throw new Error('not found');
          return { ...a, createdAt: new Date(), updatedAt: new Date() };
        },
      } as never,
      new Idem() as never,
      {
        record: async (_m: EntityManager, c: { action: string }) => {
          await Promise.resolve();
          audits.push(c.action);
        },
      } as never,
      {
        enqueueOnce: async (_m: EntityManager, c: { eventType: string }) => {
          await Promise.resolve();
          events.push(c.eventType);
          return {};
        },
      } as never,
      { increment: async () => Promise.resolve() } as never,
      {
        consumeInTransaction: async (
          _manager: unknown,
          input: { approvalId: string; resource: { id?: string } },
        ) => {
          void _manager;
          await Promise.resolve();
          return approval
            ? {
                approved: true,
                reason: 'CONSUMED',
                approval: {
                  id: input.approvalId,
                  requesterPrincipalId: 'maker',
                  approvedBy: 'checker',
                  resourceType: 'B2F_FINANCE_ACCOUNT_MAPPING',
                  resourceId: input.resource.id ?? null,
                  status: 'CONSUMED',
                  policy: { requiredRoles: ['FINANCE_PREPARER'] },
                },
              }
            : { approved: false, reason: 'RESOURCE_MISMATCH' };
        },
      } as never,
      {
        evaluateInTransaction: async (_manager: unknown) => {
          void _manager;
          await Promise.resolve();
          return {
            outcome: control ? 'ALLOW' : 'DENY',
            decisionReference: 'control-1',
            reasons: control ? [] : ['DENIED'],
          };
        },
      } as never,
    );
  });
  const lifecycle = (
    m: { mappingReference: string; mappingVersion: number; recordVersion: number },
    overrides: Partial<B2FAccountMappingLifecycleCommandV1> = {},
  ): B2FAccountMappingLifecycleCommandV1 => ({
    mappingReference: m.mappingReference,
    mappingVersion: m.mappingVersion,
    expectedRecordVersion: m.recordVersion,
    idempotencyKey: randomUUID(),
    principal,
    requestContext: ctx,
    reason: 'approved mapping lifecycle',
    approvalId: randomUUID(),
    ...overrides,
  });
  async function pending(command = create()) {
    const c = await service.create(command),
      s = await service.submitForApproval(lifecycle(c.mapping!));
    return s.mapping!;
  }
  it('exposes the frozen contract identity through read-only ports', () => {
    expect(service.getConsumerPorts()).toMatchObject({
      contractName: 'B2F-ACCOUNT-MAPPING',
      contractVersion: 1,
    });
  });
  it('creates a deterministic draft after canonical A5 verification', async () => {
    const r = await service.create(create());
    expect(r.mapping).toMatchObject({
      status: 'DRAFT',
      a5LedgerAccountId: assetId,
      observedA5AccountType: 'ASSET',
      classificationKey: 'finance.asset.settlement',
    });
    expect(r.mapping?.mappingReference).toMatch(/^b2f-account-map-/);
    expect(audits).toContain('FINANCE_ACCOUNT_MAPPING_CREATED');
    expect(events).toContain('B2FFinanceAccountMappingCreated');
  });
  it('rejects missing A5 account', async () => {
    expect((await service.create(create({ a5LedgerAccountId: randomUUID() }))).failure?.code).toBe(
      'A5_ACCOUNT_NOT_FOUND',
    );
  });
  it('rejects type and normal-balance incompatibility', async () => {
    expect(
      (await service.create(create({ classificationKey: 'finance.liability.customer-funds' })))
        .failure?.code,
    ).toBe('A5_TYPE_INCOMPATIBLE');
    accounts[assetId]!.normalBalance = LedgerNormalBalance.CREDIT;
    expect((await service.create(create({ idempotencyKey: randomUUID() }))).failure?.code).toBe(
      'A5_NORMAL_BALANCE_INCOMPATIBLE',
    );
  });
  it('rejects inactive and dimensionally incompatible A5 account', async () => {
    accounts[assetId]!.isActive = false;
    expect((await service.create(create())).failure?.code).toBe('A5_ACCOUNT_INACTIVE');
    accounts[assetId]!.isActive = true;
    accounts[assetId]!.currency = 'USD';
    expect((await service.create(create({ idempotencyKey: randomUUID() }))).failure?.code).toBe(
      'A5_DIMENSION_INCOMPATIBLE',
    );
  });
  it('computes deterministic semantic hashes excluding timestamps and references', () => {
    const c = create({ idempotencyKey: 'same' });
    expect(service.computeCreateHash({ ...c, now: new Date('2026-01-01') })).toBe(
      service.computeCreateHash({ ...c, now: new Date('2028-01-01') }),
    );
  });
  it('replays same request and conflicts changed payload', async () => {
    const c = create(),
      a = await service.create(c),
      b = await service.create(c);
    expect(b.outcome).toBe('REPLAYED');
    expect(b.mapping?.mappingReference).toBe(a.mapping?.mappingReference);
    await expect(
      service.create({ ...c, effectiveFrom: '2028-01-01T00:00:00Z' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
  it('requires A2 approval and B2F06 control before activation', async () => {
    const p = await pending();
    approval = false;
    expect((await service.activate(lifecycle(p))).failure?.code).toBe('APPROVAL_REJECTED');
    approval = true;
    control = false;
    expect(
      (await service.activate(lifecycle(p, { idempotencyKey: randomUUID() }))).failure?.code,
    ).toBe('FINANCE_CONTROL_DENIED');
  });
  it('activates an approved compatible mapping and preserves provenance', async () => {
    const p = await pending(),
      r = await service.activate(lifecycle(p));
    expect(r.mapping).toMatchObject({
      status: 'ACTIVE',
      controlDecisionReference: 'control-1',
      approvedBy: 'checker',
    });
    expect(events.some((e) => e.includes('Active'))).toBe(true);
  });
  it('prevents duplicate active mapping for the same canonical A5 account', async () => {
    const first = await pending(),
      active = await service.activate(lifecycle(first));
    expect(active.mapping?.status).toBe('ACTIVE');
    const second = await pending(
      create({
        mappingVersion: 2,
        idempotencyKey: randomUUID(),
        effectiveFrom: '2027-02-01T00:00:00Z',
      }),
    );
    expect((await service.activate(lifecycle(second))).failure?.code).toBe(
      'OVERLAPPING_ACTIVE_MAPPING',
    );
  });
  it('expires only an active mapping after its effective end', async () => {
    const p = await pending(create({ effectiveTo: '2027-02-01T00:00:00Z' })),
      a = await service.activate(lifecycle(p));
    const e = await service.expire(
      a.mapping!.mappingReference,
      1,
      new Date('2027-02-01T00:00:00Z'),
    );
    expect(e.mapping?.status).toBe('EXPIRED');
  });
  it('revokes through A2/B2F06 and keeps historical versions queryable', async () => {
    const p = await pending(),
      a = await service.activate(lifecycle(p)),
      r = await service.revoke(lifecycle(a.mapping!));
    expect(r.mapping?.status).toBe('REVOKED');
    const history = await service.listByClassification(
      'finance.book.ng.primary',
      'finance.asset.settlement',
    );
    expect(history).toHaveLength(1);
    expect(history[0]?.status).toBe('REVOKED');
  });
  it('rejects mapping verification when inactive, ineffective, mismatched, or drifted', async () => {
    const p = await pending();
    expect(
      (
        await service.verify({
          mappingReference: p.mappingReference,
          mappingVersion: 1,
          bookKey: 'finance.book.ng.primary',
          classificationKey: p.classificationKey,
          a5LedgerAccountId: p.a5LedgerAccountId,
          accountingDate: '2027-01-10',
        })
      ).reasons,
    ).toContain('MAPPING_NOT_ACTIVE');
    const a = await service.activate(lifecycle(p));
    accounts[assetId]!.name = 'drifted';
    expect(
      (
        await service.verify({
          mappingReference: a.mapping!.mappingReference,
          mappingVersion: 1,
          bookKey: 'finance.book.ng.primary',
          classificationKey: a.mapping!.classificationKey,
          a5LedgerAccountId: assetId,
          accountingDate: '2027-01-10',
        })
      ).reasons,
    ).toContain('A5_ACCOUNT_METADATA_DRIFT');
  });
  it('supports one classification aggregating multiple distinct A5 accounts', async () => {
    const other = randomUUID();
    accounts[other] = { ...accounts[assetId]!, id: other, code: 'OTHER-ASSET' };
    expect((await service.create(create())).outcome).toBe('CREATED');
    expect(
      (await service.create(create({ a5LedgerAccountId: other, idempotencyKey: randomUUID() })))
        .outcome,
    ).toBe('CREATED');
  });
  it('does not create A5 accounts, balances, journals, or public APIs', () => {
    expect(Object.keys(service)).not.toEqual(
      expect.arrayContaining(['createAccount', 'postJournal', 'balanceRepository', 'controller']),
    );
  });
});
