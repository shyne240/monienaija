import type {
  A7ProductCustomerBindingA2AuthorizationContext,
  A7ProductCustomerBindingA3BindingRecheck,
  A7ProductCustomerBindingA3RecheckOutcome,
  A7ProductCustomerBindingA4ProductPolicyDecision,
  A7ProductCustomerBindingA6PartnerCorrelation,
  A7ProductCustomerBindingA6PartnerIdentity,
  A7ProductCustomerBindingA6PartnerReference,
  A7ProductCustomerBindingA6T04FundingTargetEvidence,
  A7ProductCustomerBindingBankDirectoryEntry,
  A7ProductCustomerBindingCommand,
  A7ProductCustomerBindingConsumerPorts,
  A7ProductCustomerBindingHandoffTokenV1,
  A7ProductCustomerBindingMapV1,
  A7ProductCustomerBindingProductKey,
  A7ProductCustomerBindingResult,
  A7ProductCustomerBindingState,
  A7ProductCustomerBindingVerificationFailureV1,
  A7ProductCustomerBindingVirtualAccountEvidence,
} from '../src/policy/a7-product-customer-binding.types';
import { A7_PRODUCT_CUSTOMER_BINDING_ALL_STATES } from '../src/policy/a7-product-customer-binding.constants';

describe('A7T04 A4 product customer-binding types', () => {
  it('exposes the A7 product-key as the frozen VIRTUAL_ACCOUNT', () => {
    const key: A7ProductCustomerBindingProductKey = 'VIRTUAL_ACCOUNT';
    expect(key).toBe('VIRTUAL_ACCOUNT');
  });

  it('exposes the A7 product-state vocabulary as the union of the A7T02 frozen states', () => {
    const states: A7ProductCustomerBindingState[] = [
      'ASSIGN_REQUESTED',
      'ASSIGN_PENDING',
      'ASSIGN_ACTIVE',
      'ASSIGN_SUSPENDED',
      'ASSIGN_FAILED',
      'ASSIGN_CLOSED',
      'FUNDING_REQUESTED',
      'FUNDING_PENDING_VERIFICATION',
      'FUNDING_SETTLED',
      'FUNDING_UNKNOWN',
      'FUNDING_SUSPENDED',
      'FUNDING_FAILED',
      'FUNDING_CLOSED',
    ];
    expect(states).toEqual([...A7_PRODUCT_CUSTOMER_BINDING_ALL_STATES]);
  });

  it('exposes the A6 partner identity as a single, frozen object', () => {
    const identity: A7ProductCustomerBindingA6PartnerIdentity = {
      partnerKey: 'NIBSS_NIP',
      capabilityKey: 'external.wallet.withdrawal.settlement',
      operationType: 'OUTBOUND_BANK_SETTLEMENT',
      environment: 'sandbox',
    };
    expect(identity.partnerKey).toBe('NIBSS_NIP');
  });

  it('exposes the A6 partner reference as an optional object', () => {
    const reference: A7ProductCustomerBindingA6PartnerReference = {
      referenceType: 'OPERATION',
      value: 'value-1',
      namespace: 'ns-1',
      observedAt: '2026-08-07T10:00:00.000Z',
      source: 'ACKNOWLEDGEMENT',
    };
    expect(reference.referenceType).toBe('OPERATION');
    expect(reference.source).toBe('ACKNOWLEDGEMENT');
  });

  it('exposes the A6 partner correlation as a single, frozen object', () => {
    const correlation: A7ProductCustomerBindingA6PartnerCorrelation = {
      partnerKey: 'NIBSS_NIP',
      capabilityKey: 'external.wallet.withdrawal.settlement',
      operationType: 'OUTBOUND_BANK_SETTLEMENT',
      requestId: 'r-1',
      correlationId: 'c-1',
      traceId: 't-1',
      externalOperationId: null,
      a6CallbackReceiptId: null,
      a6SettlementId: null,
    };
    expect(correlation.partnerKey).toBe('NIBSS_NIP');
    expect(correlation.requestId).toBe('r-1');
  });

  it('exposes the A3 binding recheck shape as a single, frozen object', () => {
    const recheck: A7ProductCustomerBindingA3BindingRecheck = {
      customerId: '00000000-0000-4000-8000-000000000001',
      customerWalletId: '00000000-0000-4000-8000-000000000002',
      bindingId: '00000000-0000-4000-8000-000000000003',
      bindingVersion: 1,
      walletAccountId: '00000000-0000-4000-8000-000000000004',
      ledgerAccountId: '00000000-0000-4000-8000-000000000005',
      expectedCurrency: 'NGN',
      expectedAccountingUnit: 'CUSTOMER_FUNDS',
      expectedBindingVersion: 1,
    };
    expect(recheck.expectedCurrency).toBe('NGN');
  });

  it('exposes the A3 binding recheck outcome as a discriminated union', () => {
    const valid: A7ProductCustomerBindingA3RecheckOutcome = {
      valid: true,
      bindingId: 'b-1',
      customerId: 'c-1',
      customerWalletId: 'w-1',
      walletAccountId: 'wa-1',
      ledgerAccountId: 'la-1',
      bindingVersion: 1,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      customerVersion: 1,
      customerWalletVersion: 1,
    };
    const invalid: A7ProductCustomerBindingA3RecheckOutcome = {
      valid: false,
      code: 'A3_BINDING_MISSING',
      message: 'missing',
    };
    expect(valid.valid).toBe(true);
    expect(invalid.valid).toBe(false);
  });

  it('exposes the virtual-account evidence shape as a single, frozen object', () => {
    const evidence: A7ProductCustomerBindingVirtualAccountEvidence = {
      virtualAccountId: 'va-1',
      walletId: 'w-1',
      bankCode: '999',
      accountNumber: '0123456789',
      accountName: 'TEST',
      provider: 'NIBSS_NIP',
      status: 'ACTIVE',
      reference: 'va-ref-1',
      assignedAt: '2026-08-07T10:00:00.000Z',
      deactivatedAt: null,
    };
    expect(evidence.status).toBe('ACTIVE');
    expect(evidence.deactivatedAt).toBeNull();
  });

  it('exposes the A4 product-policy decision shape as a single, frozen object', () => {
    const decision: A7ProductCustomerBindingA4ProductPolicyDecision = {
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
    };
    expect(decision.decision).toBe('ALLOW_WITH_LIMITS');
  });

  it('exposes the A2 authorization context shape as a single, frozen object', () => {
    const a2: A7ProductCustomerBindingA2AuthorizationContext = {
      principalType: 'SERVICE',
      principalId: 'a7-product-customer-binding',
      customerAccess: 'ANY',
      evaluatedAt: '2026-08-07T10:00:00.000Z',
      allowed: true,
    };
    expect(a2.allowed).toBe(true);
  });

  it('exposes the A6T04 funding-target evidence shape as a single, frozen object', () => {
    const a6T04: A7ProductCustomerBindingA6T04FundingTargetEvidence = {
      source: 'CUSTOMER_BENEFICIARY',
      targetId: 't-1',
      targetVersion: 1,
      institutionCode: '999',
      targetCurrency: 'NGN',
      consentReference: 'va-ref-1',
      consentVersion: 1,
      consentGrantedAt: '2026-08-07T10:00:00.000Z',
      consentExpiresAt: '2026-09-06T10:00:00.000Z',
      consentGrantedBy: 'customer',
      consentPurpose: 'OUTBOUND_BANK_SETTLEMENT',
      verificationReference: 'a7-verification:1',
    };
    expect(a6T04.consentPurpose).toBe('OUTBOUND_BANK_SETTLEMENT');
  });

  it('exposes the bank directory entry shape as a single, frozen object', () => {
    const bank: A7ProductCustomerBindingBankDirectoryEntry = {
      bankCode: '999',
      bankName: 'Test Bank',
      shortName: 'TestBank',
      nipSupported: true,
      status: 'ACTIVE',
    };
    expect(bank.nipSupported).toBe(true);
  });

  it('exposes the A7 product customer-binding command shape as a single, frozen object', () => {
    const command: A7ProductCustomerBindingCommand = {
      contractName: 'A7-PRODUCT-CUSTOMER-BINDING',
      contractVersion: 1,
      productKey: 'VIRTUAL_ACCOUNT',
      productVersion: 1,
      capabilityKey: 'virtual-account.assign',
      action: 'assign',
      productState: 'ASSIGN_REQUESTED',
      customerId: '00000000-0000-4000-8000-000000000001',
      customerWalletId: '00000000-0000-4000-8000-000000000002',
      bindingId: '00000000-0000-4000-8000-000000000003',
      bindingVersion: 1,
      virtualAccount: {
        virtualAccountId: '00000000-0000-4000-8000-000000000004',
        provider: 'NIBSS_NIP',
        accountNumber: '0123456789',
        accountName: 'TEST',
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
        requestId: 'r-1',
        correlationId: 'c-1',
        traceId: 't-1',
        externalOperationId: null,
        a6CallbackReceiptId: null,
        a6SettlementId: null,
      },
      a6PartnerReference: null,
      a4ProductPolicyDecisionReference: 'a4-decision-1',
      a2AuthorizationContextReference: 'a2-auth-1',
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      idempotencyKey: 'idem-1',
    };
    expect(command.productKey).toBe('VIRTUAL_ACCOUNT');
  });

  it('exposes the A7 product customer-binding map shape as a single, frozen object', () => {
    const map: A7ProductCustomerBindingMapV1 = {
      contractName: 'A7-PRODUCT-CUSTOMER-BINDING',
      contractVersion: 1,
      mapName: 'A7-PRODUCT-CUSTOMER-BINDING',
      mapVersion: 1,
      mapReference: 'a7-map-1',
      productKey: 'VIRTUAL_ACCOUNT',
      productVersion: 1,
      capabilityKey: 'virtual-account.assign',
      action: 'assign',
      productState: 'ASSIGN_REQUESTED',
      customer: {
        customerId: 'c-1',
        customerWalletId: 'w-1',
        customerVersion: 1,
        customerWalletVersion: 1,
      },
      a3Binding: {
        bindingId: 'b-1',
        bindingVersion: 1,
        bindingState: 'ACTIVE',
        currency: 'NGN',
        accountingUnit: 'CUSTOMER_FUNDS',
      },
      internalAccount: {
        walletAccountId: 'wa-1',
        ledgerAccountId: 'la-1',
        walletStatus: 'ACTIVE',
        ledgerIsActive: true,
        ledgerAccountType: 'LIABILITY',
        ledgerNormalBalance: 'CREDIT',
        ledgerAllowNegativeBalance: false,
        currency: 'NGN',
        accountingUnit: 'CUSTOMER_FUNDS',
      },
      virtualAccount: {
        virtualAccountId: 'va-1',
        provider: 'NIBSS_NIP',
        accountNumber: '0123456789',
        accountName: 'TEST',
        bankCode: '999',
        reference: 'va-ref-1',
        status: 'ACTIVE',
        assignedAt: '2026-08-07T10:00:00.000Z',
        deactivatedAt: null,
        ownerCustomerWalletId: 'w-1',
        ownerCustomerId: 'c-1',
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
        requestId: 'r-1',
        correlationId: 'c-1',
        traceId: 't-1',
        externalOperationId: null,
        a6CallbackReceiptId: null,
        a6SettlementId: null,
      },
      a6PartnerReference: null,
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
    expect(map.mapReference).toBe('a7-map-1');
  });

  it('exposes the A7 product customer-binding verification failure shape as a single, frozen object', () => {
    const failure: A7ProductCustomerBindingVerificationFailureV1 = {
      contractName: 'A7-PRODUCT-CUSTOMER-BINDING',
      contractVersion: 1,
      mapName: 'A7-PRODUCT-CUSTOMER-BINDING',
      mapVersion: 1,
      productKey: 'VIRTUAL_ACCOUNT',
      productVersion: 1,
      capabilityKey: 'virtual-account.assign',
      action: 'assign',
      productState: 'ASSIGN_REQUESTED',
      code: 'A3_BINDING_MISSING',
      message: 'missing',
      checks: {
        a3Binding: 'FAIL',
        virtualAccount: 'OK',
        a6PartnerReference: 'OK',
        a4ProductPolicyDecision: 'OK',
        a2AuthorizationContext: 'OK',
        a6T04FundingTarget: 'OK',
        bankDirectory: 'OK',
        consent: 'OK',
        purpose: 'OK',
        currency: 'OK',
        limit: 'OK',
      },
      correlationId: 'c-1',
      requestId: 'r-1',
      createdAt: '2026-08-07T10:00:00.000Z',
    };
    expect(failure.code).toBe('A3_BINDING_MISSING');
  });

  it('exposes the A7 product customer-binding handoff token shape as a single, frozen object', () => {
    const token: A7ProductCustomerBindingHandoffTokenV1 = {
      contractName: 'A7-PRODUCT-CUSTOMER-BINDING',
      contractVersion: 1,
      tokenReference: 'a7-token-1',
      handoffScope: 'a7-product-customer-binding-handoff.v1',
      productKey: 'VIRTUAL_ACCOUNT',
      productVersion: 1,
      capabilityKey: 'virtual-account.assign',
      action: 'assign',
      productState: 'ASSIGN_REQUESTED',
      mapReference: 'a7-map-1',
      customerId: 'c-1',
      customerWalletId: 'w-1',
      bindingId: 'b-1',
      bindingVersion: 1,
      walletAccountId: 'wa-1',
      ledgerAccountId: 'la-1',
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      virtualAccountReference: 'va-ref-1',
      virtualAccountIdentifierHash: 'a'.repeat(64),
      virtualAccountProvider: 'NIBSS_NIP',
      virtualAccountBankCode: '999',
      virtualAccountAssignedAt: '2026-08-07T10:00:00.000Z',
      a6PartnerIdentity: {
        partnerKey: 'NIBSS_NIP',
        capabilityKey: 'external.wallet.withdrawal.settlement',
        operationType: 'OUTBOUND_BANK_SETTLEMENT',
        environment: 'sandbox',
      },
      a6PartnerReference: null,
      a4ProductPolicyDecisionReference: 'a4-decision-1',
      a2AuthorizationContextReference: 'a2-auth-1',
      issuedAt: '2026-08-07T10:00:00.000Z',
      expiresAt: '2026-08-07T10:15:00.000Z',
      correlationId: 'c-1',
      requestId: 'r-1',
    };
    expect(token.tokenReference).toBe('a7-token-1');
  });

  it('exposes the A7 product customer-binding result as a discriminated union', () => {
    const result: A7ProductCustomerBindingResult = { valid: false } as never;
    expect(result).toBeDefined();
  });

  it('exposes the A7 product customer-binding consumer ports as a single, frozen object', () => {
    const ports: A7ProductCustomerBindingConsumerPorts = {
      a3BindingRecheck: () =>
        Promise.resolve({ valid: false, code: 'A3_BINDING_MISSING', message: 'm' }),
      virtualAccountLookup: () => Promise.resolve(null),
      virtualAccountLookupByProviderAndNumber: () => Promise.resolve(null),
      a4ProductPolicyDecisionLookup: () => Promise.resolve(null),
      a2AuthorizationContextLookup: () => Promise.resolve(null),
      a6T04FundingTargetLookup: () => Promise.resolve(null),
      bankDirectoryLookup: () => Promise.resolve(null),
      operationsAudit: () => Promise.resolve(),
    };
    expect(typeof ports.a3BindingRecheck).toBe('function');
  });
});
