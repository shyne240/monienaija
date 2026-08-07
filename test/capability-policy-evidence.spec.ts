import {
  PolicyCollectionStatus,
  PolicyEvidenceFreshnessState,
  PolicySourceClass,
} from '../src/policy/capability-policy.enums';
import {
  A2RuntimeContextPolicyEvidenceAdapter,
  A3AccountBindingPolicyEvidenceAdapter,
  CompliancePolicyEvidenceAdapter,
  CustomerEligibilityPolicyEvidenceAdapter,
  CustomerLimitProfilePolicyEvidenceAdapter,
  CustomerPolicyEvidenceAdapter,
  CustomerRestrictionsPolicyEvidenceAdapter,
  OnboardingReadinessPolicyEvidenceAdapter,
  OperatingPermissionPolicyEvidenceAdapter,
  ProductEnrollmentPolicyEvidenceAdapter,
  RiskPolicyEvidenceAdapter,
} from '../src/policy/capability-policy-evidence.adapters';
import { PolicySourceEvidenceCoordinator } from '../src/policy/capability-policy-evidence.coordinator';
import type {
  PolicyEvidenceReadItem,
  PolicyEvidenceReadResult,
  PolicyEvidenceReader,
} from '../src/policy/capability-policy-evidence.types';
const CUSTOMER_ID = '00000000-0000-4000-8000-000000000001';
const OTHER_CUSTOMER_ID = '00000000-0000-4000-8000-000000000099';
const AT = '2026-08-07T10:00:00.000Z';

const principal = {
  type: 'SERVICE' as const,
  principalId: 'evidence-service',
  customerId: CUSTOMER_ID,
  audience: 'internal-policy',
  roles: ['policy'],
  scopes: ['policy:capability:evaluate'],
  customerAccess: 'ANY' as const,
  assuranceLevel: 'MFA' as const,
};

class FakeReader implements PolicyEvidenceReader {
  readonly contexts: Array<{ customerId: string; sourceClasses: readonly PolicySourceClass[] }> =
    [];

  constructor(private readonly result: PolicyEvidenceReadResult) {}

  read(context: { customerId: string; requiredSourceClasses: readonly PolicySourceClass[] }) {
    this.contexts.push({
      customerId: context.customerId,
      sourceClasses: context.requiredSourceClasses,
    });
    return Promise.resolve(this.result);
  }
}

function context(requiredSourceClasses: readonly PolicySourceClass[]) {
  return {
    customerId: CUSTOMER_ID,
    capability: 'wallet.transfer',
    action: 'create',
    requestedAt: AT,
    asOf: AT,
    evidenceProfile: 'profile.wallet-transfer-create.v1',
    requiredSourceClasses,
    actorContext: { principal },
    requestContext: {
      requestId: 'evidence-request-1',
      correlationId: 'evidence-correlation-1',
    },
  };
}

function result(
  sourceType: string,
  status: PolicyEvidenceReadResult['status'] = 'COMPLETE',
  items: readonly PolicyEvidenceReadItem[] = [],
): PolicyEvidenceReadResult {
  return {
    status,
    sourceType,
    observedAt: AT,
    items,
    classification: 'Restricted',
  };
}

function item(
  sourceType: string,
  sourceClass: PolicySourceClass,
  overrides: Partial<PolicyEvidenceReadItem> = {},
): PolicyEvidenceReadItem {
  return {
    sourceType,
    sourceId: `${sourceClass.toLowerCase()}-1`,
    customerId: CUSTOMER_ID,
    sourceVersion: 1,
    sourceUpdatedAt: AT,
    observedAt: AT,
    deleted: false,
    freshnessState: PolicyEvidenceFreshnessState.CURRENT,
    classification: 'Restricted',
    normalizedValue: { status: 'ACTIVE', rawComment: 'must not be copied' },
    sourceReference: `${sourceClass.toLowerCase()}:1`,
    ...overrides,
  };
}

function adaptersFor(readers: Readonly<Record<PolicySourceClass, PolicyEvidenceReader>>) {
  return [
    new CustomerPolicyEvidenceAdapter(readers[PolicySourceClass.CUSTOMER]),
    new OnboardingReadinessPolicyEvidenceAdapter(readers[PolicySourceClass.ONBOARDING]),
    new CustomerEligibilityPolicyEvidenceAdapter(readers[PolicySourceClass.ELIGIBILITY]),
    new CustomerRestrictionsPolicyEvidenceAdapter(readers[PolicySourceClass.RESTRICTIONS]),
    new CustomerLimitProfilePolicyEvidenceAdapter(readers[PolicySourceClass.LIMITS]),
    new ProductEnrollmentPolicyEvidenceAdapter(readers[PolicySourceClass.ENROLLMENT]),
    new OperatingPermissionPolicyEvidenceAdapter(readers[PolicySourceClass.PERMISSIONS]),
    new RiskPolicyEvidenceAdapter(readers[PolicySourceClass.RISK]),
    new CompliancePolicyEvidenceAdapter(readers[PolicySourceClass.COMPLIANCE]),
    new A2RuntimeContextPolicyEvidenceAdapter(readers[PolicySourceClass.AUTHORIZATION]),
    new A3AccountBindingPolicyEvidenceAdapter(readers[PolicySourceClass.ACCOUNT_BINDING]),
  ];
}

describe('A4 source-evidence adapters and coordinator', () => {
  it('normalizes a source item, allowlists fields, and marks customer mismatch as conflicting', async () => {
    const reader = new FakeReader(
      result('Customer', 'COMPLETE', [
        item('Customer', PolicySourceClass.CUSTOMER, {
          customerId: OTHER_CUSTOMER_ID,
          normalizedValue: {
            status: 'ACTIVE',
            version: 4,
            rawComment: 'restricted',
          },
        }),
      ]),
    );
    const adapter = new CustomerPolicyEvidenceAdapter(reader);

    const output = await adapter.collect(context([PolicySourceClass.CUSTOMER]));

    expect(output.collectionStatus).toBe('COMPLETE');
    expect(output.sourceClass).toBe(PolicySourceClass.CUSTOMER);
    expect(output.items[0]).toMatchObject({
      customerId: CUSTOMER_ID,
      freshnessState: PolicyEvidenceFreshnessState.CONFLICTING,
      freshnessReasonCode: 'SOURCE_CUSTOMER_MISMATCH',
    });
    expect(output.items[0]?.normalizedValue).toEqual({ status: 'ACTIVE', version: 4 });
    expect(reader.contexts).toHaveLength(1);
  });

  it('assembles all declared source classes into a deterministic immutable snapshot', async () => {
    const sourceClasses = Object.values(PolicySourceClass);
    const readers = Object.fromEntries(
      sourceClasses.map((sourceClass) => [
        sourceClass,
        new FakeReader(result(sourceClass, 'COMPLETE', [item(sourceClass, sourceClass)])),
      ]),
    ) as unknown as Readonly<Record<PolicySourceClass, PolicyEvidenceReader>>;
    const firstCoordinator = new PolicySourceEvidenceCoordinator(adaptersFor(readers), {
      now: () => new Date(AT),
    });
    const secondCoordinator = new PolicySourceEvidenceCoordinator(
      [...adaptersFor(readers)].reverse(),
      { now: () => new Date(AT) },
    );

    const first = await firstCoordinator.collect(context(sourceClasses));
    const second = await secondCoordinator.collect(context(sourceClasses));

    expect(first.collection.status).toBe(PolicyCollectionStatus.COMPLETE);
    expect(first.sourceItems).toHaveLength(sourceClasses.length);
    expect(first.evidenceSummary.normalizedInputHash).toBe(
      second.evidenceSummary.normalizedInputHash,
    );
    expect(first.snapshotReference).toBe(second.snapshotReference);
    expect(first.sourceItems.map((source) => source.sourceClass)).toEqual(
      [...first.sourceItems].map((source) => source.sourceClass).sort(),
    );
    expect(JSON.stringify(first)).not.toContain('rawComment');
    expect(JSON.stringify(first)).not.toContain('must not be copied');
  });

  it('preserves missing, stale, and unavailable evidence instead of fabricating current data', async () => {
    const sourceClasses = [
      PolicySourceClass.CUSTOMER,
      PolicySourceClass.ONBOARDING,
      PolicySourceClass.ELIGIBILITY,
      PolicySourceClass.AUTHORIZATION,
    ] as const;
    const readers = {
      [PolicySourceClass.CUSTOMER]: new FakeReader(
        result('Customer', 'COMPLETE', [item('Customer', PolicySourceClass.CUSTOMER)]),
      ),
      [PolicySourceClass.ONBOARDING]: new FakeReader(result('CustomerOnboarding', 'MISSING')),
      [PolicySourceClass.ELIGIBILITY]: new FakeReader(
        result('CustomerEligibility', 'COMPLETE', [
          item('CustomerEligibility', PolicySourceClass.ELIGIBILITY, {
            freshnessState: PolicyEvidenceFreshnessState.STALE,
          }),
        ]),
      ),
      [PolicySourceClass.AUTHORIZATION]: new FakeReader(
        result('A2AuthorizationContext', 'UNAVAILABLE'),
      ),
    } as unknown as Readonly<Record<PolicySourceClass, PolicyEvidenceReader>>;
    const coordinator = new PolicySourceEvidenceCoordinator(adaptersFor(readers), {
      now: () => new Date(AT),
    });

    const snapshot = await coordinator.collect(context(sourceClasses));

    expect(snapshot.collection.status).toBe(PolicyCollectionStatus.UNAVAILABLE);
    expect(snapshot.collection.missingSourceClasses).toContain(PolicySourceClass.ONBOARDING);
    expect(snapshot.collection.unavailableSourceClasses).toContain(PolicySourceClass.AUTHORIZATION);
    expect(snapshot.sourceItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceClass: PolicySourceClass.ONBOARDING,
          freshnessState: PolicyEvidenceFreshnessState.MISSING,
        }),
        expect.objectContaining({
          sourceClass: PolicySourceClass.ELIGIBILITY,
          freshnessState: PolicyEvidenceFreshnessState.STALE,
        }),
        expect.objectContaining({
          sourceClass: PolicySourceClass.AUTHORIZATION,
          freshnessState: PolicyEvidenceFreshnessState.UNAVAILABLE,
        }),
      ]),
    );
    expect(snapshot.evidenceSummary.freshnessStates).toEqual(
      expect.arrayContaining([
        PolicyEvidenceFreshnessState.MISSING,
        PolicyEvidenceFreshnessState.STALE,
        PolicyEvidenceFreshnessState.UNAVAILABLE,
      ]),
    );
  });

  it('exposes the complete set of read-only source adapters without write methods', () => {
    const sourceClasses = Object.values(PolicySourceClass);
    const readers = Object.fromEntries(
      sourceClasses.map((sourceClass) => [sourceClass, new FakeReader(result(sourceClass))]),
    ) as unknown as Readonly<Record<PolicySourceClass, PolicyEvidenceReader>>;
    const adapters = adaptersFor(readers);

    expect(adapters.map((adapter) => adapter.sourceClass).sort()).toEqual(sourceClasses.sort());
    expect(adapters.every((adapter) => !('write' in adapter))).toBe(true);
    expect(adapters.every((adapter) => !('mutate' in adapter))).toBe(true);
  });
});
