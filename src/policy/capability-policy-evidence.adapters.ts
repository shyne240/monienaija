import { createHash } from 'node:crypto';

import { PolicyEvidenceFreshnessState, PolicySourceClass } from './capability-policy.enums';
import type {
  PolicyEvidenceAdapter,
  PolicyEvidenceAdapterResult,
  PolicyEvidenceCollectionContext,
  PolicyEvidenceReadItem,
  PolicyEvidenceReadResult,
  PolicyEvidenceReader,
} from './capability-policy-evidence.types';
import {
  POLICY_EVIDENCE_ADAPTER_CONTRACT,
  POLICY_EVIDENCE_ADAPTER_CONTRACT_VERSION,
} from './capability-policy-evidence.types';
import type { PolicyEvidenceItem, PolicyJsonValue } from './capability-policy.types';

const SAFE_CODE_PATTERN = /^[A-Z0-9_.:-]{1,120}$/;

const ALLOWED_FIELDS: Readonly<Record<PolicySourceClass, readonly string[]>> = {
  [PolicySourceClass.CUSTOMER]: ['status', 'version'],
  [PolicySourceClass.ONBOARDING]: [
    'status',
    'version',
    'readinessStatus',
    'readinessEvaluatedAt',
    'approvedAt',
    'completedAt',
  ],
  [PolicySourceClass.ELIGIBILITY]: ['status', 'version', 'statusChangedAt'],
  [PolicySourceClass.RESTRICTIONS]: ['type', 'active', 'isActive', 'version'],
  [PolicySourceClass.LIMITS]: [
    'profileVersion',
    'currency',
    'dailyTransactionCount',
    'dailyTransactionAmountMinor',
    'singleTransactionAmountMinor',
    'monthlyTransactionAmountMinor',
    'walletBalanceMinor',
  ],
  [PolicySourceClass.ENROLLMENT]: ['product', 'status', 'version', 'statusChangedAt'],
  [PolicySourceClass.PERMISSIONS]: ['type', 'enabled', 'version'],
  [PolicySourceClass.RISK]: [
    'sourceKind',
    'status',
    'riskLevel',
    'overallRiskLevel',
    'assessmentDate',
    'reviewDueDate',
    'factorReferences',
    'version',
  ],
  [PolicySourceClass.COMPLIANCE]: [
    'casePresent',
    'category',
    'severity',
    'status',
    'resolutionReference',
    'assignmentReference',
    'version',
    'openedAt',
    'updatedAt',
    'closedAt',
  ],
  [PolicySourceClass.ACCOUNT_BINDING]: [
    'bindingId',
    'customerWalletId',
    'walletAccountId',
    'ledgerAccountId',
    'state',
    'bindingState',
    'currency',
    'accountingUnit',
    'sourceCustomerVersion',
    'sourceCustomerWalletVersion',
    'bindingVersion',
    'dimensionsCompatible',
    'ledgerIsActive',
    'reconciliationStatus',
  ],
  [PolicySourceClass.AUTHORIZATION]: [
    'principalType',
    'principalId',
    'customerId',
    'audience',
    'assuranceLevel',
    'allowed',
    'authorizationReference',
    'evaluatedAt',
  ],
};

const DEFAULT_CLASSIFICATION: Readonly<Record<PolicySourceClass, string>> = {
  [PolicySourceClass.CUSTOMER]: 'Restricted',
  [PolicySourceClass.ONBOARDING]: 'Restricted',
  [PolicySourceClass.ELIGIBILITY]: 'Restricted',
  [PolicySourceClass.RESTRICTIONS]: 'Restricted',
  [PolicySourceClass.LIMITS]: 'Restricted financial/customer data',
  [PolicySourceClass.ENROLLMENT]: 'Restricted',
  [PolicySourceClass.PERMISSIONS]: 'Restricted',
  [PolicySourceClass.RISK]: 'Highly Restricted',
  [PolicySourceClass.COMPLIANCE]: 'Highly Restricted',
  [PolicySourceClass.ACCOUNT_BINDING]: 'Highly Restricted financial/control data',
  [PolicySourceClass.AUTHORIZATION]: 'Restricted security context',
};

abstract class ReadOnlyPolicyEvidenceAdapter implements PolicyEvidenceAdapter {
  abstract readonly sourceClass: PolicySourceClass;

  protected constructor(
    private readonly reader: PolicyEvidenceReader,
    private readonly sourceType: string,
  ) {}

  async collect(context: PolicyEvidenceCollectionContext): Promise<PolicyEvidenceAdapterResult> {
    let readResult: PolicyEvidenceReadResult;
    try {
      readResult = await this.reader.read(context);
    } catch {
      readResult = {
        status: 'UNAVAILABLE',
        sourceType: this.sourceType,
        observedAt: new Date().toISOString(),
        items: [],
        classification: DEFAULT_CLASSIFICATION[this.sourceClass],
        failureReference: 'SOURCE_READ_FAILED',
      };
    }

    const items = this.normalizeItems(readResult, context);
    return {
      contractName: POLICY_EVIDENCE_ADAPTER_CONTRACT,
      contractVersion: POLICY_EVIDENCE_ADAPTER_CONTRACT_VERSION,
      sourceClass: this.sourceClass,
      collectionStatus: readResult.status,
      sourceType: readResult.sourceType || this.sourceType,
      observedAt: readResult.observedAt,
      items,
      ...(readResult.failureReference ? { failureReference: readResult.failureReference } : {}),
    };
  }

  private normalizeItems(
    result: PolicyEvidenceReadResult,
    context: PolicyEvidenceCollectionContext,
  ): PolicyEvidenceItem[] {
    if (result.items.length === 0) {
      if (result.status === 'COMPLETE') return [];
      return [
        this.degradedItem(
          result,
          context,
          result.status === 'MISSING'
            ? PolicyEvidenceFreshnessState.MISSING
            : result.status === 'RESTRICTED'
              ? PolicyEvidenceFreshnessState.RESTRICTED
              : result.status === 'CONFLICTING'
                ? PolicyEvidenceFreshnessState.CONFLICTING
                : PolicyEvidenceFreshnessState.UNAVAILABLE,
        ),
      ];
    }
    return result.items.map((item) => this.normalizeItem(item, result, context));
  }

  private normalizeItem(
    item: PolicyEvidenceReadItem,
    result: PolicyEvidenceReadResult,
    context: PolicyEvidenceCollectionContext,
  ): PolicyEvidenceItem {
    const sourceCustomerId = item.customerId?.trim().toLowerCase() ?? context.customerId;
    const subjectConflict =
      item.customerId !== undefined &&
      item.customerId !== null &&
      sourceCustomerId !== context.customerId;
    const freshnessState = subjectConflict
      ? PolicyEvidenceFreshnessState.CONFLICTING
      : item.deleted
        ? PolicyEvidenceFreshnessState.DELETED
        : (item.freshnessState ?? statusFreshness(result.status));
    const freshnessReasonCode = subjectConflict
      ? 'SOURCE_CUSTOMER_MISMATCH'
      : (item.freshnessReasonCode ?? result.freshnessReasonCode);
    const sourceId = item.sourceId ?? null;
    const sourceType = item.sourceType ?? result.sourceType ?? this.sourceType;
    const classification =
      item.classification ?? result.classification ?? DEFAULT_CLASSIFICATION[this.sourceClass];
    return {
      sourceClass: this.sourceClass,
      sourceType,
      sourceId,
      customerId: context.customerId,
      sourceVersion: item.sourceVersion ?? null,
      sourceUpdatedAt: item.sourceUpdatedAt ?? null,
      observedAt: item.observedAt ?? result.observedAt,
      deleted: item.deleted ?? false,
      freshnessState,
      ...(freshnessReasonCode ? { freshnessReasonCode: safeCode(freshnessReasonCode) } : {}),
      classification,
      normalizedValue: sanitizeNormalizedValue(this.sourceClass, item.normalizedValue),
      sourceReference: item.sourceReference ?? sourceId,
    };
  }

  private degradedItem(
    result: PolicyEvidenceReadResult,
    context: PolicyEvidenceCollectionContext,
    freshnessState: PolicyEvidenceFreshnessState,
  ): PolicyEvidenceItem {
    const reason =
      result.freshnessReasonCode ?? result.failureReference ?? `SOURCE_${freshnessState}`;
    return {
      sourceClass: this.sourceClass,
      sourceType: result.sourceType || this.sourceType,
      sourceId: null,
      customerId: context.customerId,
      sourceVersion: null,
      sourceUpdatedAt: null,
      observedAt: result.observedAt,
      deleted: false,
      freshnessState,
      freshnessReasonCode: safeCode(reason),
      classification: result.classification || DEFAULT_CLASSIFICATION[this.sourceClass],
      normalizedValue: {},
      sourceReference: result.failureReference ?? null,
    };
  }
}

export class CustomerPolicyEvidenceAdapter extends ReadOnlyPolicyEvidenceAdapter {
  readonly sourceClass = PolicySourceClass.CUSTOMER;
  constructor(reader: PolicyEvidenceReader) {
    super(reader, 'Customer');
  }
}

export class OnboardingReadinessPolicyEvidenceAdapter extends ReadOnlyPolicyEvidenceAdapter {
  readonly sourceClass = PolicySourceClass.ONBOARDING;
  constructor(reader: PolicyEvidenceReader) {
    super(reader, 'CustomerOnboardingReadiness');
  }
}

export class CustomerEligibilityPolicyEvidenceAdapter extends ReadOnlyPolicyEvidenceAdapter {
  readonly sourceClass = PolicySourceClass.ELIGIBILITY;
  constructor(reader: PolicyEvidenceReader) {
    super(reader, 'CustomerEligibility');
  }
}

export class CustomerRestrictionsPolicyEvidenceAdapter extends ReadOnlyPolicyEvidenceAdapter {
  readonly sourceClass = PolicySourceClass.RESTRICTIONS;
  constructor(reader: PolicyEvidenceReader) {
    super(reader, 'CustomerRestriction');
  }
}

export class CustomerLimitProfilePolicyEvidenceAdapter extends ReadOnlyPolicyEvidenceAdapter {
  readonly sourceClass = PolicySourceClass.LIMITS;
  constructor(reader: PolicyEvidenceReader) {
    super(reader, 'CustomerLimitProfile');
  }
}

export class ProductEnrollmentPolicyEvidenceAdapter extends ReadOnlyPolicyEvidenceAdapter {
  readonly sourceClass = PolicySourceClass.ENROLLMENT;
  constructor(reader: PolicyEvidenceReader) {
    super(reader, 'CustomerProductEnrollment');
  }
}

export class OperatingPermissionPolicyEvidenceAdapter extends ReadOnlyPolicyEvidenceAdapter {
  readonly sourceClass = PolicySourceClass.PERMISSIONS;
  constructor(reader: PolicyEvidenceReader) {
    super(reader, 'CustomerOperatingPermission');
  }
}

export class RiskPolicyEvidenceAdapter extends ReadOnlyPolicyEvidenceAdapter {
  readonly sourceClass = PolicySourceClass.RISK;
  constructor(reader: PolicyEvidenceReader) {
    super(reader, 'CustomerRiskProfile');
  }
}

export class CompliancePolicyEvidenceAdapter extends ReadOnlyPolicyEvidenceAdapter {
  readonly sourceClass = PolicySourceClass.COMPLIANCE;
  constructor(reader: PolicyEvidenceReader) {
    super(reader, 'CustomerComplianceCase');
  }
}

export class A2RuntimeContextPolicyEvidenceAdapter extends ReadOnlyPolicyEvidenceAdapter {
  readonly sourceClass = PolicySourceClass.AUTHORIZATION;
  constructor(reader: PolicyEvidenceReader) {
    super(reader, 'A2AuthorizationContext');
  }
}

export class A3AccountBindingPolicyEvidenceAdapter extends ReadOnlyPolicyEvidenceAdapter {
  readonly sourceClass = PolicySourceClass.ACCOUNT_BINDING;
  constructor(reader: PolicyEvidenceReader) {
    super(reader, 'CustomerFinancialAccountBinding');
  }
}

function statusFreshness(status: PolicyEvidenceReadResult['status']): PolicyEvidenceFreshnessState {
  switch (status) {
    case 'COMPLETE':
      return PolicyEvidenceFreshnessState.CURRENT;
    case 'MISSING':
      return PolicyEvidenceFreshnessState.MISSING;
    case 'UNAVAILABLE':
      return PolicyEvidenceFreshnessState.UNAVAILABLE;
    case 'RESTRICTED':
      return PolicyEvidenceFreshnessState.RESTRICTED;
    case 'CONFLICTING':
      return PolicyEvidenceFreshnessState.CONFLICTING;
  }
}

function sanitizeNormalizedValue(
  sourceClass: PolicySourceClass,
  value: Readonly<Record<string, unknown>>,
): Readonly<Record<string, PolicyJsonValue>> {
  const allowed = new Set(ALLOWED_FIELDS[sourceClass]);
  const output: Record<string, PolicyJsonValue> = {};
  for (const field of allowed) {
    if (value[field] !== undefined) {
      output[field] = toJsonValue(value[field]);
    }
  }
  return output;
}

function toJsonValue(value: unknown): PolicyJsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((entry) => toJsonValue(entry));
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(record).map(([key, entry]) => [key, toJsonValue(entry)]),
    ) as { readonly [key: string]: PolicyJsonValue };
  }
  return null;
}

function safeCode(value: string): string {
  const normalized = value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_.:-]/g, '_');
  return SAFE_CODE_PATTERN.test(normalized) ? normalized : 'SOURCE_EVIDENCE_DEGRADED';
}

export function defaultSnapshotReference(normalizedInputHash: string): string {
  return `a4-snapshot-${createHash('sha256').update(normalizedInputHash).digest('hex')}`;
}
