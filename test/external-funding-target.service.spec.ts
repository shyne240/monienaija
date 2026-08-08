import { BankStatus } from '../src/bank/bank.enums';
import {
  CustomerBeneficiaryStatus,
  CustomerBeneficiaryType,
} from '../src/customer-beneficiary/customer-beneficiary.enums';
import {
  CustomerFundingInstrumentStatus,
  CustomerFundingInstrumentType,
  FundingInstrumentVerificationState,
} from '../src/customer-funding-instrument/customer-funding-instrument.enums';
import { ExternalFundingTargetMappingService } from '../src/partner/external-funding-target.service';
import type { ExternalFundingTargetMappingCommand } from '../src/partner/external-funding-target.types';

const CUSTOMER_ID = '00000000-0000-4000-8000-000000000001';
const CUSTOMER_WALLET_ID = '00000000-0000-4000-8000-000000000002';
const BINDING_ID = '00000000-0000-4000-8000-000000000003';
const WALLET_ACCOUNT_ID = '00000000-0000-4000-8000-000000000004';
const LEDGER_ACCOUNT_ID = '00000000-0000-4000-8000-000000000005';
const BENEFICIARY_ID = '00000000-0000-4000-8000-000000000006';
const FUNDING_INSTRUMENT_ID = '00000000-0000-4000-8000-000000000007';
const PRINCIPAL_ID = '00000000-0000-4000-8000-000000000008';

function future(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

function past(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

function makeBeneficiary(overrides: Record<string, unknown> = {}) {
  return {
    id: BENEFICIARY_ID,
    customerId: CUSTOMER_ID,
    type: CustomerBeneficiaryType.BANK_ACCOUNT,
    displayName: 'Verified bank target',
    reference: 'beneficiary-1',
    destinationIdentifier: '0123456789',
    destinationName: 'Target Customer',
    destinationInstitution: '058',
    nickname: null,
    status: CustomerBeneficiaryStatus.ACTIVE,
    verified: true,
    version: 4,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeFundingInstrument(overrides: Record<string, unknown> = {}) {
  return {
    id: FUNDING_INSTRUMENT_ID,
    customerId: CUSTOMER_ID,
    type: CustomerFundingInstrumentType.BANK_ACCOUNT,
    displayName: 'Verified bank account',
    reference: 'funding-instrument-1',
    status: CustomerFundingInstrumentStatus.VERIFIED,
    verificationState: FundingInstrumentVerificationState.VERIFIED,
    version: 6,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeCommand(
  overrides: Partial<ExternalFundingTargetMappingCommand> = {},
): ExternalFundingTargetMappingCommand {
  return {
    principal: {
      type: 'CUSTOMER',
      principalId: PRINCIPAL_ID,
      customerId: CUSTOMER_ID,
      roles: [],
      scopes: [],
      customerAccess: 'SELF',
      assuranceLevel: 'MFA',
    },
    requestContext: {
      requestId: 'request-1',
      correlationId: 'correlation-1',
      traceId: 'trace-1',
    },
    customerId: CUSTOMER_ID,
    sourceCustomerWalletId: CUSTOMER_WALLET_ID,
    sourceBindingId: BINDING_ID,
    sourceBindingVersion: 3,
    sourceWalletAccountId: WALLET_ACCOUNT_ID,
    sourceLedgerAccountId: LEDGER_ACCOUNT_ID,
    amountMinor: '1000',
    currency: 'NGN',
    accountingUnit: 'CUSTOMER_FUNDS',
    target: {
      source: 'CUSTOMER_BENEFICIARY',
      beneficiaryId: BENEFICIARY_ID,
      version: 4,
      institutionCode: '058',
    },
    consent: {
      reference: 'consent-1',
      customerId: CUSTOMER_ID,
      targetSource: 'CUSTOMER_BENEFICIARY',
      targetId: BENEFICIARY_ID,
      purpose: 'OUTBOUND_BANK_SETTLEMENT',
      grantedBy: CUSTOMER_ID,
      grantedAt: past(1),
      expiresAt: future(30),
      version: 1,
    },
    policy: {
      customerId: CUSTOMER_ID,
      capability: 'external.wallet.withdrawal.settlement',
      action: 'create',
      decision: 'ALLOW_WITH_LIMITS',
      decisionReference: 'decision-1',
      policyVersion: 'policy-v1',
      currency: 'NGN',
      expiresAt: future(30),
      reviewAt: null,
      maxAmountMinor: '5000',
    },
    ...overrides,
  };
}

function makeService(
  options: {
    beneficiary?: Record<string, unknown>;
    fundingInstrument?: Record<string, unknown>;
    bank?: Record<string, unknown>;
    authorizationAllowed?: boolean;
  } = {},
) {
  const authorizationService = {
    authorize: jest.fn().mockResolvedValue({
      allowed: options.authorizationAllowed ?? true,
      principalType: 'CUSTOMER',
      principalId: PRINCIPAL_ID,
      resourceType: 'external-funding-target',
      resourceId: BENEFICIARY_ID,
      customerId: CUSTOMER_ID,
      action: 'wallet:withdrawal:external-target:use',
      evaluatedAt: new Date(),
      requiredScopes: [],
      requiredRoles: [],
    }),
  };
  const bindingService = {
    validateActiveBinding: jest.fn().mockResolvedValue({
      valid: true,
      bindingId: BINDING_ID,
      customerId: CUSTOMER_ID,
      customerWalletId: CUSTOMER_WALLET_ID,
      walletAccountId: WALLET_ACCOUNT_ID,
      ledgerAccountId: LEDGER_ACCOUNT_ID,
      bindingVersion: 3,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
    }),
  };
  const fundingInstrumentService = {
    getInstrument: jest
      .fn()
      .mockResolvedValue(options.fundingInstrument ?? makeFundingInstrument()),
  };
  const beneficiaryService = {
    getBeneficiary: jest.fn().mockResolvedValue(options.beneficiary ?? makeBeneficiary()),
  };
  const bankService = {
    list: jest.fn().mockResolvedValue([
      {
        id: '00000000-0000-4000-8000-000000000009',
        bankCode: '058',
        bankName: 'Demo Bank',
        shortName: 'Demo',
        nipSupported: options.bank?.nipSupported ?? true,
        status: options.bank?.status ?? BankStatus.ACTIVE,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]),
  };
  const partnerConnectionService = {
    getProfile: jest.fn().mockReturnValue({
      enabled: true,
      partnerKey: 'NIBSS_NIP',
      capabilityKey: 'external.wallet.withdrawal.settlement',
      operationType: 'OUTBOUND_BANK_SETTLEMENT',
    }),
  };
  const auditService = { record: jest.fn().mockResolvedValue(undefined) };
  const service = new ExternalFundingTargetMappingService(
    authorizationService as never,
    bindingService as never,
    fundingInstrumentService as never,
    beneficiaryService as never,
    bankService as never,
    partnerConnectionService as never,
    auditService as never,
  );
  return {
    service,
    authorizationService,
    bindingService,
    fundingInstrumentService,
    beneficiaryService,
    bankService,
    partnerConnectionService,
    auditService,
  };
}

describe('ExternalFundingTargetMappingService', () => {
  it('maps a verified customer beneficiary to the explicit A3 internal account chain', async () => {
    const fixture = makeService();

    const result = await fixture.service.resolve(makeCommand());

    expect(result).toMatchObject({
      mappingVersion: 1,
      customerId: CUSTOMER_ID,
      partner: {
        partnerKey: 'NIBSS_NIP',
        capabilityKey: 'external.wallet.withdrawal.settlement',
        operationType: 'OUTBOUND_BANK_SETTLEMENT',
      },
      internalAccount: {
        customerWalletId: CUSTOMER_WALLET_ID,
        bindingId: BINDING_ID,
        bindingVersion: 3,
        walletAccountId: WALLET_ACCOUNT_ID,
        ledgerAccountId: LEDGER_ACCOUNT_ID,
        currency: 'NGN',
        accountingUnit: 'CUSTOMER_FUNDS',
      },
      target: {
        source: 'CUSTOMER_BENEFICIARY',
        sourceId: BENEFICIARY_ID,
        sourceVersion: 4,
        targetType: 'BANK_ACCOUNT',
        institutionCode: '058',
        consentReference: 'consent-1',
      },
      money: { amountMinor: '1000', currency: 'NGN', accountingUnit: 'CUSTOMER_FUNDS' },
    });
    expect(result.target.externalTarget.targetReference).toMatch(/^a6-target:/);
    expect(result.target.externalTarget.targetReference).not.toContain('0123456789');
    expect(fixture.bindingService.validateActiveBinding).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: CUSTOMER_ID,
        bindingId: BINDING_ID,
        walletAccountId: WALLET_ACCOUNT_ID,
        ledgerAccountId: LEDGER_ACCOUNT_ID,
        expectedBindingVersion: 3,
        expectedCurrency: 'NGN',
        expectedAccountingUnit: 'CUSTOMER_FUNDS',
      }),
    );
  });

  it('maps a verified bank-account funding instrument without exposing its source reference', async () => {
    const fixture = makeService();
    const command = makeCommand({
      target: {
        source: 'FUNDING_INSTRUMENT',
        fundingInstrumentId: FUNDING_INSTRUMENT_ID,
        version: 6,
        institutionCode: '058',
      },
      consent: {
        ...makeCommand().consent,
        targetSource: 'FUNDING_INSTRUMENT',
        targetId: FUNDING_INSTRUMENT_ID,
        reference: 'consent-instrument-1',
      },
    });

    const result = await fixture.service.resolve(command);

    expect(result.target).toMatchObject({
      source: 'FUNDING_INSTRUMENT',
      sourceId: FUNDING_INSTRUMENT_ID,
      sourceVersion: 6,
      targetType: 'BANK_ACCOUNT',
    });
    expect(result.target.externalTarget.targetReference).not.toContain('funding-instrument-1');
    expect(fixture.fundingInstrumentService.getInstrument).toHaveBeenCalledWith(
      CUSTOMER_ID,
      FUNDING_INSTRUMENT_ID,
    );
  });

  it('requires A2 authorization and does not map a denied target', async () => {
    const fixture = makeService({ authorizationAllowed: false });

    await expect(fixture.service.resolve(makeCommand())).rejects.toMatchObject({
      code: 'AUTHORIZATION_REQUIRED',
    });
    expect(fixture.bindingService.validateActiveBinding).not.toHaveBeenCalled();
    expect(fixture.beneficiaryService.getBeneficiary).not.toHaveBeenCalled();
  });

  it('rejects ambiguous target sources', async () => {
    const fixture = makeService();
    const command = makeCommand({
      target: {
        source: 'CUSTOMER_BENEFICIARY',
        beneficiaryId: BENEFICIARY_ID,
        fundingInstrumentId: FUNDING_INSTRUMENT_ID,
        version: 4,
        institutionCode: '058',
      },
    });

    await expect(fixture.service.resolve(command)).rejects.toMatchObject({
      code: 'TARGET_MAPPING_AMBIGUOUS',
    });
  });

  it('rejects unsupported target types and unverified sources', async () => {
    const unsupported = makeService({
      beneficiary: makeBeneficiary({ type: CustomerBeneficiaryType.MOBILE_MONEY }),
    });
    await expect(unsupported.service.resolve(makeCommand())).rejects.toMatchObject({
      code: 'TARGET_TYPE_UNSUPPORTED',
    });

    const unverified = makeService({ beneficiary: makeBeneficiary({ verified: false }) });
    await expect(unverified.service.resolve(makeCommand())).rejects.toMatchObject({
      code: 'TARGET_NOT_VERIFIED',
    });
  });

  it('rejects stale target versions, unsupported banks, and non-NGN currency', async () => {
    const stale = makeService();
    await expect(
      stale.service.resolve(makeCommand({ target: { ...makeCommand().target, version: 99 } })),
    ).rejects.toMatchObject({ code: 'TARGET_VERSION_STALE' });

    const unsupportedBank = makeService({ bank: { nipSupported: false } });
    await expect(unsupportedBank.service.resolve(makeCommand())).rejects.toMatchObject({
      code: 'BANK_NOT_SUPPORTED',
    });

    const nonNgn = makeService();
    await expect(nonNgn.service.resolve(makeCommand({ currency: 'USD' }))).rejects.toMatchObject({
      code: 'CURRENCY_UNSUPPORTED',
    });
  });

  it('rejects expired or mismatched consent and policy assertions', async () => {
    const expiredConsent = makeService();
    await expect(
      expiredConsent.service.resolve(
        makeCommand({
          consent: { ...makeCommand().consent, expiresAt: past(1) },
        }),
      ),
    ).rejects.toMatchObject({ code: 'CONSENT_INVALID' });

    const mismatchedPolicy = makeService();
    await expect(
      mismatchedPolicy.service.resolve(
        makeCommand({
          policy: { ...makeCommand().policy, customerId: '00000000-0000-4000-8000-000000000099' },
        }),
      ),
    ).rejects.toMatchObject({ code: 'POLICY_NOT_EXECUTABLE' });
  });

  it('creates a safe Operations audit fact without raw target values', async () => {
    const fixture = makeService();

    const result = await fixture.service.resolveAndAudit({} as never, makeCommand());

    expect(result.mappingReference).toMatch(/^[a-f0-9]{64}$/);
    expect(fixture.auditService.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        entityType: 'A6_EXTERNAL_TARGET_MAPPING',
        action: 'MAPPED',
      }),
    );
    const calls = fixture.auditService.record.mock.calls as unknown as Array<
      [unknown, { newValues?: Record<string, unknown> }]
    >;
    const values = calls[0]?.[1]?.newValues ?? {};
    expect(values.targetReferenceHash).toBe(result.target.targetReferenceHash);
    expect(values).not.toHaveProperty('destinationIdentifier');
    expect(values).not.toHaveProperty('reference');
  });
});
