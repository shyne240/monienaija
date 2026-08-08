import { Injectable } from '@nestjs/common';

import {
  EXTERNAL_DATA_MINIMIZATION_AUDIENCE_MAXIMUM_LEVELS,
  EXTERNAL_DATA_MINIMIZATION_DEFAULT_RETENTION_DAYS,
  EXTERNAL_DATA_MINIMIZATION_DISCLOSURE_RETENTION_DAYS,
  EXTERNAL_DATA_MINIMIZATION_IDEMPOTENCY_RETENTION_DAYS,
  EXTERNAL_DATA_MINIMIZATION_OUTBOX_PUBLISHED_RETENTION_DAYS,
  EXTERNAL_DATA_MINIMIZATION_SUPPORT_TRACE_RETENTION_DAYS,
  ExternalDataHandlingLevel,
  ExternalDisclosureAudience,
  ExternalSecretCategory,
} from './external-data-minimization.enums';
import {
  EXTERNAL_DATA_MINIMIZATION_FIELD_REGISTRY_VERSION,
  ExternalDataClassificationEntry,
  ExternalDataMinimizationException,
} from './external-data-minimization.types';

@Injectable()
export class ExternalDataClassificationRegistry {
  private readonly entriesByName = new Map<string, ExternalDataClassificationEntry>();

  constructor() {
    this.registerDefaults();
  }

  get(fieldName: string): ExternalDataClassificationEntry {
    const entry = this.entriesByName.get(fieldName);
    if (!entry) {
      throw new ExternalDataMinimizationException(
        'CLASSIFICATION_NOT_REGISTERED',
        `Field ${fieldName} is not registered in the data classification registry`,
      );
    }
    return entry;
  }

  tryGet(fieldName: string): ExternalDataClassificationEntry | null {
    return this.entriesByName.get(fieldName) ?? null;
  }

  isRegistered(fieldName: string): boolean {
    return this.entriesByName.has(fieldName);
  }

  levelFor(fieldName: string): ExternalDataHandlingLevel {
    return this.get(fieldName).level;
  }

  registryVersion(): number {
    return EXTERNAL_DATA_MINIMIZATION_FIELD_REGISTRY_VERSION;
  }

  isSecret(fieldName: string): boolean {
    return (
      this.tryGet(fieldName)?.secretCategory !== null &&
      this.tryGet(fieldName)?.secretCategory !== undefined
    );
  }

  secretCategoryFor(fieldName: string): ExternalSecretCategory | null {
    return this.get(fieldName).secretCategory;
  }

  allFieldNames(): readonly string[] {
    return [...this.entriesByName.keys()];
  }

  register(entry: ExternalDataClassificationEntry): void {
    if (entry.fieldName.length === 0) {
      throw new ExternalDataMinimizationException(
        'CLASSIFICATION_NOT_REGISTERED',
        'Field name must be non-empty',
      );
    }
    if (
      entry.secretCategory !== null &&
      entry.level !== ExternalDataHandlingLevel.HIGHLY_RESTRICTED
    ) {
      throw new ExternalDataMinimizationException(
        'CLASSIFICATION_LEVEL_INVALID',
        `Secret field ${entry.fieldName} must be classified as HIGHLY_RESTRICTED`,
      );
    }
    this.entriesByName.set(entry.fieldName, entry);
  }

  private registerDefaults(): void {
    const A = ExternalDataHandlingLevel;
    const auditAudience = EXTERNAL_DATA_MINIMIZATION_AUDIENCE_MAXIMUM_LEVELS;

    const register = (entry: Omit<ExternalDataClassificationEntry, 'audienceMaximums'>): void => {
      this.register({ ...entry, audienceMaximums: auditAudience });
    };

    // External operation identity
    register({
      fieldName: 'externalOperationId',
      level: A.INTERNAL,
      sourceDomain: 'A6T05',
      owner: 'a6-external-operation',
      secretCategory: null,
      retentionDays: 365,
      holdSupport: true,
    });
    register({
      fieldName: 'externalOperationReference',
      level: A.INTERNAL,
      sourceDomain: 'A6T05',
      owner: 'a6-external-operation',
      secretCategory: null,
      retentionDays: 365,
      holdSupport: true,
    });
    register({
      fieldName: 'operationVersion',
      level: A.INTERNAL,
      sourceDomain: 'A6T05',
      owner: 'a6-external-operation',
      secretCategory: null,
      retentionDays: 365,
      holdSupport: true,
    });
    register({
      fieldName: 'partnerKey',
      level: A.INTERNAL,
      sourceDomain: 'A6T05',
      owner: 'a6-external-operation',
      secretCategory: null,
      retentionDays: 365,
      holdSupport: true,
    });
    register({
      fieldName: 'capabilityKey',
      level: A.INTERNAL,
      sourceDomain: 'A6T05',
      owner: 'a6-external-operation',
      secretCategory: null,
      retentionDays: 365,
      holdSupport: true,
    });
    register({
      fieldName: 'operationType',
      level: A.INTERNAL,
      sourceDomain: 'A6T05',
      owner: 'a6-external-operation',
      secretCategory: null,
      retentionDays: 365,
      holdSupport: true,
    });
    register({
      fieldName: 'resourceType',
      level: A.INTERNAL,
      sourceDomain: 'A6T05',
      owner: 'a6-external-operation',
      secretCategory: null,
      retentionDays: 365,
      holdSupport: true,
    });
    register({
      fieldName: 'resourceId',
      level: A.CONFIDENTIAL,
      sourceDomain: 'A6T05',
      owner: 'a6-external-operation',
      secretCategory: null,
      retentionDays: 365,
      holdSupport: true,
    });
    register({
      fieldName: 'internalCommandId',
      level: A.INTERNAL,
      sourceDomain: 'A6T05',
      owner: 'a6-external-operation',
      secretCategory: null,
      retentionDays: 365,
      holdSupport: true,
    });

    // Customer/Wallet/Ledger identity chain
    register({
      fieldName: 'customerId',
      level: A.RESTRICTED,
      sourceDomain: 'Customer',
      owner: 'customer-engineering',
      secretCategory: null,
      retentionDays: 365,
      holdSupport: true,
    });
    register({
      fieldName: 'walletAccountId',
      level: A.RESTRICTED,
      sourceDomain: 'Wallet',
      owner: 'wallet',
      secretCategory: null,
      retentionDays: 365,
      holdSupport: true,
    });
    register({
      fieldName: 'ledgerAccountId',
      level: A.RESTRICTED,
      sourceDomain: 'Ledger',
      owner: 'ledger',
      secretCategory: null,
      retentionDays: 365,
      holdSupport: true,
    });
    register({
      fieldName: 'customerLedgerAccountId',
      level: A.RESTRICTED,
      sourceDomain: 'Ledger',
      owner: 'ledger',
      secretCategory: null,
      retentionDays: 365,
      holdSupport: true,
    });
    register({
      fieldName: 'settlementAssetLedgerAccountId',
      level: A.RESTRICTED,
      sourceDomain: 'Ledger',
      owner: 'ledger',
      secretCategory: null,
      retentionDays: 365,
      holdSupport: true,
    });

    // Money and target mapping
    register({
      fieldName: 'targetMappingReference',
      level: A.INTERNAL,
      sourceDomain: 'A6T04',
      owner: 'a6-external-funding-target',
      secretCategory: null,
      retentionDays: 365,
      holdSupport: true,
    });
    register({
      fieldName: 'amountMinor',
      level: A.CONFIDENTIAL,
      sourceDomain: 'A5/A6',
      owner: 'finance',
      secretCategory: null,
      retentionDays: 365,
      holdSupport: true,
    });
    register({
      fieldName: 'currency',
      level: A.INTERNAL,
      sourceDomain: 'A5/A6',
      owner: 'finance',
      secretCategory: null,
      retentionDays: 365,
      holdSupport: true,
    });
    register({
      fieldName: 'accountingUnit',
      level: A.INTERNAL,
      sourceDomain: 'A5/A6',
      owner: 'finance',
      secretCategory: null,
      retentionDays: 365,
      holdSupport: true,
    });

    // Idempotency
    register({
      fieldName: 'internalIdempotencyScope',
      level: A.CONFIDENTIAL,
      sourceDomain: 'Operations',
      owner: 'operations',
      secretCategory: null,
      retentionDays: EXTERNAL_DATA_MINIMIZATION_IDEMPOTENCY_RETENTION_DAYS,
      holdSupport: true,
    });
    register({
      fieldName: 'internalIdempotencyKey',
      level: A.CONFIDENTIAL,
      sourceDomain: 'Operations',
      owner: 'operations',
      secretCategory: null,
      retentionDays: EXTERNAL_DATA_MINIMIZATION_IDEMPOTENCY_RETENTION_DAYS,
      holdSupport: true,
    });
    register({
      fieldName: 'providerIdempotencyScope',
      level: A.CONFIDENTIAL,
      sourceDomain: 'A6T05',
      owner: 'a6-external-operation',
      secretCategory: null,
      retentionDays: 365,
      holdSupport: true,
    });
    register({
      fieldName: 'providerIdempotencyKey',
      level: A.CONFIDENTIAL,
      sourceDomain: 'A6T05',
      owner: 'a6-external-operation',
      secretCategory: null,
      retentionDays: 365,
      holdSupport: true,
    });

    // Request hash and correlation
    register({
      fieldName: 'requestHash',
      level: A.INTERNAL,
      sourceDomain: 'A6T05',
      owner: 'a6-external-operation',
      secretCategory: null,
      retentionDays: 365,
      holdSupport: true,
    });
    register({
      fieldName: 'requestId',
      level: A.INTERNAL,
      sourceDomain: 'Operations',
      owner: 'operations',
      secretCategory: null,
      retentionDays: 365,
      holdSupport: true,
    });
    register({
      fieldName: 'correlationId',
      level: A.INTERNAL,
      sourceDomain: 'Operations',
      owner: 'operations',
      secretCategory: null,
      retentionDays: 365,
      holdSupport: true,
    });
    register({
      fieldName: 'traceId',
      level: A.INTERNAL,
      sourceDomain: 'Operations',
      owner: 'operations',
      secretCategory: null,
      retentionDays: 365,
      holdSupport: true,
    });
    register({
      fieldName: 'causationId',
      level: A.INTERNAL,
      sourceDomain: 'Operations',
      owner: 'operations',
      secretCategory: null,
      retentionDays: 365,
      holdSupport: true,
    });

    // Lifecycle
    register({
      fieldName: 'lifecycleState',
      level: A.INTERNAL,
      sourceDomain: 'A6T07',
      owner: 'a6-external-lifecycle',
      secretCategory: null,
      retentionDays: 365,
      holdSupport: true,
    });
    register({
      fieldName: 'attemptCount',
      level: A.INTERNAL,
      sourceDomain: 'A6T07',
      owner: 'a6-external-lifecycle',
      secretCategory: null,
      retentionDays: 365,
      holdSupport: true,
    });
    register({
      fieldName: 'maxAttempts',
      level: A.INTERNAL,
      sourceDomain: 'A6T07',
      owner: 'a6-external-lifecycle',
      secretCategory: null,
      retentionDays: 365,
      holdSupport: true,
    });
    register({
      fieldName: 'providerStatus',
      level: A.CONFIDENTIAL,
      sourceDomain: 'A6T07',
      owner: 'a6-external-lifecycle',
      secretCategory: null,
      retentionDays: 365,
      holdSupport: true,
    });
    register({
      fieldName: 'failureCode',
      level: A.CONFIDENTIAL,
      sourceDomain: 'A6T07',
      owner: 'a6-external-lifecycle',
      secretCategory: null,
      retentionDays: 365,
      holdSupport: true,
    });
    register({
      fieldName: 'failureMessage',
      level: A.CONFIDENTIAL,
      sourceDomain: 'A6T07',
      owner: 'a6-external-lifecycle',
      secretCategory: null,
      retentionDays: 365,
      holdSupport: true,
    });
    register({
      fieldName: 'recoveryReference',
      level: A.INTERNAL,
      sourceDomain: 'A6T07',
      owner: 'a6-external-lifecycle',
      secretCategory: null,
      retentionDays: 365,
      holdSupport: true,
    });

    // External operation reference
    register({
      fieldName: 'referenceType',
      level: A.INTERNAL,
      sourceDomain: 'A6T05',
      owner: 'a6-external-operation',
      secretCategory: null,
      retentionDays: 365,
      holdSupport: true,
    });
    register({
      fieldName: 'referenceValue',
      level: A.CONFIDENTIAL,
      sourceDomain: 'Partner',
      owner: 'a6-external-operation',
      secretCategory: null,
      retentionDays: 365,
      holdSupport: true,
    });
    register({
      fieldName: 'referenceValueHash',
      level: A.INTERNAL,
      sourceDomain: 'A6T05',
      owner: 'a6-external-operation',
      secretCategory: null,
      retentionDays: 365,
      holdSupport: true,
    });
    register({
      fieldName: 'namespace',
      level: A.INTERNAL,
      sourceDomain: 'Partner',
      owner: 'a6-external-operation',
      secretCategory: null,
      retentionDays: 365,
      holdSupport: true,
    });
    register({
      fieldName: 'source',
      level: A.INTERNAL,
      sourceDomain: 'A6T05',
      owner: 'a6-external-operation',
      secretCategory: null,
      retentionDays: 365,
      holdSupport: true,
    });
    register({
      fieldName: 'observedAt',
      level: A.INTERNAL,
      sourceDomain: 'A6T05',
      owner: 'a6-external-operation',
      secretCategory: null,
      retentionDays: 365,
      holdSupport: true,
    });

    // External callback receipt
    register({
      fieldName: 'callbackEventId',
      level: A.CONFIDENTIAL,
      sourceDomain: 'Partner',
      owner: 'a6-partner-callback',
      secretCategory: null,
      retentionDays: 365,
      holdSupport: true,
    });
    register({
      fieldName: 'payloadHash',
      level: A.INTERNAL,
      sourceDomain: 'A6T06',
      owner: 'a6-partner-callback',
      secretCategory: null,
      retentionDays: 365,
      holdSupport: true,
    });
    register({
      fieldName: 'signatureHash',
      level: A.INTERNAL,
      sourceDomain: 'A6T06',
      owner: 'a6-partner-callback',
      secretCategory: null,
      retentionDays: 365,
      holdSupport: true,
    });
    register({
      fieldName: 'providerReferenceType',
      level: A.INTERNAL,
      sourceDomain: 'A6T06',
      owner: 'a6-partner-callback',
      secretCategory: null,
      retentionDays: 365,
      holdSupport: true,
    });
    register({
      fieldName: 'providerReferenceValueHash',
      level: A.INTERNAL,
      sourceDomain: 'A6T06',
      owner: 'a6-partner-callback',
      secretCategory: null,
      retentionDays: 365,
      holdSupport: true,
    });
    register({
      fieldName: 'providerReferenceNamespace',
      level: A.INTERNAL,
      sourceDomain: 'A6T06',
      owner: 'a6-partner-callback',
      secretCategory: null,
      retentionDays: 365,
      holdSupport: true,
    });
    register({
      fieldName: 'providerOccurredAt',
      level: A.INTERNAL,
      sourceDomain: 'A6T06',
      owner: 'a6-partner-callback',
      secretCategory: null,
      retentionDays: 365,
      holdSupport: true,
    });
    register({
      fieldName: 'receivedAt',
      level: A.INTERNAL,
      sourceDomain: 'A6T06',
      owner: 'a6-partner-callback',
      secretCategory: null,
      retentionDays: 365,
      holdSupport: true,
    });
    register({
      fieldName: 'status',
      level: A.INTERNAL,
      sourceDomain: 'A6T06',
      owner: 'a6-partner-callback',
      secretCategory: null,
      retentionDays: 365,
      holdSupport: true,
    });
    register({
      fieldName: 'rejectionCode',
      level: A.INTERNAL,
      sourceDomain: 'A6T06',
      owner: 'a6-partner-callback',
      secretCategory: null,
      retentionDays: 365,
      holdSupport: true,
    });

    // External settlement
    register({
      fieldName: 'decision',
      level: A.INTERNAL,
      sourceDomain: 'A6T08',
      owner: 'a6-external-settlement',
      secretCategory: null,
      retentionDays: 365,
      holdSupport: true,
    });
    register({
      fieldName: 'evidenceType',
      level: A.INTERNAL,
      sourceDomain: 'A6T08',
      owner: 'a6-external-settlement',
      secretCategory: null,
      retentionDays: 365,
      holdSupport: true,
    });
    register({
      fieldName: 'evidenceValue',
      level: A.CONFIDENTIAL,
      sourceDomain: 'Partner',
      owner: 'a6-external-settlement',
      secretCategory: null,
      retentionDays: 365,
      holdSupport: true,
    });
    register({
      fieldName: 'evidenceValueHash',
      level: A.INTERNAL,
      sourceDomain: 'A6T08',
      owner: 'a6-external-settlement',
      secretCategory: null,
      retentionDays: 365,
      holdSupport: true,
    });
    register({
      fieldName: 'evidenceNamespace',
      level: A.INTERNAL,
      sourceDomain: 'A6T08',
      owner: 'a6-external-settlement',
      secretCategory: null,
      retentionDays: 365,
      holdSupport: true,
    });
    register({
      fieldName: 'evidenceSource',
      level: A.INTERNAL,
      sourceDomain: 'A6T08',
      owner: 'a6-external-settlement',
      secretCategory: null,
      retentionDays: 365,
      holdSupport: true,
    });
    register({
      fieldName: 'evidenceHash',
      level: A.INTERNAL,
      sourceDomain: 'A6T08',
      owner: 'a6-external-settlement',
      secretCategory: null,
      retentionDays: 365,
      holdSupport: true,
    });
    register({
      fieldName: 'idempotencyScope',
      level: A.CONFIDENTIAL,
      sourceDomain: 'Operations',
      owner: 'a6-external-settlement',
      secretCategory: null,
      retentionDays: 365,
      holdSupport: true,
    });
    register({
      fieldName: 'idempotencyKey',
      level: A.CONFIDENTIAL,
      sourceDomain: 'Operations',
      owner: 'a6-external-settlement',
      secretCategory: null,
      retentionDays: 365,
      holdSupport: true,
    });
    register({
      fieldName: 'ownerPrincipal',
      level: A.INTERNAL,
      sourceDomain: 'A6T08',
      owner: 'a6-external-settlement',
      secretCategory: null,
      retentionDays: 365,
      holdSupport: true,
    });
    register({
      fieldName: 'postedAt',
      level: A.INTERNAL,
      sourceDomain: 'A6T08',
      owner: 'a6-external-settlement',
      secretCategory: null,
      retentionDays: 365,
      holdSupport: true,
    });
    register({
      fieldName: 'reversalPostedAt',
      level: A.INTERNAL,
      sourceDomain: 'A6T08',
      owner: 'a6-external-settlement',
      secretCategory: null,
      retentionDays: 365,
      holdSupport: true,
    });
    register({
      fieldName: 'journalId',
      level: A.RESTRICTED,
      sourceDomain: 'Ledger',
      owner: 'ledger',
      secretCategory: null,
      retentionDays: 365,
      holdSupport: true,
    });
    register({
      fieldName: 'reversalJournalId',
      level: A.RESTRICTED,
      sourceDomain: 'Ledger',
      owner: 'ledger',
      secretCategory: null,
      retentionDays: 365,
      holdSupport: true,
    });

    // External suspense entry
    register({
      fieldName: 'reason',
      level: A.INTERNAL,
      sourceDomain: 'A6T08',
      owner: 'a6-external-settlement',
      secretCategory: null,
      retentionDays: 365,
      holdSupport: true,
    });
    register({
      fieldName: 'owner',
      level: A.INTERNAL,
      sourceDomain: 'A6T08',
      owner: 'a6-external-settlement',
      secretCategory: null,
      retentionDays: 365,
      holdSupport: true,
    });
    register({
      fieldName: 'rejectionCode',
      level: A.INTERNAL,
      sourceDomain: 'A6T08',
      owner: 'a6-external-settlement',
      secretCategory: null,
      retentionDays: 365,
      holdSupport: true,
    });
    register({
      fieldName: 'clearedAt',
      level: A.INTERNAL,
      sourceDomain: 'A6T08',
      owner: 'a6-external-settlement',
      secretCategory: null,
      retentionDays: 365,
      holdSupport: true,
    });
    register({
      fieldName: 'settlementId',
      level: A.INTERNAL,
      sourceDomain: 'A6T08',
      owner: 'a6-external-settlement',
      secretCategory: null,
      retentionDays: 365,
      holdSupport: true,
    });

    // Audit/outbox/idempotency
    register({
      fieldName: 'auditEvent.previousValues',
      level: A.CONFIDENTIAL,
      sourceDomain: 'Operations',
      owner: 'operations',
      secretCategory: null,
      retentionDays: 365,
      holdSupport: true,
    });
    register({
      fieldName: 'auditEvent.newValues',
      level: A.CONFIDENTIAL,
      sourceDomain: 'Operations',
      owner: 'operations',
      secretCategory: null,
      retentionDays: 365,
      holdSupport: true,
    });
    register({
      fieldName: 'outboxEvent.payload',
      level: A.CONFIDENTIAL,
      sourceDomain: 'Operations',
      owner: 'operations',
      secretCategory: null,
      retentionDays: EXTERNAL_DATA_MINIMIZATION_OUTBOX_PUBLISHED_RETENTION_DAYS,
      holdSupport: true,
    });
    register({
      fieldName: 'idempotencyRecord.requestHash',
      level: A.INTERNAL,
      sourceDomain: 'Operations',
      owner: 'operations',
      secretCategory: null,
      retentionDays: EXTERNAL_DATA_MINIMIZATION_IDEMPOTENCY_RETENTION_DAYS,
      holdSupport: true,
    });
    register({
      fieldName: 'idempotencyRecord.match',
      level: A.INTERNAL,
      sourceDomain: 'Operations',
      owner: 'operations',
      secretCategory: null,
      retentionDays: EXTERNAL_DATA_MINIMIZATION_IDEMPOTENCY_RETENTION_DAYS,
      holdSupport: true,
    });

    // A6T10 internal records
    register({
      fieldName: 'dataClassification.fieldName',
      level: A.INTERNAL,
      sourceDomain: 'A6T10',
      owner: 'a6-external-data-minimization',
      secretCategory: null,
      retentionDays: 365,
      holdSupport: true,
    });
    register({
      fieldName: 'dataClassification.level',
      level: A.INTERNAL,
      sourceDomain: 'A6T10',
      owner: 'a6-external-data-minimization',
      secretCategory: null,
      retentionDays: 365,
      holdSupport: true,
    });
    register({
      fieldName: 'dataClassification.sourceDomain',
      level: A.INTERNAL,
      sourceDomain: 'A6T10',
      owner: 'a6-external-data-minimization',
      secretCategory: null,
      retentionDays: 365,
      holdSupport: true,
    });
    register({
      fieldName: 'dataClassification.owner',
      level: A.INTERNAL,
      sourceDomain: 'A6T10',
      owner: 'a6-external-data-minimization',
      secretCategory: null,
      retentionDays: 365,
      holdSupport: true,
    });
    register({
      fieldName: 'consent.mandateReference',
      level: A.RESTRICTED,
      sourceDomain: 'Consent',
      owner: 'a6-external-data-minimization',
      secretCategory: null,
      retentionDays: 365,
      holdSupport: true,
    });
    register({
      fieldName: 'consent.grantedBy',
      level: A.CONFIDENTIAL,
      sourceDomain: 'Consent',
      owner: 'a6-external-data-minimization',
      secretCategory: null,
      retentionDays: 365,
      holdSupport: true,
    });
    register({
      fieldName: 'retention.dataset',
      level: A.INTERNAL,
      sourceDomain: 'A6T10',
      owner: 'a6-external-data-minimization',
      secretCategory: null,
      retentionDays: 365,
      holdSupport: true,
    });
    register({
      fieldName: 'retention.level',
      level: A.INTERNAL,
      sourceDomain: 'A6T10',
      owner: 'a6-external-data-minimization',
      secretCategory: null,
      retentionDays: 365,
      holdSupport: true,
    });
    register({
      fieldName: 'retention.owner',
      level: A.INTERNAL,
      sourceDomain: 'A6T10',
      owner: 'a6-external-data-minimization',
      secretCategory: null,
      retentionDays: 365,
      holdSupport: true,
    });
    register({
      fieldName: 'retention.retentionDays',
      level: A.INTERNAL,
      sourceDomain: 'A6T10',
      owner: 'a6-external-data-minimization',
      secretCategory: null,
      retentionDays: 365,
      holdSupport: true,
    });
    register({
      fieldName: 'legalHold.scope',
      level: A.INTERNAL,
      sourceDomain: 'A6T10',
      owner: 'a6-external-data-minimization',
      secretCategory: null,
      retentionDays: 365,
      holdSupport: true,
    });
    register({
      fieldName: 'legalHold.referenceId',
      level: A.INTERNAL,
      sourceDomain: 'A6T10',
      owner: 'a6-external-data-minimization',
      secretCategory: null,
      retentionDays: 365,
      holdSupport: true,
    });
    register({
      fieldName: 'legalHold.owner',
      level: A.RESTRICTED,
      sourceDomain: 'A6T10',
      owner: 'a6-external-data-minimization',
      secretCategory: null,
      retentionDays: 365,
      holdSupport: true,
    });
    register({
      fieldName: 'legalHold.authority',
      level: A.RESTRICTED,
      sourceDomain: 'A6T10',
      owner: 'a6-external-data-minimization',
      secretCategory: null,
      retentionDays: 365,
      holdSupport: true,
    });
    register({
      fieldName: 'legalHold.reason',
      level: A.RESTRICTED,
      sourceDomain: 'A6T10',
      owner: 'a6-external-data-minimization',
      secretCategory: null,
      retentionDays: 365,
      holdSupport: true,
    });
    register({
      fieldName: 'legalHold.imposedBy',
      level: A.RESTRICTED,
      sourceDomain: 'A6T10',
      owner: 'a6-external-data-minimization',
      secretCategory: null,
      retentionDays: 365,
      holdSupport: true,
    });
    register({
      fieldName: 'legalHold.releasedBy',
      level: A.RESTRICTED,
      sourceDomain: 'A6T10',
      owner: 'a6-external-data-minimization',
      secretCategory: null,
      retentionDays: 365,
      holdSupport: true,
    });
    register({
      fieldName: 'disclosure.view',
      level: A.CONFIDENTIAL,
      sourceDomain: 'A6T10',
      owner: 'a6-external-data-minimization',
      secretCategory: null,
      retentionDays: EXTERNAL_DATA_MINIMIZATION_DISCLOSURE_RETENTION_DAYS,
      holdSupport: true,
    });
    register({
      fieldName: 'supportTrace.view',
      level: A.CONFIDENTIAL,
      sourceDomain: 'A6T10',
      owner: 'a6-external-data-minimization',
      secretCategory: null,
      retentionDays: EXTERNAL_DATA_MINIMIZATION_SUPPORT_TRACE_RETENTION_DAYS,
      holdSupport: true,
    });

    // Secrets (HIGHLY_RESTRICTED, never store raw value)
    register({
      fieldName: 'secret.PARTNER_CLIENT_AUTHENTICATION',
      level: A.HIGHLY_RESTRICTED,
      sourceDomain: 'A6T03',
      owner: 'security',
      secretCategory: ExternalSecretCategory.PARTNER_CLIENT_AUTHENTICATION,
      retentionDays: 365,
      holdSupport: true,
    });
    register({
      fieldName: 'secret.PARTNER_REQUEST_SIGNING_KEY',
      level: A.HIGHLY_RESTRICTED,
      sourceDomain: 'A6T03',
      owner: 'security',
      secretCategory: ExternalSecretCategory.PARTNER_REQUEST_SIGNING_KEY,
      retentionDays: 365,
      holdSupport: true,
    });
    register({
      fieldName: 'secret.CALLBACK_SECRET',
      level: A.HIGHLY_RESTRICTED,
      sourceDomain: 'A6T06',
      owner: 'security',
      secretCategory: ExternalSecretCategory.CALLBACK_SECRET,
      retentionDays: 365,
      holdSupport: true,
    });
    register({
      fieldName: 'secret.CALLBACK_SIGNATURE',
      level: A.HIGHLY_RESTRICTED,
      sourceDomain: 'A6T06',
      owner: 'security',
      secretCategory: ExternalSecretCategory.CALLBACK_SIGNATURE,
      retentionDays: 365,
      holdSupport: true,
    });
    register({
      fieldName: 'secret.PRIVATE_KEY',
      level: A.HIGHLY_RESTRICTED,
      sourceDomain: 'A6T03',
      owner: 'security',
      secretCategory: ExternalSecretCategory.PRIVATE_KEY,
      retentionDays: 365,
      holdSupport: true,
    });
    register({
      fieldName: 'secret.CUSTOMER_PIN',
      level: A.HIGHLY_RESTRICTED,
      sourceDomain: 'A6T03',
      owner: 'security',
      secretCategory: ExternalSecretCategory.CUSTOMER_PIN,
      retentionDays: 365,
      holdSupport: true,
    });
    register({
      fieldName: 'secret.CUSTOMER_OTP',
      level: A.HIGHLY_RESTRICTED,
      sourceDomain: 'A6T03',
      owner: 'security',
      secretCategory: ExternalSecretCategory.CUSTOMER_OTP,
      retentionDays: 365,
      holdSupport: true,
    });
    register({
      fieldName: 'secret.DEVICE_FINGERPRINT_RAW',
      level: A.HIGHLY_RESTRICTED,
      sourceDomain: 'A6T03',
      owner: 'security',
      secretCategory: ExternalSecretCategory.DEVICE_FINGERPRINT_RAW,
      retentionDays: 365,
      holdSupport: true,
    });
    register({
      fieldName: 'secret.RISK_NARRATIVE_RAW',
      level: A.HIGHLY_RESTRICTED,
      sourceDomain: 'A6T03',
      owner: 'security',
      secretCategory: ExternalSecretCategory.RISK_NARRATIVE_RAW,
      retentionDays: 365,
      holdSupport: true,
    });
    register({
      fieldName: 'secret.COMPLIANCE_CASE_RAW',
      level: A.HIGHLY_RESTRICTED,
      sourceDomain: 'A6T03',
      owner: 'security',
      secretCategory: ExternalSecretCategory.COMPLIANCE_CASE_RAW,
      retentionDays: 365,
      holdSupport: true,
    });
  }
}

export const EXTERNAL_DATA_CLASSIFICATION_DEFAULT_RETENTION_DAYS =
  EXTERNAL_DATA_MINIMIZATION_DEFAULT_RETENTION_DAYS;
export const EXTERNAL_DATA_CLASSIFICATION_AUDIENCE_MAXIMUM_LEVELS: Readonly<
  Record<ExternalDisclosureAudience, ExternalDataHandlingLevel>
> = EXTERNAL_DATA_MINIMIZATION_AUDIENCE_MAXIMUM_LEVELS;
