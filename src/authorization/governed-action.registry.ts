/**
 * Governed-action registry — the maker/checker request types, action names and resource types
 * that the P0 financial-control fixes (commercial rule maker/checker per
 * `V1-ADMIN-ROLE-AND-PERMISSION-DECISIONS-01` Decision 2, and ledger-journal-reversal maker
 * requests per `V1-ADMIN-ROLE-AND-FUNCTION-MODEL-01` §8/§10) register and consume.
 *
 * Governance identities are hardcoded (not `A2_MAKER_CHECKER_RULES_JSON`-driven), mirroring the
 * documented `RoleDefinitionGovernanceService` precedent (`ROLE_DEFINITION_INITIATOR_ROLE` /
 * `ROLE_DEFINITION_APPROVER_ROLE`) and the `ADMINISTRATOR_OPERATIONAL_ROLE_KEYS` precedent in
 * `finance-role-administration.service.ts`. Every value below is copied verbatim from the
 * approved decisions — nothing here is a new approval policy:
 *
 *  - Decision 2 (commercial configuration is maker/checker governed): FINANCE_PREPARER initiates,
 *    FINANCE_CONTROLLER approves, maker and checker must always be different principals,
 *    minimum one approval — "following the exact shape of the already-implemented
 *    finance.control_policy.activate rule (self-approval prohibited, minimum one approval)".
 *  - V1-ADMIN-ROLE-AND-FUNCTION-MODEL-01 §8: governed action `LEDGER_JOURNAL_REVERSAL` with
 *    FINANCE_PREPARER as the sole initiating role and FINANCE_CONTROLLER as the sole approving
 *    role, `minimumApprovals: 1`, `selfApprovalProhibited: true`.
 *
 * Function codes are catalogue codes from `authorization-catalogue.seed.ts` and are never
 * invented: `ledger.approve_adjustment` is FUTURE / `assignable: false` ("intentionally not
 * assigned to FINANCE_CONTROLLER yet"), so `LEDGER_JOURNAL_REVERSAL` deliberately has no
 * approving function code and its approval side falls back to the role rule plus the
 * `PrivilegedActionApprovalService` separation controls (self-approval forbidden, approval-scope
 * membership, MFA) — identical to how `FINANCE_CONTROL_POLICY_ACTIVATE` is governed today.
 *
 * The legacy `A2_MAKER_CHECKER_RULES_JSON` environment registry keeps precedence for the three
 * actions it already defines (FINANCE_ROLE_ASSIGN / FINANCE_ROLE_REVOKE /
 * FINANCE_CONTROL_POLICY_ACTIVATE); this registry only ever supplies the actions the
 * environment file never carried.
 */

import { canonical, sha256 } from './workforce-crypto';

export interface GovernedActionDefinition {
  /** Registered maker-checker action type (the `actionType` recorded on the approval). */
  readonly action: string;
  /** Registered resource type for the approval's resource binding. */
  readonly resourceType: string;
  /** Catalogue function codes the REQUESTER must hold (never invented). */
  readonly initiatingFunctionCodes: readonly string[];
  /** Catalogue function codes the APPROVER must hold; empty = role rule only. */
  readonly approvingFunctionCodes: readonly string[];
  /** Maker role(s) per the approved decision. */
  readonly initiatingRoles: readonly string[];
  /** Checker role(s) per the approved decision. */
  readonly approvingRoles: readonly string[];
  readonly minimumApprovals: number;
  readonly selfApprovalProhibited: boolean;
  readonly mfaRequired: boolean;
  readonly minimumAssurance: 'PASSWORD' | 'MFA';
  /**
   * Scope string recorded on the approval and checked by
   * `PrivilegedActionApprovalService.decide()` against the deciding principal's scopes.
   * Commercial actions use their catalogue function code (held by both sides, exactly like
   * RoleDefinitionGovernanceService's `approvalScope`); LEDGER_JOURNAL_REVERSAL uses the
   * service default `privileged:approve` — the literal approval capability FINANCE_CONTROLLER
   * carries in the A2 scope vocabulary that PrivilegedActionApprovalService consumes directly.
   */
  readonly approvalScope: string;
}

const FINANCE_PREPARER = 'FINANCE_PREPARER';
const FINANCE_CONTROLLER = 'FINANCE_CONTROLLER';

const rule = (
  action: string,
  resourceType: string,
  functionCode: string | null,
  approvalScope: string,
  approvingFunctionCodes: readonly string[] = functionCode ? [functionCode] : [],
): GovernedActionDefinition => ({
  action,
  resourceType,
  initiatingFunctionCodes: functionCode ? [functionCode] : [],
  approvingFunctionCodes,
  initiatingRoles: [FINANCE_PREPARER],
  approvingRoles: [FINANCE_CONTROLLER],
  minimumApprovals: 1,
  selfApprovalProhibited: true,
  mfaRequired: true,
  minimumAssurance: 'MFA',
  approvalScope,
});

/**
 * Commercial configuration (Decision 2). `agent.assign_limit` is explicitly NOT governed and is
 * deliberately absent (Decision 2: "Remains operational — explicitly NOT maker/checker
 * governed"). `limit.modify` is a Decision-2 function but is outside the P0-A task scope
 * ("fee, commission, reward, and product rule changes") and is left ungoverned pending P1.
 */
export const COMMERCIAL_RULE_ACTIONS: Readonly<Record<string, GovernedActionDefinition>> = {
  FEE_RULE_CREATE: rule('FEE_RULE_CREATE', 'FEE_RULE', 'fee_rule.create', 'fee_rule.create'),
  FEE_RULE_MODIFY: rule('FEE_RULE_MODIFY', 'FEE_RULE', 'fee_rule.modify', 'fee_rule.modify'),
  COMMISSION_RULE_CREATE: rule(
    'COMMISSION_RULE_CREATE',
    'COMMISSION_RULE',
    'commission_rule.create',
    'commission_rule.create',
  ),
  COMMISSION_RULE_MODIFY: rule(
    'COMMISSION_RULE_MODIFY',
    'COMMISSION_RULE',
    'commission_rule.modify',
    'commission_rule.modify',
  ),
  REWARD_RULE_CREATE: rule(
    'REWARD_RULE_CREATE',
    'REWARD_RULE',
    'reward_rule.create',
    'reward_rule.create',
  ),
  REWARD_RULE_MODIFY: rule(
    'REWARD_RULE_MODIFY',
    'REWARD_RULE',
    'reward_rule.modify',
    'reward_rule.modify',
  ),
  PRODUCT_MODIFY: rule('PRODUCT_MODIFY', 'PRODUCT', 'product.modify', 'product.modify'),
  PRODUCT_GOVERNANCE: rule(
    'PRODUCT_GOVERNANCE',
    'PRODUCT',
    'product.governance',
    'product.governance',
  ),
};

/**
 * Ledger journal reversal (V1-ADMIN-ROLE-AND-FUNCTION-MODEL-01 §8/§10: registered governed
 * action `LEDGER_JOURNAL_REVERSAL` on resource type `LEDGER_JOURNAL`). The maker holds
 * `ledger.reverse` (CAT: FINANCE_PREPARER INITIATE). The checker function
 * `ledger.approve_adjustment` is FUTURE/not assignable, so the approval side is role-gated only —
 * never invent a code for it.
 */
export const LEDGER_JOURNAL_REVERSAL_ACTION = rule(
  'LEDGER_JOURNAL_REVERSAL',
  'LEDGER_JOURNAL',
  'ledger.reverse',
  'privileged:approve',
  [],
);

export const AGENT_FUNDING_ACTIONS: Readonly<Record<string, GovernedActionDefinition>> =
  Object.fromEntries(
    ['FUND', 'DEFUND'].map((direction) => {
      const code = direction === 'FUND' ? 'agent.fund' : 'agent.defund';
      const definition = {
        ...rule(`AGENT_${direction}`, 'AGENT', code, code),
        initiatingRoles: ['AGENT_NETWORK_MANAGER'],
      };
      return [definition.action, definition];
    }),
  );

export const GOVERNED_ACTIONS: Readonly<Record<string, GovernedActionDefinition>> = {
  ...COMMERCIAL_RULE_ACTIONS,
  ...AGENT_FUNDING_ACTIONS,
  [LEDGER_JOURNAL_REVERSAL_ACTION.action]: LEDGER_JOURNAL_REVERSAL_ACTION,
};

export function governedAction(action: string): GovernedActionDefinition | undefined {
  return GOVERNED_ACTIONS[action];
}

export function isGovernedAction(action: string): boolean {
  return Object.prototype.hasOwnProperty.call(GOVERNED_ACTIONS, action);
}

/**
 * Deterministic fingerprint of a governed change request: derived from the actual requested
 * action and the full relevant payload via the existing canonicalization rules
 * (`workforce-crypto.canonical` + `sha256` — the same primitives
 * `A2FinanceRoleAdministrationService.fingerprint`, `B2FFinanceControlService` and
 * `RoleDefinitionGovernanceService` fingerprint with). Key order never matters (`canonical` sorts
 * keys recursively); any payload difference changes the hash, so a request approved for one
 * payload can never be consumed to execute another.
 */
export function governedChangeFingerprint(
  action: string,
  resourceType: string,
  resourceId: string | null,
  payload: Readonly<Record<string, unknown>>,
): string {
  return sha256(
    canonical({
      action,
      resourceType,
      resourceId: resourceId ?? null,
      payload,
    }),
  );
}
