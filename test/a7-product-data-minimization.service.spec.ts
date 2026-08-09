import {
  A7_PRODUCT_DATA_MINIMIZATION_FAILURE_INVALID_COMMAND,
  A7_PRODUCT_DATA_MINIMIZATION_FAILURE_QUERY_UNAVAILABLE,
} from '../src/policy/a7-product-data-minimization.constants';
import { A7ProductDataMinimizationService } from '../src/policy/a7-product-data-minimization.service';
import type { A7ProductDataMinimizationRepository } from '../src/policy/a7-product-data-minimization.repository';
import type { A7ProductDataMinimizationCommandV1 } from '../src/policy/a7-product-data-minimization.types';
import {
  ExternalConsentStatus,
  ExternalDataHandlingLevel,
  ExternalLegalHoldScope,
} from '../src/partner/external-data-minimization.enums';
import type { ExternalDisclosureAudience } from '../src/partner/external-data-minimization.enums';

const PRODUCT_OPERATION_REFERENCE = 'a7-product-operation:v1:abc';
const REQUEST_ID = 'request-a7t10-1';
const CORRELATION_ID = 'correlation-a7t10-1';
const TRACE_ID = 'trace-a7t10-1';
const CUSTOMER_ID = '00000000-0000-4000-8000-000000000001';

function makeInput(overrides: Record<string, unknown> = {}): A7ProductDataMinimizationCommandV1 {
  return {
    productKey: 'VIRTUAL_ACCOUNT',
    productVersion: 1,
    productOperationReference: PRODUCT_OPERATION_REFERENCE,
    requestContext: {
      requestId: REQUEST_ID,
      correlationId: CORRELATION_ID,
      traceId: TRACE_ID,
    },
    causationId: null,
    ...overrides,
  } as A7ProductDataMinimizationCommandV1;
}

class FakeRepository {
  public classificationView: unknown = null;
  public consentView: unknown = null;
  public retentionView: unknown = null;
  public legalHoldView: unknown = null;
  public secretView: unknown = null;
  public disclosureProjection: unknown = null;
  public supportTraceProjection: unknown = null;
  public partnerPayloadValidation: unknown = null;
  public failure: unknown = null;
  public throwOnLoad = false;
  public batchReport: unknown = {
    contractName: 'A7-PRODUCT-DATA-MINIMIZATION',
    contractVersion: 1,
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
  public dataSource: {
    transaction: <T>(
      isolation: 'REPEATABLE READ',
      runner: (manager: unknown) => Promise<T>,
    ) => Promise<T>;
  } = {
    transaction: <T>(
      _isolation: 'REPEATABLE READ',
      runner: (manager: unknown) => Promise<T>,
    ): Promise<T> => {
      void _isolation;
      return runner({});
    },
  };

  getDataSource(): {
    transaction: <T>(
      isolation: 'REPEATABLE READ',
      runner: (manager: unknown) => Promise<T>,
    ) => Promise<T>;
  } {
    return this.dataSource;
  }

  getA7ProductDataMinimizationProviderIdempotencyScope(): string {
    return 'nibss.nip.external-operation.v1';
  }

  getContractName(): string {
    return 'A7-PRODUCT-DATA-MINIMIZATION';
  }

  getContractVersion(): number {
    return 1;
  }

  getConsumerPorts(): unknown {
    return {};
  }

  loadReport(command: A7ProductDataMinimizationCommandV1): Promise<unknown> {
    if (this.throwOnLoad) {
      return Promise.reject(new Error('query unavailable'));
    }
    return Promise.resolve({
      contractName: 'A7-PRODUCT-DATA-MINIMIZATION',
      contractVersion: 1,
      productKey: 'VIRTUAL_ACCOUNT',
      productVersion: 1,
      productOperationReference: command.productOperationReference,
      kind: command.kind,
      classificationView: this.classificationView,
      consentView: this.consentView,
      retentionView: this.retentionView,
      legalHoldView: this.legalHoldView,
      secretView: this.secretView,
      disclosureProjection: this.disclosureProjection,
      supportTraceProjection: this.supportTraceProjection,
      partnerPayloadValidation: this.partnerPayloadValidation,
      failure: this.failure,
      generatedAt: '2026-08-09T00:00:00.000Z',
      correlationId: command.requestContext.correlationId,
      requestId: command.requestContext.requestId,
      causationId: command.causationId,
    });
  }

  async loadBatchReport(
    batchId: string,
    batchReference: string,
    commands: readonly A7ProductDataMinimizationCommandV1[],
    generatedAt: string,
  ): Promise<unknown> {
    const reports: unknown[] = [];
    for (const command of commands) {
      reports.push(await this.loadReport(command));
    }
    return {
      contractName: 'A7-PRODUCT-DATA-MINIMIZATION',
      contractVersion: 1,
      batchId,
      batchReference,
      productKey: 'VIRTUAL_ACCOUNT',
      productVersion: 1,
      total: commands.length,
      withFailure: 0,
      queryUnavailable: 0,
      reports,
      generatedAt,
      correlationId: 'correlation-1',
    };
  }

  toResult(
    _command: A7ProductDataMinimizationCommandV1,
    report: unknown,
  ): { valid: true; report: unknown } | { valid: false; failure: unknown } {
    const r = report as { failure: unknown };
    if (r.failure) {
      return { valid: false, failure: r.failure };
    }
    return { valid: true, report: r };
  }
}

function serviceWithFakeRepository(fake: FakeRepository): A7ProductDataMinimizationService {
  return new A7ProductDataMinimizationService(
    fake as unknown as A7ProductDataMinimizationRepository,
  );
}

describe('A7T10 service', () => {
  it('exposes the A7 product data minimization contract identity', () => {
    const service = serviceWithFakeRepository(new FakeRepository());
    expect(service.getContractName()).toBe('A7-PRODUCT-DATA-MINIMIZATION');
    expect(service.getContractVersion()).toBe(1);
    expect(service.getContractDocument()).toBe('docs/A7-PRODUCT-DATA-CLASSIFICATION-MATRIX.md');
  });

  it('exposes the A7 product data minimization scope / retention / audit / actor / product getters', () => {
    const service = serviceWithFakeRepository(new FakeRepository());
    expect(service.getInternalIdempotencyScope()).toBe(
      'a7.product-data-minimization.idempotency.v1',
    );
    expect(service.getProviderIdempotencyScope()).toBe('nibss.nip.external-operation.v1');
    expect(service.getIdempotencyRetentionSeconds()).toBe(86_400);
    expect(service.getAuditEntityType()).toBe('A7_PRODUCT_DATA_MINIMIZATION');
    expect(service.getAuditActor()).toBe('a7-product-data-minimization');
    expect(service.getProductKey()).toBe('VIRTUAL_ACCOUNT');
    expect(service.getProductVersion()).toBe(1);
    expect(service.getProductCapability()).toBe('product.virtual-account');
    expect(service.getProductAction()).toBe('lifecycle');
  });

  it('exposes the A7 product data minimization vocabulary getters', () => {
    const service = serviceWithFakeRepository(new FakeRepository());
    expect(service.listConsentPurposes()).toEqual(['PRODUCT_VIRTUAL_ACCOUNT_INBOUND_FUNDING']);
    expect(service.listConsentApprovedJurisdictions()).toEqual(['NG']);
    expect(service.listRetentionDatasets().length).toBe(9);
    expect(service.listLegalHoldScopes().length).toBe(9);
    expect(service.listDisclosureAudiences().length).toBe(8);
    expect(service.listDataHandlingLevels()).toEqual([
      'PUBLIC',
      'INTERNAL',
      'CONFIDENTIAL',
      'RESTRICTED',
      'HIGHLY_RESTRICTED',
    ]);
    expect(service.listSecretCategories().length).toBe(10);
    expect(service.listFailureCodes().length).toBe(20);
    expect(service.listFieldClassifications().length).toBeGreaterThan(0);
    expect(service.listFieldNames().length).toBeGreaterThan(0);
  });

  it('rejects an invalid product key', async () => {
    const fake = new FakeRepository();
    const service = serviceWithFakeRepository(fake);
    const result = await service.evaluate(
      makeInput({ productKey: 'WRONG' as unknown as 'VIRTUAL_ACCOUNT' }),
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe(A7_PRODUCT_DATA_MINIMIZATION_FAILURE_INVALID_COMMAND);
    }
  });

  it('rejects an invalid product version', async () => {
    const fake = new FakeRepository();
    const service = serviceWithFakeRepository(fake);
    const result = await service.evaluate(makeInput({ productVersion: 2 as unknown as 1 }));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe(A7_PRODUCT_DATA_MINIMIZATION_FAILURE_INVALID_COMMAND);
    }
  });

  it('rejects an empty product operation reference', async () => {
    const fake = new FakeRepository();
    const service = serviceWithFakeRepository(fake);
    const result = await service.evaluate(makeInput({ productOperationReference: '' }));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe(A7_PRODUCT_DATA_MINIMIZATION_FAILURE_INVALID_COMMAND);
    }
  });

  it('rejects an invalid CONSENT customerId', async () => {
    const fake = new FakeRepository();
    const service = serviceWithFakeRepository(fake);
    const result = await service.evaluate(
      makeInput({
        kind: 'CONSENT',
        customerId: 'not-a-uuid',
        source: 'DERIVED' as never,
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
      } as Partial<A7ProductDataMinimizationCommandV1>),
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe(A7_PRODUCT_DATA_MINIMIZATION_FAILURE_INVALID_COMMAND);
    }
  });

  it('returns the A6T10 consent view for a valid CONSENT command', async () => {
    const fake = new FakeRepository();
    fake.consentView = {
      consentId: 'consent-1',
      customerId: CUSTOMER_ID,
      source: 'DERIVED',
      targetId: '00000000-0000-4000-8000-000000000002',
      targetVersion: 1,
      purpose: 'PRODUCT_VIRTUAL_ACCOUNT_INBOUND_FUNDING',
      jurisdiction: 'NG',
      mandateReference: 'mandate-1',
      mandateVersion: 1,
      grantedAt: new Date('2026-08-09T00:00:00.000Z'),
      expiresAt: new Date('2026-12-09T00:00:00.000Z'),
      grantedBy: 'a7-product-customer-binding',
      revocable: true,
      revokedAt: null,
      status: ExternalConsentStatus.ACTIVE,
      recordedAt: new Date('2026-08-09T00:00:00.000Z'),
    };
    const service = serviceWithFakeRepository(fake);
    const result = await service.evaluate(
      makeInput({
        kind: 'CONSENT',
        customerId: CUSTOMER_ID,
        source: 'DERIVED' as never,
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
      } as Partial<A7ProductDataMinimizationCommandV1>),
    );
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.report.consentView).not.toBeNull();
    }
  });

  it('returns the A6T10 retention view for a valid RETENTION command', async () => {
    const fake = new FakeRepository();
    fake.retentionView = {
      retentionId: 'retention-1',
      dataset: 'A7_PRODUCT_OPERATION',
      level: ExternalDataHandlingLevel.CONFIDENTIAL,
      owner: 'a7-product-data-minimization',
      retentionDays: 365,
      holdSupport: true,
      recordedAt: new Date('2026-08-09T00:00:00.000Z'),
    };
    const service = serviceWithFakeRepository(fake);
    const result = await service.evaluate(
      makeInput({
        kind: 'RETENTION',
        dataset: 'A7_PRODUCT_OPERATION',
      } as Partial<A7ProductDataMinimizationCommandV1>),
    );
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.report.retentionView).not.toBeNull();
    }
  });

  it('returns the A6T10 legal-hold view for a valid LEGAL_HOLD command', async () => {
    const fake = new FakeRepository();
    fake.legalHoldView = {
      holdId: 'hold-1',
      scope: ExternalLegalHoldScope.EXTERNAL_OPERATION,
      referenceId: 'reference-1',
      owner: 'a7-product-data-minimization',
      authority: 'LEGAL',
      reason: 'reason-1',
      imposedAt: new Date('2026-08-09T00:00:00.000Z'),
      imposedBy: 'a7-product-data-minimization',
      releasedAt: null,
      releasedBy: null,
      notes: null,
      status: 'ACTIVE',
    };
    const service = serviceWithFakeRepository(fake);
    const result = await service.evaluate(
      makeInput({
        kind: 'LEGAL_HOLD',
        scope: 'A7_PRODUCT_OPERATION' as never,
        referenceId: 'reference-1',
      } as Partial<A7ProductDataMinimizationCommandV1>),
    );
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.report.legalHoldView).not.toBeNull();
    }
  });

  it('returns the A6T10 secret classification view for a valid SECRET command', async () => {
    const fake = new FakeRepository();
    fake.secretView = {
      classificationId: 'secret-1',
      category: 'CALLBACK_SECRET',
      owner: 'a7-product-data-minimization',
      reference: 'secret-1',
      notes: null,
      recordedAt: new Date('2026-08-09T00:00:00.000Z'),
    };
    const service = serviceWithFakeRepository(fake);
    const result = await service.evaluate(
      makeInput({
        kind: 'SECRET',
        category: 'CALLBACK_SECRET' as never,
        reference: 'secret-1',
      } as Partial<A7ProductDataMinimizationCommandV1>),
    );
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.report.secretView).not.toBeNull();
    }
  });

  it('returns the A6T10 classification view for a valid CLASSIFY command', async () => {
    const fake = new FakeRepository();
    fake.classificationView = {
      classificationId: 'a7.productOperationReference',
      fieldName: 'a7.productOperationReference',
      level: ExternalDataHandlingLevel.INTERNAL,
      sourceDomain: 'a7.product',
      owner: 'a7-product-data-minimization',
      recordedAt: new Date('2026-08-09T00:00:00.000Z'),
      classificationRegistryVersion: 1,
    };
    const service = serviceWithFakeRepository(fake);
    const result = await service.evaluate(
      makeInput({
        kind: 'CLASSIFY',
        fieldName: 'a7.productOperationReference' as never,
      } as Partial<A7ProductDataMinimizationCommandV1>),
    );
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.report.classificationView).not.toBeNull();
    }
  });

  it('returns the A6T10 disclosure projection for a valid DISCLOSURE command', async () => {
    const fake = new FakeRepository();
    fake.disclosureProjection = {
      viewId: 'disclosure-1',
      externalOperationId: PRODUCT_OPERATION_REFERENCE,
      audience: 'SUPPORT' as ExternalDisclosureAudience,
      fields: { 'a7.amountMinor': '100000' },
      maskedFields: [],
      generatedAt: new Date('2026-08-09T00:00:00.000Z'),
    };
    const service = serviceWithFakeRepository(fake);
    const result = await service.evaluate(
      makeInput({
        kind: 'DISCLOSURE',
        audience: 'SUPPORT' as never,
        fields: { 'a7.amountMinor': '100000' },
        audit: { actor: 'a7-product-data-minimization' },
      } as Partial<A7ProductDataMinimizationCommandV1>),
    );
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.report.disclosureProjection).not.toBeNull();
    }
  });

  it('returns the A6T10 support-trace projection for a valid SUPPORT_TRACE command', async () => {
    const fake = new FakeRepository();
    fake.supportTraceProjection = {
      traceId: 'trace-1',
      externalOperationId: PRODUCT_OPERATION_REFERENCE,
      audience: 'SUPPORT' as ExternalDisclosureAudience,
      trace: { 'a7.productOperationReference': 'reference-1' },
      maskedFields: [],
      generatedAt: new Date('2026-08-09T00:00:00.000Z'),
    };
    const service = serviceWithFakeRepository(fake);
    const result = await service.evaluate(
      makeInput({
        kind: 'SUPPORT_TRACE',
        audience: 'SUPPORT' as never,
        trace: { 'a7.productOperationReference': 'reference-1' },
        audit: { actor: 'a7-product-data-minimization' },
      } as Partial<A7ProductDataMinimizationCommandV1>),
    );
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.report.supportTraceProjection).not.toBeNull();
    }
  });

  it('returns the A6T10 partner-payload validation for a valid PARTNER_PAYLOAD command', async () => {
    const fake = new FakeRepository();
    fake.partnerPayloadValidation = {
      valid: true,
      rejectedFields: [],
      missingFields: [],
      recommendedFields: [],
      auditRecorded: true,
    };
    const service = serviceWithFakeRepository(fake);
    const result = await service.evaluate(
      makeInput({
        kind: 'PARTNER_PAYLOAD',
        partnerKey: 'NIBSS_NIP',
        capabilityKey: 'external.wallet.withdrawal.settlement',
        payload: { amountMinor: '100000', currency: 'NGN' },
      } as Partial<A7ProductDataMinimizationCommandV1>),
    );
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.report.partnerPayloadValidation).not.toBeNull();
    }
  });

  it('returns a failure when the data source transaction throws', async () => {
    const fake = new FakeRepository();
    fake.dataSource = {
      transaction: <T>(
        _isolation: 'REPEATABLE READ',
        _runner: (manager: unknown) => Promise<T>,
      ): Promise<T> => {
        void _isolation;
        void _runner;
        return Promise.reject(new Error('query unavailable'));
      },
    };
    const service = serviceWithFakeRepository(fake);
    const result = await service.evaluate(makeInput());
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe(A7_PRODUCT_DATA_MINIMIZATION_FAILURE_QUERY_UNAVAILABLE);
    }
  });

  it('returns a failure when the repository throws on load', async () => {
    const fake = new FakeRepository();
    fake.throwOnLoad = true;
    const service = serviceWithFakeRepository(fake);
    const result = await service.evaluate(makeInput());
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe(A7_PRODUCT_DATA_MINIMIZATION_FAILURE_QUERY_UNAVAILABLE);
    }
  });

  it('rejects an empty batch', async () => {
    const fake = new FakeRepository();
    const service = serviceWithFakeRepository(fake);
    const result = await service.evaluateBatch([]);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe(A7_PRODUCT_DATA_MINIMIZATION_FAILURE_INVALID_COMMAND);
    }
  });

  it('rejects a batch with an invalid command', async () => {
    const fake = new FakeRepository();
    const service = serviceWithFakeRepository(fake);
    const result = await service.evaluateBatch([makeInput({ productOperationReference: '' })]);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe(A7_PRODUCT_DATA_MINIMIZATION_FAILURE_INVALID_COMMAND);
    }
  });

  it('returns a batch report for a valid batch', async () => {
    const fake = new FakeRepository();
    const service = serviceWithFakeRepository(fake);
    const result = await service.evaluateBatch([makeInput(), makeInput()]);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.report.total).toBe(2);
    }
  });

  it('exposes the A7 product data minimization consumer ports through the repository', () => {
    const fake = new FakeRepository();
    const service = serviceWithFakeRepository(fake);
    const ports = service.getConsumerPorts();
    expect(ports).toBeDefined();
  });

  it('looks up a field classification by fieldName', () => {
    const service = serviceWithFakeRepository(new FakeRepository());
    const entry = service.getFieldClassification('a7.productOperationReference' as never);
    expect(entry).not.toBeNull();
  });

  it('returns null for an unknown fieldName', () => {
    const service = serviceWithFakeRepository(new FakeRepository());
    const entry = service.getFieldClassification('a7.unknownField' as never);
    expect(entry).toBeNull();
  });
});
