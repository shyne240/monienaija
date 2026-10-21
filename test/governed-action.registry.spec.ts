/**
 * P0-A / P0-B governed-action registry unit tests: the registry values must match the approved
 * Decision-2 / role-model documents VERBATIM (roles, assurance, separation), and the governed
 * change fingerprint must be a deterministic pure function of (action, resourceType, resourceId,
 * payload) — key order never matters, any payload difference changes the hash.
 */
import {
  COMMERCIAL_RULE_ACTIONS,
  GOVERNED_ACTIONS,
  LEDGER_JOURNAL_REVERSAL_ACTION,
  governedAction,
  governedChangeFingerprint,
  isGovernedAction,
} from '../src/authorization/governed-action.registry';

describe('governed-action registry (P0-A/P0-B)', () => {
  it('registers exactly the eight Decision-2 commercial actions and LEDGER_JOURNAL_REVERSAL', () => {
    expect(Object.keys(COMMERCIAL_RULE_ACTIONS).sort()).toEqual(
      [
        'COMMISSION_RULE_CREATE',
        'COMMISSION_RULE_MODIFY',
        'FEE_RULE_CREATE',
        'FEE_RULE_MODIFY',
        'PRODUCT_GOVERNANCE',
        'PRODUCT_MODIFY',
        'REWARD_RULE_CREATE',
        'REWARD_RULE_MODIFY',
      ].sort(),
    );
    expect(Object.keys(GOVERNED_ACTIONS).sort()).toEqual(
      [...Object.keys(COMMERCIAL_RULE_ACTIONS), 'LEDGER_JOURNAL_REVERSAL'].sort(),
    );
    // Decision 2 explicitly keeps agent.assign_limit ungoverned and limit.modify out of this P0.
    expect(isGovernedAction('AGENT_ASSIGN_LIMIT')).toBe(false);
    expect(isGovernedAction('LIMIT_MODIFY')).toBe(false);
    expect(isGovernedAction('LEDGER_JOURNAL_REVERSAL')).toBe(true);
  });

  it('carries the Decision-2 policy values verbatim on every action', () => {
    for (const definition of Object.values(GOVERNED_ACTIONS)) {
      expect(definition.initiatingRoles).toEqual(['FINANCE_PREPARER']);
      expect(definition.approvingRoles).toEqual(['FINANCE_CONTROLLER']);
      expect(definition.minimumApprovals).toBe(1);
      expect(definition.selfApprovalProhibited).toBe(true);
      expect(definition.mfaRequired).toBe(true);
      expect(definition.minimumAssurance).toBe('MFA');
    }
  });

  it('binds commercial actions to their catalogue function codes and approval scopes', () => {
    expect(governedAction('FEE_RULE_CREATE')).toMatchObject({
      action: 'FEE_RULE_CREATE',
      resourceType: 'FEE_RULE',
      initiatingFunctionCodes: ['fee_rule.create'],
      approvingFunctionCodes: ['fee_rule.create'],
      approvalScope: 'fee_rule.create',
    });
    expect(governedAction('PRODUCT_GOVERNANCE')).toMatchObject({
      action: 'PRODUCT_GOVERNANCE',
      resourceType: 'PRODUCT',
      initiatingFunctionCodes: ['product.governance'],
      approvalScope: 'product.governance',
    });
  });

  it('binds LEDGER_JOURNAL_REVERSAL to LEDGER_JOURNAL with the documented function codes', () => {
    expect(LEDGER_JOURNAL_REVERSAL_ACTION).toMatchObject({
      action: 'LEDGER_JOURNAL_REVERSAL',
      resourceType: 'LEDGER_JOURNAL',
      initiatingFunctionCodes: ['ledger.reverse'],
      // ledger.approve_adjustment is FUTURE/unassignable — approving side is role-gated only.
      approvingFunctionCodes: [],
      approvalScope: 'privileged:approve',
    });
  });

  describe('governedChangeFingerprint', () => {
    const base = {
      action: 'FEE_RULE_CREATE',
      resourceType: 'FEE_RULE',
      resourceId: null,
      payload: { reason: 'repricing', productCode: 'CASH_IN', percentageBps: 30 },
    };

    it('is deterministic and key-order independent', () => {
      const a = governedChangeFingerprint('FEE_RULE_CREATE', 'FEE_RULE', null, {
        reason: 'repricing',
        productCode: 'CASH_IN',
        percentageBps: 30,
      });
      const b = governedChangeFingerprint('FEE_RULE_CREATE', 'FEE_RULE', null, {
        percentageBps: 30,
        productCode: 'CASH_IN',
        reason: 'repricing',
      });
      expect(a).toBe(b);
      expect(a).toMatch(/^[0-9a-f]{64}$/);
    });

    it('changes for any payload difference (including nested)', () => {
      const original = governedChangeFingerprint(
        base.action,
        base.resourceType,
        base.resourceId,
        base.payload,
      );
      expect(
        governedChangeFingerprint(base.action, base.resourceType, base.resourceId, {
          ...base.payload,
          percentageBps: 31,
        }),
      ).not.toBe(original);
      expect(
        governedChangeFingerprint(base.action, base.resourceType, base.resourceId, {
          ...base.payload,
          tiers: [{ upToMinor: '100' }],
        }),
      ).not.toBe(original);
    });

    it('changes across action, resource type and resource id', () => {
      const original = governedChangeFingerprint(
        base.action,
        base.resourceType,
        base.resourceId,
        base.payload,
      );
      expect(
        governedChangeFingerprint('FEE_RULE_MODIFY', base.resourceType, base.resourceId, base.payload),
      ).not.toBe(original);
      expect(
        governedChangeFingerprint(base.action, 'COMMISSION_RULE', base.resourceId, base.payload),
      ).not.toBe(original);
      expect(
        governedChangeFingerprint(base.action, base.resourceType, 'rule-id-1', base.payload),
      ).not.toBe(original);
    });
  });
});
