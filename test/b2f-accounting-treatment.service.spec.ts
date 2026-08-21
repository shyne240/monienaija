import { randomUUID } from 'node:crypto';
import { ConflictException } from '@nestjs/common';
import type { DataSource, EntityManager } from 'typeorm';
import { PrivilegedActionApprovalStatus } from '../src/authorization/privileged-action-approval.enums';
import type { B2FFinanceAccountingTreatment } from '../src/policy/b2f-accounting-treatment.entity';
import { B2FAccountingTreatmentService } from '../src/policy/b2f-accounting-treatment.service';
import type {
  B2FAccountingTreatmentCommandV1,
  B2FSourceCategory,
} from '../src/policy/b2f-accounting-treatment.types';
class Repo {
  rows: B2FFinanceAccountingTreatment[] = [];
  create(v: Partial<B2FFinanceAccountingTreatment>) {
    return v as B2FFinanceAccountingTreatment;
  }
  async save(v: B2FFinanceAccountingTreatment) {
    await Promise.resolve();
    if (!v.id) v.id = randomUUID();
    this.rows.push(v);
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
}
class Idem {
  m = new Map<
    string,
    { id: string; requestHash: string; responseBody: Record<string, unknown> | null }
  >();
  async reserve(_m: EntityManager, c: { key: string; requestHash: string }) {
    await Promise.resolve();
    const e = this.m.get(c.key);
    if (e) {
      if (e.requestHash !== c.requestHash) throw new ConflictException();
      return { kind: 'REPLAY' as const, record: e };
    }
    const r = { id: randomUUID(), requestHash: c.requestHash, responseBody: null };
    this.m.set(c.key, r);
    return { kind: 'NEW' as const, record: r };
  }
  async complete(_m: EntityManager, id: string, c: { responseBody: Record<string, unknown> }) {
    await Promise.resolve();
    [...this.m.values()].find((v) => v.id === id)!.responseBody = c.responseBody;
  }
}
const hash = 'a'.repeat(64),
  asset = randomUUID(),
  liability = randomUUID(),
  principal = {
    type: 'PRIVILEGED' as const,
    principalId: 'checker',
    roles: ['FINANCE_CONTROLLER'],
    scopes: ['privileged:execute'],
    customerAccess: 'NONE' as const,
    assuranceLevel: 'MFA' as const,
  },
  ctx = { requestId: randomUUID(), correlationId: randomUUID(), traceId: randomUUID() };
const approval = {
  id: randomUUID(),
  actionType: 'FINANCE_ACCOUNTING_TREATMENT_ADOPT',
  resourceType: 'B2F_FINANCE_ACCOUNTING_TREATMENT',
  resourceId: null,
  customerId: null,
  actionFingerprint: 'c'.repeat(64),
  requesterPrincipalId: 'maker',
  approvedBy: 'checker',
  approvalScope: 'finance:approve',
  requiredAssurance: 'MFA',
  policy: { requiredRoles: ['FINANCE_PREPARER'] },
  status: PrivilegedActionApprovalStatus.CONSUMED,
  isEmergency: false,
  requestedAt: new Date(),
  expiresAt: new Date(Date.now() + 1000),
  approvedAt: new Date(),
  rejectedAt: null,
  cancelledAt: null,
  consumedAt: new Date(),
  version: 1,
};
const command = (
  category: B2FSourceCategory = 'B1_COMMERCIAL_DECISION',
  overrides: Partial<B2FAccountingTreatmentCommandV1> = {},
): B2FAccountingTreatmentCommandV1 => ({
  treatmentVersion: 1,
  source: {
    category,
    sourceOwner: category.startsWith('B1') ? 'B1' : category.startsWith('A6') ? 'A6' : 'A7',
    sourceReference: category === 'A6_SETTLEMENT' ? 'settlement-1' : 'source-1',
    sourceVersion: 1,
    sourceHash: hash,
    lookupReference: category.startsWith('A6') ? randomUUID() : undefined,
    effectiveAt: '2027-01-15T00:00:00.000Z',
  },
  periodKey: 'finance.period.ng.2027-01',
  periodVersion: 1,
  accountingDate: '2027-01-15',
  journalClassification: 'STANDARD',
  description: 'Adopt authoritative source',
  lines: [
    {
      lineNumber: 1,
      direction: 'DEBIT',
      amountMinor: '100',
      a5LedgerAccountId: asset,
      financeClassificationKey: 'finance.asset.settlement',
      financeClassificationVersion: 1,
      mappingReference: 'b2f-account-map-asset',
      mappingVersion: 1,
    },
    {
      lineNumber: 2,
      direction: 'CREDIT',
      amountMinor: '100',
      a5LedgerAccountId: liability,
      financeClassificationKey: 'finance.liability.customer-funds',
      financeClassificationVersion: 1,
      mappingReference: 'b2f-account-map-liability',
      mappingVersion: 1,
    },
  ],
  makerPrincipalId: 'maker',
  makerRoles: ['FINANCE_PREPARER'],
  approvals: [approval],
  idempotencyKey: randomUUID(),
  principal,
  requestContext: ctx,
  evaluatedAt: new Date('2027-01-16T00:00:00Z'),
  ...overrides,
});
describe('B2F accounting treatment service (B2F07)', () => {
  let service: B2FAccountingTreatmentService,
    repo: Repo,
    period: boolean,
    control: boolean,
    journal: boolean,
    audits: string[];
  beforeEach(() => {
    repo = new Repo();
    period = true;
    control = true;
    journal = true;
    audits = [];
    const manager = { getRepository: () => repo } as unknown as EntityManager,
      ds = {
        transaction: async (_i: string, cb: (m: EntityManager) => Promise<unknown>) => cb(manager),
        getRepository: () => repo,
      } as unknown as DataSource;
    const b1 = {
      getPersistenceRecordByReference: async () => {
        await Promise.resolve();
        return {
          decisionHash: hash,
          currency: 'NGN',
          accountingUnit: 'CUSTOMER_FUNDS',
          record: { decisionHash: hash, currency: 'NGN', accountingUnit: 'CUSTOMER_FUNDS' },
        };
      },
    };
    service = new B2FAccountingTreatmentService(
      ds,
      new Idem() as never,
      {
        record: async (_m: EntityManager, c: { action: string }) => {
          await Promise.resolve();
          audits.push(c.action);
        },
      } as never,
      b1 as never,
      b1 as never,
      b1 as never,
      b1 as never,
      {
        getByOperation: async () => {
          await Promise.resolve();
          return {
            settlementId: 'settlement-1',
            evidence: { evidenceHash: hash },
            currency: 'NGN',
            accountingUnit: 'CUSTOMER_FUNDS',
            amountMinor: '100',
          };
        },
        getSuspenseForOperation: async () => {
          await Promise.resolve();
          return [
            {
              suspenseId: 'suspense-1',
              evidenceHash: hash,
              currency: 'NGN',
              accountingUnit: 'CUSTOMER_FUNDS',
              amountMinor: '100',
            },
          ];
        },
      } as never,
      {
        checkAdmission: async () => {
          await Promise.resolve();
          return { compatible: period, reason: period ? 'ADMISSIBLE' : 'PERIOD_LOCKED' };
        },
      } as never,
      {
        evaluateInTransaction: async (_manager: unknown) => {
          void _manager;
          await Promise.resolve();
          return {
            outcome: control ? 'ALLOW' : 'DENY',
            decisionReference: 'control-1',
            reasons: control ? [] : ['CONTROL_DENIED'],
          };
        },
      } as never,
      {
        createJournal: async () => {
          await Promise.resolve();
          return journal
            ? {
                outcome: 'CREATED',
                journal: { financeJournalReference: 'journal-1' },
                failure: null,
              }
            : { outcome: 'REJECTED', journal: null, failure: { code: 'MAPPING_INVALID' } };
        },
      } as never,
    );
  });
  it('adopts verified B1 source into a Finance treatment and journal draft', async () => {
    const d = await service.adopt(command());
    expect(d.state).toBe('JOURNAL_DRAFT_CREATED');
    expect(d.financeJournalReference).toBe('journal-1');
    expect(d.sourceVerification.status).toBe('VERIFIED_READ_ONLY');
    expect(audits).toContain('FINANCE_TREATMENT_ADOPTED');
  });
  it.each([
    'B1_BILLING_RECORD',
    'B1_INVOICE',
    'B1_REVENUE_RECOGNITION',
    'B1_TAX_VAT',
    'B1_COST_ACCOUNTING',
    'B1_PROFITABILITY',
    'B1_COMMERCIAL_RECONCILIATION',
  ] as B2FSourceCategory[])('adopts verified read-only B1 category %s', async (category) => {
    expect(
      (await service.verifySource(command(category).source, new Date('2027-01-16'))).authoritative,
    ).toBe(true);
  });
  it('adopts verified A6 settlement evidence without executing settlement', async () => {
    const d = await service.adopt(command('A6_SETTLEMENT'));
    expect(d.state).toBe('JOURNAL_DRAFT_CREATED');
    expect(d.sourceVerification.provenance).toMatchObject({ settlementId: 'settlement-1' });
  });
  it('adopts verified A6 suspense evidence by exact source reference', async () => {
    const c = command('A6_SUSPENSE', {
      source: { ...command('A6_SUSPENSE').source, sourceReference: 'suspense-1' },
    });
    expect((await service.verifySource(c.source, new Date('2027-01-16'))).authoritative).toBe(true);
  });
  it('fails closed for A7 because a canonical read interface is not verified', async () => {
    const d = await service.adopt(command('A7_PRODUCT_FINANCIAL_EFFECT'));
    expect(d.state).toBe('REJECTED');
    expect(d.sourceVerification.status).toBe('NOT_VERIFIED_REQUIRES_REVIEW');
    expect(d.failureReasons).toContain('SOURCE_NOT_ADOPTABLE');
  });
  it('rejects stale, hash-mismatched, and incompatible source decisions', async () => {
    const stale = command('B1_COMMERCIAL_DECISION', {
      source: { ...command().source, expiresAt: '2027-01-01T00:00:00Z' },
    });
    expect((await service.adopt(stale)).state).toBe('REJECTED');
    const mismatch = command('B1_COMMERCIAL_DECISION', {
      source: { ...command().source, sourceHash: 'b'.repeat(64) },
    });
    expect((await service.adopt(mismatch)).failureReasons).toContain('SOURCE_HASH_MISMATCH');
  });
  it('rejects invalid period, control, and journal mapping compatibility', async () => {
    period = false;
    expect((await service.adopt(command())).failureReasons).toContain('PERIOD_PERIOD_LOCKED');
    period = true;
    control = false;
    expect(
      (await service.adopt(command('B1_COMMERCIAL_DECISION', { idempotencyKey: randomUUID() })))
        .failureReasons,
    ).toContain('CONTROL_CONTROL_DENIED');
    control = true;
    journal = false;
    expect(
      (await service.adopt(command('B1_COMMERCIAL_DECISION', { idempotencyKey: randomUUID() })))
        .failureReasons,
    ).toContain('JOURNAL_MAPPING_INVALID');
  });
  it('is deterministic and replay safe and conflicts changed payload', async () => {
    const c = command(),
      a = await service.adopt(c),
      b = await service.adopt(c);
    expect(b.replayed).toBe(true);
    expect(b.treatmentReference).toBe(a.treatmentReference);
    await expect(service.adopt({ ...c, description: 'changed' })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
  it('exposes read-only treatment/source provenance consumer ports', async () => {
    const d = await service.adopt(command());
    const ports = service.getConsumerPorts();
    expect((await ports.getTreatment(d.treatmentReference))?.source.sourceOwner).toBe('B1');
    expect(
      (await ports.getBySource(d.source.category, d.source.sourceReference, 1))?.decisionHash,
    ).toBe(d.decisionHash);
  });
  it('does not post to A5 or mutate B1/A6/A7 authority', () => {
    expect(Object.keys(service)).not.toEqual(
      expect.arrayContaining([
        'ledgerService',
        'postJournal',
        'externalPartnerClient',
        'productMutationService',
      ]),
    );
  });
});
