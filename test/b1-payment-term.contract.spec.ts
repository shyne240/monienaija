import { BadRequestException } from '@nestjs/common';
import { getMetadataArgsStorage } from 'typeorm';
import { B1PaymentTermModule } from '../src/policy/b1-payment-term.module';
import {
  B1DueDateAmendment,
  B1InvoicePaymentTermBinding,
  B1PaymentTerm,
} from '../src/policy/b1-payment-term.entity';
import {
  B1PaymentTermService,
  b1CalculateDueAt,
  b1CanonicalInstant,
  b1CanonicalJson,
  b1Hash,
} from '../src/policy/b1-payment-term.service';
import type { B1PaymentTermCreateCommandV1 } from '../src/policy/b1-payment-term.types';
import { CreateB1PaymentTermTables1785753600051 } from '../src/migrations/1785753600051-CreateB1PaymentTermTables';

const principal = {
  type: 'PRIVILEGED' as const,
  principalId: 'maker',
  roles: [],
  scopes: [],
  customerAccess: 'NONE' as const,
  assuranceLevel: 'MFA' as const,
};
const command = (
  overrides: Partial<B1PaymentTermCreateCommandV1> = {},
): B1PaymentTermCreateCommandV1 => ({
  paymentTermReference: 'test.fixture.payment-term',
  paymentTermVersion: 1,
  termBasis: 'ELAPSED_DAYS',
  termValue: 7,
  effectiveFrom: '2027-01-01T00:00:00Z',
  effectiveTo: null,
  currency: 'NGN',
  accountingUnit: 'CUSTOMER_FUNDS',
  applicability: {
    capability: { key: 'commercial.virtual-account.inbound-funding.fee', version: 1 },
    plan: { key: 'plan', version: 1 },
    subscription: null,
    product: { key: 'VIRTUAL_ACCOUNT', version: 1 },
    customer: null,
    merchant: 'merchant-1',
    partner: 'partner-1',
  },
  idempotencyKey: 'fixture-key',
  principal,
  requestContext: { requestId: 'request', correlationId: 'correlation', traceId: 'trace' },
  ...overrides,
});
const service = () =>
  new B1PaymentTermService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );

describe('B1T12 canonical contract', () => {
  it('canonicalizes recursively sorted keys, explicit null, and semantic array order', () => {
    expect(b1CanonicalJson({ z: null, a: { y: 2, x: 1 }, list: [2, 1] })).toBe(
      '{"a":{"x":1,"y":2},"list":[2,1],"z":null}',
    );
  });
  it('produces deterministic lowercase SHA-256', () => {
    expect(b1Hash({ b: 2, a: 1 })).toBe(b1Hash({ a: 1, b: 2 }));
    expect(b1Hash({ a: 1 })).toMatch(/^[a-f0-9]{64}$/);
  });
  it('normalizes UTC instants to milliseconds', () =>
    expect(b1CanonicalInstant('2027-01-01T01:00:00+01:00')).toBe('2027-01-01T00:00:00.000Z'));
  it('rejects invalid instants', () =>
    expect(() => b1CanonicalInstant('invalid')).toThrow(BadRequestException));
  it('calculates zero elapsed days exactly', () =>
    expect(b1CalculateDueAt('2027-01-01T00:00:00.000Z', 0)).toBe('2027-01-01T00:00:00.000Z'));
  it('calculates exact 86400-second elapsed days', () =>
    expect(b1CalculateDueAt('2027-01-01T00:00:00.000Z', 7)).toBe('2027-01-08T00:00:00.000Z'));
  it('accepts the maximum 3660 fixture', () =>
    expect(b1CalculateDueAt('2027-01-01T00:00:00.000Z', 3660)).toBe('2037-01-08T00:00:00.000Z'));
  it.each([-1, 1.5, 3661, Number.MAX_SAFE_INTEGER, Number.NaN])(
    'rejects invalid term value %s',
    (value) =>
      expect(() => b1CalculateDueAt('2027-01-01T00:00:00.000Z', value)).toThrow(
        BadRequestException,
      ),
  );
  it('rejects invalid resulting instants', () =>
    expect(() => b1CalculateDueAt('+275760-09-12T00:00:00.000Z', 3660)).toThrow(
      BadRequestException,
    ));

  it('hashes the exact normalized definition deterministically', () => {
    const one = service().computeDefinitionHash(command());
    const two = service().computeDefinitionHash(
      command({
        idempotencyKey: 'another',
        requestContext: { requestId: 'other', correlationId: 'other', traceId: 'other' },
      }),
    );
    expect(one).toBe(two);
  });
  it.each([
    'capability',
    'plan',
    'subscription',
    'product',
    'customer',
    'merchant',
    'partner',
  ] as const)('commits applicability dimension %s to definition hash', (dimension) => {
    const base = command();
    const changed = {
      ...base.applicability,
      [dimension]:
        dimension === 'customer' || dimension === 'merchant' || dimension === 'partner'
          ? 'changed'
          : { key: 'changed', version: 1 },
    };
    expect(service().computeDefinitionHash({ ...base, applicability: changed })).not.toBe(
      service().computeDefinitionHash(base),
    );
  });
  it('commits explicit null applicability', () => {
    const base = command();
    expect(
      service().computeDefinitionHash({
        ...base,
        applicability: { ...base.applicability, plan: null },
      }),
    ).not.toBe(service().computeDefinitionHash(base));
  });
  it('rejects unsupported term basis', () =>
    expect(() =>
      service().computeDefinitionHash(command({ termBasis: 'CALENDAR_DAYS' as never })),
    ).toThrow('termBasis must be ELAPSED_DAYS'));
  it('rejects inverted effective dates', () =>
    expect(() =>
      service().computeDefinitionHash(command({ effectiveTo: '2026-01-01T00:00:00Z' })),
    ).toThrow('effectiveTo must be after effectiveFrom'));
  it('defines an internal module without controllers', () =>
    expect(
      (Reflect.getMetadata('controllers', B1PaymentTermModule) as unknown[] | undefined) ?? [],
    ).toHaveLength(0));
  it('registers exactly the three B1-owned aggregate tables', () => {
    const tables = getMetadataArgsStorage()
      .tables.filter((t) =>
        [B1PaymentTerm, B1InvoicePaymentTermBinding, B1DueDateAmendment].includes(
          t.target as never,
        ),
      )
      .map((t) => t.name)
      .sort();
    expect(tables).toEqual([
      'b1_due_date_amendments',
      'b1_invoice_payment_term_bindings',
      'b1_payment_terms',
    ]);
  });
  it('migration creates no second invoice table and freezes exact scopes', async () => {
    const sql: string[] = [];
    const q = {
      query: (statement: string) => {
        sql.push(statement);
        return Promise.resolve();
      },
    };
    await new CreateB1PaymentTermTables1785753600051().up(q as never);
    const all = sql.join('\n');
    expect(all).toContain('CREATE TABLE b1_payment_terms');
    expect(all).toContain('CREATE TABLE b1_invoice_payment_term_bindings');
    expect(all).toContain('CREATE TABLE b1_due_date_amendments');
    expect(all).not.toContain('CREATE TABLE b1_billing_documents');
    expect(new Set(all.match(/b1\.payment-term\.[a-z.-]+\.v1/g))).toEqual(
      new Set([
        'b1.payment-term.definition.idempotency.v1',
        'b1.payment-term.invoice-binding.idempotency.v1',
        'b1.payment-term.due-date-amendment.idempotency.v1',
      ]),
    );
  });
});
