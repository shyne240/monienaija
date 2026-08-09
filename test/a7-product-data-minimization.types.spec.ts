import {
  A7_PRODUCT_DATA_MINIMIZATION_CONTRACT_NAME,
  A7_PRODUCT_DATA_MINIMIZATION_CONTRACT_VERSION,
} from '../src/policy/a7-product-data-minimization.constants';
import type {
  A7ProductDataMinimizationBatchReportV1,
  A7ProductDataMinimizationBatchResultV1,
  A7ProductDataMinimizationCommandV1,
  A7ProductDataMinimizationConsentCommandV1,
  A7ProductDataMinimizationConsentAssertionV1,
  A7ProductDataMinimizationDisclosureProjectionV1,
  A7ProductDataMinimizationFailureV1,
  A7ProductDataMinimizationFieldClassification,
  A7ProductDataMinimizationFieldName,
  A7ProductDataMinimizationLegalHoldCommandV1,
  A7ProductDataMinimizationLegalHoldV1,
  A7ProductDataMinimizationPartnerPayloadValidationV1,
  A7ProductDataMinimizationPartnerPayloadCommandV1,
  A7ProductDataMinimizationReportV1,
  A7ProductDataMinimizationResultV1,
  A7ProductDataMinimizationSupportTraceProjectionV1,
  A7ProductDataMinimizationSupportTraceRequestV1,
  A7ProductDataMinimizationSecretCommandV1,
  A7ProductDataMinimizationRetentionCommandV1,
  A7ProductDataMinimizationClassifyCommandV1,
} from '../src/policy/a7-product-data-minimization.types';
import {
  ExternalConsentStatus,
  ExternalDataHandlingLevel,
} from '../src/partner/external-data-minimization.enums';
import type { ExternalDisclosureAudience } from '../src/partner/external-data-minimization.enums';

describe('A7T10 types', () => {
  it('freezes the A7 product data minimization report identity', () => {
    const report: A7ProductDataMinimizationReportV1 = {
      contractName: A7_PRODUCT_DATA_MINIMIZATION_CONTRACT_NAME,
      contractVersion: A7_PRODUCT_DATA_MINIMIZATION_CONTRACT_VERSION,
      productKey: 'VIRTUAL_ACCOUNT',
      productVersion: 1,
      productOperationReference: 'a7-product-operation-reference',
      kind: 'CLASSIFY',
      classificationView: null,
      consentView: null,
      retentionView: null,
      legalHoldView: null,
      secretView: null,
      disclosureProjection: null,
      supportTraceProjection: null,
      partnerPayloadValidation: null,
      failure: null,
      generatedAt: '2026-08-09T00:00:00.000Z',
      correlationId: 'correlation-1',
      requestId: 'request-1',
      causationId: null,
    };
    expect(report.contractName).toBe('A7-PRODUCT-DATA-MINIMIZATION');
    expect(report.productKey).toBe('VIRTUAL_ACCOUNT');
  });

  it('exposes the A7 product data minimization failure type with the frozen code vocabulary', () => {
    const failure: A7ProductDataMinimizationFailureV1 = {
      contractName: A7_PRODUCT_DATA_MINIMIZATION_CONTRACT_NAME,
      contractVersion: A7_PRODUCT_DATA_MINIMIZATION_CONTRACT_VERSION,
      code: 'A7_PRODUCT_DATA_MINIMIZATION_INVALID_COMMAND',
      rejectionCode: null,
      message: 'invalid command',
      correlationId: 'correlation-1',
      requestId: 'request-1',
      createdAt: '2026-08-09T00:00:00.000Z',
    };
    expect(failure.code).toBe('A7_PRODUCT_DATA_MINIMIZATION_INVALID_COMMAND');
  });

  it('exposes the A7 product data minimization result envelope', () => {
    const failure: A7ProductDataMinimizationFailureV1 = {
      contractName: A7_PRODUCT_DATA_MINIMIZATION_CONTRACT_NAME,
      contractVersion: A7_PRODUCT_DATA_MINIMIZATION_CONTRACT_VERSION,
      code: 'A7_PRODUCT_DATA_MINIMIZATION_QUERY_UNAVAILABLE',
      rejectionCode: null,
      message: 'unavailable',
      correlationId: 'correlation-1',
      requestId: 'request-1',
      createdAt: '2026-08-09T00:00:00.000Z',
    };
    const result: A7ProductDataMinimizationResultV1 = { valid: false, failure };
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe('A7_PRODUCT_DATA_MINIMIZATION_QUERY_UNAVAILABLE');
    }
  });

  it('exposes the A7 product data minimization batch result envelope', () => {
    const batchReport: A7ProductDataMinimizationBatchReportV1 = {
      contractName: A7_PRODUCT_DATA_MINIMIZATION_CONTRACT_NAME,
      contractVersion: A7_PRODUCT_DATA_MINIMIZATION_CONTRACT_VERSION,
      batchId: 'batch-1',
      batchReference: 'a7-product-data-minimization-batch:v1:abc',
      productKey: 'VIRTUAL_ACCOUNT',
      productVersion: 1,
      total: 1,
      withFailure: 0,
      queryUnavailable: 0,
      reports: [],
      generatedAt: '2026-08-09T00:00:00.000Z',
      correlationId: 'correlation-1',
    };
    const batchResult: A7ProductDataMinimizationBatchResultV1 = {
      valid: true,
      report: batchReport,
    };
    expect(batchResult.valid).toBe(true);
    if (batchResult.valid) {
      expect(batchResult.report.batchId).toBe('batch-1');
    }
  });

  it('exposes the A7 product data minimization command union with all 8 kinds', () => {
    const classify: A7ProductDataMinimizationClassifyCommandV1 = {
      productKey: 'VIRTUAL_ACCOUNT',
      productVersion: 1,
      productOperationReference: 'a7-product-operation-reference',
      fieldName: 'a7.productOperationReference',
      requestContext: { requestId: 'r', correlationId: 'c', traceId: 't' },
      causationId: null,
    };
    const consent: A7ProductDataMinimizationConsentCommandV1 = {
      productKey: 'VIRTUAL_ACCOUNT',
      productVersion: 1,
      productOperationReference: 'a7-product-operation-reference',
      customerId: '00000000-0000-4000-8000-000000000001',
      source: 'DERIVED' as A7ProductDataMinimizationConsentAssertionV1['source'],
      targetId: '00000000-0000-4000-8000-000000000002',
      targetVersion: 1,
      purpose: 'PRODUCT_VIRTUAL_ACCOUNT_INBOUND_FUNDING',
      jurisdiction: 'NG',
      mandateReference: 'mandate-1',
      mandateVersion: 1,
      grantedAt: '2026-08-09T00:00:00.000Z',
      expiresAt: '2026-12-09T00:00:00.000Z',
      grantedBy: 'a7-product-customer-binding',
      revocable: true,
      revokedAt: null,
      consentReference: 'a7-product-consent:v1:abc',
      requestContext: { requestId: 'r', correlationId: 'c', traceId: 't' },
      causationId: null,
    };
    const retention: A7ProductDataMinimizationRetentionCommandV1 = {
      productKey: 'VIRTUAL_ACCOUNT',
      productVersion: 1,
      productOperationReference: 'a7-product-operation-reference',
      dataset: 'A7_PRODUCT_OPERATION',
      requestContext: { requestId: 'r', correlationId: 'c', traceId: 't' },
      causationId: null,
    };
    const legalHold: A7ProductDataMinimizationLegalHoldCommandV1 = {
      productKey: 'VIRTUAL_ACCOUNT',
      productVersion: 1,
      productOperationReference: 'a7-product-operation-reference',
      scope: 'A7_PRODUCT_OPERATION' as A7ProductDataMinimizationLegalHoldV1['scope'],
      referenceId: 'reference-1',
      requestContext: { requestId: 'r', correlationId: 'c', traceId: 't' },
      causationId: null,
    };
    const secret: A7ProductDataMinimizationSecretCommandV1 = {
      productKey: 'VIRTUAL_ACCOUNT',
      productVersion: 1,
      productOperationReference: 'a7-product-operation-reference',
      category: 'CALLBACK_SECRET' as A7ProductDataMinimizationSecretCommandV1['category'],
      reference: 'secret-1',
      requestContext: { requestId: 'r', correlationId: 'c', traceId: 't' },
      causationId: null,
    };
    const partnerPayload: A7ProductDataMinimizationPartnerPayloadCommandV1 = {
      productKey: 'VIRTUAL_ACCOUNT',
      productVersion: 1,
      productOperationReference: 'a7-product-operation-reference',
      partnerKey: 'NIBSS_NIP',
      capabilityKey: 'external.wallet.withdrawal.settlement',
      payload: { amountMinor: '100000', currency: 'NGN' },
      requestContext: { requestId: 'r', correlationId: 'c', traceId: 't' },
      causationId: null,
    };
    const disclosure: A7ProductDataMinimizationSupportTraceRequestV1 & {
      productOperationReference: string;
      kind: 'DISCLOSURE';
    } = null as never;
    void disclosure;
    const supportTrace: A7ProductDataMinimizationSupportTraceRequestV1 = {
      productKey: 'VIRTUAL_ACCOUNT',
      productVersion: 1,
      productOperationReference: 'a7-product-operation-reference',
      audience: 'SUPPORT' as ExternalDisclosureAudience,
      trace: { 'a7.productOperationReference': 'reference-1' },
      audit: { actor: 'a7-product-data-minimization' },
      requestContext: { requestId: 'r', correlationId: 'c', traceId: 't' },
      causationId: null,
    };
    const commands: A7ProductDataMinimizationCommandV1[] = [
      { kind: 'CLASSIFY', ...classify },
      { kind: 'CONSENT', ...consent },
      { kind: 'RETENTION', ...retention },
      { kind: 'LEGAL_HOLD', ...legalHold },
      { kind: 'SECRET', ...secret },
      { kind: 'PARTNER_PAYLOAD', ...partnerPayload },
      {
        kind: 'DISCLOSURE',
        productKey: 'VIRTUAL_ACCOUNT',
        productVersion: 1,
        productOperationReference: 'a7-product-operation-reference',
        audience: 'SUPPORT' as ExternalDisclosureAudience,
        fields: { 'a7.amountMinor': '100000' },
        audit: { actor: 'a7-product-data-minimization' },
        requestContext: { requestId: 'r', correlationId: 'c', traceId: 't' },
        causationId: null,
      },
      { kind: 'SUPPORT_TRACE', ...supportTrace },
    ];
    expect(commands.length).toBe(8);
  });

  it('exposes the A7 product data minimization field classification entry', () => {
    const entry: A7ProductDataMinimizationFieldClassification = {
      fieldName: 'a7.productOperationReference' as A7ProductDataMinimizationFieldName,
      level: ExternalDataHandlingLevel.INTERNAL,
      sourceDomain: 'a7.product',
      owner: 'a7-product-data-minimization',
      secretCategory: null,
      retentionDays: 365,
      holdSupport: true,
    };
    expect(entry.fieldName).toBe('a7.productOperationReference');
  });

  it('exposes the A7 product data minimization consent assertion, legal hold, disclosure projection, support-trace projection, and partner-payload validation types', () => {
    const assertion: A7ProductDataMinimizationConsentAssertionV1 = {
      productKey: 'VIRTUAL_ACCOUNT',
      productVersion: 1,
      customerId: '00000000-0000-4000-8000-000000000001',
      source: 'DERIVED' as A7ProductDataMinimizationConsentAssertionV1['source'],
      purpose: 'PRODUCT_VIRTUAL_ACCOUNT_INBOUND_FUNDING',
      jurisdiction: 'NG',
      grantedBy: 'a7-product-customer-binding',
      revocable: true,
      grantedAt: '2026-08-09T00:00:00.000Z',
      expiresAt: '2026-12-09T00:00:00.000Z',
      revokedAt: null,
      status: ExternalConsentStatus.ACTIVE,
      mandateReference: 'mandate-1',
      mandateVersion: 1,
      consentReference: 'a7-product-consent:v1:abc',
      recordedAt: '2026-08-09T00:00:00.000Z',
    };
    const legalHold: A7ProductDataMinimizationLegalHoldV1 = {
      holdId: 'hold-1',
      scope: 'A7_PRODUCT_OPERATION' as A7ProductDataMinimizationLegalHoldV1['scope'],
      referenceId: 'reference-1',
      owner: 'a7-product-data-minimization',
      authority: 'LEGAL' as A7ProductDataMinimizationLegalHoldV1['authority'],
      reason: 'reason-1',
      imposedAt: '2026-08-09T00:00:00.000Z',
      imposedBy: 'a7-product-data-minimization',
      releasedAt: null,
      releasedBy: null,
      notes: null,
      active: true,
    };
    const disclosure: A7ProductDataMinimizationDisclosureProjectionV1 = {
      disclosureReference: 'a7-product-disclosure:v1:abc',
      productKey: 'VIRTUAL_ACCOUNT',
      productVersion: 1,
      productOperationReference: 'a7-product-operation-reference',
      audience: 'SUPPORT' as ExternalDisclosureAudience,
      projectedFields: { 'a7.amountMinor': '100000' },
      maskedFields: [],
      audienceMaximumLevel: ExternalDataHandlingLevel.CONFIDENTIAL,
      generatedAt: '2026-08-09T00:00:00.000Z',
      correlationId: 'correlation-1',
    };
    const supportTrace: A7ProductDataMinimizationSupportTraceProjectionV1 = {
      supportTraceReference: 'a7-product-support-trace:v1:abc',
      productKey: 'VIRTUAL_ACCOUNT',
      productVersion: 1,
      productOperationReference: 'a7-product-operation-reference',
      audience: 'SUPPORT' as ExternalDisclosureAudience,
      projectedTrace: { 'a7.productOperationReference': 'reference-1' },
      maskedFields: [],
      generatedAt: '2026-08-09T00:00:00.000Z',
      correlationId: 'correlation-1',
    };
    const partnerPayload: A7ProductDataMinimizationPartnerPayloadValidationV1 = {
      partnerKey: 'NIBSS_NIP',
      capabilityKey: 'external.wallet.withdrawal.settlement',
      valid: true,
      rejectedFields: [],
      missingFields: [],
      recommendedFields: [],
      auditRecorded: true,
      rejectionCodes: [],
    };
    expect(assertion.status).toBe(ExternalConsentStatus.ACTIVE);
    expect(legalHold.active).toBe(true);
    expect(disclosure.audienceMaximumLevel).toBe(ExternalDataHandlingLevel.CONFIDENTIAL);
    expect(supportTrace.maskedFields.length).toBe(0);
    expect(partnerPayload.valid).toBe(true);
  });
});
