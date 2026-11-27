import { ConflictException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';

import {
  BLACKLISTED_CUSTOMER_MESSAGE,
  CustomerFinancialEligibilityService,
  FROZEN_CUSTOMER_MESSAGE,
} from '../src/kyc-verification/customer-financial-eligibility.service';
import type { KycTierEvidenceReader } from '../src/kyc-verification/kyc-tier-evidence.reader';
import type { KycTierPolicyService } from '../src/kyc-verification/kyc-tier-policy.service';

/**
 * ARENA 5 §6 — administrative restriction admission at the centralized financial boundary.
 *
 * These cases pin the decision table and the read's placement/shape without a database. The
 * real-PostgreSQL suite (`v1-frozen-restriction-admission.integration.spec.ts`) owns the row-level
 * truth: what `is_active=false`, `deleted_at` and concurrent writers actually do.
 */

interface RestrictionRow {
  customer_id: string;
  type: string;
  is_active: boolean;
  deleted_at: Date | null;
}

const CUSTOMER_ID = '11111111-1111-4111-8111-111111111111';

interface FixtureOptions {
  restrictions?: RestrictionRow[];
  lockMode?: 'UPDATE' | 'SHARE';
  requireActive?: boolean;
}

function fixture(options: FixtureOptions = {}) {
  const restrictions = options.restrictions ?? [];
  const statements: Array<{ sql: string; params?: unknown[] }> = [];
  const policies = { effective: jest.fn().mockResolvedValue({}) };
  const reader = {
    read: jest.fn().mockResolvedValue({
      identityRevision: 1,
      evidence: {},
    }),
  };
  const query = jest.fn((sql: string, params?: unknown[]) => {
    return Promise.resolve().then(() => {
      statements.push({ sql, params });
      if (/FROM customers\b/.test(sql))
        return [
          {
            status: 'ACTIVE',
            kyc_status: 'APPROVED',
            kyc_level: 'LEVEL_1',
            is_synthetic: false,
            deleted_at: null,
          },
        ];
      if (/FROM customer_restrictions/.test(sql)) {
        // Mirrors the predicates the statement itself carries so a decision-table case cannot pass
        // on a statement that stopped filtering active, undeleted blocking restrictions.
        return restrictions
          .filter(
            (row) =>
              row.customer_id === params?.[0] &&
              ['BLACKLISTED', 'FROZEN'].includes(row.type) &&
              row.is_active &&
              row.deleted_at === null,
          )
          .map((row) => ({ type: row.type }))
          .sort((left, right) => left.type.localeCompare(right.type));
      }
      if (/clock_timestamp\(\)/.test(sql)) return [{ now: new Date('2026-11-20T00:00:00.000Z') }];
      if (/FROM kyc_tier_manual_holds|FROM kyc_identity_conflicts/.test(sql)) return [];
      if (/FROM customer_contact_methods/.test(sql)) return [{ id: 'contact' }];
      if (/FROM customer_kyc_assessments/.test(sql)) return [{ id: 'assessment' }];
      throw new Error(`Unexpected statement in restriction admission fixture: ${sql}`);
    });
  });
  const service = new CustomerFinancialEligibilityService(
    policies as unknown as KycTierPolicyService,
    reader as unknown as KycTierEvidenceReader,
  );
  const manager = { query } as unknown as EntityManager;
  return { service, manager, statements, policies, reader, query };
}

function restriction(type: string, overrides: Partial<RestrictionRow> = {}): RestrictionRow {
  return {
    customer_id: CUSTOMER_ID,
    type,
    is_active: true,
    deleted_at: null,
    ...overrides,
  };
}

/** Captures a refusal without introducing an `any`-typed error surface. */
async function refusal(promise: Promise<unknown>): Promise<ConflictException> {
  try {
    await promise;
  } catch (error) {
    return error as ConflictException;
  }
  throw new Error('Expected the admission boundary to refuse this customer');
}

function statementsFor(
  statements: Array<{ sql: string; params?: unknown[] }>,
  table: string,
): Array<{ sql: string; params?: unknown[] }> {
  return statements.filter((statement) => statement.sql.includes(table));
}

describe('financial admission — administrative restrictions (ARENA 5 §6)', () => {
  it('never reports a restriction for a customer with no restriction row', async () => {
    const test = fixture();
    // The stubbed tier evidence cannot produce a real ELIGIBLE decision, so some generic
    // eligibility failure is expected here; what must never happen is a restriction verdict.
    const error = await refusal(test.service.require(test.manager, CUSTOMER_ID));
    expect(error.message).not.toBe(FROZEN_CUSTOMER_MESSAGE);
    expect(error.message).not.toBe(BLACKLISTED_CUSTOMER_MESSAGE);
    expect(statementsFor(test.statements, 'customer_restrictions')).toHaveLength(1);
  });

  it('rejects an active FROZEN restriction with a 409 before any policy or evidence I/O', async () => {
    const test = fixture({ restrictions: [restriction('FROZEN')] });
    const error = await refusal(test.service.require(test.manager, CUSTOMER_ID));

    expect(error).toBeInstanceOf(ConflictException);
    expect(error.message).toBe(FROZEN_CUSTOMER_MESSAGE);
    expect(error.getStatus()).toBe(409);
    // Fail-closed at admission: the boundary is decided before policy/evidence authority is read.
    expect(test.policies.effective).not.toHaveBeenCalled();
    expect(test.reader.read).not.toHaveBeenCalled();
    expect(statementsFor(test.statements, 'clock_timestamp').length).toBe(0);
  });

  it('rejects an active BLACKLISTED restriction with its own message', async () => {
    const test = fixture({ restrictions: [restriction('BLACKLISTED')] });
    const error = await refusal(test.service.require(test.manager, CUSTOMER_ID));

    expect(error).toBeInstanceOf(ConflictException);
    expect(error.message).toBe(BLACKLISTED_CUSTOMER_MESSAGE);
    expect(test.reader.read).not.toHaveBeenCalled();
  });

  it('reports BLACKLISTED when both blocking restrictions are active', async () => {
    const test = fixture({ restrictions: [restriction('FROZEN'), restriction('BLACKLISTED')] });
    await expect(test.service.require(test.manager, CUSTOMER_ID)).rejects.toThrow(
      BLACKLISTED_CUSTOMER_MESSAGE,
    );
  });

  it('does not block an inactive FROZEN restriction', async () => {
    const test = fixture({ restrictions: [restriction('FROZEN', { is_active: false })] });
    await expect(test.service.require(test.manager, CUSTOMER_ID)).rejects.not.toThrow(
      FROZEN_CUSTOMER_MESSAGE,
    );
    expect(test.statements.some((s) => s.sql.includes('FROM customer_restrictions'))).toBe(true);
  });

  it('does not block a soft-deleted FROZEN restriction', async () => {
    const test = fixture({
      restrictions: [restriction('FROZEN', { deleted_at: new Date('2026-01-01T00:00:00Z') })],
    });
    await expect(test.service.require(test.manager, CUSTOMER_ID)).rejects.not.toThrow(
      FROZEN_CUSTOMER_MESSAGE,
    );
  });

  it.each(['LIMITED', 'MANUAL_REVIEW', 'NONE'])(
    'does not reinterpret an active %s restriction as a freeze',
    async (type) => {
      const test = fixture({ restrictions: [restriction(type)] });
      const statements = test.statements;
      await test.service.require(test.manager, CUSTOMER_ID).catch(() => undefined);
      const restrictionRead = statementsFor(statements, 'customer_restrictions');
      // The read is issued (uniform placement) but the restriction predicate never selects a
      // non-blocking type, so no freeze/blacklist decision can be produced from it.
      expect(restrictionRead).toHaveLength(1);
      expect(restrictionRead[0]!.sql).toContain(
        "type IN ('BLACKLISTED','FROZEN','CONFIGURATION_REVIEW')",
      );
    },
  );

  it('reads restrictions inside the caller transaction, after the customer row lock', async () => {
    const test = fixture({ restrictions: [restriction('FROZEN')] });
    await test.service.require(test.manager, CUSTOMER_ID).catch(() => undefined);
    const customerIndex = test.statements.findIndex((s) => /FROM customers\b/.test(s.sql));
    const restrictionIndex = test.statements.findIndex((s) =>
      s.sql.includes('customer_restrictions'),
    );
    expect(customerIndex).toBeGreaterThanOrEqual(0);
    expect(restrictionIndex).toBe(customerIndex + 1);
    expect(test.statements[customerIndex]!.sql).toContain('FOR UPDATE');
  });

  it('reuses the caller lock strength for the restriction read', async () => {
    const withUpdate = fixture();
    await withUpdate.service.require(withUpdate.manager, CUSTOMER_ID).catch(() => undefined);
    const updateRead = statementsFor(withUpdate.statements, 'customer_restrictions')[0]!;
    expect(updateRead.sql).toContain('FOR UPDATE');
    expect(updateRead.params).toEqual([CUSTOMER_ID]);

    const withShare = fixture();
    await withShare.service
      .require(withShare.manager, CUSTOMER_ID, { lockMode: 'SHARE' })
      .catch(() => undefined);
    const shareRead = statementsFor(withShare.statements, 'customer_restrictions')[0]!;
    expect(shareRead.sql).toContain('FOR SHARE');
  });

  it('keeps the restriction predicate fail-closed in SQL itself', async () => {
    const test = fixture();
    await test.service.require(test.manager, CUSTOMER_ID).catch(() => undefined);
    const sql = statementsFor(test.statements, 'customer_restrictions')[0]!.sql;
    expect(sql).toContain('is_active=true');
    expect(sql).toContain('deleted_at IS NULL');
  });
});
