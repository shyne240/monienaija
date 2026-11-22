/**
 * Arena 3 Phase 5 — Commercial Configuration Studio authoring contract.
 *
 * This module contains NO business rules. Everything here is either
 *  - a mirror of a backend contract (route, payload field set, allowlisted enum), or
 *  - presentation of a fact the backend returned (approval status, effective-window state).
 *
 * Explicit non-goals, because getting these wrong is how a UI silently becomes a second engine:
 *  - It never computes a fee, commission, reward, threshold or eligibility decision.
 *  - It never decides precedence. Fee/commission/reward/limit precedence lives in the backend
 *    resolvers; the Studio displays their answer (the effective preview) and surfaces an
 *    AMBIGUOUS refusal as a blocker.
 *  - It never treats a client-side scope check as authorization. Function scopes decide what the
 *    Studio OFFERS to do; the backend decides what is allowed, and a refusal renders verbatim.
 */

export type AuthoringDomain = 'fees' | 'commissions' | 'rewards' | 'limits';

export type AuthoringCapability =
  /** Full governed authoring: request → independent approval → execute. */
  | 'GOVERNED_AUTHORING'
  /** Existing registry mutation routes exist, but no governed action is registered yet. */
  | 'BLOCKED_ON_GOVERNANCE'
  /** No authorized mutation contract for this resource on this baseline. */
  | 'READ_ONLY';

export interface AuthoringContract {
  domain: AuthoringDomain;
  /** Display name of the resource being authored. */
  resource: string;
  capability: AuthoringCapability;
  /** Why a capability is unavailable — shown verbatim, never softened into "coming soon". */
  reason: string | null;
  /** Function that lets the operator ASK for a change (maker side). */
  requestFunction: string;
  /** Function that lets the operator EXECUTE an approved change. */
  executeFunction: string;
  /** Governed action keys the backend registry uses. */
  actions: { create: string | null; modify: string | null };
  /** Maker-phase path. For limits, create is nested under the profile code. */
  createPath: string | null;
  createPathTemplate: string | null;
  modifyPathTemplate: string | null;
  /** Reason is fingerprint-bound on both phases; the backend requires 1–500 characters. */
  reasonRequired: true;
  /** Human note about what this resource can and cannot do today. */
  note: string;
}

/**
 * Capability matrix, grounded in THIS baseline's controllers:
 *
 *  - fee/commission/reward: `POST /internal/{x}-rules` and `PATCH /internal/{x}-rules/:id` route
 *    through `CommercialRuleGovernanceService` (maker), with
 *    `POST …/changes/:approvalId/execute-create|execute-modify` (checker execution).
 *  - limits: `POST /internal/limit-profiles/:code/rules` → `LimitRuleGovernanceService.requestCreate`
 *    and `PATCH /internal/limit-rules/:id` → `requestUpdate`, with
 *    `POST …/changes/:approvalId/execute-create` and
 *    `POST /internal/limit-rules/:id/changes/:approvalId/execute-update`. `LIMIT_RULE_CREATE` and
 *    `LIMIT_RULE_UPDATE` are registered in `governed-action.registry.ts`, so limit authoring is
 *    GOVERNED_AUTHORING — the earlier BLOCKED_ON_GOVERNANCE assessment is obsolete.
 *  - limit profiles and assignments are NOT part of this matrix: they are separate administration
 *    surfaces with their own contracts and are not authored from the Studio.
 */
export const AUTHORING_CONTRACTS: Readonly<Record<AuthoringDomain, AuthoringContract>> = {
  fees: {
    domain: 'fees',
    resource: 'Fee rule',
    capability: 'GOVERNED_AUTHORING',
    reason: null,
    requestFunction: 'fee_rule.create',
    executeFunction: 'fee_rule.create',
    actions: { create: 'FEE_RULE_CREATE', modify: 'FEE_RULE_MODIFY' },
    createPath: '/internal/fee-rules',
    createPathTemplate: '/internal/fee-rules',
    modifyPathTemplate: '/internal/fee-rules/{id}',
    reasonRequired: true,
    note: 'Authoring stores a fee rule DEFINITION. No fee is charged, collected or posted by authoring or by preview.',
  },
  commissions: {
    domain: 'commissions',
    resource: 'Commission rule',
    capability: 'GOVERNED_AUTHORING',
    reason: null,
    requestFunction: 'commission_rule.create',
    executeFunction: 'commission_rule.create',
    actions: { create: 'COMMISSION_RULE_CREATE', modify: 'COMMISSION_RULE_MODIFY' },
    createPath: '/internal/commission-rules',
    createPathTemplate: '/internal/commission-rules',
    modifyPathTemplate: '/internal/commission-rules/{id}',
    reasonRequired: true,
    note: 'Definition only. Calculation, accrual, settlement and posting remain separate, unwired concerns.',
  },
  rewards: {
    domain: 'rewards',
    resource: 'Reward rule',
    capability: 'GOVERNED_AUTHORING',
    reason: null,
    requestFunction: 'reward_rule.create',
    executeFunction: 'reward_rule.create',
    actions: { create: 'REWARD_RULE_CREATE', modify: 'REWARD_RULE_MODIFY' },
    createPath: '/internal/reward-rules',
    createPathTemplate: '/internal/reward-rules',
    modifyPathTemplate: '/internal/reward-rules/{id}',
    reasonRequired: true,
    note: 'Definition only. No cashback credit, wallet movement or reward settlement exists.',
  },
  limits: {
    domain: 'limits',
    resource: 'Limit rule',
    capability: 'GOVERNED_AUTHORING',
    reason: null,
    requestFunction: 'limit.modify',
    executeFunction: 'limit.modify',
    actions: { create: 'LIMIT_RULE_CREATE', modify: 'LIMIT_RULE_UPDATE' },
    createPath: null,
    createPathTemplate: '/internal/limit-profiles/{limitProfileCode}/rules',
    modifyPathTemplate: '/internal/limit-rules/{id}',
    reasonRequired: true,
    note: 'Governed by LIMIT_RULE_CREATE / LIMIT_RULE_UPDATE. A new rule belongs to an existing limit profile; the Studio does not create or edit profiles.',
  },
};

// ──────────────────────────────────────────────────────────── enums mirrored from the backend

/** Mirrors src/fee-rules/fee-rule.entity.ts field set (no calculation-model column). */
export const FEE_FIELDS = [
  'reason',
  'productCode',
  'currency',
  'flatFeeMinor',
  'percentageBps',
  'minimumFeeMinor',
  'maximumFeeMinor',
  'vatBps',
  'effectiveFrom',
  'effectiveTo',
  'priority',
  'isActive',
  'version',
] as const;

export const COMMISSION_RECIPIENTS = ['AGENT', 'AGGREGATOR', 'PLATFORM'] as const;
/**
 * Mirrors src/commission/commission-rule.entity.ts COMMISSION_CALCULATION_MODELS.
 * The backend validates model/parameter coherence (e.g. FIXED needs a flat amount), so the Studio
 * must not offer an invented model name or invent a value for a parameter it did not collect.
 */
export const COMMISSION_MODELS = [
  'FIXED',
  'PERCENTAGE',
  'PERCENTAGE_MIN',
  'PERCENTAGE_MAX',
  'PERCENTAGE_MIN_MAX',
  'FLAT_PLUS_PERCENTAGE',
] as const;
/**
 * Backend-valid models this Studio deliberately does NOT offer yet. `TIERED` is a real
 * CommissionCalculationModel, but a tiered rule is only coherent with explicit tier bands
 * (`tiers`), and the Studio has no tier editor and no approved overlap/gap validation contract.
 * Offering the model without the bands would produce requests the backend rejects.
 */
export const UNAUTHORED_COMMISSION_MODELS = ['TIERED'] as const;
export const COMMISSION_BASES = ['PRINCIPAL', 'FEE', 'NET'] as const;
export const REWARD_BENEFICIARIES = ['CUSTOMER', 'AGENT'] as const;
export const REWARD_TYPES = ['CASHBACK', 'BONUS', 'PROMOTION'] as const;
/** Mirrors src/reward/reward-rule.entity.ts REWARD_CALCULATION_MODELS. */
export const REWARD_MODELS = [
  'FIXED',
  'PERCENTAGE',
  'PERCENTAGE_MIN',
  'PERCENTAGE_MAX',
  'PERCENTAGE_MIN_MAX',
  'FLAT_PLUS_PERCENTAGE',
] as const;
/** See UNAUTHORED_COMMISSION_MODELS: tiered rewards need tier bands this Studio cannot author. */
export const UNAUTHORED_REWARD_MODELS = ['TIERED'] as const;
export const REWARD_BASES = ['PRINCIPAL', 'FEE', 'NET'] as const;
export const REWARD_KYC_LEVELS = ['NONE', 'LEVEL_1', 'LEVEL_2', 'LEVEL_3'] as const;
/** Mirrors src/limit-catalog/limit-catalog.enums.ts LimitDimension. */
export const LIMIT_DIMENSIONS = [
  'MIN_AMOUNT_PER_TX',
  'MAX_AMOUNT_PER_TX',
  'DAILY_AMOUNT',
  'WEEKLY_AMOUNT',
  'MONTHLY_AMOUNT',
  'YEARLY_AMOUNT',
  'DAILY_COUNT',
  'WEEKLY_COUNT',
  'MONTHLY_COUNT',
  'YEARLY_COUNT',
  'WALLET_BALANCE_MAX',
] as const;
export const LIMIT_AMOUNT_DIMENSIONS = [
  'MIN_AMOUNT_PER_TX',
  'MAX_AMOUNT_PER_TX',
  'DAILY_AMOUNT',
  'WEEKLY_AMOUNT',
  'MONTHLY_AMOUNT',
  'YEARLY_AMOUNT',
  'WALLET_BALANCE_MAX',
] as const;
export const LIMIT_COUNT_DIMENSIONS = [
  'DAILY_COUNT',
  'WEEKLY_COUNT',
  'MONTHLY_COUNT',
  'YEARLY_COUNT',
] as const;
export const LIMIT_DIRECTIONS = ['INCOMING', 'OUTGOING', 'BOTH'] as const;

// ─────────────────────────────────────────────────────────────── authoring form primitives

export interface AuthoringFieldSpec {
  key: string;
  label: string;
  /** `text`/`number`/`date-time` are inputs; `select` renders the allowlisted `options`. */
  type: 'text' | 'number' | 'date-time' | 'select' | 'textarea' | 'boolean';
  options?: readonly string[];
  required?: boolean;
  hint?: string;
  /** Validation the browser can safely do: format only, never a business decision. */
  pattern?: string;
  /** Only present on MODIFY forms; the backend rejects a mismatch as a stale version. */
  modifyOnly?: boolean;
  /**
   * The backend normalises these codes to upper case. Normalising as the operator types keeps the
   * HTML `pattern` (which is case-sensitive) from rejecting a valid lowercase entry.
   */
  uppercase?: boolean;
}

const reasonField: AuthoringFieldSpec = {
  key: 'reason',
  label: 'Reason for this change',
  type: 'textarea',
  required: true,
  hint: 'Bound to the approval fingerprint. The checker sees this text; 1–500 characters.',
};

const effectiveFields: AuthoringFieldSpec[] = [
  {
    key: 'effectiveFrom',
    label: 'Effective from (UTC, inclusive)',
    type: 'date-time',
    required: true,
    hint: 'The rule governs nothing before this instant.',
  },
  {
    key: 'effectiveTo',
    label: 'Effective until (UTC, exclusive)',
    type: 'date-time',
    hint: 'Leave empty for open-ended. At exactly this instant the rule stops applying.',
  },
  {
    key: 'priority',
    label: 'Priority',
    type: 'number',
    hint: 'Integer. Highest applicable priority wins; an equal top priority is AMBIGUOUS and neither rule is chosen.',
  },
];

export const AUTHORING_FIELDS: Readonly<Record<AuthoringDomain, AuthoringFieldSpec[]>> = {
  fees: [
    { key: 'productCode', uppercase: true, label: 'Product code', type: 'text', required: true, pattern: '[A-Za-z0-9_.-]{2,80}' },
    { key: 'currency', uppercase: true, label: 'Currency', type: 'text', required: true, pattern: '[A-Za-z]{3}', hint: 'Three-letter ISO code; V1 is NGN.' },
    { key: 'flatFeeMinor', label: 'Flat fee (minor units)', type: 'text', pattern: '\\d{1,18}', hint: 'Integer minor units. Use 0 for an explicit zero-fee rule.' },
    { key: 'percentageBps', label: 'Rate (basis points)', type: 'number', hint: '10000 bps = 100%.' },
    { key: 'minimumFeeMinor', label: 'Minimum fee (minor units)', type: 'text', pattern: '\\d{1,18}' },
    { key: 'maximumFeeMinor', label: 'Maximum fee (minor units)', type: 'text', pattern: '\\d{1,18}' },
    { key: 'vatBps', label: 'VAT (basis points)', type: 'number', hint: 'Stored as configuration only. No VAT is posted while commercial accounting is disabled.' },
    ...effectiveFields,
    { key: 'isActive', label: 'Active', type: 'boolean' },
    reasonField,
  ],
  commissions: [
    { key: 'productCode', uppercase: true, label: 'Product code', type: 'text', required: true, pattern: '[A-Za-z0-9_.-]{2,80}' },
    { key: 'currency', uppercase: true, label: 'Currency', type: 'text', required: true, pattern: '[A-Za-z]{3}' },
    { key: 'recipientType', label: 'Recipient type', type: 'select', required: true, options: COMMISSION_RECIPIENTS },
    {
      key: 'calculationModel',
      label: 'Calculation model',
      type: 'select',
      required: true,
      options: COMMISSION_MODELS,
      hint: 'TIERED is not offered: tiered rules need explicit tier bands, and no approved tier editor exists yet.',
    },
    { key: 'calculationBasis', label: 'Calculation basis', type: 'select', required: true, options: COMMISSION_BASES },
    { key: 'flatCommissionMinor', label: 'Flat commission (minor units)', type: 'text', pattern: '\\d{1,18}' },
    { key: 'percentageBps', label: 'Rate (basis points)', type: 'number' },
    { key: 'minimumCommissionMinor', label: 'Minimum commission (minor units)', type: 'text', pattern: '\\d{1,18}' },
    { key: 'maximumCommissionMinor', label: 'Maximum commission (minor units)', type: 'text', pattern: '\\d{1,18}' },
    { key: 'agentClassId', label: 'Agent class UUID', type: 'text', hint: 'Targeting only. A missing target means the rule is not class-scoped.' },
    { key: 'agentId', label: 'Agent UUID', type: 'text' },
    { key: 'aggregatorId', label: 'Aggregator UUID', type: 'text' },
    ...effectiveFields,
    { key: 'isActive', label: 'Active', type: 'boolean' },
    reasonField,
  ],
  rewards: [
    { key: 'productCode', uppercase: true, label: 'Product code', type: 'text', required: true, pattern: '[A-Za-z0-9_.-]{2,80}' },
    { key: 'currency', uppercase: true, label: 'Currency', type: 'text', required: true, pattern: '[A-Za-z]{3}' },
    { key: 'beneficiaryType', label: 'Beneficiary type', type: 'select', required: true, options: REWARD_BENEFICIARIES },
    { key: 'rewardType', label: 'Reward type', type: 'select', required: true, options: REWARD_TYPES },
    {
      key: 'calculationModel',
      label: 'Calculation model',
      type: 'select',
      required: true,
      options: REWARD_MODELS,
      hint: 'TIERED is not offered: tiered rules need explicit tier bands, and no approved tier editor exists yet.',
    },
    { key: 'calculationBasis', label: 'Calculation basis', type: 'select', required: true, options: REWARD_BASES },
    { key: 'flatRewardMinor', label: 'Flat reward (minor units)', type: 'text', pattern: '\\d{1,18}' },
    { key: 'percentageBps', label: 'Rate (basis points)', type: 'number' },
    { key: 'minimumRewardMinor', label: 'Minimum reward (minor units)', type: 'text', pattern: '\\d{1,18}' },
    { key: 'maximumRewardMinor', label: 'Maximum reward (minor units)', type: 'text', pattern: '\\d{1,18}' },
    { key: 'customerKycLevel', label: 'Customer KYC level', type: 'select', options: REWARD_KYC_LEVELS },
    { key: 'campaignCode', uppercase: true, label: 'Campaign code', type: 'text' },
    { key: 'customerId', label: 'Customer UUID', type: 'text' },
    { key: 'agentClassId', label: 'Agent class UUID', type: 'text' },
    { key: 'agentId', label: 'Agent UUID', type: 'text' },
    ...effectiveFields,
    { key: 'isActive', label: 'Active', type: 'boolean' },
    reasonField,
  ],
  limits: [
    { key: 'limitProfileCode', uppercase: true, label: 'Limit profile code', type: 'text', required: true, pattern: '[A-Z0-9_]{3,80}', hint: 'The rule is created inside this EXISTING profile. Profiles are not created here.' },
    { key: 'product', uppercase: true, label: 'Product', type: 'text', required: true, pattern: '[A-Z0-9_][A-Z0-9_.-]{1,79}' },
    { key: 'currency', uppercase: true, label: 'Currency', type: 'text', required: true, pattern: '[A-Z]{3}' },
    { key: 'dimension', label: 'Dimension', type: 'select', required: true, options: LIMIT_DIMENSIONS, hint: 'Amount dimensions use the minor-unit field; count dimensions use the count field.' },
    { key: 'direction', label: 'Direction', type: 'select', options: LIMIT_DIRECTIONS, hint: 'BOTH applies to both directions.' },
    { key: 'channel', label: 'Channel', type: 'text', hint: 'Empty matches any channel. A set channel never matches a channel-less operation.' },
    { key: 'limitValueMinor', label: 'Amount limit (minor units)', type: 'text', pattern: '\\d{1,18}' },
    { key: 'limitValueCount', label: 'Count limit', type: 'number' },
    ...effectiveFields,
    { key: 'isActive', label: 'Active', type: 'boolean' },
    reasonField,
  ],
};

/**
 * Fields the backend refuses to change after creation (identity fields).
 *
 * For fee/commission/reward this mirrors the published `*UpdateBody` DTOs: the mutable economics
 * only, with identity and effective-start absent. For limits the update DTO accepts product,
 * direction, channel, currency and dimension, so only the owning profile is treated as identity.
 */
export const IMMUTABLE_ON_MODIFY: Readonly<Record<AuthoringDomain, readonly string[]>> = {
  fees: ['productCode', 'currency', 'effectiveFrom'],
  commissions: [
    'productCode',
    'currency',
    'recipientType',
    'calculationModel',
    'agentClassId',
    'agentId',
    'aggregatorId',
    'effectiveFrom',
  ],
  rewards: [
    'productCode',
    'currency',
    'beneficiaryType',
    'rewardType',
    'calculationModel',
    'customerId',
    'customerKycLevel',
    'agentClassId',
    'agentId',
    'campaignCode',
    'effectiveFrom',
  ],
  limits: ['limitProfileCode'],
};

export type AuthoringPhase = 'request' | 'approve' | 'execute';

export interface AuthoringAction {
  id: string;
  label: string;
  phase: AuthoringPhase;
  /** Whether this session holds the function the backend requires for the phase. */
  entitled: boolean;
  /** Why the action is unavailable, when it is. Shown to the operator verbatim. */
  unavailableReason: string | null;
}

/**
 * Offer only what this session could plausibly be allowed to do. Entitlement here is the same
 * catalogue function the backend checks — a UX filter, never an authorization decision. A missing
 * entitlement hides nothing a direct API call could not also attempt; a present one guarantees
 * nothing the backend will not re-check.
 */
export function authoringActions(input: {
  domain: AuthoringDomain;
  mode: 'create' | 'modify';
  scopes: readonly string[];
  readOnlyPrincipal: boolean;
}): AuthoringAction[] {
  const contract = AUTHORING_CONTRACTS[input.domain];
  if (contract.capability !== 'GOVERNED_AUTHORING') {
    return [
      {
        id: 'blocked',
        label: 'Authoring unavailable',
        phase: 'request',
        entitled: false,
        unavailableReason: contract.reason,
      },
    ];
  }
  if (input.readOnlyPrincipal) {
    return [
      {
        id: 'read-only',
        label: 'Authoring unavailable',
        phase: 'request',
        entitled: false,
        unavailableReason:
          'This session is an explicitly read-only principal. The backend refuses every governed write for it.',
      },
    ];
  }
  const requestFunction =
    input.mode === 'create'
      ? contract.requestFunction
      : contract.requestFunction.replace(/create$/, 'modify');
  const entitled = input.scopes.includes(requestFunction);
  return [
    {
      id: 'request',
      label: input.mode === 'create' ? 'Request creation' : 'Request change',
      phase: 'request',
      entitled,
      unavailableReason: entitled
        ? null
        : `This session does not hold ${requestFunction}. A FINANCE_PREPARER initiates governed commercial changes.`,
    },
  ];
}

// ─────────────────────────────────────────────────────────────── payload construction

const trimmed = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  return text === '' ? undefined : text;
};
const minor = (value: unknown): string | undefined => {
  const text = trimmed(value) ?? (typeof value === 'number' ? String(value) : undefined);
  if (text === undefined) return undefined;
  if (!/^\d{1,18}$/.test(text)) throw new Error('Minor-unit amounts must be whole non-negative integers.');
  return text.replace(/^0+(?=\d)/, '');
};
const integer = (value: unknown, label: string, max = 10000): number | undefined => {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > max)
    throw new Error(`${label} must be an integer between 0 and ${max}.`);
  return parsed;
};
const isoInstant = (value: unknown, label: string): string | undefined => {
  const text = trimmed(value);
  if (text === undefined) return undefined;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) throw new Error(`${label} must be a valid date/time.`);
  return date.toISOString();
};
const booleanValue = (value: unknown): boolean | undefined => {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return undefined;
};

/**
 * Build the exact request body for a maker phase. Only documented registry fields are emitted:
 * anything the form does not collect is omitted, never defaulted to a business value. The result is
 * then fingerprinted server-side together with `reason`, so the checker approves precisely this.
 */
export function buildAuthoringPayload(
  domain: AuthoringDomain,
  values: Record<string, unknown>,
): Record<string, unknown> {
  const reason = trimmed(values.reason);
  if (!reason || reason.length > 500)
    throw new Error('A reason of 1–500 characters is required for a governed change.');

  const base: Record<string, unknown> = { reason };
  const put = (key: string, value: unknown) => {
    if (value !== undefined && value !== null && value !== '') base[key] = value;
  };

  if (domain === 'limits') {
    // The create body is the CreateLimitRuleDto: the profile code travels in the PATH, not the body.
    put('product', trimmed(values.product)?.toUpperCase());
    put('direction', trimmed(values.direction)?.toUpperCase());
    put('channel', trimmed(values.channel));
    put('currency', trimmed(values.currency)?.toUpperCase());
    put('dimension', trimmed(values.dimension)?.toUpperCase());
    put('limitValueMinor', minor(values.limitValueMinor));
    put('limitValueCount', integer(values.limitValueCount, 'Count limit', 1_000_000_000));
    put('effectiveFrom', isoInstant(values.effectiveFrom, 'Effective from'));
    put('effectiveTo', isoInstant(values.effectiveTo, 'Effective until'));
    put('priority', integer(values.priority, 'Priority', 100000));
    put('isActive', booleanValue(values.isActive));
    validateLimitDimensionBalance(base);
    return base;
  }

  const productCode = trimmed(values.productCode) ?? trimmed(values.product);
  put('productCode', productCode?.toUpperCase());
  put('currency', trimmed(values.currency)?.toUpperCase());
  put('effectiveFrom', isoInstant(values.effectiveFrom, 'Effective from'));
  put('effectiveTo', isoInstant(values.effectiveTo, 'Effective until'));
  put('priority', integer(values.priority, 'Priority', 100000));
  put('isActive', booleanValue(values.isActive));

  if (domain === 'fees') {
    put('flatFeeMinor', minor(values.flatFeeMinor));
    put('percentageBps', integer(values.percentageBps, 'Rate (bps)'));
    put('minimumFeeMinor', minor(values.minimumFeeMinor));
    put('maximumFeeMinor', minor(values.maximumFeeMinor));
    put('vatBps', integer(values.vatBps, 'VAT (bps)'));
  }

  if (domain === 'commissions') {
    put('recipientType', trimmed(values.recipientType)?.toUpperCase());
    put('calculationModel', trimmed(values.calculationModel)?.toUpperCase());
    put('calculationBasis', trimmed(values.calculationBasis)?.toUpperCase());
    put('flatCommissionMinor', minor(values.flatCommissionMinor));
    put('percentageBps', integer(values.percentageBps, 'Rate (bps)'));
    put('minimumCommissionMinor', minor(values.minimumCommissionMinor));
    put('maximumCommissionMinor', minor(values.maximumCommissionMinor));
    put('agentClassId', trimmed(values.agentClassId));
    put('agentId', trimmed(values.agentId));
    put('aggregatorId', trimmed(values.aggregatorId));
  }

  if (domain === 'rewards') {
    put('beneficiaryType', trimmed(values.beneficiaryType)?.toUpperCase());
    put('rewardType', trimmed(values.rewardType)?.toUpperCase());
    put('calculationModel', trimmed(values.calculationModel)?.toUpperCase());
    put('calculationBasis', trimmed(values.calculationBasis)?.toUpperCase());
    put('flatRewardMinor', minor(values.flatRewardMinor));
    put('percentageBps', integer(values.percentageBps, 'Rate (bps)'));
    put('minimumRewardMinor', minor(values.minimumRewardMinor));
    put('maximumRewardMinor', minor(values.maximumRewardMinor));
    put('customerKycLevel', trimmed(values.customerKycLevel)?.toUpperCase());
    put('campaignCode', trimmed(values.campaignCode));
    put('customerId', trimmed(values.customerId));
    put('agentClassId', trimmed(values.agentClassId));
    put('agentId', trimmed(values.agentId));
  }

  return base;
}

/**
 * A limit rule carries exactly one value, and which one depends on the dimension. Sending both (or
 * neither) produces an incoherent rule the backend rejects; this is a format check on the single
 * documented rule, not a threshold decision.
 */
function validateLimitDimensionBalance(payload: Record<string, unknown>): void {
  const dimension = String(payload.dimension ?? '');
  if (!dimension) return;
  const isCount = (LIMIT_COUNT_DIMENSIONS as readonly string[]).includes(dimension);
  const hasAmount = payload.limitValueMinor !== undefined;
  const hasCount = payload.limitValueCount !== undefined;
  if (isCount && hasAmount)
    throw new Error(`${dimension} is a count dimension and must not carry an amount limit.`);
  if (!isCount && hasCount)
    throw new Error(`${dimension} is an amount dimension and must not carry a count limit.`);
  if (!hasAmount && !hasCount)
    throw new Error(`${dimension} requires a value (an amount limit or a count limit).`);
}

/** MODIFY adds the optimistic-concurrency version and must not resend identity fields. */
export function buildModifyPayload(
  domain: AuthoringDomain,
  values: Record<string, unknown>,
  version: number,
): Record<string, unknown> {
  const payload = buildAuthoringPayload(domain, values);
  for (const key of IMMUTABLE_ON_MODIFY[domain]) delete payload[key];
  if (domain !== 'limits') delete payload.productCode;
  payload.version = version;
  // A modify always carries `reason` plus the changed fields; `version` must be the loaded one.
  return payload;
}

/** Resolve the maker-phase path, substituting the profile code for a limit-rule creation. */
export function authoringPath(
  domain: AuthoringDomain,
  mode: 'create' | 'modify',
  record?: Record<string, unknown> | null,
  values?: Record<string, unknown>,
): string {
  const contract = AUTHORING_CONTRACTS[domain];
  if (mode === 'create') {
    if (contract.createPath) return contract.createPath;
    const template = contract.createPathTemplate;
    if (!template) throw new Error(`No creation contract exists for ${domain}.`);
    const code = trimmed(values?.limitProfileCode);
    if (!code) throw new Error('A limit profile code is required to create a limit rule.');
    return template.replace('{limitProfileCode}', encodeURIComponent(code.toUpperCase()));
  }
  const template = contract.modifyPathTemplate;
  if (!template) throw new Error(`No modification contract exists for ${domain}.`);
  const id = typeof record?.id === 'string' ? record.id : null;
  if (!id) throw new Error('This rule has no readable id, so a governed change cannot be bound to it.');
  return template.replace('{id}', encodeURIComponent(id));
}

// ─────────────────────────────────────────────────────────── approval / effective windows

export type ChangeState =
  | 'PROPOSED'
  | 'APPROVED_NOT_APPLIED'
  | 'APPLIED_PENDING_WINDOW'
  | 'EFFECTIVE'
  | 'ENDED'
  | 'REJECTED'
  | 'CONSUMED_APPLIED'
  | 'EXPIRED';

export interface ChangeStateExplanation {
  state: ChangeState;
  headline: string;
  detail: string;
}

/**
 * Combine the approval lifecycle (a backend fact) with the rule's effective window (also a backend
 * fact) into the states an operator must be able to tell apart. This is a LABELLING function: it
 * adds no decision, and an unknown combination degrades to the raw approval status.
 */
export function explainChangeState(input: {
  approvalStatus: string | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  isActive: boolean | null;
  now?: number;
}): ChangeStateExplanation {
  const now = input.now ?? Date.now();
  const from = input.effectiveFrom ? Date.parse(input.effectiveFrom) : null;
  const to = input.effectiveTo ? Date.parse(input.effectiveTo) : null;
  const status = input.approvalStatus;

  if (status === 'REQUESTED')
    return {
      state: 'PROPOSED',
      headline: 'Proposed',
      detail:
        'Waiting for an independent FINANCE_CONTROLLER decision. Nothing is persisted as configuration and this rule does not govern any operation yet.',
    };
  if (status === 'REJECTED')
    return {
      state: 'REJECTED',
      headline: 'Rejected',
      detail: 'The checker rejected the proposal. No configuration was written.',
    };
  if (status === 'EXPIRED')
    return {
      state: 'EXPIRED',
      headline: 'Approval expired',
      detail:
        'The approval window closed before execution. The proposal can no longer be executed; a new request is required.',
    };
  if (status === 'APPROVED')
    return {
      state: 'APPROVED_NOT_APPLIED',
      headline: 'Approved, not applied',
      detail:
        'Approved by the checker but not yet executed. Approval alone never mutates configuration; an authorized executor must consume it.',
    };

  if (from !== null && from > now)
    return {
      state: 'APPLIED_PENDING_WINDOW',
      headline: 'Applied, scheduled',
      detail: 'Written and approved, but its effective window has not started. It governs nothing yet.',
    };
  if (to !== null && to <= now)
    return {
      state: 'ENDED',
      headline: 'Ended',
      detail: 'Its effective window has passed. It no longer applies, and existing records are unaffected.',
    };
  if (input.isActive === false)
    return {
      state: 'APPLIED_PENDING_WINDOW',
      headline: 'Applied, inactive',
      detail: 'Written and approved, but the active flag is off, so enforcement skips it.',
    };
  return {
    state: status === 'CONSUMED' ? 'CONSUMED_APPLIED' : 'EFFECTIVE',
    headline: 'Effective',
    detail:
      'Approved, applied and inside its effective window with the active flag on. This is the configuration an operation would be governed by.',
  };
}

const WINDOW_STATES = ['EFFECTIVE NOW', 'SCHEDULED', 'ENDED', 'INACTIVE'] as const;

/** Effective-window state at load time. Presentation of the returned dates only. */
export function windowState(row: Record<string, unknown>, loadedAt: number): string {
  if (row.isActive === false) return 'INACTIVE';
  const from = typeof row.effectiveFrom === 'string' ? Date.parse(row.effectiveFrom) : NaN;
  const to = typeof row.effectiveTo === 'string' ? Date.parse(row.effectiveTo) : null;
  if (!Number.isFinite(from)) return 'INACTIVE';
  if (from > loadedAt) return 'SCHEDULED';
  if (to !== null && Number.isFinite(to) && to <= loadedAt) return 'ENDED';
  return 'EFFECTIVE NOW';
}

export { WINDOW_STATES };

export interface PreviewCall {
  productCode: string;
  currency: string;
  principalType: 'CUSTOMER' | 'AGENT';
  principalId?: string;
  agentClassId?: string;
  institutionId?: string;
  direction: 'INCOMING' | 'OUTGOING';
  channel?: string;
  amountMinor?: string;
  serviceClass?: string;
  at?: string;
}

/** Build the query for the read-only preview. Empty optional values are omitted, not blanked. */
export function previewQuery(call: PreviewCall): string {
  const params = new URLSearchParams();
  params.set('productCode', call.productCode.trim().toUpperCase());
  params.set('currency', (call.currency || 'NGN').trim().toUpperCase());
  params.set('principalType', call.principalType);
  params.set('direction', call.direction);
  for (const key of [
    'principalId',
    'agentClassId',
    'institutionId',
    'channel',
    'amountMinor',
    'serviceClass',
    'at',
  ] as const) {
    const value = call[key];
    if (typeof value === 'string' && value.trim() !== '') params.set(key, value.trim());
  }
  return `/internal/commercial-configuration/effective-preview?${params.toString()}`;
}

export function historyQuery(actionType: string, resourceId: string): string {
  const params = new URLSearchParams({ actionType, resourceId });
  return `/internal/commercial-configuration/change-history?${params.toString()}`;
}

/** Map a registry tab + row to the governed action its history is recorded under. */
export function historyActionFor(domain: AuthoringDomain, mode: 'create' | 'modify'): string {
  const contract = AUTHORING_CONTRACTS[domain];
  const action = mode === 'create' ? contract.actions.create : contract.actions.modify;
  if (!action) throw new Error(`No governed ${mode} action is registered for ${domain}.`);
  return action;
}
