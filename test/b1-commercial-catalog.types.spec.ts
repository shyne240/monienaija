import {
  B1_COMMERCIAL_CATALOG_AUDIT_ACTOR,
  B1_COMMERCIAL_CATALOG_AUDIT_ENTITY_TYPE,
  B1_COMMERCIAL_CATALOG_BILLING_CYCLE_PER_TRANSACTION,
  B1_COMMERCIAL_CATALOG_BUNDLE_KEY,
  B1_COMMERCIAL_CATALOG_CAPABILITY_COMMISSION,
  B1_COMMERCIAL_CATALOG_CAPABILITY_FEE,
  B1_COMMERCIAL_CATALOG_CONTRACT_NAME,
  B1_COMMERCIAL_CATALOG_CONTRACT_VERSION,
  B1_COMMERCIAL_CATALOG_CUSTOMER_TIER_KEY,
  B1_COMMERCIAL_CATALOG_FAILURE_QUERY_UNAVAILABLE,
  B1_COMMERCIAL_CATALOG_FEATURE_FLAG_FEE,
  B1_COMMERCIAL_CATALOG_INTERNAL_IDEMPOTENCY_SCOPE,
  B1_COMMERCIAL_CATALOG_LOOKUP_KINDS,
  B1_COMMERCIAL_CATALOG_MERCHANT_TIER_KEY,
  B1_COMMERCIAL_CATALOG_OUTBOX_EVENT_TYPE,
  B1_COMMERCIAL_CATALOG_PACKAGE_KEY,
  B1_COMMERCIAL_CATALOG_PARTNER_TIER_KEY,
  B1_COMMERCIAL_CATALOG_PLAN_KEY_COMMISSION,
  B1_COMMERCIAL_CATALOG_PLAN_KEY_FEE,
  B1_COMMERCIAL_CATALOG_PRICING_KEYS,
  B1_COMMERCIAL_CATALOG_PRODUCT_ENTITLEMENT_KEY_COMMISSION,
  B1_COMMERCIAL_CATALOG_PRODUCT_ENTITLEMENT_KEY_FEE,
  B1_COMMERCIAL_CATALOG_SCOPE_ACCOUNTING_UNIT,
  B1_COMMERCIAL_CATALOG_SCOPE_CURRENCY,
  B1_COMMERCIAL_CATALOG_SCOPE_DIRECTION,
  B1_COMMERCIAL_CATALOG_SCOPE_KEY,
  B1_COMMERCIAL_CATALOG_SCOPE_PARTNER_DEPENDENCY,
  B1_COMMERCIAL_CATALOG_SCOPE_PRODUCT_DEPENDENCY,
  B1_COMMERCIAL_CATALOG_SCOPE_VERSION,
  B1_COMMERCIAL_CATALOG_STATE_ADMITTED,
  B1_COMMERCIAL_CATALOG_STATES,
  B1_COMMERCIAL_CATALOG_SUBSCRIPTION_PLAN_KEY,
} from '../src/policy/b1-commercial-catalog.constants';

describe('B1 commercial catalog types (B1T03)', () => {
  it('exposes the B1 commercial catalog first commercial scope identity constants', () => {
    expect(B1_COMMERCIAL_CATALOG_SCOPE_KEY).toBe('commercial.virtual-account.inbound-funding');
    expect(B1_COMMERCIAL_CATALOG_SCOPE_VERSION).toBe(1);
    expect(B1_COMMERCIAL_CATALOG_SCOPE_DIRECTION).toBe('inbound');
    expect(B1_COMMERCIAL_CATALOG_SCOPE_CURRENCY).toBe('NGN');
    expect(B1_COMMERCIAL_CATALOG_SCOPE_ACCOUNTING_UNIT).toBe('CUSTOMER_FUNDS');
    expect(B1_COMMERCIAL_CATALOG_SCOPE_PARTNER_DEPENDENCY).toBe('NIBSS_NIP');
    expect(B1_COMMERCIAL_CATALOG_SCOPE_PRODUCT_DEPENDENCY).toBe('VIRTUAL_ACCOUNT');
  });

  it('exposes the B1 commercial catalog contract name and version', () => {
    expect(B1_COMMERCIAL_CATALOG_CONTRACT_NAME).toBe('B1-COMMERCIAL-CATALOG');
    expect(B1_COMMERCIAL_CATALOG_CONTRACT_VERSION).toBe(1);
  });

  it('exposes the B1 commercial catalog capability identity', () => {
    expect(B1_COMMERCIAL_CATALOG_CAPABILITY_FEE).toBe(
      'commercial.virtual-account.inbound-funding.fee',
    );
    expect(B1_COMMERCIAL_CATALOG_CAPABILITY_COMMISSION).toBe(
      'commercial.virtual-account.inbound-funding.commission',
    );
  });

  it('exposes the B1 commercial catalog plan identity', () => {
    expect(B1_COMMERCIAL_CATALOG_PLAN_KEY_FEE).toBe(
      'commercial.virtual-account.inbound-funding.fee.v1.plan.standard',
    );
    expect(B1_COMMERCIAL_CATALOG_PLAN_KEY_COMMISSION).toBe(
      'commercial.virtual-account.inbound-funding.commission.v1.plan.standard',
    );
  });

  it('exposes the B1 commercial catalog customer / merchant / partner tier identity', () => {
    expect(B1_COMMERCIAL_CATALOG_CUSTOMER_TIER_KEY).toBe('commercial.customer.tier.standard.v1');
    expect(B1_COMMERCIAL_CATALOG_MERCHANT_TIER_KEY).toBe('commercial.merchant.tier.standard.v1');
    expect(B1_COMMERCIAL_CATALOG_PARTNER_TIER_KEY).toBe('commercial.partner.tier.standard.v1');
  });

  it('exposes the B1 commercial catalog product entitlement identity', () => {
    expect(B1_COMMERCIAL_CATALOG_PRODUCT_ENTITLEMENT_KEY_FEE).toBe(
      'commercial.virtual-account.inbound-funding.entitlement.fee.v1',
    );
    expect(B1_COMMERCIAL_CATALOG_PRODUCT_ENTITLEMENT_KEY_COMMISSION).toBe(
      'commercial.virtual-account.inbound-funding.entitlement.commission.v1',
    );
  });

  it('exposes the B1 commercial catalog package and bundle identity', () => {
    expect(B1_COMMERCIAL_CATALOG_PACKAGE_KEY).toBe(
      'commercial.virtual-account.inbound-funding.package.fee.commission.v1',
    );
    expect(B1_COMMERCIAL_CATALOG_BUNDLE_KEY).toBe(
      'commercial.virtual-account.inbound-funding.bundle.fee.commission.v1',
    );
  });

  it('exposes the B1 commercial catalog subscription plan identity', () => {
    expect(B1_COMMERCIAL_CATALOG_SUBSCRIPTION_PLAN_KEY).toBe(
      'commercial.virtual-account.inbound-funding.subscription.standard.v1',
    );
  });

  it('exposes the B1 commercial catalog feature flag identity', () => {
    expect(B1_COMMERCIAL_CATALOG_FEATURE_FLAG_FEE).toBe(
      'commercial.virtual-account.inbound-funding.fee.enabled',
    );
  });

  it('exposes the B1 commercial catalog state vocabulary', () => {
    expect(B1_COMMERCIAL_CATALOG_STATE_ADMITTED).toBe('COMMERCIAL_DECISION_ADMITTED');
    expect(B1_COMMERCIAL_CATALOG_STATES.length).toBe(6);
  });

  it('exposes the B1 commercial catalog billing cycle', () => {
    expect(B1_COMMERCIAL_CATALOG_BILLING_CYCLE_PER_TRANSACTION).toBe('PER_TRANSACTION');
  });

  it('exposes the B1 commercial catalog internal idempotency scope', () => {
    expect(B1_COMMERCIAL_CATALOG_INTERNAL_IDEMPOTENCY_SCOPE).toBe(
      'b1.commercial-catalog.idempotency.v1',
    );
  });

  it('exposes the B1 commercial catalog outbox event type', () => {
    expect(B1_COMMERCIAL_CATALOG_OUTBOX_EVENT_TYPE).toBe('B1CommercialCatalogRegistered');
  });

  it('exposes the B1 commercial catalog audit actor and entity type', () => {
    expect(B1_COMMERCIAL_CATALOG_AUDIT_ACTOR).toBe('b1-commercial-catalog');
    expect(B1_COMMERCIAL_CATALOG_AUDIT_ENTITY_TYPE).toBe('B1_COMMERCIAL_CATALOG');
  });

  it('exposes the B1 commercial catalog lookup kind vocabulary', () => {
    expect(B1_COMMERCIAL_CATALOG_LOOKUP_KINDS).toContain('CATALOG');
    expect(B1_COMMERCIAL_CATALOG_LOOKUP_KINDS).toContain('PLAN');
    expect(B1_COMMERCIAL_CATALOG_LOOKUP_KINDS).toContain('CUSTOMER_TIER');
    expect(B1_COMMERCIAL_CATALOG_LOOKUP_KINDS).toContain('MERCHANT_TIER');
    expect(B1_COMMERCIAL_CATALOG_LOOKUP_KINDS).toContain('PARTNER_TIER');
    expect(B1_COMMERCIAL_CATALOG_LOOKUP_KINDS).toContain('PRODUCT_ENTITLEMENT');
    expect(B1_COMMERCIAL_CATALOG_LOOKUP_KINDS).toContain('PACKAGE');
    expect(B1_COMMERCIAL_CATALOG_LOOKUP_KINDS).toContain('BUNDLE');
    expect(B1_COMMERCIAL_CATALOG_LOOKUP_KINDS).toContain('SUBSCRIPTION_PLAN');
    expect(B1_COMMERCIAL_CATALOG_LOOKUP_KINDS).toContain('FEATURE_FLAG');
    expect(B1_COMMERCIAL_CATALOG_LOOKUP_KINDS).toContain('DYNAMIC_LIMIT');
    expect(B1_COMMERCIAL_CATALOG_LOOKUP_KINDS).toContain('PRICING_CATALOG');
    expect(B1_COMMERCIAL_CATALOG_LOOKUP_KINDS).toContain('CAPABILITY_PLANS');
    expect(B1_COMMERCIAL_CATALOG_LOOKUP_KINDS).toContain('CAPABILITY_PACKAGES');
    expect(B1_COMMERCIAL_CATALOG_LOOKUP_KINDS).toContain('CAPABILITY_BUNDLES');
  });

  it('exposes the B1 commercial catalog failure code vocabulary', () => {
    expect(B1_COMMERCIAL_CATALOG_FAILURE_QUERY_UNAVAILABLE).toBe(
      'B1_COMMERCIAL_CATALOG_QUERY_UNAVAILABLE',
    );
  });

  it('exposes the B1 commercial catalog pricing keys', () => {
    expect(B1_COMMERCIAL_CATALOG_PRICING_KEYS).toHaveLength(2);
  });
});
