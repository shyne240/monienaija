import { A7ProductCustomerBindingService } from '../src/policy/a7-product-customer-binding.service';
import type { A7ProductCustomerBindingRepository } from '../src/policy/a7-product-customer-binding.repository';
import type {
  A7ProductCustomerBindingA2AuthorizationContext,
  A7ProductCustomerBindingA3RecheckOutcome,
  A7ProductCustomerBindingA4ProductPolicyDecision,
  A7ProductCustomerBindingA6T04FundingTargetEvidence,
  A7ProductCustomerBindingBankDirectoryEntry,
  A7ProductCustomerBindingCommand,
  A7ProductCustomerBindingConsumerPorts,
  A7ProductCustomerBindingVirtualAccountEvidence,
} from '../src/policy/a7-product-customer-binding.types';
import type { RequestContext } from '../src/production/request-context';

const CUSTOMER_ID = '00000000-0000-4000-8000-000000000001';
const CUSTOMER_WALLET_ID = '00000000-0000-4000-8000-000000000002';
const BINDING_ID = '00000000-0000-4000-8000-000000000003';
const WALLET_ACCOUNT_ID = '00000000-0000-4000-8000-000000000004';
const LEDGER_ACCOUNT_ID = '00000000-0000-4000-8000-000000000005';
const VIRTUAL_ACCOUNT_ID = '00000000-0000-4000-8000-000000000006';
const REQUEST_ID = 'request-rcb-1';
const CORRELATION_ID = 'correlation-rcb-1';

function makeRequestContext(): RequestContext {
  return { requestId: REQUEST_ID, correlationId: CORRELATION_ID, traceId: 'trace-1' };
}

function makeA3Valid(): A7ProductCustomerBindingA3RecheckOutcome {
  return {
    valid: true,
    bindingId: BINDING_ID,
    customerId: CUSTOMER_ID,
    customerWalletId: CUSTOMER_WALLET_ID,
    walletAccountId: WALLET_ACCOUNT_ID,
    ledgerAccountId: LEDGER_ACCOUNT_ID,
    bindingVersion: 1,
    currency: 'NGN',
    accountingUnit: 'CUSTOMER_FUNDS',
    customerVersion: 1,
    customerWalletVersion: 1,
  };
}

function makeA3Invalid(
  code: string = 'A3_BINDING_NOT_ACTIVE',
  message: string = 'not active',
): A7ProductCustomerBindingA3RecheckOutcome {
  return { valid: false, code, message };
}

function makeVirtualAccount(
  status: 'ACTIVE' | 'DEACTIVATED' = 'ACTIVE',
  overrides: Partial<A7ProductCustomerBindingVirtualAccountEvidence> = {},
): A7ProductCustomerBindingVirtualAccountEvidence {
  return {
    virtualAccountId: VIRTUAL_ACCOUNT_ID,
    walletId: CUSTOMER_WALLET_ID,
    bankCode: '999',
    accountNumber: '0123456789',
    accountName: 'TEST ACCOUNT',
    provider: 'NIBSS_NIP',
    status,
    reference: 'va-ref-1',
    assignedAt: '2026-08-07T10:00:00.000Z',
    deactivatedAt: null,
    ...overrides,
  };
}

function makeA4(
  overrides: Partial<A7ProductCustomerBindingA4ProductPolicyDecision> = {},
): A7ProductCustomerBindingA4ProductPolicyDecision {
  return {
    decisionReference: 'a4-decision-1',
    productKey: 'VIRTUAL_ACCOUNT',
    capability: 'product.virtual-account',
    action: 'lifecycle',
    profileReference: 'profile.product-virtual-account-lifecycle.v1',
    policyVersion: 'a4.profile.product-virtual-account-lifecycle.v1',
    decision: 'ALLOW_WITH_LIMITS',
    expiresAt: null,
    reasonCodes: [],
    maxAmountMinor: null,
    ...overrides,
  };
}

function makeA2(allowed: boolean = true): A7ProductCustomerBindingA2AuthorizationContext {
  return {
    principalType: 'SERVICE',
    principalId: 'a7-product-customer-binding',
    customerAccess: 'ANY',
    evaluatedAt: '2026-08-07T10:00:00.000Z',
    allowed,
  };
}

function makeA6T04(
  overrides: Partial<A7ProductCustomerBindingA6T04FundingTargetEvidence> = {},
): A7ProductCustomerBindingA6T04FundingTargetEvidence {
  const now = Date.now();
  return {
    source: 'CUSTOMER_BENEFICIARY',
    targetId: 'a7-target-id',
    targetVersion: 1,
    institutionCode: '999',
    targetCurrency: 'NGN',
    consentReference: 'va-ref-1',
    consentVersion: 1,
    consentGrantedAt: new Date(now - 1000).toISOString(),
    consentExpiresAt: new Date(now + 30 * 24 * 60 * 60 * 1000).toISOString(),
    consentGrantedBy: 'customer-consent',
    consentPurpose: 'OUTBOUND_BANK_SETTLEMENT',
    verificationReference: 'a7-verification:va-ref-1',
    ...overrides,
  };
}

function makeBank(
  overrides: Partial<A7ProductCustomerBindingBankDirectoryEntry> = {},
): A7ProductCustomerBindingBankDirectoryEntry {
  return {
    bankCode: '999',
    bankName: 'Test Bank',
    shortName: 'TestBank',
    nipSupported: true,
    status: 'ACTIVE',
    ...overrides,
  };
}

class FakeRepository {
  a3Outcome: A7ProductCustomerBindingA3RecheckOutcome = makeA3Valid();
  virtualAccount: A7ProductCustomerBindingVirtualAccountEvidence | null = makeVirtualAccount();
  a4: A7ProductCustomerBindingA4ProductPolicyDecision | null = makeA4();
  a2: A7ProductCustomerBindingA2AuthorizationContext | null = makeA2();
  a6T04: A7ProductCustomerBindingA6T04FundingTargetEvidence | null = makeA6T04();
  bank: A7ProductCustomerBindingBankDirectoryEntry | null = makeBank();
  partnerEnabled = true;
  a6PartnerReferenceValid = true;
  auditRecorded: Array<{
    mapReference: string;
    newValues: Readonly<Record<string, unknown>>;
  }> = [];
  auditThrows = false;

  getConsumerPorts(): A7ProductCustomerBindingConsumerPorts {
    return {
      a3BindingRecheck: () => Promise.resolve(this.a3Outcome),
      virtualAccountLookup: () => Promise.resolve(this.virtualAccount),
      virtualAccountLookupByProviderAndNumber: () => Promise.resolve(this.virtualAccount),
      a4ProductPolicyDecisionLookup: () => Promise.resolve(this.a4),
      a2AuthorizationContextLookup: () => Promise.resolve(this.a2),
      a6T04FundingTargetLookup: () => Promise.resolve(this.a6T04),
      bankDirectoryLookup: () => Promise.resolve(this.bank),
      operationsAudit: () => Promise.resolve(),
    };
  }

  getA6PartnerConnectionStatus() {
    return {
      enabled: this.partnerEnabled,
      partnerKey: 'NIBSS_NIP' as const,
      capabilityKey: 'external.wallet.withdrawal.settlement' as const,
      operationType: 'OUTBOUND_BANK_SETTLEMENT' as const,
      environment: 'sandbox' as const,
      baseUrlConfigured: true,
    };
  }

  validateA6PartnerReferenceShape(
    referenceType: string,
    value: string,
    namespace: string,
  ): boolean {
    void referenceType;
    void value;
    void namespace;
    return this.a6PartnerReferenceValid;
  }

  recordVerifiedAudit(
    mapReference: string,
    requestContext: RequestContext,
    newValues: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    void requestContext;
    if (this.auditThrows) {
      return Promise.reject(new Error('audit failed'));
    }
    this.auditRecorded.push({ mapReference, newValues });
    return Promise.resolve();
  }
}

function makeCommand(
  overrides: Partial<A7ProductCustomerBindingCommand> = {},
): A7ProductCustomerBindingCommand {
  return {
    contractName: 'A7-PRODUCT-CUSTOMER-BINDING',
    contractVersion: 1,
    productKey: 'VIRTUAL_ACCOUNT',
    productVersion: 1,
    capabilityKey: 'virtual-account.assign',
    action: 'assign',
    productState: 'ASSIGN_REQUESTED',
    customerId: CUSTOMER_ID,
    customerWalletId: CUSTOMER_WALLET_ID,
    bindingId: BINDING_ID,
    bindingVersion: 1,
    virtualAccount: {
      virtualAccountId: VIRTUAL_ACCOUNT_ID,
      provider: 'NIBSS_NIP',
      accountNumber: '0123456789',
      accountName: 'TEST ACCOUNT',
      bankCode: '999',
    },
    a6PartnerIdentity: {
      partnerKey: 'NIBSS_NIP',
      capabilityKey: 'external.wallet.withdrawal.settlement',
      operationType: 'OUTBOUND_BANK_SETTLEMENT',
      environment: 'sandbox',
    },
    a6PartnerCorrelation: {
      partnerKey: 'NIBSS_NIP',
      capabilityKey: 'external.wallet.withdrawal.settlement',
      operationType: 'OUTBOUND_BANK_SETTLEMENT',
      requestId: REQUEST_ID,
      correlationId: CORRELATION_ID,
      traceId: 'trace-1',
      externalOperationId: null,
      a6CallbackReceiptId: null,
      a6SettlementId: null,
    },
    a6PartnerReference: {
      referenceType: 'OPERATION',
      value: 'a6-op-1',
      namespace: 'nibss-nip',
      observedAt: new Date().toISOString(),
      source: 'ACKNOWLEDGEMENT',
    },
    a4ProductPolicyDecisionReference: 'a4-decision-1',
    a2AuthorizationContextReference: 'a2-auth-1',
    currency: 'NGN',
    accountingUnit: 'CUSTOMER_FUNDS',
    idempotencyKey: 'idem-rcb-1',
    ...overrides,
  };
}

function makeFixture(overrides: Partial<FakeRepository> = {}) {
  const repository = new FakeRepository();
  Object.assign(repository, overrides);
  const service = new A7ProductCustomerBindingService(
    repository as unknown as A7ProductCustomerBindingRepository,
  );
  return { service, repository };
}

describe('A7T04 A4 product customer-binding service', () => {
  it('exposes the A4 + A7 contract names and versions', () => {
    const { service } = makeFixture();
    expect(service.getContractNames()).toEqual({
      a4: 'A4-CAPABILITY-POLICY',
      a7: 'A7-PRODUCT-CUSTOMER-BINDING',
    });
    expect(service.getContractVersions()).toEqual({ a4: 1, a7: 1 });
  });

  it('exposes the A7 mapping names and versions', () => {
    const { service } = makeFixture();
    expect(service.getMappingNames()).toEqual({ a7: 'A7-PRODUCT-CUSTOMER-BINDING' });
    expect(service.getMappingVersions()).toEqual({ a7: 1 });
  });

  it('exposes the A7 handoff scope and audit actor', () => {
    const { service } = makeFixture();
    expect(service.getHandoffScope()).toBe('a7-product-customer-binding-handoff.v1');
    expect(service.getAuditActor()).toBe('a7-product-customer-binding');
    expect(service.getAuditActionVerified()).toBe('A7_PRODUCT_CUSTOMER_BINDING_VERIFIED');
    expect(service.getAuditActionResolved()).toBe('A7_PRODUCT_CUSTOMER_BINDING_RESOLVED');
    expect(service.getAuditActionHandoffIssued()).toBe(
      'A7_PRODUCT_CUSTOMER_BINDING_HANDOFF_ISSUED',
    );
    expect(service.getAuditActionRejected()).toBe('A7_PRODUCT_CUSTOMER_BINDING_REJECTED');
  });

  it('resolves a verified A7 product customer-binding map', async () => {
    const { service, repository } = makeFixture();
    const result = await service.resolveProductCustomerBinding(makeCommand(), makeRequestContext());
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.map.productKey).toBe('VIRTUAL_ACCOUNT');
      expect(result.map.customer.customerId).toBe(CUSTOMER_ID);
      expect(result.map.customer.customerWalletId).toBe(CUSTOMER_WALLET_ID);
      expect(result.map.a3Binding.bindingId).toBe(BINDING_ID);
      expect(result.map.internalAccount.walletAccountId).toBe(WALLET_ACCOUNT_ID);
      expect(result.map.internalAccount.ledgerAccountId).toBe(LEDGER_ACCOUNT_ID);
      expect(result.map.virtualAccount.virtualAccountId).toBe(VIRTUAL_ACCOUNT_ID);
      expect(result.map.a6PartnerIdentity.partnerKey).toBe('NIBSS_NIP');
      expect(result.map.a4ProductPolicyDecisionReference).toBe('a4-decision-1');
      expect(result.map.a2AuthorizationContextReference).toBe('a2-auth-1');
      expect(result.map.ownership.virtualAccountOwnerMatchesBinding).toBe(true);
      expect(result.map.ownership.bankDirectorySupported).toBe(true);
      expect(repository.auditRecorded).toHaveLength(1);
    }
  });

  it('issues a handoff token from a verified map', () => {
    const { service } = makeFixture();
    const command = makeCommand();
    const repository = new FakeRepository();
    repository.a3Outcome = makeA3Valid();
    repository.virtualAccount = makeVirtualAccount();
    repository.a4 = makeA4();
    repository.a2 = makeA2();
    repository.a6T04 = makeA6T04();
    repository.bank = makeBank();
    const service2 = new A7ProductCustomerBindingService(
      repository as unknown as A7ProductCustomerBindingRepository,
    );
    const fakeMap = {
      mapReference: 'a7-map-test',
      contractName: 'A7-PRODUCT-CUSTOMER-BINDING' as const,
      contractVersion: 1 as const,
      mapName: 'A7-PRODUCT-CUSTOMER-BINDING' as const,
      mapVersion: 1 as const,
      productKey: 'VIRTUAL_ACCOUNT' as const,
      productVersion: 1 as const,
      capabilityKey: command.capabilityKey,
      action: command.action,
      productState: command.productState,
      customer: {
        customerId: CUSTOMER_ID,
        customerWalletId: CUSTOMER_WALLET_ID,
        customerVersion: 1,
        customerWalletVersion: 1,
      },
      a3Binding: {
        bindingId: BINDING_ID,
        bindingVersion: 1,
        bindingState: 'ACTIVE' as const,
        currency: 'NGN' as const,
        accountingUnit: 'CUSTOMER_FUNDS' as const,
      },
      internalAccount: {
        walletAccountId: WALLET_ACCOUNT_ID,
        ledgerAccountId: LEDGER_ACCOUNT_ID,
        walletStatus: 'ACTIVE' as const,
        ledgerIsActive: true as const,
        ledgerAccountType: 'LIABILITY' as const,
        ledgerNormalBalance: 'CREDIT' as const,
        ledgerAllowNegativeBalance: false as const,
        currency: 'NGN' as const,
        accountingUnit: 'CUSTOMER_FUNDS' as const,
      },
      virtualAccount: {
        virtualAccountId: VIRTUAL_ACCOUNT_ID,
        provider: 'NIBSS_NIP',
        accountNumber: '0123456789',
        accountName: 'TEST ACCOUNT',
        bankCode: '999',
        reference: 'va-ref-1',
        status: 'ACTIVE' as const,
        assignedAt: '2026-08-07T10:00:00.000Z',
        deactivatedAt: null,
        ownerCustomerWalletId: CUSTOMER_WALLET_ID,
        ownerCustomerId: CUSTOMER_ID,
      },
      a6PartnerIdentity: command.a6PartnerIdentity,
      a6PartnerCorrelation: command.a6PartnerCorrelation,
      a6PartnerReference: command.a6PartnerReference,
      a4ProductPolicyDecisionReference: 'a4-decision-1',
      a2AuthorizationContextReference: 'a2-auth-1',
      ownership: {
        virtualAccountOwnerMatchesBinding: true,
        fundingTargetOwnerMatchesBinding: true,
        bankDirectorySupported: true,
        consentCurrent: true,
        mandateCurrent: true,
        purposeCompatible: true,
        currencyCompatible: true,
        limitCompatible: true,
      },
      createdAt: '2026-08-07T10:00:00.000Z',
      expiresAt: '2026-08-07T10:15:00.000Z',
    };
    const token = service2.issueHandoffToken(fakeMap);
    expect(token.contractName).toBe('A7-PRODUCT-CUSTOMER-BINDING');
    expect(token.productKey).toBe('VIRTUAL_ACCOUNT');
    expect(token.customerId).toBe(CUSTOMER_ID);
    expect(token.customerWalletId).toBe(CUSTOMER_WALLET_ID);
    expect(token.bindingId).toBe(BINDING_ID);
    expect(token.virtualAccountReference).toBe('va-ref-1');
    expect(token.virtualAccountIdentifierHash).toMatch(/^[a-f0-9]{64}$/);
    expect(token.a4ProductPolicyDecisionReference).toBe('a4-decision-1');
    expect(token.a2AuthorizationContextReference).toBe('a2-auth-1');
    expect(token.handoffScope).toBe('a7-product-customer-binding-handoff.v1');
    expect(token.correlationId).toBe(CORRELATION_ID);
    expect(token.requestId).toBe(REQUEST_ID);
    void command;
    void service;
  });

  it('fails closed for a missing A3 binding', async () => {
    const { service, repository } = makeFixture();
    repository.a3Outcome = makeA3Invalid('A3_BINDING_MISSING', 'binding is missing');
    const result = await service.resolveProductCustomerBinding(makeCommand(), makeRequestContext());
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe('A3_BINDING_MISSING');
      expect(result.failure.checks.a3Binding).toBe('FAIL');
      expect(result.failure.checks.virtualAccount).toBe('OK');
    }
  });

  it('fails closed for a non-active A3 binding', async () => {
    const { service, repository } = makeFixture();
    repository.a3Outcome = makeA3Invalid('BINDING_NOT_ACTIVE', 'binding is not active');
    const result = await service.resolveProductCustomerBinding(makeCommand(), makeRequestContext());
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe('BINDING_NOT_ACTIVE');
    }
  });

  it('fails closed for a missing virtual-account row', async () => {
    const { service, repository } = makeFixture();
    repository.virtualAccount = null;
    const result = await service.resolveProductCustomerBinding(makeCommand(), makeRequestContext());
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe('VIRTUAL_ACCOUNT_MISSING');
    }
  });

  it('fails closed for a deactivated virtual-account row', async () => {
    const { service, repository } = makeFixture();
    repository.virtualAccount = makeVirtualAccount('DEACTIVATED');
    const result = await service.resolveProductCustomerBinding(makeCommand(), makeRequestContext());
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe('VIRTUAL_ACCOUNT_INACTIVE');
    }
  });

  it('fails closed for a virtual-account owner mismatch', async () => {
    const { service, repository } = makeFixture();
    repository.virtualAccount = makeVirtualAccount('ACTIVE', {
      walletId: '00000000-0000-4000-8000-000000000099',
    });
    const result = await service.resolveProductCustomerBinding(makeCommand(), makeRequestContext());
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe('VIRTUAL_ACCOUNT_OWNER_MISMATCH');
    }
  });

  it('fails closed for a virtual-account provider mismatch', async () => {
    const { service, repository } = makeFixture();
    repository.virtualAccount = makeVirtualAccount('ACTIVE', { provider: 'OTHER' });
    const result = await service.resolveProductCustomerBinding(makeCommand(), makeRequestContext());
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe('VIRTUAL_ACCOUNT_PROVIDER_MISMATCH');
    }
  });

  it('fails closed for a virtual-account account-number mismatch', async () => {
    const { service, repository } = makeFixture();
    repository.virtualAccount = makeVirtualAccount('ACTIVE', { accountNumber: '9999999999' });
    const result = await service.resolveProductCustomerBinding(makeCommand(), makeRequestContext());
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe('VIRTUAL_ACCOUNT_NUMBER_MISMATCH');
    }
  });

  it('fails closed for a bank directory miss', async () => {
    const { service, repository } = makeFixture();
    repository.bank = null;
    const result = await service.resolveProductCustomerBinding(makeCommand(), makeRequestContext());
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe('BANK_NOT_FOUND');
    }
  });

  it('fails closed for a missing A4 product-policy decision', async () => {
    const { service, repository } = makeFixture();
    repository.a4 = null;
    const result = await service.resolveProductCustomerBinding(makeCommand(), makeRequestContext());
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe('A4_POLICY_DECISION_MISSING');
    }
  });

  it('fails closed for an expired A4 product-policy decision', async () => {
    const { service, repository } = makeFixture();
    repository.a4 = makeA4({ expiresAt: new Date(Date.now() - 1000).toISOString() });
    const result = await service.resolveProductCustomerBinding(makeCommand(), makeRequestContext());
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe('A4_POLICY_DECISION_EXPIRED');
    }
  });

  it('fails closed for a non-executable A4 product-policy decision', async () => {
    const { service, repository } = makeFixture();
    repository.a4 = makeA4({ decision: 'DENY' as never });
    const result = await service.resolveProductCustomerBinding(makeCommand(), makeRequestContext());
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe('A4_POLICY_DECISION_NOT_EXECUTABLE');
    }
  });

  it('fails closed for a missing A2 authorization context', async () => {
    const { service, repository } = makeFixture();
    repository.a2 = null;
    const result = await service.resolveProductCustomerBinding(makeCommand(), makeRequestContext());
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe('A2_AUTHORIZATION_MISSING');
    }
  });

  it('fails closed for a denied A2 authorization context', async () => {
    const { service, repository } = makeFixture();
    repository.a2 = makeA2(false);
    const result = await service.resolveProductCustomerBinding(makeCommand(), makeRequestContext());
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe('A2_AUTHORIZATION_DENIED');
    }
  });

  it('fails closed for a missing A6T04 funding-target evidence', async () => {
    const { service, repository } = makeFixture();
    repository.a6T04 = null;
    const result = await service.resolveProductCustomerBinding(makeCommand(), makeRequestContext());
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe('A6T04_TARGET_NOT_FOUND');
    }
  });

  it('fails closed for a non-NGN A6T04 funding-target currency', async () => {
    const { service, repository } = makeFixture();
    repository.a6T04 = makeA6T04({ targetCurrency: 'USD' as never });
    const result = await service.resolveProductCustomerBinding(makeCommand(), makeRequestContext());
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe('A6T04_CURRENCY_UNSUPPORTED');
    }
  });

  it('fails closed for an expired A6T04 consent', async () => {
    const { service, repository } = makeFixture();
    repository.a6T04 = makeA6T04({
      consentGrantedAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(),
      consentExpiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    const result = await service.resolveProductCustomerBinding(makeCommand(), makeRequestContext());
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe('A6T04_CONSENT_INVALID');
    }
  });

  it('fails closed when the A6 partner connection is disabled', async () => {
    const { service, repository } = makeFixture();
    repository.partnerEnabled = false;
    const result = await service.resolveProductCustomerBinding(makeCommand(), makeRequestContext());
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe('A6_PARTNER_CONNECTION_UNAVAILABLE');
    }
  });

  it('fails closed for a missing A6 partner reference', async () => {
    const { service } = makeFixture();
    const result = await service.resolveProductCustomerBinding(
      makeCommand({ a6PartnerReference: null }),
      makeRequestContext(),
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe('A6_PARTNER_REFERENCE_MISSING');
    }
  });

  it('fails closed for an invalid A6 partner reference shape', async () => {
    const { service, repository } = makeFixture();
    repository.a6PartnerReferenceValid = false;
    const result = await service.resolveProductCustomerBinding(makeCommand(), makeRequestContext());
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe('A6_PARTNER_REFERENCE_MISSING');
    }
  });

  it('fails closed for a product purpose mismatch', async () => {
    const { service, repository } = makeFixture();
    repository.a6T04 = makeA6T04({ consentPurpose: 'OTHER_PURPOSE' as never });
    const result = await service.resolveProductCustomerBinding(makeCommand(), makeRequestContext());
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe('PRODUCT_PURPOSE_MISMATCH');
    }
  });

  it('fails closed for an invalid command contract name', async () => {
    const { service } = makeFixture();
    const result = await service.resolveProductCustomerBinding(
      makeCommand({ contractName: 'A7-WRONG-CONTRACT' as never }),
      makeRequestContext(),
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe('OPERATIONS_EVIDENCE_UNAVAILABLE');
    }
  });

  it('fails closed for a non-NGN currency', async () => {
    const { service } = makeFixture();
    const result = await service.resolveProductCustomerBinding(
      makeCommand({ currency: 'USD' as never }),
      makeRequestContext(),
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe('CURRENCY_MISMATCH');
    }
  });

  it('fails closed for an invalid product state', async () => {
    const { service } = makeFixture();
    const result = await service.resolveProductCustomerBinding(
      makeCommand({ productState: 'INVALID_STATE' as never }),
      makeRequestContext(),
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe('OPERATIONS_EVIDENCE_UNAVAILABLE');
    }
  });

  it('fails closed for an invalid capability', async () => {
    const { service } = makeFixture();
    const result = await service.resolveProductCustomerBinding(
      makeCommand({ capabilityKey: 'virtual-account.invalid' }),
      makeRequestContext(),
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe('OPERATIONS_EVIDENCE_UNAVAILABLE');
    }
  });

  it('fails closed for an invalid action', async () => {
    const { service } = makeFixture();
    const result = await service.resolveProductCustomerBinding(
      makeCommand({ action: 'invalid' }),
      makeRequestContext(),
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe('OPERATIONS_EVIDENCE_UNAVAILABLE');
    }
  });

  it('fails closed when the audit service throws', async () => {
    const { service } = makeFixture({ auditThrows: true });
    const result = await service.resolveProductCustomerBinding(makeCommand(), makeRequestContext());
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe('OPERATIONS_EVIDENCE_UNAVAILABLE');
    }
  });
});
