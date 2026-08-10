import { randomUUID } from 'node:crypto';
import { ConflictException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { B1BillingDocument } from '../src/policy/b1-billing-engine.entity';
import type { B1InvoiceV1 } from '../src/policy/b1-billing-engine.types';
import {
  B1DueDateAmendment,
  B1InvoicePaymentTermBinding,
  B1PaymentTerm,
} from '../src/policy/b1-payment-term.entity';
import { B1PaymentTermService } from '../src/policy/b1-payment-term.service';
import type {
  B1PaymentTermCreateCommandV1,
  B1PaymentTermLifecycleCommandV1,
} from '../src/policy/b1-payment-term.types';

class Repo<T extends { id: string }> {
  rows: T[] = [];
  create(v: Partial<T>) {
    return v as T;
  }
  async save(v: T) {
    const i = this.rows.findIndex((x) => x.id === v.id);
    if (i >= 0) {
      if ('recordVersion' in v) (v as T & { recordVersion: number }).recordVersion++;
      this.rows[i] = v;
    } else this.rows.push(v);
    return Promise.resolve(v);
  }
  async findOne(o: { where: Record<string, unknown> }) {
    return Promise.resolve(
      this.rows.find((r) =>
        Object.entries(o.where).every(([k, v]) => (r as Record<string, unknown>)[k] === v),
      ) ?? null,
    );
  }
  async find(o: { where?: Record<string, unknown>; order?: Record<string, string> }) {
    const rows = o.where
      ? this.rows.filter((r) =>
          Object.entries(o.where!).every(([k, v]) => (r as Record<string, unknown>)[k] === v),
        )
      : [...this.rows];
    if (o.order?.paymentTermVersion)
      rows.sort(
        (a, b) =>
          Number((a as Record<string, unknown>).paymentTermVersion) -
          Number((b as Record<string, unknown>).paymentTermVersion),
      );
    if (o.order?.sequence)
      rows.sort(
        (a, b) =>
          Number((a as Record<string, unknown>).sequence) -
          Number((b as Record<string, unknown>).sequence),
      );
    return Promise.resolve(rows);
  }
  createQueryBuilder() {
    let params: Record<string, unknown> = {},
      take = 0,
      descending = false;
    const q = {
      where: (_sql: string, p?: Record<string, unknown>) => {
        params = { ...params, ...p };
        return q;
      },
      andWhere: (_sql: string, p?: Record<string, unknown>) => {
        params = { ...params, ...p };
        return q;
      },
      setLock: (mode: string) => {
        void mode;
        return q;
      },
      orderBy: (_field: string, direction: string) => {
        descending = direction === 'DESC';
        return q;
      },
      take: (value: number) => {
        take = value;
        return q;
      },
      getOne: async () => {
        let rows = [...this.rows];
        if (params.reference !== undefined)
          rows = rows.filter(
            (r) =>
              ((r as Record<string, unknown>).paymentTermReference === params.reference &&
                (r as Record<string, unknown>).paymentTermVersion === params.version) ||
              (r as Record<string, unknown>).bindingReference === params.reference,
          );
        if (params.bindingReference !== undefined)
          rows = rows.filter(
            (r) =>
              (r as Record<string, unknown>).originalBindingReference === params.bindingReference,
          );
        if (descending) rows.reverse();
        return Promise.resolve(rows.slice(0, take || 1)[0] ?? null);
      },
      getMany: async () => {
        let rows = [...this.rows];
        if (params.at instanceof Date)
          rows = rows.filter(
            (r) =>
              (r as unknown as B1PaymentTerm).status === 'ACTIVE' &&
              (r as unknown as B1PaymentTerm).effectiveFrom <= params.at! &&
              (!(r as unknown as B1PaymentTerm).effectiveTo ||
                (r as unknown as B1PaymentTerm).effectiveTo! > params.at!),
          );
        if (params.id !== undefined)
          rows = rows.filter(
            (r) => r.id !== params.id && (r as unknown as B1PaymentTerm).status === 'ACTIVE',
          );
        return Promise.resolve(rows);
      },
    };
    return q;
  }
}
class Idem {
  records = new Map<
    string,
    { id: string; requestHash: string; responseBody: Record<string, unknown> | null }
  >();
  async reserve(_manager: EntityManager, c: { scope: string; key: string; requestHash: string }) {
    await Promise.resolve();
    const key = `${c.scope}:${c.key}`,
      old = this.records.get(key);
    if (old) {
      if (old.requestHash !== c.requestHash) throw new ConflictException('conflict');
      return { kind: 'REPLAY' as const, record: old };
    }
    const record = { id: randomUUID(), requestHash: c.requestHash, responseBody: null };
    this.records.set(key, record);
    return { kind: 'NEW' as const, record };
  }
  async complete(
    _manager: EntityManager,
    id: string,
    c: { responseBody: Record<string, unknown> },
  ) {
    [...this.records.values()].find((x) => x.id === id)!.responseBody = c.responseBody;
    return Promise.resolve();
  }
}
const principal = {
  type: 'PRIVILEGED' as const,
  principalId: 'operator',
  roles: [],
  scopes: ['privileged:execute'],
  customerAccess: 'NONE' as const,
  assuranceLevel: 'MFA' as const,
};
const context = { requestId: 'request', correlationId: 'correlation', traceId: 'trace' };
const createCommand = (
  overrides: Partial<B1PaymentTermCreateCommandV1> = {},
): B1PaymentTermCreateCommandV1 => ({
  paymentTermReference: 'test.fixture.term',
  paymentTermVersion: 1,
  termBasis: 'ELAPSED_DAYS',
  termValue: 7,
  effectiveFrom: '2027-01-01T00:00:00.000Z',
  effectiveTo: null,
  currency: 'NGN',
  accountingUnit: 'CUSTOMER_FUNDS',
  applicability: {
    capability: null,
    plan: null,
    subscription: null,
    product: { key: 'VIRTUAL_ACCOUNT', version: 1 },
    customer: null,
    merchant: null,
    partner: null,
  },
  idempotencyKey: 'create-key',
  principal,
  requestContext: context,
  now: new Date('2026-12-01T00:00:00.000Z'),
  ...overrides,
});

describe('B1T12 payment-term lifecycle service', () => {
  let termRepo: Repo<B1PaymentTerm>,
    bindingRepo: Repo<B1InvoicePaymentTermBinding>,
    amendmentRepo: Repo<B1DueDateAmendment>,
    billingRepo: Repo<B1BillingDocument>,
    idem: Idem,
    approvals: { consume: jest.Mock },
    service: B1PaymentTermService;
  beforeEach(() => {
    termRepo = new Repo();
    bindingRepo = new Repo();
    amendmentRepo = new Repo();
    billingRepo = new Repo();
    idem = new Idem();
    approvals = {
      consume: jest.fn().mockResolvedValue({ approved: true, approval: { approvedBy: 'checker' } }),
    };
    const repos = new Map<unknown, unknown>([
      [B1PaymentTerm, termRepo],
      [B1InvoicePaymentTermBinding, bindingRepo],
      [B1DueDateAmendment, amendmentRepo],
      [B1BillingDocument, billingRepo],
    ]);
    const manager = { getRepository: (type: unknown) => repos.get(type) } as EntityManager;
    const dataSource = {
      manager,
      transaction: async (_isolation: string, work: (m: EntityManager) => unknown) => {
        await Promise.resolve();
        return work(manager);
      },
      getRepository: (type: unknown) => repos.get(type),
    };
    const invoice = {
      invoiceId: randomUUID(),
      invoiceNumber: 'B1:invoice:test',
      invoiceVersion: 1,
      invoiceState: 'GENERATED',
      invoiceHash: 'a'.repeat(64),
      invoiceReplayHash: 'b'.repeat(64),
      billingRequestHash: 'c'.repeat(64),
      contractName: 'B1-BILLING-ENGINE',
      contractVersion: 1,
      scopeKey: 'commercial.virtual-account.inbound-funding',
      scopeVersion: 1,
      customerId: 'customer',
      merchantId: 'merchant',
      partnerId: 'partner',
      productKey: 'VIRTUAL_ACCOUNT',
      productVersion: 1,
      capabilityKey: 'commercial.virtual-account.inbound-funding.fee',
      capabilityVersion: 1,
      planKey: 'plan',
      planVersion: 1,
      subscriptionKey: 'subscription',
      subscriptionVersion: 1,
      packageKey: 'package',
      packageVersion: 1,
      bundleKey: 'bundle',
      bundleVersion: 1,
      productEntitlementKey: 'entitlement',
      productEntitlementVersion: 1,
      customerTierKey: 'customer-tier',
      customerTierVersion: 1,
      merchantTierKey: 'merchant-tier',
      merchantTierVersion: 1,
      partnerTierKey: 'partner-tier',
      partnerTierVersion: 1,
      baseAmountMinor: '100',
      baseCurrency: 'NGN',
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      feeMinor: '1',
      commissionMinor: '0',
      revenueSharingMinor: '0',
      totalMinor: '1',
      periodKey: 'commercial.virtual-account.inbound-funding.billing-period.per-transaction.v1',
      periodVersion: 1,
      issuedAt: '2027-01-01T00:00:00.000Z',
      commercialDecisionReferences: [],
      commercialDecisionIdempotencyKeys: [],
      explanationTrace: {},
      ruleTrace: {},
      auditEvidence: {},
      idempotencyScope: 'b1.billing-engine.invoice.idempotency.v1',
      idempotencyKey: 'invoice-key',
      replayed: false,
      conflict: false,
      conflictReason: null,
      failure: null,
      generatedAt: '2027-01-01T00:00:00.000Z',
      correlationId: 'correlation',
      requestContext: context,
      causationId: null,
      invoiceLines: [],
    } as unknown as B1InvoiceV1;
    service = new B1PaymentTermService(
      dataSource as never,
      { generateInvoice: () => invoice } as never,
      idem as never,
      approvals as never,
      { record: jest.fn().mockResolvedValue({}) } as never,
      { enqueueOnce: jest.fn().mockResolvedValue({}) } as never,
      { increment: jest.fn().mockResolvedValue(undefined) } as never,
    );
  });
  it('creates DRAFT, never automatically ACTIVE, and replays durable evidence', async () => {
    const first = await service.create(createCommand());
    expect(first.term?.status).toBe('DRAFT');
    const replay = await service.create(createCommand());
    expect(replay.outcome).toBe('REPLAYED');
    expect(termRepo.rows).toHaveLength(1);
  });
  it('conflicts when one definition key is reused for changed semantics', async () => {
    await service.create(createCommand());
    await expect(service.create(createCommand({ termValue: 8 }))).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
  it('enforces semantic version progression and preserves history', async () => {
    await service.create(createCommand());
    const second = await service.create(
      createCommand({ paymentTermVersion: 2, termValue: 30, idempotencyKey: 'version-2' }),
    );
    expect(second.term?.paymentTermVersion).toBe(2);
    expect(termRepo.rows).toHaveLength(2);
  });
  it('moves DRAFT to PENDING_APPROVAL without consuming approval', async () => {
    const created = await service.create(createCommand());
    const result = await service.submitForApproval({
      paymentTermReference: 'test.fixture.term',
      paymentTermVersion: 1,
      expectedRecordVersion: created.term!.recordVersion,
      idempotencyKey: 'submit',
      principal,
      requestContext: context,
      reason: 'review',
      now: new Date('2026-12-02T00:00:00.000Z'),
    });
    expect(result.term?.status).toBe('PENDING_APPROVAL');
    expect(approvals.consume).not.toHaveBeenCalled();
  });
  it('requires and consumes A2 approval for activation', async () => {
    const created = await service.create(createCommand());
    const pending = await service.submitForApproval({
      paymentTermReference: 'test.fixture.term',
      paymentTermVersion: 1,
      expectedRecordVersion: created.term!.recordVersion,
      idempotencyKey: 'submit',
      principal,
      requestContext: context,
      reason: 'review',
      now: new Date('2026-12-02T00:00:00.000Z'),
    });
    const command: B1PaymentTermLifecycleCommandV1 = {
      paymentTermReference: 'test.fixture.term',
      paymentTermVersion: 1,
      expectedRecordVersion: pending.term!.recordVersion,
      idempotencyKey: 'activate',
      principal,
      requestContext: context,
      reason: 'approved',
      approvalId: randomUUID(),
      now: new Date('2026-12-03T00:00:00.000Z'),
    };
    const active = await service.activate(command);
    expect(active.term?.status).toBe('ACTIVE');
    expect(approvals.consume).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: 'B1_PAYMENT_TERM_ACTIVATE',
        resource: { type: 'B1_PAYMENT_TERM', id: 'test.fixture.term/v1' },
      }),
    );
  });
  it('requires and consumes A2 approval for revocation', async () => {
    await service.create(createCommand());
    const term = termRepo.rows[0]!;
    term.status = 'ACTIVE';
    const result = await service.revoke({
      paymentTermReference: term.paymentTermReference,
      paymentTermVersion: 1,
      expectedRecordVersion: term.recordVersion,
      idempotencyKey: 'revoke',
      principal,
      requestContext: context,
      reason: 'retired',
      approvalId: randomUUID(),
      now: new Date('2027-01-02T00:00:00.000Z'),
    });
    expect(result.term?.status).toBe('REVOKED');
    expect(approvals.consume).toHaveBeenCalledWith(
      expect.objectContaining({ actionType: 'B1_PAYMENT_TERM_REVOKE' }),
    );
  });
  it('persists one canonical invoice and immutable binding with stable issuance on replay', async () => {
    await service.create(createCommand());
    termRepo.rows[0]!.status = 'ACTIVE';
    const request = bindingCommand();
    const first = await service.issueInvoiceWithPaymentTerm(request);
    expect(first.binding?.issuedAt).toBe('2027-01-01T00:00:00.000Z');
    expect(first.binding?.dueAt).toBe('2027-01-08T00:00:00.000Z');
    expect(first.binding?.dueDateCalculationHash).toMatch(/^[a-f0-9]{64}$/);
    const replay = await service.issueInvoiceWithPaymentTerm(request);
    expect(replay.outcome).toBe('REPLAYED');
    expect(replay.binding).toEqual(first.binding);
    expect(billingRepo.rows).toHaveLength(1);
    expect(bindingRepo.rows).toHaveLength(1);
  });
  it('fails closed when multiple ACTIVE tuples can match the invoice', async () => {
    await service.create(createCommand());
    termRepo.rows[0]!.status = 'ACTIVE';
    await service.create(
      createCommand({
        paymentTermReference: 'test.fixture.other',
        idempotencyKey: 'other-create',
        applicability: {
          capability: null,
          plan: null,
          subscription: null,
          product: null,
          customer: null,
          merchant: null,
          partner: null,
        },
      }),
    );
    termRepo.rows[1]!.status = 'ACTIVE';
    const result = await service.issueInvoiceWithPaymentTerm(bindingCommand());
    expect(result.failure?.code).toBe('AMBIGUOUS_APPLICABLE_TERMS');
    expect(bindingRepo.rows).toHaveLength(0);
  });
  it('appends approved derived amendments while preserving original evidence and replaying safely', async () => {
    await service.create(createCommand());
    termRepo.rows[0]!.status = 'ACTIVE';
    const bound = await service.issueInvoiceWithPaymentTerm(bindingCommand());
    const originalDueAt = bound.binding!.dueAt;
    const amendment = {
      bindingReference: bound.binding!.bindingReference,
      supersedesEvidenceReference: bound.binding!.bindingReference,
      expectedEvidenceHash: bound.binding!.bindingHash,
      replacementElapsedDays: 30,
      reason: 'approved extension',
      effectiveAt: '2027-01-02T00:00:00.000Z',
      idempotencyKey: 'amend-key',
      approvalId: randomUUID(),
      principal,
      requestContext: context,
      now: new Date('2027-01-02T00:00:00.000Z'),
    };
    const result = await service.amendDueDate(amendment);
    expect(result.amendment?.replacementDueAt).toBe('2027-01-31T00:00:00.000Z');
    expect(bindingRepo.rows[0]!.dueAt.toISOString()).toBe(originalDueAt);
    expect(approvals.consume).toHaveBeenCalledWith(
      expect.objectContaining({ actionType: 'B1_PAYMENT_TERM_DUE_DATE_AMEND' }),
    );
    const replay = await service.amendDueDate(amendment);
    expect(replay.outcome).toBe('REPLAYED');
    expect(amendmentRepo.rows).toHaveLength(1);
    const evidence = await service.getInvoicePaymentTermEvidence(
      bound.binding!.invoiceReference,
      1,
      new Date('2027-01-03T00:00:00.000Z'),
    );
    expect(evidence?.readOnly).toBe(true);
    expect(evidence?.effectiveDueAt).toBe('2027-01-31T00:00:00.000Z');
    expect(evidence?.supersessionStatus).toBe('AMENDED');
  });
});

function bindingCommand() {
  return {
    invoiceRequest: {
      contractName: 'B1-BILLING-ENGINE' as const,
      contractVersion: 1 as const,
      invoiceRequestId: 'invoice-request',
      invoiceRequestVersion: 1 as const,
      scopeKey: 'commercial.virtual-account.inbound-funding' as const,
      scopeVersion: 1 as const,
      expectedCurrency: 'NGN' as const,
      expectedAccountingUnit: 'CUSTOMER_FUNDS' as const,
      customerId: 'customer',
      merchantId: 'merchant',
      partnerId: 'partner',
      productKey: 'VIRTUAL_ACCOUNT' as const,
      productVersion: 1 as const,
      capabilityKey: 'commercial.virtual-account.inbound-funding.fee' as const,
      capabilityVersion: 1 as const,
      planKey: 'plan',
      planVersion: 1 as const,
      subscriptionKey: 'subscription',
      subscriptionVersion: 1 as const,
      packageKey: 'package',
      packageVersion: 1 as const,
      bundleKey: 'bundle',
      bundleVersion: 1 as const,
      productEntitlementKey: 'entitlement',
      productEntitlementVersion: 1 as const,
      customerTierKey: 'customer-tier',
      customerTierVersion: 1 as const,
      merchantTierKey: 'merchant-tier',
      merchantTierVersion: 1 as const,
      partnerTierKey: 'partner-tier',
      partnerTierVersion: 1 as const,
      billingRecordReferences: [],
      commercialDecisionReferences: [],
      commercialDecisionIdempotencyKeys: [],
      idempotencyKey: 'invoice-key',
      requestContext: context,
      causationId: null,
    },
    paymentTermReference: 'test.fixture.term',
    paymentTermVersion: 1,
    idempotencyKey: 'binding-key',
    principal,
    requestContext: context,
    now: new Date('2027-01-01T00:00:00.000Z'),
  };
}
