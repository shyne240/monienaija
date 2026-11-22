import {
  AUTHORING_CONTRACTS,
  AUTHORING_FIELDS,
  COMMISSION_MODELS,
  IMMUTABLE_ON_MODIFY,
  REWARD_MODELS,
  UNAUTHORED_COMMISSION_MODELS,
  UNAUTHORED_REWARD_MODELS,
  authoringActions,
  authoringPath,
  buildAuthoringPayload,
  buildModifyPayload,
  explainChangeState,
  historyActionFor,
  historyQuery,
  previewQuery,
  windowState,
} from '../src/screens/authenticated/commercial-authoring-contract';

const NOW = Date.parse('2026-03-01T12:00:00.000Z');

describe('capability matrix is grounded in the baseline routes', () => {
  test('fees, commissions and rewards expose governed authoring with real paths', () => {
    for (const domain of ['fees', 'commissions', 'rewards'] as const) {
      const contract = AUTHORING_CONTRACTS[domain];
      expect(contract.capability).toBe('GOVERNED_AUTHORING');
      expect(contract.reason).toBeNull();
      expect(contract.createPath).toMatch(/^\/internal\/[a-z-]+-rules$/);
      expect(contract.modifyPathTemplate).toContain('{id}');
      expect(contract.actions.create).toMatch(/_CREATE$/);
      expect(contract.actions.modify).toMatch(/_MODIFY$/);
    }
  });

  test('limit rules are GOVERNED_AUTHORING (the old BLOCKED assessment is obsolete)', () => {
    const limits = AUTHORING_CONTRACTS.limits;
    expect(limits.capability).toBe('GOVERNED_AUTHORING');
    expect(limits.reason).toBeNull();
    expect(limits.actions).toEqual({ create: 'LIMIT_RULE_CREATE', modify: 'LIMIT_RULE_UPDATE' });
    // Creation is nested under an EXISTING profile; the Studio never creates profiles.
    expect(limits.createPath).toBeNull();
    expect(limits.createPathTemplate).toBe('/internal/limit-profiles/{limitProfileCode}/rules');
    expect(limits.modifyPathTemplate).toBe('/internal/limit-rules/{id}');
    expect(limits.note).toMatch(/does not create or edit profiles/);
  });

  test('every authorable contract states what it does NOT do financially', () => {
    expect(AUTHORING_CONTRACTS.fees.note).toMatch(/No fee is charged/);
    expect(AUTHORING_CONTRACTS.commissions.note).toMatch(/Definition only/);
    expect(AUTHORING_CONTRACTS.rewards.note).toMatch(/No cashback credit/);
    for (const contract of Object.values(AUTHORING_CONTRACTS)) {
      expect(contract.reasonRequired).toBe(true);
    }
  });
});

describe('authoring actions gate on the function the backend checks', () => {
  test('create needs the create function; modify needs the modify function', () => {
    const create = authoringActions({
      domain: 'fees',
      mode: 'create',
      scopes: ['fee_rule.create'],
      readOnlyPrincipal: false,
    });
    expect(create[0].entitled).toBe(true);

    const modifyWithCreateOnly = authoringActions({
      domain: 'fees',
      mode: 'modify',
      scopes: ['fee_rule.create'],
      readOnlyPrincipal: false,
    });
    expect(modifyWithCreateOnly[0].entitled).toBe(false);
    expect(modifyWithCreateOnly[0].unavailableReason).toContain('fee_rule.modify');
  });

  test('limits authoring is offered to a limit.modify holder', () => {
    const actions = authoringActions({
      domain: 'limits',
      mode: 'create',
      scopes: ['limit.modify', 'limit.view'],
      readOnlyPrincipal: false,
    });
    expect(actions[0].entitled).toBe(true);
    expect(actions[0].unavailableReason).toBeNull();
  });

  test('a read-only principal is refused civilly and cites the backend refusal', () => {
    const actions = authoringActions({
      domain: 'rewards',
      mode: 'create',
      scopes: ['reward_rule.create'],
      readOnlyPrincipal: true,
    });
    expect(actions[0].entitled).toBe(false);
    expect(actions[0].unavailableReason).toMatch(/read-only/i);
    expect(actions[0].unavailableReason).toMatch(/backend/i);
  });
});

describe('payloads match the backend maker bodies', () => {
  test('fee create emits only documented fields, keeps minor units as strings', () => {
    const payload = buildAuthoringPayload('fees', {
      productCode: ' wallet_transfer ',
      currency: 'ngn',
      flatFeeMinor: '000150',
      percentageBps: '25',
      minimumFeeMinor: '10',
      maximumFeeMinor: '5000',
      vatBps: 750,
      effectiveFrom: '2026-03-01T00:00:00.000Z',
      priority: '10',
      isActive: true,
      reason: '  Add transfer fee  ',
    });
    expect(payload).toEqual({
      reason: 'Add transfer fee',
      productCode: 'WALLET_TRANSFER',
      currency: 'NGN',
      flatFeeMinor: '150',
      percentageBps: 25,
      minimumFeeMinor: '10',
      maximumFeeMinor: '5000',
      vatBps: 750,
      effectiveFrom: '2026-03-01T00:00:00.000Z',
      priority: 10,
      isActive: true,
    });
    // No fabricated business defaults.
    expect('effectiveTo' in payload).toBe(false);
  });

  test('limit create emits the CreateLimitRuleDto body without the profile code', () => {
    const payload = buildAuthoringPayload('limits', {
      limitProfileCode: 'STANDARD',
      product: 'wallet_transfer',
      currency: 'ngn',
      dimension: 'DAILY_AMOUNT',
      direction: 'both',
      limitValueMinor: '500000',
      effectiveFrom: '2026-03-01T00:00:00.000Z',
      priority: 10,
      isActive: true,
      reason: 'Daily cap',
    });
    expect(payload).toEqual({
      reason: 'Daily cap',
      product: 'WALLET_TRANSFER',
      currency: 'NGN',
      dimension: 'DAILY_AMOUNT',
      direction: 'BOTH',
      limitValueMinor: '500000',
      effectiveFrom: '2026-03-01T00:00:00.000Z',
      priority: 10,
      isActive: true,
    });
    // The profile code travels in the PATH, never the body.
    expect('limitProfileCode' in payload).toBe(false);
  });

  test('a limit rule carries exactly the value its dimension requires', () => {
    const base = {
      reason: 'r',
      limitProfileCode: 'STANDARD',
      product: 'TRANSFER',
      currency: 'NGN',
      effectiveFrom: '2026-03-01T00:00:00.000Z',
    };
    // count dimension must not carry an amount
    expect(() =>
      buildAuthoringPayload('limits', {
        ...base,
        dimension: 'DAILY_COUNT',
        limitValueMinor: '100',
        limitValueCount: 5,
      }),
    ).toThrow(/count dimension and must not carry an amount/);
    // amount dimension must not carry a count
    expect(() =>
      buildAuthoringPayload('limits', {
        ...base,
        dimension: 'DAILY_AMOUNT',
        limitValueMinor: '100',
        limitValueCount: 5,
      }),
    ).toThrow(/amount dimension and must not carry a count/);
    // and a value is mandatory
    expect(() => buildAuthoringPayload('limits', { ...base, dimension: 'DAILY_AMOUNT' })).toThrow(
      /requires a value/,
    );
    expect(
      buildAuthoringPayload('limits', { ...base, dimension: 'DAILY_COUNT', limitValueCount: 5 })
        .limitValueCount,
    ).toBe(5);
  });

  test('commission create carries targeting only when provided', () => {
    const payload = buildAuthoringPayload('commissions', {
      reason: 'Agent commission',
      productCode: 'CASH_OUT',
      currency: 'NGN',
      recipientType: 'agent',
      calculationModel: 'percentage',
      calculationBasis: 'fee',
      percentageBps: 50,
      effectiveFrom: '2026-03-01T00:00:00.000Z',
      isActive: true,
    });
    expect(payload.recipientType).toBe('AGENT');
    expect(payload.calculationModel).toBe('PERCENTAGE');
    expect('agentId' in payload).toBe(false);
    expect('agentClassId' in payload).toBe(false);
  });

  test('reward create never emits a credit or an execution instruction', () => {
    const payload = buildAuthoringPayload('rewards', {
      reason: 'Campaign bonus',
      productCode: 'AIRTIME',
      currency: 'NGN',
      beneficiaryType: 'customer',
      rewardType: 'cashback',
      calculationModel: 'fixed',
      calculationBasis: 'principal',
      flatRewardMinor: '5000',
      effectiveFrom: '2026-03-01T00:00:00.000Z',
      isActive: true,
    });
    expect(payload.beneficiaryType).toBe('CUSTOMER');
    expect(payload.rewardType).toBe('CASHBACK');
    expect(JSON.stringify(payload)).not.toMatch(/credit|settle|post|wallet/i);
  });

  test('the model enums mirror the backend and exclude TIERED from the form', () => {
    for (const model of UNAUTHORED_COMMISSION_MODELS) expect(COMMISSION_MODELS).not.toContain(model);
    for (const model of UNAUTHORED_REWARD_MODELS) expect(REWARD_MODELS).not.toContain(model);
    const field = AUTHORING_FIELDS.commissions.find((f) => f.key === 'calculationModel');
    expect(field?.options).toBe(COMMISSION_MODELS);
    expect(field?.hint).toMatch(/TIERED/);
    expect(field?.hint).toMatch(/tier bands/);
  });

  test('a missing or oversized reason is refused before any call is made', () => {
    expect(() => buildAuthoringPayload('fees', { productCode: 'X', currency: 'NGN' })).toThrow(
      /reason of 1–500 characters/,
    );
    expect(() =>
      buildAuthoringPayload('fees', { reason: 'x'.repeat(501), currency: 'NGN' }),
    ).toThrow(/reason of 1–500 characters/);
  });

  test('non-integer money and out-of-range integers are refused, not coerced', () => {
    const base = { reason: 'r', currency: 'NGN', productCode: 'P' };
    expect(() => buildAuthoringPayload('fees', { ...base, flatFeeMinor: '10.5' })).toThrow(
      /whole non-negative integers/,
    );
    expect(() => buildAuthoringPayload('fees', { ...base, percentageBps: 10001 })).toThrow(
      /between 0 and 10000/,
    );
    expect(() => buildAuthoringPayload('fees', { ...base, effectiveFrom: 'not-a-date' })).toThrow(
      /valid date\/time/,
    );
  });

  test('an explicit zero fee survives as a configured rule', () => {
    const payload = buildAuthoringPayload('fees', {
      reason: 'Free transfer window',
      productCode: 'TRANSFER',
      currency: 'NGN',
      flatFeeMinor: '0',
      effectiveFrom: '2026-03-01T00:00:00.000Z',
    });
    expect(payload.flatFeeMinor).toBe('0');
  });
});

describe('modify payloads strip identity and bind the loaded version', () => {
  test('fee modify drops product/currency/effectiveFrom and adds version', () => {
    const payload = buildModifyPayload(
      'fees',
      {
        reason: 'Raise the cap',
        productCode: 'TRANSFER',
        currency: 'NGN',
        effectiveFrom: '2026-03-01T00:00:00.000Z',
        maximumFeeMinor: '9000',
        priority: 20,
        isActive: true,
      },
      7,
    );
    expect(payload.version).toBe(7);
    expect(payload.maximumFeeMinor).toBe('9000');
    for (const key of IMMUTABLE_ON_MODIFY.fees) expect(key in payload).toBe(false);
  });

  test('limit modify keeps the mutable fields and binds the version', () => {
    const payload = buildModifyPayload(
      'limits',
      {
        reason: 'Raise the daily cap',
        limitProfileCode: 'STANDARD',
        product: 'TRANSFER',
        currency: 'NGN',
        dimension: 'DAILY_AMOUNT',
        limitValueMinor: '900000',
        effectiveFrom: '2026-03-01T00:00:00.000Z',
        priority: 10,
        isActive: true,
      },
      4,
    );
    expect(payload.version).toBe(4);
    expect(payload.limitValueMinor).toBe('900000');
    // The owning profile is identity and must not be resent.
    expect('limitProfileCode' in payload).toBe(false);
  });

  test('every immutable key of an authorable domain is a field the form shows', () => {
    for (const domain of ['fees', 'commissions', 'rewards', 'limits'] as const) {
      const shown = new Set(AUTHORING_FIELDS[domain].map((field) => field.key));
      expect(IMMUTABLE_ON_MODIFY[domain].length).toBeGreaterThan(0);
      for (const key of IMMUTABLE_ON_MODIFY[domain]) expect(shown.has(key)).toBe(true);
    }
  });
});

describe('authoring paths resolve from the contracts', () => {
  test('limit creation interpolates the profile code into the path', () => {
    expect(
      authoringPath('limits', 'create', null, { limitProfileCode: 'standard tier' }),
    ).toBe('/internal/limit-profiles/STANDARD%20TIER/rules');
    expect(() => authoringPath('limits', 'create', null, {})).toThrow(/profile code is required/);
  });

  test('modify requires a readable id', () => {
    expect(authoringPath('fees', 'modify', { id: 'fee-1' })).toBe('/internal/fee-rules/fee-1');
    expect(() => authoringPath('fees', 'modify', {})).toThrow(/no readable id/);
  });

  test('create paths for flat resources are used verbatim', () => {
    expect(authoringPath('fees', 'create')).toBe('/internal/fee-rules');
    expect(authoringPath('rewards', 'create')).toBe('/internal/reward-rules');
  });
});

describe('change-state explanation separates proposed, approved and effective', () => {
  const base = { effectiveFrom: null, effectiveTo: null, isActive: null, now: NOW };

  test('approval lifecycle states', () => {
    expect(explainChangeState({ ...base, approvalStatus: 'REQUESTED' }).state).toBe('PROPOSED');
    expect(explainChangeState({ ...base, approvalStatus: 'APPROVED' }).state).toBe(
      'APPROVED_NOT_APPLIED',
    );
    expect(explainChangeState({ ...base, approvalStatus: 'REJECTED' }).state).toBe('REJECTED');
    expect(explainChangeState({ ...base, approvalStatus: 'EXPIRED' }).state).toBe('EXPIRED');
  });

  test('a proposal states it governs nothing yet', () => {
    expect(explainChangeState({ ...base, approvalStatus: 'REQUESTED' }).detail).toMatch(
      /does not govern any operation yet/,
    );
  });

  test('approval alone is described as not applied', () => {
    expect(explainChangeState({ ...base, approvalStatus: 'APPROVED' }).detail).toMatch(
      /executor must consume it/i,
    );
  });

  test('effective windows are inclusive at the start and exclusive at the end', () => {
    expect(
      explainChangeState({
        approvalStatus: 'CONSUMED',
        effectiveFrom: '2026-03-01T12:00:00.000Z',
        effectiveTo: null,
        isActive: true,
        now: NOW,
      }).state,
    ).toBe('CONSUMED_APPLIED');
    expect(
      explainChangeState({
        approvalStatus: 'CONSUMED',
        effectiveFrom: '2026-03-01T12:00:00.001Z',
        effectiveTo: null,
        isActive: true,
        now: NOW,
      }).state,
    ).toBe('APPLIED_PENDING_WINDOW');
    expect(
      explainChangeState({
        approvalStatus: 'CONSUMED',
        effectiveFrom: '2026-01-01T00:00:00.000Z',
        effectiveTo: '2026-03-01T12:00:00.000Z',
        isActive: true,
        now: NOW,
      }).state,
    ).toBe('ENDED');
  });

  test('an inactive applied rule is not described as governing', () => {
    const inactive = explainChangeState({
      approvalStatus: 'CONSUMED',
      effectiveFrom: '2026-01-01T00:00:00.000Z',
      effectiveTo: null,
      isActive: false,
      now: NOW,
    });
    expect(inactive.headline).toBe('Applied, inactive');
    expect(inactive.detail).toMatch(/active flag is off/);
  });

  test('windowState reads the loaded-at instant, not the browser clock', () => {
    expect(windowState({ isActive: true, effectiveFrom: '2026-03-01T11:00:00.000Z' }, NOW)).toBe(
      'EFFECTIVE NOW',
    );
    expect(windowState({ isActive: true, effectiveFrom: '2026-03-01T13:00:00.000Z' }, NOW)).toBe(
      'SCHEDULED',
    );
    expect(
      windowState(
        {
          isActive: true,
          effectiveFrom: '2026-01-01T00:00:00.000Z',
          effectiveTo: '2026-03-01T11:59:59.000Z',
        },
        NOW,
      ),
    ).toBe('ENDED');
    expect(windowState({ isActive: false, effectiveFrom: '2026-01-01T00:00:00.000Z' }, NOW)).toBe(
      'INACTIVE',
    );
    expect(windowState({ isActive: true }, NOW)).toBe('INACTIVE');
  });
});

describe('query construction omits blanks and upper-cases codes', () => {
  test('preview query carries only supplied values', () => {
    const query = previewQuery({
      productCode: 'wallet_transfer',
      currency: 'ngn',
      principalType: 'CUSTOMER',
      direction: 'OUTGOING',
      amountMinor: '250000',
      principalId: '   ',
      institutionId: '',
    });
    expect(query.startsWith('/internal/commercial-configuration/effective-preview?')).toBe(true);
    const params = new URLSearchParams(query.split('?')[1]);
    expect(params.get('productCode')).toBe('WALLET_TRANSFER');
    expect(params.get('currency')).toBe('NGN');
    expect(params.get('amountMinor')).toBe('250000');
    expect(params.has('principalId')).toBe(false);
    expect(params.has('institutionId')).toBe(false);
  });

  test('history query is scoped to one action and one resource', () => {
    const query = historyQuery('LIMIT_RULE_UPDATE', 'limit-1');
    const params = new URLSearchParams(query.split('?')[1]);
    expect(query.startsWith('/internal/commercial-configuration/change-history?')).toBe(true);
    expect(params.get('actionType')).toBe('LIMIT_RULE_UPDATE');
    expect(params.get('resourceId')).toBe('limit-1');
  });

  test('historyActionFor maps each domain to its governed action', () => {
    expect(historyActionFor('fees', 'create')).toBe('FEE_RULE_CREATE');
    expect(historyActionFor('fees', 'modify')).toBe('FEE_RULE_MODIFY');
    expect(historyActionFor('commissions', 'modify')).toBe('COMMISSION_RULE_MODIFY');
    expect(historyActionFor('rewards', 'create')).toBe('REWARD_RULE_CREATE');
    expect(historyActionFor('limits', 'modify')).toBe('LIMIT_RULE_UPDATE');
  });
});
