/**
 * Two defects the Tier 1 Admin Web acceptance run found, pinned so neither can come back silently.
 *
 * 1. `CustomerEffectiveConfigurationService` located the institution for the regulatory tier
 *    ceiling ONLY through `wallet_accounts.institution_id`. Between staff completion and the
 *    customer's own claim there is no wallet yet, so the staff screen showed the commercial
 *    ceiling (NGN 10,000,000) while the customer's first transfer would be governed by the lower
 *    approved institution cap (NGN 5,000,000). The read now falls back to the ACTIVE institution
 *    enrolment, which is the institutional relationship that predates the wallet, so display and
 *    enforcement agree at every stage.
 *
 * 2. `AdminCustomerController` takes `InstitutionWorkforceScopeService` as `@Optional()`, but
 *    `AdminModule` did not import the module that provides it. The dependency resolved to
 *    `undefined` at runtime and `assertRecordScope` returned immediately — so every staff
 *    principal, assigned or not, could read every enrolled customer's registration review.
 *
 * These are unit-level assertions about wiring and fallback selection; the end-to-end behaviour is
 * proved by the browser acceptance run against disposable PostgreSQL.
 */
import { AdminModule } from '../src/admin/admin.module';
import { InstitutionModule } from '../src/institution/institution.module';
import { CustomerEffectiveConfigurationService } from '../src/customer-onboarding/customer-effective-configuration.service';

const CUSTOMER_ID = '11111111-1111-4111-8111-111111111111';
const ENROLLED_INSTITUTION_ID = '22222222-2222-4222-8222-222222222222';
const WALLET_INSTITUTION_ID = '33333333-3333-4333-8333-333333333333';

/** Minimal EntityManager double: answers the queries this service issues, records them. */
function fakeManager(options: {
  walletInstitutionId: string | null;
  enrolmentInstitutionId: string | null;
}) {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const manager = {
    query: jest.fn((sql: string, params: unknown[] = []) => {
      queries.push({ sql, params });
      const text = String(sql);
      if (/FROM customers\s+WHERE id = \$1/i.test(text))
        return Promise.resolve([{ kyc_level: 'LEVEL_1' }]);
      if (/FROM products/i.test(text)) return Promise.resolve([]);
      if (/FROM customer_tier_default_classes/i.test(text)) return Promise.resolve([]);
      if (/FROM wallet_accounts/i.test(text)) {
        return Promise.resolve(
          options.walletInstitutionId ? [{ institution_id: options.walletInstitutionId }] : [],
        );
      }
      if (/FROM customer_institution_enrolments/i.test(text)) {
        return Promise.resolve(
          options.enrolmentInstitutionId
            ? [{ institution_id: options.enrolmentInstitutionId }]
            : [],
        );
      }
      return Promise.resolve([]);
    }),
  };
  return { manager: manager as never, queries };
}

function buildService(options: {
  walletInstitutionId: string | null;
  enrolmentInstitutionId: string | null;
}) {
  const { manager, queries } = fakeManager(options);
  const tierLimitPolicies = { enforcementEnabled: true, resolveWithManager: jest.fn() };
  const customerEligibility = {
    require: jest.fn(() => Promise.resolve('LEVEL_1' as const)),
  };
  const service = new CustomerEffectiveConfigurationService(
    { transaction: jest.fn() } as never,
    { resolveInManager: jest.fn(() => Promise.resolve(null)) } as never,
    { resolveWithManager: jest.fn(() => Promise.resolve({ status: 'NOT_CONFIGURED' })) } as never,
    { compute: jest.fn() } as never,
    { resolve: jest.fn(() => Promise.resolve(null)) } as never,
    tierLimitPolicies as never,
    customerEligibility as never,
  );
  return { service, manager, queries, customerEligibility };
}

describe('Tier 1 effective configuration — institution resolution for the tier ceiling', () => {
  it('uses the attributed wallet institution once a wallet exists', async () => {
    const { service, manager, customerEligibility } = buildService({
      walletInstitutionId: WALLET_INSTITUTION_ID,
      enrolmentInstitutionId: ENROLLED_INSTITUTION_ID,
    });

    await service.evaluateInManager(manager, CUSTOMER_ID);

    expect(customerEligibility.require).toHaveBeenCalledTimes(1);
  });

  it('falls back to the ACTIVE enrolment before the wallet exists, so staff see the governed ceiling', async () => {
    const { service, manager, queries, customerEligibility } = buildService({
      walletInstitutionId: null,
      enrolmentInstitutionId: ENROLLED_INSTITUTION_ID,
    });

    await service.evaluateInManager(manager, CUSTOMER_ID);

    // The trusted tier gate is only consulted when an institution was resolved; without the
    // fallback it is skipped and no approved tier policy can ever reach the display.
    expect(customerEligibility.require).toHaveBeenCalledTimes(1);
    expect(customerEligibility.require).toHaveBeenCalledWith(manager, CUSTOMER_ID, {
      lockMode: 'NONE',
    });
    const enrolmentLookup = queries.find((entry) =>
      /FROM customer_institution_enrolments/i.test(entry.sql),
    );
    expect(enrolmentLookup).toBeDefined();
    // Only ACTIVE enrolments grant institutional reach — a closed or suspended one must not.
    expect(enrolmentLookup!.sql).toMatch(/status = 'ACTIVE'/i);
  });

  it('stays on the commercial path for a customer with neither a wallet nor an enrolment', async () => {
    const { service, manager, customerEligibility } = buildService({
      walletInstitutionId: null,
      enrolmentInstitutionId: null,
    });

    await service.evaluateInManager(manager, CUSTOMER_ID);

    expect(customerEligibility.require).not.toHaveBeenCalled();
  });
});

describe('AdminModule — institution scope wiring', () => {
  it('imports InstitutionModule so the registration-review scope guard is actually injected', () => {
    const imports = Reflect.getMetadata('imports', AdminModule) as unknown[];
    expect(Array.isArray(imports)).toBe(true);
    // `InstitutionWorkforceScopeService` is provided and exported by InstitutionModule only. If
    // this import is removed, the controller's @Optional() dependency silently becomes
    // `undefined` and institution scope stops being enforced on the staff reads.
    expect(imports).toContain(InstitutionModule);
  });
});
