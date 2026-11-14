import type { EntityManager } from 'typeorm';
import type { TestingModuleBuilder } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';

import {
  CASH_TO_CASH_FUNDING_POLICY_AUTHORITY,
  evaluateFundingPolicy,
  type CashToCashFundingPolicy,
  type CashToCashFundingPolicyAuthority,
  type FundingPolicyResolution,
  type FundingPolicyResolutionRequest,
} from '../../src/agent/cash-to-cash-funding-policy';

/**
 * **Test-only** controlled funding-policy source for agent-funded Cash-to-Cash.
 *
 * ARENA 3B Stage 2: no approved production Cash-to-Cash funding policy exists, so the production
 * binding stays fail-closed (`UnavailableCashToCashFundingPolicyAuthority`). Functional
 * acceptance therefore needs an *explicitly declared* policy record rather than a weakened
 * production path. This class:
 *
 *  - refuses to construct unless `NODE_ENV === 'test'`;
 *  - holds the declared policy document in memory and exposes it for evidence, so the exact
 *    policy a run relied on is recorded in the acceptance output;
 *  - applies the same institution-match and effective-window evaluation
 *    (`evaluateFundingPolicy`) a production authority would apply — it substitutes the *source*
 *    of the approved policy, never the rules;
 *  - does not weaken `RESOLVED`-only admission, locking, revalidation or any institutional check.
 *
 * Suites opt in with `overrideCashToCashFundingPolicy(builder, handle)`.
 */
export interface ControlledPolicyDeclaration {
  policyReference?: string;
  institutionId?: string;
  approvedBy?: string;
  approvedAt?: string;
  effectiveFrom?: string;
  effectiveUntil?: string | null;
}

export interface ControlledFundingPolicyHandle {
  authority: CashToCashFundingPolicyAuthority;
  /** The exact approved policy document this run relies on. */
  policy: CashToCashFundingPolicy;
  /** Every resolution this handle has been asked for, in order. */
  calls: Array<{ request: FundingPolicyResolutionRequest; outcome: string }>;
  /** Replace the declared policy (for superseded/expired policy cases). */
  setPolicy(policy: CashToCashFundingPolicy | null): void;
}

const DEFAULT_APPROVED_AT = '2026-01-01T00:00:00.000Z';
const DEFAULT_EFFECTIVE_FROM = '2026-01-01T00:00:00.000Z';

export function createControlledFundingPolicy(
  declaration: ControlledPolicyDeclaration = {},
): ControlledFundingPolicyHandle {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('The controlled funding policy may only be constructed under NODE_ENV=test');
  }
  const policy: CashToCashFundingPolicy = {
    policyId: `controlled-policy-${randomUUID()}`,
    policyReference: declaration.policyReference ?? 'CONTROLLED-ACCEPTANCE-C2C-FUNDING-POLICY-001',
    institutionId: declaration.institutionId ?? 'ANY',
    approvedBy: declaration.approvedBy ?? 'controlled-acceptance-checker',
    approvedAt: declaration.approvedAt ?? DEFAULT_APPROVED_AT,
    effectiveFrom: declaration.effectiveFrom ?? DEFAULT_EFFECTIVE_FROM,
    effectiveUntil: declaration.effectiveUntil === undefined ? null : declaration.effectiveUntil,
  };
  let current: CashToCashFundingPolicy | null = policy;
  const calls: Array<{ request: FundingPolicyResolutionRequest; outcome: string }> = [];

  const authority: CashToCashFundingPolicyAuthority = {
    resolve(
      _manager: EntityManager,
      request: FundingPolicyResolutionRequest,
    ): Promise<FundingPolicyResolution> {
      // The default declaration authorizes any institution; a declared institution is enforced.
      const scoped =
        current && current.institutionId === 'ANY'
          ? { ...current, institutionId: request.institutionId }
          : current;
      const resolution = evaluateFundingPolicy(scoped, request);
      calls.push({ request, outcome: resolution.outcome });
      return Promise.resolve(resolution);
    },
  };

  return {
    authority,
    get policy() {
      return policy;
    },
    calls,
    setPolicy(next: CashToCashFundingPolicy | null) {
      current = next;
    },
  };
}

/** Bind the controlled policy source into a testing module. */
export function overrideCashToCashFundingPolicy(
  builder: TestingModuleBuilder,
  handle: ControlledFundingPolicyHandle,
): TestingModuleBuilder {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('Overriding the funding policy is only permitted under NODE_ENV=test');
  }
  return builder.overrideProvider(CASH_TO_CASH_FUNDING_POLICY_AUTHORITY).useValue(handle.authority);
}
