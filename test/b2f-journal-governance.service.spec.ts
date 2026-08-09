import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException } from '@nestjs/common';
import type { DataSource, EntityManager } from 'typeorm';
import { LedgerAccountType, LedgerNormalBalance } from '../src/ledger/ledger.enums';
import type { B2FFinanceJournalGovernance } from '../src/policy/b2f-finance-journal.entity';
import { B2FJournalGovernanceService } from '../src/policy/b2f-journal-governance.service';
import type {
  B2FFinanceJournalCreateCommandV1,
  B2FFinanceJournalLifecycleCommandV1,
} from '../src/policy/b2f-journal-governance.types';

class Repo {
  rows: B2FFinanceJournalGovernance[] = [];
  lock = false;
  create(value: Partial<B2FFinanceJournalGovernance>) {
    return value as B2FFinanceJournalGovernance;
  }
  async save(value: B2FFinanceJournalGovernance) {
    await Promise.resolve();
    if (!value.id) value.id = randomUUID();
    const i = this.rows.findIndex((r) => r.id === value.id);
    if (i >= 0) {
      value.recordVersion += 1;
      this.rows[i] = value;
    } else this.rows.push(value);
    return value;
  }
  async findOne(input: { where: { financeJournalReference: string } }) {
    await Promise.resolve();
    return (
      this.rows.find((r) => r.financeJournalReference === input.where.financeJournalReference) ??
      null
    );
  }
  createQueryBuilder() {
    let ref = '';
    const q = {
      where: (_s: string, v: { reference: string }) => {
        ref = v.reference;
        return q;
      },
      setLock: (mode: string) => {
        void mode;
        this.lock = true;
        return q;
      },
      getOne: async () => {
        await Promise.resolve();
        return this.rows.find((r) => r.financeJournalReference === ref) ?? null;
      },
    };
    return q;
  }
}
class Idem {
  map = new Map<
    string,
    { id: string; requestHash: string; responseBody: Record<string, unknown> | null }
  >();
  async reserve(_m: EntityManager, c: { scope: string; key: string; requestHash: string }) {
    await Promise.resolve();
    const k = `${c.scope}:${c.key}`,
      e = this.map.get(k);
    if (e) {
      if (e.requestHash !== c.requestHash) throw new ConflictException();
      return { kind: 'REPLAY' as const, record: e };
    }
    const r = { id: randomUUID(), requestHash: c.requestHash, responseBody: null };
    this.map.set(k, r);
    return { kind: 'NEW' as const, record: r };
  }
  async complete(_m: EntityManager, id: string, c: { responseBody: Record<string, unknown> }) {
    await Promise.resolve();
    [...this.map.values()].find((r) => r.id === id)!.responseBody = c.responseBody;
  }
  async fail(m: EntityManager, id: string, c: { responseBody: Record<string, unknown> }) {
    return this.complete(m, id, c);
  }
}
const assetId = '00000000-0000-4000-8000-000000000201',
  liabilityId = '00000000-0000-4000-8000-000000000299';
const principal = {
  type: 'PRIVILEGED' as const,
  principalId: 'finance-executor',
  roles: ['FINANCE'],
  scopes: ['privileged:execute'],
  customerAccess: 'NONE' as const,
  assuranceLevel: 'MFA' as const,
};
const context = { requestId: randomUUID(), correlationId: randomUUID(), traceId: randomUUID() };
const command = (
  overrides: Partial<B2FFinanceJournalCreateCommandV1> = {},
): B2FFinanceJournalCreateCommandV1 => ({
  classification: 'STANDARD',
  periodKey: 'finance.period.ng.2027-01',
  periodVersion: 1,
  accountingDate: '2027-01-15',
  description: 'Recognize approved source',
  sourceDocument: {
    sourceKind: 'B1_FEE',
    sourceOwner: 'B1',
    sourceReference: 'b1-fee-1',
    sourceVersion: 1,
    sourceHash: 'a'.repeat(64),
    sourceOccurredAt: '2027-01-15T00:00:00.000Z',
  },
  lines: [
    {
      lineNumber: 1,
      direction: 'DEBIT',
      amountMinor: '100',
      a5LedgerAccountId: assetId,
      financeClassificationKey: 'finance.asset.settlement',
      financeClassificationVersion: 1,
      mappingReference: 'b2f-account-map-asset',
      mappingVersion: 1,
    },
    {
      lineNumber: 2,
      direction: 'CREDIT',
      amountMinor: '100',
      a5LedgerAccountId: liabilityId,
      financeClassificationKey: 'finance.liability.customer-funds',
      financeClassificationVersion: 1,
      mappingReference: 'b2f-account-map-liability',
      mappingVersion: 1,
    },
  ],
  idempotencyKey: randomUUID(),
  principal,
  requestContext: context,
  ...overrides,
});

describe('B2F journal governance service (B2F05)', () => {
  let repo: Repo,
    idem: Idem,
    audits: string[],
    outbox: string[],
    postMode: 'ok' | 'reject' | 'unknown',
    postCalls: number,
    approval: boolean,
    period: boolean,
    service: B2FJournalGovernanceService;
  beforeEach(() => {
    repo = new Repo();
    idem = new Idem();
    audits = [];
    outbox = [];
    postMode = 'ok';
    postCalls = 0;
    approval = true;
    period = true;
    const manager = { getRepository: () => repo } as unknown as EntityManager;
    const ds = {
      transaction: async (_i: string, cb: (m: EntityManager) => Promise<unknown>) => cb(manager),
      getRepository: () => repo,
    } as unknown as DataSource;
    const ledger = {
      getAccount: async (id: string) => {
        await Promise.resolve();
        if (![assetId, liabilityId].includes(id)) throw new BadRequestException('not found');
        const asset = id === assetId;
        return {
          id,
          code: 'x',
          name: 'x',
          accountType: asset ? LedgerAccountType.ASSET : LedgerAccountType.LIABILITY,
          normalBalance: asset ? LedgerNormalBalance.DEBIT : LedgerNormalBalance.CREDIT,
          currency: 'NGN',
          accountingUnit: 'CUSTOMER_FUNDS',
          allowNegativeBalance: false,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
      },
      postJournal: async () => {
        await Promise.resolve();
        postCalls++;
        if (postMode === 'reject') throw new BadRequestException('A5 rejected');
        if (postMode === 'unknown') throw new Error('timeout');
        return { id: randomUUID(), postedAt: new Date('2027-01-15T01:00:00Z'), lines: [] };
      },
    };
    service = new B2FJournalGovernanceService(
      ds,
      ledger as never,
      {
        checkAdmission: async () => {
          await Promise.resolve();
          return { compatible: period, reason: period ? 'ADMISSIBLE' : 'PERIOD_LOCKED' };
        },
      } as never,
      idem as never,
      {
        record: async (_m: EntityManager, c: { action: string }) => {
          await Promise.resolve();
          audits.push(c.action);
        },
      } as never,
      {
        enqueue: async (_m: EntityManager, c: { eventType: string }) => {
          await Promise.resolve();
          outbox.push(c.eventType);
        },
      } as never,
      {
        consume: async () => {
          await Promise.resolve();
          return { approved: approval, reason: approval ? 'CONSUMED' : 'NOT_FOUND' };
        },
      } as never,
    );
  });
  const lifecycle = (
    reference: string,
    version: number,
    overrides: Partial<B2FFinanceJournalLifecycleCommandV1> = {},
  ): B2FFinanceJournalLifecycleCommandV1 => ({
    financeJournalReference: reference,
    expectedRecordVersion: version,
    idempotencyKey: randomUUID(),
    principal,
    requestContext: context,
    reason: 'approved finance journal',
    ...overrides,
  });
  async function pending() {
    const created = await service.createJournal(command());
    const draft = created.journal!;
    const submitted = await service.submitForApproval(
      lifecycle(draft.financeJournalReference, draft.recordVersion),
    );
    return submitted.journal!;
  }
  it('accepts a balanced, mapped, open-period journal and preserves provenance', async () => {
    const result = await service.createJournal(command());
    expect(result.outcome).toBe('CREATED');
    expect(result.journal).toMatchObject({
      state: 'DRAFT',
      totalDebitMinor: '100',
      totalCreditMinor: '100',
      a5JournalId: null,
    });
    expect(result.journal?.sourceDocument.sourceReference).toBe('b1-fee-1');
  });
  it('rejects unbalanced and zero-value journals', async () => {
    const bad = command({
      lines: [...command().lines.slice(0, 1), { ...command().lines[1]!, amountMinor: '99' }],
    });
    expect((await service.compatibilityCheck(bad)).failure?.code).toBe('JOURNAL_UNBALANCED');
    const zero = command({
      lines: [{ ...command().lines[0]!, amountMinor: '0' }, command().lines[1]!],
    });
    expect((await service.compatibilityCheck(zero)).compatible).toBe(false);
  });
  it('rejects invalid accounts, mappings, source, and period', async () => {
    expect(
      (
        await service.compatibilityCheck(
          command({
            lines: [
              { ...command().lines[0]!, a5LedgerAccountId: randomUUID() },
              command().lines[1]!,
            ],
          }),
        )
      ).compatible,
    ).toBe(false);
    expect(
      (
        await service.compatibilityCheck(
          command({
            lines: [{ ...command().lines[0]!, mappingReference: 'bad' }, command().lines[1]!],
          }),
        )
      ).failure?.code,
    ).toBe('LINE_INVALID');
    expect(
      (
        await service.compatibilityCheck(
          command({ sourceDocument: { ...command().sourceDocument, sourceReference: '' } }),
        )
      ).failure?.code,
    ).toBe('SOURCE_DOCUMENT_INVALID');
    period = false;
    expect((await service.compatibilityCheck(command())).failure?.code).toBe(
      'PERIOD_NOT_ADMISSIBLE',
    );
  });
  it('rejects incompatible Finance classification mapping', async () => {
    const bad = command({
      lines: [
        { ...command().lines[0]!, financeClassificationKey: 'finance.liability.customer-funds' },
        command().lines[1]!,
      ],
    });
    expect((await service.compatibilityCheck(bad)).failure?.code).toBe('A5_MAPPING_INVALID');
  });
  it('replays identical creation and conflicts changed payload', async () => {
    const c = command(),
      first = await service.createJournal(c),
      replay = await service.createJournal(c);
    expect(replay.outcome).toBe('REPLAYED');
    expect(replay.journal?.financeJournalReference).toBe(first.journal?.financeJournalReference);
    await expect(service.createJournal({ ...c, description: 'changed' })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
  it('supports approval lifecycle and successful A5 posting exactly once', async () => {
    const journal = await pending();
    const posted = await service.postApprovedJournal(
      lifecycle(journal.financeJournalReference, journal.recordVersion, {
        approvalId: randomUUID(),
      }),
    );
    expect(posted.outcome).toBe('POSTED');
    expect(posted.journal?.a5JournalId).toBeTruthy();
    expect(postCalls).toBe(1);
    expect(audits).toEqual(
      expect.arrayContaining([
        'FINANCE_JOURNAL_APPROVED',
        'FINANCE_JOURNAL_POSTING_REQUESTED',
        'FINANCE_JOURNAL_POSTED',
      ]),
    );
    expect(outbox).toEqual(['B2FFinanceJournalPosted']);
  });
  it('does not post when approval is rejected', async () => {
    approval = false;
    const journal = await pending();
    const result = await service.postApprovedJournal(
      lifecycle(journal.financeJournalReference, journal.recordVersion, {
        approvalId: randomUUID(),
      }),
    );
    expect(result.outcome).toBe('REJECTED');
    expect(result.journal?.state).toBe('REJECTED');
    expect(postCalls).toBe(0);
  });
  it('records A5 rejection as FAILED and publishes no success event', async () => {
    postMode = 'reject';
    const journal = await pending();
    const result = await service.postApprovedJournal(
      lifecycle(journal.financeJournalReference, journal.recordVersion, {
        approvalId: randomUUID(),
      }),
    );
    expect(result.journal?.state).toBe('FAILED');
    expect(result.failure?.code).toBe('A5_REJECTED');
    expect(outbox).toHaveLength(0);
  });
  it('records timeout as POSTING_UNKNOWN and retries through the same A5 idempotency key', async () => {
    postMode = 'unknown';
    const journal = await pending();
    const unknown = await service.postApprovedJournal(
      lifecycle(journal.financeJournalReference, journal.recordVersion, {
        approvalId: randomUUID(),
      }),
    );
    expect(unknown.journal?.state).toBe('POSTING_UNKNOWN');
    const key = unknown.journal!.a5IdempotencyKey;
    postMode = 'ok';
    const retry = await service.postApprovedJournal(
      lifecycle(journal.financeJournalReference, unknown.journal!.recordVersion, {
        approvalId: unknown.journal!.approvalId!,
        idempotencyKey: randomUUID(),
      }),
    );
    expect(retry.outcome).toBe('POSTED');
    expect(retry.journal?.a5IdempotencyKey).toBe(key);
    expect(postCalls).toBe(2);
  });
  it('prevents stale concurrent posting and exposes read-only provenance/status ports', async () => {
    const journal = await pending();
    const posted = await service.postApprovedJournal(
      lifecycle(journal.financeJournalReference, journal.recordVersion, {
        approvalId: randomUUID(),
      }),
    );
    const stale = await service.postApprovedJournal(
      lifecycle(journal.financeJournalReference, journal.recordVersion, {
        approvalId: randomUUID(),
      }),
    );
    expect(stale.outcome).toBe('REJECTED');
    expect(postCalls).toBe(1);
    const ports = service.getConsumerPorts();
    expect((await ports.getPostingResult(journal.financeJournalReference))?.a5JournalId).toBe(
      posted.journal?.a5JournalId,
    );
    expect(
      (await ports.getProvenance(journal.financeJournalReference))?.sourceDocument.sourceOwner,
    ).toBe('B1');
    expect(repo.lock).toBe(true);
  });
  it('contains no B1, A6, Treasury, controller, or balance authority', () => {
    expect(Object.keys(service)).not.toEqual(
      expect.arrayContaining([
        'b1Service',
        'externalSettlementService',
        'treasuryService',
        'balanceRepository',
      ]),
    );
  });
});
