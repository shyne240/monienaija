import type { DataRecord } from '../../components/StructuredData';

export const PROFILE_CODE = /^[A-Z0-9_]{3,80}$/;
export const RULE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const AMOUNT_DIMENSIONS = [
  'MIN_AMOUNT_PER_TX',
  'MAX_AMOUNT_PER_TX',
  'DAILY_AMOUNT',
  'WEEKLY_AMOUNT',
  'MONTHLY_AMOUNT',
  'YEARLY_AMOUNT',
  'WALLET_BALANCE_MAX',
];
export const COUNT_DIMENSIONS = ['DAILY_COUNT', 'WEEKLY_COUNT', 'MONTHLY_COUNT', 'YEARLY_COUNT'];
const SUBJECTS = ['GLOBAL', 'SEGMENT', 'AGENT_CLASS', 'CUSTOMER', 'AGENT'];
const STATUS = ['ACTIVE', 'DISABLED', 'DEPRECATED'];
const CONFIGURATION = ['CONFIGURED', 'NOT_CONFIGURED', 'DISABLED'];

interface Filter {
  key: string;
  label: string;
  options?: readonly string[];
  pattern?: string;
}
const code = (key: string, label: string): Filter => ({
  key,
  label,
  pattern: '[A-Za-z0-9_]{3,80}',
});
const product = code('productCode', 'Product code');
const profile = code('limitProfileCode', 'Profile code');
const currency = { key: 'currency', label: 'Currency', pattern: '[A-Za-z]{3}' };
const active = { key: 'isActive', label: 'Active flag', options: ['true', 'false'] };
const configurationFilters: Filter[] = [
  { key: 'status', label: 'Lifecycle status', options: STATUS },
  { key: 'enabled', label: 'Enabled flag', options: ['true', 'false'] },
  { key: 'configurationStatus', label: 'Configuration status', options: CONFIGURATION },
];

// Only filters accepted by the baseline list controllers. Free-text search and the window
// filter are deliberately page-local; the API does not support either across the registry.
export const FILTERS: Readonly<Record<string, readonly Filter[]>> = {
  '/internal/products': [
    {
      key: 'domain',
      label: 'Domain',
      options: ['CUSTOMER', 'AGENT', 'AGGREGATOR', 'FINANCE', 'SUPPORT', 'PLATFORM'],
    },
    { key: 'productScope', label: 'Product scope', options: ['V1', 'V2'] },
    ...configurationFilters,
  ],
  '/internal/fee-rules': [product, currency, active],
  '/internal/commission-rules': [
    product,
    currency,
    active,
    { key: 'recipientType', label: 'Recipient type', options: ['AGENT', 'AGGREGATOR', 'PLATFORM'] },
  ],
  '/internal/reward-rules': [
    product,
    currency,
    active,
    { key: 'beneficiaryType', label: 'Beneficiary type', options: ['CUSTOMER', 'AGENT'] },
  ],
  '/internal/limit-profiles': [
    { key: 'kind', label: 'Profile kind', options: ['CUSTOMER', 'AGENT', 'SYSTEM', 'UNIVERSAL'] },
    ...configurationFilters,
  ],
  '/internal/limit-rules': [
    profile,
    code('product', 'Product code'),
    currency,
    active,
    { key: 'dimension', label: 'Dimension', options: [...AMOUNT_DIMENSIONS, ...COUNT_DIMENSIONS] },
  ],
  '/internal/limit-assignments': [
    profile,
    { key: 'subjectType', label: 'Subject type', options: SUBJECTS },
    {
      key: 'subjectId',
      label: 'Subject UUID',
      pattern: RULE_ID.source.slice(1, -1).replaceAll('a-f', 'a-fA-F'),
    },
    code('segmentCode', 'Segment code'),
    active,
  ],
};

export const WINDOW_STATES = ['In window', 'Scheduled', 'Ended', 'Window unavailable'] as const;
export function windowState(row: DataRecord, at: number): (typeof WINDOW_STATES)[number] {
  const from = typeof row.effectiveFrom === 'string' ? Date.parse(row.effectiveFrom) : NaN;
  const to =
    row.effectiveTo === null
      ? Infinity
      : typeof row.effectiveTo === 'string'
        ? Date.parse(row.effectiveTo)
        : NaN;
  if (!Number.isFinite(from) || Number.isNaN(to) || to <= from) return 'Window unavailable';
  if (at < from) return 'Scheduled';
  return at >= to ? 'Ended' : 'In window';
}

const AUDIT = ['version', 'createdBy', 'updatedBy', 'createdAt', 'updatedAt'];
const WINDOW = ['effectiveFrom', 'effectiveTo', 'isActive'];
const FINANCIAL = ['id', 'productCode', 'currency', 'priority', ...WINDOW, ...AUDIT];
const CALCULATION = ['calculationModel', 'calculationBasis', 'percentageBps', 'tiers'];
const COMMISSION_TARGETS = {
  agentClassId: 'Agent class',
  agentId: 'Agent',
  aggregatorId: 'Aggregator',
};
const REWARD_TARGETS = {
  customerId: 'Customer',
  customerKycLevel: 'Customer KYC level',
  agentClassId: 'Agent class',
  agentId: 'Agent',
  campaignCode: 'Campaign',
};
const DETAIL_FIELDS: Record<string, readonly string[]> = {
  '/internal/products': [
    'code',
    'name',
    'description',
    'domain',
    'currency',
    'productScope',
    'status',
    'enabled',
    'configurationStatus',
    ...AUDIT,
  ],
  '/internal/fee-rules': [
    ...FINANCIAL,
    'customerClassCode',
    'agentClassId',
    'institutionId',
    'flatFeeMinor',
    'percentageBps',
    'minimumFeeMinor',
    'maximumFeeMinor',
    'vatBps',
  ],
  '/internal/commission-rules': [
    ...FINANCIAL,
    ...CALCULATION,
    'recipientType',
    'flatCommissionMinor',
    'minimumCommissionMinor',
    'maximumCommissionMinor',
    ...Object.keys(COMMISSION_TARGETS),
  ],
  '/internal/reward-rules': [
    ...FINANCIAL,
    ...CALCULATION,
    'beneficiaryType',
    'rewardType',
    'flatRewardMinor',
    'minimumRewardMinor',
    'maximumRewardMinor',
    ...Object.keys(REWARD_TARGETS),
  ],
  '/internal/limit-assignments': [
    'id',
    'limitProfileCode',
    'subjectType',
    'subjectId',
    'segmentCode',
    'precedence',
    ...WINDOW,
    ...AUDIT,
  ],
};

function scalar(value: unknown) {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value);
}

function assignmentIsValid(row: DataRecord) {
  const { id, limitProfileCode, subjectType, subjectId, segmentCode } = row;
  if (
    typeof id !== 'string' ||
    !RULE_ID.test(id) ||
    typeof limitProfileCode !== 'string' ||
    !PROFILE_CODE.test(limitProfileCode) ||
    !SUBJECTS.includes(subjectType as string) ||
    !Number.isSafeInteger(row.precedence) ||
    !Number.isSafeInteger(row.version) ||
    (row.version as number) < 1 ||
    typeof row.isActive !== 'boolean' ||
    windowState(row, 0) === 'Window unavailable'
  )
    return false;
  if (subjectType === 'GLOBAL') return subjectId === null && segmentCode === null;
  if (subjectType === 'SEGMENT')
    return subjectId === null && typeof segmentCode === 'string' && PROFILE_CODE.test(segmentCode);
  return segmentCode === null && typeof subjectId === 'string' && RULE_ID.test(subjectId);
}

export function registryRows(rows: DataRecord[], endpoint: string): DataRecord[] | null {
  const fields = DETAIL_FIELDS[endpoint];
  if (!fields) return rows; // Profiles and rules already have dedicated validation/projection.
  const seen = new Set<string>();
  const result: DataRecord[] = [];
  for (const row of rows) {
    const id = endpoint === '/internal/products' ? row.code : row.id;
    if (typeof id !== 'string' || !id.trim() || seen.has(id)) return null;
    seen.add(id);
    if (endpoint === '/internal/limit-assignments' && !assignmentIsValid(row)) return null;
    const projected = Object.fromEntries(
      fields.filter((key) => scalar(row[key])).map((key) => [key, row[key]]),
    );
    if (fields.includes('tiers') && Array.isArray(row.tiers)) {
      projected.tiers = row.tiers.map((tier: unknown) => {
        if (!tier || typeof tier !== 'object' || Array.isArray(tier)) return null;
        const record = tier as DataRecord;
        return Object.fromEntries(
          ['upToMinor', 'bps', 'flatMinor']
            .filter((key) => scalar(record[key]))
            .map((key) => [key, record[key]]),
        );
      });
    }
    result.push(projected);
  }
  return result;
}

export function targetingScope(row: DataRecord, family: 'commission' | 'reward'): string {
  const fields = family === 'commission' ? COMMISSION_TARGETS : REWARD_TARGETS;
  const targets = Object.entries(fields).filter(
    ([key]) => typeof row[key] === 'string' && row[key],
  );
  if (targets.length) return targets.map(([key, label]) => `${label}: ${row[key]}`).join(' · ');
  return Object.keys(fields).every((key) => row[key] === null)
    ? 'Untargeted within group'
    : 'Targeting unavailable';
}
