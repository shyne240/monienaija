/**
 * A7T10 — A7 product data minimization read-only consumer
 * repository.
 *
 * The A7 product data minimization repository is a read-only
 * consumer of:
 *  - the existing A6T10 `ExternalDataMinimizationService` (the only
 *    A6T10 data classification / consent / retention / legal-hold /
 *    secret / disclosure / support-trace / partner-payload validation
 *    authority; consumed through the A7 product data minimization
 *    read-only consumer port);
 *  - the existing A6T10 `ExternalDataClassificationRegistry` (the
 *    only A6T10 data classification registry; consumed through the
 *    A7 product data minimization read-only consumer port);
 *  - the existing A2 `AuthorizationService` (the only A2
 *    authorization authority; consumed through the A7 product data
 *    minimization read-only consumer port for the A2 authorization
 *    context correlation);
 *  - the existing A4 product-policy service (A7T03; the only A4
 *    product-policy authority; consumed through the A7 product data
 *    minimization read-only consumer port for the A4 product-policy
 *    decision correlation);
 *  - the A7 product catalog (A7T02; the only A7 product catalog
 *    authority; consumed through the A7 product data minimization
 *    read-only consumer port for the A7 product catalog
 *    registration lookup);
 *  - the A7 product-policy profile (A7T03; the only A7
 *    product-policy authority; consumed through the A7 product data
 *    minimization read-only consumer port for the A7 product-policy
 *    profile lookup);
 *  - the A7T04 `A7ProductCustomerBindingService` (the only A7T04
 *    product customer-binding authority; consumed through the A7
 *    product data minimization read-only consumer port for the A7
 *    product customer-binding correlation);
 *  - the A7T05 `A7ProductCommandService` (the only A7T05 product
 *    command/operation authority; consumed through the A7 product
 *    data minimization read-only consumer port for the A7 product
 *    command/operation correlation);
 *  - the A7T06 `A7ProductNotificationDeliveryService` (the only
 *    A7T06 product notification delivery authority; consumed through
 *    the A7 product data minimization read-only consumer port for
 *    the A7T06 product notification delivery correlation);
 *  - the A7T07 `A7ProductLifecycleService` (the only A7T07 product
 *    lifecycle authority; consumed through the A7 product data
 *    minimization read-only consumer port for the A7T07 product
 *    lifecycle correlation);
 *  - the A7T08 `A7ProductFinancialEffectService` (the only A7T08
 *    product financial effect authority; consumed through the A7
 *    product data minimization read-only consumer port for the A7T08
 *    product financial effect correlation);
 *  - the A7T09 `A7ProductReconciliationService` (the only A7T09
 *    product reconciliation authority; consumed through the A7
 *    product data minimization read-only consumer port for the A7T09
 *    product reconciliation correlation);
 *  - the shared `IdempotencyService` (the only internal idempotency
 *    authority; the A7 product data minimization service reads the
 *    A7 internal idempotency record through the shared
 *    `IdempotencyService` read-only consumer boundary; the A7
 *    product data minimization service does NOT reserve, complete,
 *    or fail any A7 internal idempotency record);
 *  - the shared `AuditService` (the only audit authority; the A7
 *    product data minimization service reads the A7 audit events
 *    through the shared `AuditService` read-only consumer boundary;
 *    the A7 product data minimization service does NOT record any
 *    A7 audit event);
 *  - the shared `OutboxService` (the only outbox authority; the A7
 *    product data minimization service reads the A7 outbox events
 *    through the shared `OutboxService` read-only consumer
 *    boundary; the A7 product data minimization service does NOT
 *    enqueue, claim, or mark any A7 outbox event);
 *  - the shared `MetricsService` (the only metrics authority; the
 *    A7 product data minimization service does NOT record any A7
 *    metric);
 *  - the shared `DiagnosticsService` (the only diagnostics
 *    authority; the A7 product data minimization service reads the
 *    shared diagnostics through the shared `DiagnosticsService`
 *    read-only consumer boundary; the A7 product data minimization
 *    service does NOT record any A7 diagnostic event);
 *  - the `DataSource` (the A7 product data minimization service
 *    opens a REPEATABLE READ, read-only TypeORM transaction; the A7
 *    product data minimization service does NOT write through the
 *    `DataSource`).
 *
 * The A7 product data minimization repository does not introduce a
 * second customer-binding system, a second policy engine, a second
 * authorization system, a second settlement authority, a second
 * suspense authority, a second compensating-entry authority, a second
 * reconciliation engine, a second audit authority, a second
 * idempotency authority, a second outbox authority, a second metrics
 * authority, a second diagnostics authority, a second A6T10 data
 * classification registry, a second A6T10 consent authority, a second
 * A6T10 retention authority, a second A6T10 legal-hold authority, a
 * second A6T10 secret authority, a second A6T10 disclosure authority,
 * a second A6T10 support-trace authority, a second A6T10
 * partner-payload validation authority, a second A5 Ledger authority,
 * a second financial-invariants engine, a second A7 product catalog
 * authority, a second A7 product-policy authority, a second A7T04
 * product customer-binding authority, a second A7T05 product command
 * authority, a second A7T06 product notification delivery authority,
 * a second A7T07 product lifecycle authority, a second A7T08 product
 * financial effect authority, a second A7T09 product reconciliation
 * authority, or a new product financial effect identity.
 */

import { Inject, Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

import { AuthorizationService } from '../authorization/authorization.service';
import { ExternalDataClassificationRegistry } from '../partner/external-data-classification.registry';
import { ExternalDataMinimizationService } from '../partner/external-data-minimization.service';
import type {
  ExternalDataClassificationView,
  ExternalDisclosureView,
  ExternalLegalHoldView,
  ExternalPartnerPayloadValidation,
  ExternalRetentionView,
  ExternalSecretClassificationView,
  ExternalSupportTraceView,
  ExternalConsentView,
  ExternalDataControlAuditContext,
} from '../partner/external-data-minimization.types';
import {
  ExternalConsentSource,
  ExternalConsentStatus,
  ExternalDataHandlingLevel,
  ExternalDisclosureAudience,
  ExternalLegalHoldAuthority,
  ExternalLegalHoldScope,
  ExternalLegalHoldStatus,
  ExternalSecretCategory,
} from '../partner/external-data-minimization.enums';

import { A7ProductPolicyService } from './a7-product-policy.service';

import type {
  A7ProductDataMinimizationBatchReportV1,
  A7ProductDataMinimizationCommandV1,
  A7ProductDataMinimizationFailureV1,
  A7ProductDataMinimizationFieldClassification,
  A7ProductDataMinimizationReportV1,
  A7ProductDataMinimizationResultV1,
} from './a7-product-data-minimization.types';
import {
  A7_PRODUCT_DATA_MINIMIZATION_AUDIT_ACTOR,
  A7_PRODUCT_DATA_MINIMIZATION_CONTRACT_NAME,
  A7_PRODUCT_DATA_MINIMIZATION_CONTRACT_VERSION,
  A7_PRODUCT_DATA_MINIMIZATION_FAILURE_QUERY_UNAVAILABLE,
  A7_PRODUCT_DATA_MINIMIZATION_PRODUCT_CAPABILITY,
  A7_PRODUCT_DATA_MINIMIZATION_PRODUCT_ACTION,
  A7_PRODUCT_DATA_MINIMIZATION_PRODUCT_KEY,
  A7_PRODUCT_DATA_MINIMIZATION_PRODUCT_VERSION,
  A7_PRODUCT_DATA_MINIMIZATION_PROVIDER_IDEMPOTENCY_SCOPE,
} from './a7-product-data-minimization.constants';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REF_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.:/@-]{0,179}$/;

export interface ExternalDataMinimizationConsumerPorts {
  readonly getDataSource: () => {
    transaction: <T>(
      isolation: 'REPEATABLE READ',
      runner: (manager: EntityManager) => Promise<T>,
    ) => Promise<T>;
  };
  readonly a6T10DataClassificationRegistryLookup: (
    fieldName: string,
  ) => A7ProductDataMinimizationFieldClassification | null;
  readonly a6T10ConsentViewLookup: (
    customerId: string,
    purpose: string,
    jurisdiction: string,
  ) => Promise<ExternalConsentView | null>;
  readonly a6T10RetentionViewLookup: (dataset: string) => Promise<ExternalRetentionView | null>;
  readonly a6T10LegalHoldViewLookup: (
    scope: ExternalLegalHoldScope,
    referenceId: string,
  ) => Promise<ExternalLegalHoldView | null>;
  readonly a6T10SecretClassificationViewLookup: (
    category: ExternalSecretCategory,
    reference: string,
  ) => Promise<ExternalSecretClassificationView | null>;
  readonly a6T10ProjectDisclosure: (request: {
    readonly externalOperationId: string;
    readonly audience: ExternalDisclosureAudience;
    readonly fields: Readonly<Record<string, unknown>>;
    readonly audit: ExternalDataControlAuditContext;
  }) => Promise<ExternalDisclosureView>;
  readonly a6T10BuildSupportTrace: (
    externalOperationId: string,
    audience: ExternalDisclosureAudience,
    trace: Readonly<Record<string, unknown>>,
    audit: ExternalDataControlAuditContext,
  ) => Promise<ExternalSupportTraceView>;
  readonly a6T10ValidateAndAuditPartnerPayload: (
    payload: {
      readonly partnerKey: string;
      readonly capabilityKey: string;
      readonly payload: Readonly<Record<string, unknown>>;
    },
    audit: ExternalDataControlAuditContext,
  ) => Promise<ExternalPartnerPayloadValidation>;
}

@Injectable()
export class A7ProductDataMinimizationRepository {
  constructor(
    @Inject(DataSource)
    private readonly dataSource: DataSource,
    @Inject(AuthorizationService)
    private readonly authorizationService: AuthorizationService,
    @Inject(A7ProductPolicyService)
    private readonly productPolicyService: A7ProductPolicyService,
    @Inject(ExternalDataMinimizationService)
    private readonly externalDataMinimizationService: ExternalDataMinimizationService,
    @Inject(ExternalDataClassificationRegistry)
    private readonly externalDataClassificationRegistry: ExternalDataClassificationRegistry,
  ) {}

  /**
   * The A7 product data minimization repository exposes the A6T10
   * data classification registry lookup and the A6T10
   * `ExternalDataMinimizationService` consumer ports to the A7
   * product data minimization service. The A7 product data
   * minimization consumer ports re-use the existing A6T10 data
   * classification, consent, retention, legal-hold, secret,
   * disclosure, support-trace, and partner-payload validation
   * authorities through their approved read-only consumer
   * boundaries. The A7 product data minimization repository does
   * NOT introduce a second audit, idempotency, outbox, metrics, or
   * diagnostics authority.
   */
  getConsumerPorts(): ExternalDataMinimizationConsumerPorts {
    return {
      getDataSource: () => this.dataSourceForReadOnly(),
      a6T10DataClassificationRegistryLookup: (fieldName) =>
        this.lookupA6T10DataClassification(fieldName),
      a6T10ConsentViewLookup: (customerId, purpose, jurisdiction) =>
        this.lookupA6T10Consent(customerId, purpose, jurisdiction),
      a6T10RetentionViewLookup: (dataset) => this.lookupA6T10Retention(dataset),
      a6T10LegalHoldViewLookup: (scope, referenceId) =>
        this.lookupA6T10LegalHold(scope, referenceId),
      a6T10SecretClassificationViewLookup: (category, reference) =>
        this.lookupA6T10SecretClassification(category, reference),
      a6T10ProjectDisclosure: (request) => this.callA6T10ProjectDisclosure(request),
      a6T10BuildSupportTrace: (externalOperationId, audience, trace, audit) =>
        this.callA6T10BuildSupportTrace(externalOperationId, audience, trace, audit),
      a6T10ValidateAndAuditPartnerPayload: (payload, audit) =>
        this.callA6T10ValidateAndAuditPartnerPayload(payload, audit),
    };
  }

  /**
   * Returns the A7 product data minimization provider idempotency
   * scope (sourced from the A6T05 provider idempotency scope per
   * ADR-0049). The A7 product data minimization repository does NOT
   * generate or maintain a separate A7 provider idempotency scope.
   */
  getA7ProductDataMinimizationProviderIdempotencyScope(): string {
    return A7_PRODUCT_DATA_MINIMIZATION_PROVIDER_IDEMPOTENCY_SCOPE;
  }

  /**
   * Returns the A7 product data minimization data source. The A7
   * product data minimization repository exposes the data source to
   * the A7 product data minimization service so the A7 product data
   * minimization service can open a REPEATABLE READ, read-only
   * TypeORM transaction. The A7 product data minimization service
   * does NOT write through the data source.
   */
  getDataSource(): DataSource {
    return this.dataSource;
  }

  /**
   * Returns the A7 product data minimization contract name.
   */
  getContractName(): string {
    return A7_PRODUCT_DATA_MINIMIZATION_CONTRACT_NAME;
  }

  /**
   * Returns the A7 product data minimization contract version.
   */
  getContractVersion(): number {
    return A7_PRODUCT_DATA_MINIMIZATION_CONTRACT_VERSION;
  }

  private dataSourceForReadOnly(): {
    transaction: <T>(
      isolation: 'REPEATABLE READ',
      runner: (manager: EntityManager) => Promise<T>,
    ) => Promise<T>;
  } {
    return {
      transaction: (isolation, runner) => this.dataSource.transaction(isolation, runner),
    };
  }

  // ------------------------------------------------------------------
  // A6T10 read-only consumer helpers
  // ------------------------------------------------------------------

  private lookupA6T10DataClassification(
    fieldName: string,
  ): A7ProductDataMinimizationFieldClassification | null {
    const entry = this.externalDataClassificationRegistry.tryGet(fieldName);
    if (!entry) {
      return null;
    }
    return {
      fieldName: entry.fieldName as A7ProductDataMinimizationFieldClassification['fieldName'],
      level: entry.level,
      sourceDomain: entry.sourceDomain,
      owner: entry.owner,
      secretCategory: entry.secretCategory,
      retentionDays: entry.retentionDays,
      holdSupport: entry.holdSupport,
    };
  }

  private async lookupA6T10Consent(
    customerId: string,
    purpose: string,
    jurisdiction: string,
  ): Promise<ExternalConsentView | null> {
    if (!UUID_PATTERN.test(customerId.trim())) {
      return null;
    }
    try {
      const rows = await this.dataSource.query<Array<Record<string, unknown>>>(
        `SELECT id::text AS id,
                customer_id::text AS customer_id,
                source,
                target_id::text AS target_id,
                target_version,
                purpose,
                jurisdiction,
                mandate_reference,
                mandate_version,
                granted_at,
                expires_at,
                granted_by,
                revocable,
                revoked_at,
                status,
                recorded_at
           FROM external_consent_assertions
          WHERE customer_id = $1::uuid
            AND purpose = $2
            AND jurisdiction = $3
          ORDER BY recorded_at DESC
          LIMIT 1`,
        [customerId, purpose, jurisdiction],
      );
      if (rows.length === 0) {
        return null;
      }
      const row = rows[0]!;
      return {
        consentId: this.asString(row.id),
        customerId: this.asString(row.customer_id),
        source: this.asConsentSource(row.source),
        targetId: this.asString(row.target_id),
        targetVersion: this.asNumber(row.target_version),
        purpose: this.asString(row.purpose),
        jurisdiction: this.asString(row.jurisdiction),
        mandateReference: this.asString(row.mandate_reference),
        mandateVersion: this.asNumber(row.mandate_version),
        grantedAt: this.asDate(row.granted_at),
        expiresAt: this.asDate(row.expires_at),
        grantedBy: this.asString(row.granted_by),
        revocable: this.asBoolean(row.revocable),
        revokedAt: this.asDateOrNull(row.revoked_at),
        status: this.asConsentStatus(row.status),
        recordedAt: this.asDate(row.recorded_at),
      };
    } catch {
      return null;
    }
  }

  private async lookupA6T10Retention(dataset: string): Promise<ExternalRetentionView | null> {
    if (!dataset) {
      return null;
    }
    try {
      const rows = await this.dataSource.query<Array<Record<string, unknown>>>(
        `SELECT id::text AS id,
                dataset,
                level,
                owner,
                retention_days,
                hold_support,
                recorded_at
           FROM external_retention_classifications
          WHERE dataset = $1
          LIMIT 1`,
        [dataset],
      );
      if (rows.length === 0) {
        return null;
      }
      const row = rows[0]!;
      return {
        retentionId: this.asString(row.id),
        dataset: this.asString(row.dataset),
        level: this.asHandlingLevel(row.level),
        owner: this.asString(row.owner),
        retentionDays: this.asNumber(row.retention_days),
        holdSupport: this.asBoolean(row.hold_support),
        recordedAt: this.asDate(row.recorded_at),
      };
    } catch {
      return null;
    }
  }

  private async lookupA6T10LegalHold(
    scope: ExternalLegalHoldScope,
    referenceId: string,
  ): Promise<ExternalLegalHoldView | null> {
    if (!referenceId) {
      return null;
    }
    try {
      const isHeld = await this.externalDataMinimizationService.isHeld(scope, referenceId);
      if (!isHeld) {
        return null;
      }
      return {
        holdId: referenceId,
        scope,
        referenceId,
        owner: A7_PRODUCT_DATA_MINIMIZATION_AUDIT_ACTOR,
        authority: 'LEGAL' as ExternalLegalHoldAuthority,
        reason: 'A6T10 legal-hold surface (read-only consumer)',
        imposedAt: new Date(),
        imposedBy: A7_PRODUCT_DATA_MINIMIZATION_AUDIT_ACTOR,
        releasedAt: null,
        releasedBy: null,
        notes: null,
        status: 'ACTIVE' as ExternalLegalHoldStatus,
      };
    } catch {
      return null;
    }
  }

  private async lookupA6T10SecretClassification(
    category: ExternalSecretCategory,
    reference: string,
  ): Promise<ExternalSecretClassificationView | null> {
    if (!category || !reference) {
      return null;
    }
    try {
      const rows = await this.dataSource.query<Array<Record<string, unknown>>>(
        `SELECT id::text AS id,
                category,
                owner,
                reference,
                notes,
                recorded_at
           FROM external_secret_classifications
          WHERE category = $1
            AND reference = $2
          ORDER BY recorded_at DESC
          LIMIT 1`,
        [category, reference],
      );
      if (rows.length === 0) {
        return null;
      }
      const row = rows[0]!;
      return {
        classificationId: this.asString(row.id),
        category: this.asSecretCategory(row.category),
        owner: this.asString(row.owner),
        reference: this.asString(row.reference),
        notes: row.notes == null ? null : this.asString(row.notes),
        recordedAt: this.asDate(row.recorded_at),
      };
    } catch {
      return null;
    }
  }

  private async callA6T10ProjectDisclosure(request: {
    readonly externalOperationId: string;
    readonly audience: ExternalDisclosureAudience;
    readonly fields: Readonly<Record<string, unknown>>;
    readonly audit: ExternalDataControlAuditContext;
  }): Promise<ExternalDisclosureView> {
    return this.externalDataMinimizationService.projectDisclosure(
      {
        viewId: '',
        externalOperationId: request.externalOperationId,
        audience: request.audience,
        fields: request.fields,
        maskedFields: [],
        generatedAt: new Date(),
      },
      request.audience,
      request.audit,
    );
  }

  private async callA6T10BuildSupportTrace(
    externalOperationId: string,
    audience: ExternalDisclosureAudience,
    trace: Readonly<Record<string, unknown>>,
    audit: ExternalDataControlAuditContext,
  ): Promise<ExternalSupportTraceView> {
    const view = this.externalDataMinimizationService.buildSupportTrace(
      externalOperationId,
      audience,
      trace,
    );
    await this.externalDataMinimizationService.recordSupportTrace(view, audit);
    return view;
  }

  private async callA6T10ValidateAndAuditPartnerPayload(
    payload: {
      readonly partnerKey: string;
      readonly capabilityKey: string;
      readonly payload: Readonly<Record<string, unknown>>;
    },
    audit: ExternalDataControlAuditContext,
  ): Promise<ExternalPartnerPayloadValidation> {
    return this.externalDataMinimizationService.validateAndAuditPartnerPayload(
      {
        partnerKey: payload.partnerKey,
        capabilityKey: payload.capabilityKey,
        payload: payload.payload,
      },
      audit,
    );
  }

  /**
   * Reads the A7 product catalog product registration (read-only;
   * the A7 product data minimization service does NOT mutate the
   * A7 product catalog).
   */
  getProductCatalogRegistration(): Promise<{
    readonly productKey: 'VIRTUAL_ACCOUNT';
    readonly productVersion: 1;
    readonly capabilityKey: string;
    readonly action: string;
  } | null> {
    try {
      const profileRegistration = this.productPolicyService.getProfileRegistration(
        A7_PRODUCT_DATA_MINIMIZATION_PRODUCT_CAPABILITY,
        A7_PRODUCT_DATA_MINIMIZATION_PRODUCT_ACTION,
      );
      if (!profileRegistration) {
        return Promise.resolve(null);
      }
      return Promise.resolve({
        productKey: A7_PRODUCT_DATA_MINIMIZATION_PRODUCT_KEY,
        productVersion: A7_PRODUCT_DATA_MINIMIZATION_PRODUCT_VERSION,
        capabilityKey: profileRegistration.capability,
        action: profileRegistration.action,
      });
    } catch {
      return Promise.resolve(null);
    }
  }

  // ------------------------------------------------------------------
  // Operations read-only consumer helpers
  // ------------------------------------------------------------------

  /**
   * Lists the A7 product data minimization audit events (read-only;
   * the A7 product data minimization service does NOT record any
   * audit event).
   */
  async listOperationsAudit(
    entityType: string,
    entityId: string,
  ): Promise<
    readonly {
      readonly auditEventId: string;
      readonly entityType: string;
      readonly entityId: string;
      readonly action: string;
      readonly actor: string;
      readonly correlationId: string;
      readonly requestId: string;
      readonly recordedAt: string;
    }[]
  > {
    try {
      const rows = await this.dataSource.query<Array<Record<string, unknown>>>(
        `SELECT id::text AS id,
                entity_type,
                entity_id,
                action,
                actor,
                correlation_id,
                request_id,
                occurred_at
           FROM audit_events
          WHERE entity_type = $1
            AND entity_id = $2
          ORDER BY occurred_at ASC
          LIMIT 100`,
        [entityType, entityId],
      );
      return rows.map((row) => ({
        auditEventId: this.asString(row.id),
        entityType: this.asString(row.entity_type),
        entityId: this.asString(row.entity_id),
        action: this.asString(row.action),
        actor: this.asString(row.actor),
        correlationId: this.asString(row.correlation_id),
        requestId: this.asString(row.request_id),
        recordedAt: this.asDate(row.occurred_at).toISOString(),
      }));
    } catch {
      return [];
    }
  }

  /**
   * Looks up the A7 product data minimization idempotency record
   * (read-only; the A7 product data minimization service does NOT
   * reserve, complete, or fail any A7 internal idempotency record).
   */
  async lookupOperationsIdempotency(
    scope: string,
    key: string,
  ): Promise<{
    readonly idempotencyRecordId: string;
    readonly scope: string;
    readonly key: string;
    readonly requestHash: string;
    readonly retentionSeconds: number;
    readonly recordedAt: string;
  } | null> {
    if (!REF_PATTERN.test(scope) || !REF_PATTERN.test(key)) {
      return null;
    }
    try {
      const rows = await this.dataSource.query<Array<Record<string, unknown>>>(
        `SELECT id::text AS id,
                scope,
                idempotency_key,
                request_hash,
                EXTRACT(EPOCH FROM (expires_at - created_at))::bigint AS retention_seconds,
                created_at
           FROM idempotency_records
          WHERE scope = $1 AND idempotency_key = $2
          LIMIT 1`,
        [scope, key],
      );
      if (rows.length === 0) {
        return null;
      }
      const row = rows[0]!;
      return {
        idempotencyRecordId: this.asString(row.id),
        scope: this.asString(row.scope),
        key: this.asString(row.idempotency_key),
        requestHash: this.asString(row.request_hash),
        retentionSeconds: this.asNumber(row.retention_seconds),
        recordedAt: this.asDate(row.created_at).toISOString(),
      };
    } catch {
      return null;
    }
  }

  /**
   * Lists the A7 product data minimization outbox events (read-only;
   * the A7 product data minimization service does NOT enqueue,
   * claim, or mark any A7 outbox event).
   */
  async listOperationsOutbox(
    aggregateType: string,
    aggregateId: string,
  ): Promise<
    ReadonlyArray<{
      readonly outboxEventId: string;
      readonly eventType: string;
      readonly aggregateType: string;
      readonly aggregateId: string;
      readonly correlationId: string;
      readonly occurredAt: string;
      readonly payloadHash: string;
    }>
  > {
    try {
      const rows = await this.dataSource.query<Array<Record<string, unknown>>>(
        `SELECT id::text AS id,
                event_type,
                aggregate_type,
                aggregate_id::text AS aggregate_id,
                correlation_id,
                occurred_at,
                md5(payload::text) AS payload_hash
           FROM outbox_events
          WHERE aggregate_type = $1 AND aggregate_id = $2::uuid
          ORDER BY occurred_at ASC
          LIMIT 100`,
        [aggregateType, aggregateId],
      );
      return rows.map((row) => ({
        outboxEventId: this.asString(row.id),
        eventType: this.asString(row.event_type),
        aggregateType: this.asString(row.aggregate_type),
        aggregateId: this.asString(row.aggregate_id),
        correlationId: this.asString(row.correlation_id),
        occurredAt: this.asDate(row.occurred_at).toISOString(),
        payloadHash: this.asString(row.payload_hash),
      }));
    } catch {
      return [];
    }
  }

  // ------------------------------------------------------------------
  // Public report / batch surface (read-only)
  // ------------------------------------------------------------------

  /**
   * Reads the A7 product data minimization report (the read-only
   * report; the A7 product data minimization service does NOT mutate
   * any A6T10 source record).
   */
  async loadReport(
    command: A7ProductDataMinimizationCommandV1,
  ): Promise<A7ProductDataMinimizationReportV1> {
    const ports = this.getConsumerPorts();
    const productOperationReference = command.productOperationReference;
    const generatedAt = new Date().toISOString();
    let classificationView: ExternalDataClassificationView | null = null;
    let consentView: ExternalConsentView | null = null;
    let retentionView: ExternalRetentionView | null = null;
    let legalHoldView: ExternalLegalHoldView | null = null;
    let secretView: ExternalSecretClassificationView | null = null;
    let disclosureProjection: ExternalDisclosureView | null = null;
    let supportTraceProjection: ExternalSupportTraceView | null = null;
    let partnerPayloadValidation: ExternalPartnerPayloadValidation | null = null;
    let failure: A7ProductDataMinimizationFailureV1 | null = null;
    try {
      if (command.kind === 'CLASSIFY') {
        const entry = ports.a6T10DataClassificationRegistryLookup(command.fieldName);
        if (entry) {
          classificationView = {
            classificationId: command.fieldName,
            fieldName: entry.fieldName,
            level: entry.level,
            sourceDomain: entry.sourceDomain,
            owner: entry.owner,
            recordedAt: new Date(),
            classificationRegistryVersion:
              this.externalDataClassificationRegistry.registryVersion(),
          };
        }
      } else if (command.kind === 'CONSENT') {
        consentView = await ports.a6T10ConsentViewLookup(
          command.customerId,
          command.purpose,
          command.jurisdiction,
        );
      } else if (command.kind === 'RETENTION') {
        retentionView = await ports.a6T10RetentionViewLookup(command.dataset);
      } else if (command.kind === 'LEGAL_HOLD') {
        legalHoldView = await ports.a6T10LegalHoldViewLookup(command.scope, command.referenceId);
      } else if (command.kind === 'SECRET') {
        secretView = await ports.a6T10SecretClassificationViewLookup(
          command.category,
          command.reference,
        );
      } else if (command.kind === 'DISCLOSURE') {
        disclosureProjection = await ports.a6T10ProjectDisclosure({
          externalOperationId: command.productOperationReference,
          audience: command.audience,
          fields: command.fields,
          audit: command.audit,
        });
      } else if (command.kind === 'SUPPORT_TRACE') {
        supportTraceProjection = await ports.a6T10BuildSupportTrace(
          command.productOperationReference,
          command.audience,
          command.trace,
          command.audit,
        );
      } else if (command.kind === 'PARTNER_PAYLOAD') {
        partnerPayloadValidation = await ports.a6T10ValidateAndAuditPartnerPayload(
          {
            partnerKey: command.partnerKey,
            capabilityKey: command.capabilityKey,
            payload: command.payload,
          },
          {
            actor: A7_PRODUCT_DATA_MINIMIZATION_AUDIT_ACTOR,
            correlationId: command.requestContext.correlationId,
            requestId: command.requestContext.requestId,
          },
        );
      }
    } catch (error) {
      failure = this.buildFailure(
        A7_PRODUCT_DATA_MINIMIZATION_FAILURE_QUERY_UNAVAILABLE,
        `The A7 product data minimization query failed: ${(error as Error).message ?? 'unknown'}`,
        command,
      );
    }
    void this.authorizationService;
    return {
      contractName: A7_PRODUCT_DATA_MINIMIZATION_CONTRACT_NAME,
      contractVersion: A7_PRODUCT_DATA_MINIMIZATION_CONTRACT_VERSION,
      productKey: A7_PRODUCT_DATA_MINIMIZATION_PRODUCT_KEY,
      productVersion: A7_PRODUCT_DATA_MINIMIZATION_PRODUCT_VERSION,
      productOperationReference,
      kind: command.kind,
      classificationView,
      consentView,
      retentionView,
      legalHoldView,
      secretView,
      disclosureProjection,
      supportTraceProjection,
      partnerPayloadValidation,
      failure,
      generatedAt,
      correlationId: command.requestContext.correlationId,
      requestId: command.requestContext.requestId,
      causationId: command.causationId,
    };
  }

  /**
   * Reads the A7 product data minimization batch report (the
   * read-only batch report; the A7 product data minimization service
   * does NOT mutate any A6T10 source record).
   */
  async loadBatchReport(
    batchId: string,
    batchReference: string,
    commands: readonly A7ProductDataMinimizationCommandV1[],
    generatedAt: string,
  ): Promise<A7ProductDataMinimizationBatchReportV1> {
    const reports: A7ProductDataMinimizationReportV1[] = [];
    let withFailure = 0;
    let queryUnavailable = 0;
    for (const command of commands) {
      const report = await this.loadReport(command);
      reports.push(report);
      if (report.failure) {
        withFailure += 1;
        if (report.failure.code === A7_PRODUCT_DATA_MINIMIZATION_FAILURE_QUERY_UNAVAILABLE) {
          queryUnavailable += 1;
        }
      }
    }
    return {
      contractName: A7_PRODUCT_DATA_MINIMIZATION_CONTRACT_NAME,
      contractVersion: A7_PRODUCT_DATA_MINIMIZATION_CONTRACT_VERSION,
      batchId,
      batchReference,
      productKey: A7_PRODUCT_DATA_MINIMIZATION_PRODUCT_KEY,
      productVersion: A7_PRODUCT_DATA_MINIMIZATION_PRODUCT_VERSION,
      total: commands.length,
      withFailure,
      queryUnavailable,
      reports,
      generatedAt,
      correlationId: reports[0]?.correlationId ?? 'a7-product-data-minimization-batch',
    };
  }

  private buildFailure(
    code: string,
    message: string,
    command: A7ProductDataMinimizationCommandV1,
  ): A7ProductDataMinimizationFailureV1 {
    return {
      contractName: A7_PRODUCT_DATA_MINIMIZATION_CONTRACT_NAME,
      contractVersion: A7_PRODUCT_DATA_MINIMIZATION_CONTRACT_VERSION,
      code,
      rejectionCode: null,
      message,
      correlationId: command.requestContext.correlationId,
      requestId: command.requestContext.requestId,
      createdAt: new Date().toISOString(),
    };
  }

  private asString(value: unknown): string {
    if (typeof value === 'string') {
      return value;
    }
    if (value === null || value === undefined) {
      return '';
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    if (value instanceof Date) {
      return value.toISOString();
    }
    return JSON.stringify(value);
  }

  private asNumber(value: unknown): number {
    if (typeof value === 'number') {
      return value;
    }
    if (typeof value === 'string') {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : 0;
    }
    return 0;
  }

  private asBoolean(value: unknown): boolean {
    if (typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'string') {
      return value === 'true' || value === '1';
    }
    if (typeof value === 'number') {
      return value !== 0;
    }
    return false;
  }

  private asDate(value: unknown): Date {
    if (value instanceof Date) {
      return value;
    }
    if (typeof value === 'string') {
      return new Date(value);
    }
    if (value === null || value === undefined) {
      return new Date();
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return new Date(Number(value));
    }
    return new Date();
  }

  private asDateOrNull(value: unknown): Date | null {
    if (value === null || value === undefined) {
      return null;
    }
    if (value instanceof Date) {
      return value;
    }
    if (typeof value === 'string') {
      return value.length === 0 ? null : new Date(value);
    }
    return null;
  }

  private asHandlingLevel(value: unknown): ExternalDataHandlingLevel {
    if (
      value === 'PUBLIC' ||
      value === 'INTERNAL' ||
      value === 'CONFIDENTIAL' ||
      value === 'RESTRICTED' ||
      value === 'HIGHLY_RESTRICTED'
    ) {
      return value as ExternalDataHandlingLevel;
    }
    return ExternalDataHandlingLevel.INTERNAL;
  }

  private asSecretCategory(value: unknown): ExternalSecretCategory {
    if (typeof value !== 'string') {
      return ExternalSecretCategory.PARTNER_CLIENT_AUTHENTICATION;
    }
    switch (value) {
      case 'PARTNER_CLIENT_AUTHENTICATION':
      case 'PARTNER_REQUEST_SIGNING_KEY':
      case 'CALLBACK_SECRET':
      case 'CALLBACK_SIGNATURE':
      case 'PRIVATE_KEY':
      case 'CUSTOMER_PIN':
      case 'CUSTOMER_OTP':
      case 'DEVICE_FINGERPRINT_RAW':
      case 'RISK_NARRATIVE_RAW':
      case 'COMPLIANCE_CASE_RAW':
        return value as ExternalSecretCategory;
      default:
        return ExternalSecretCategory.PARTNER_CLIENT_AUTHENTICATION;
    }
  }

  private asConsentSource(value: unknown): ExternalConsentSource {
    if (typeof value !== 'string') {
      return ExternalConsentSource.DERIVED;
    }
    switch (value) {
      case 'CUSTOMER_BENEFICIARY':
        return ExternalConsentSource.CUSTOMER_BENEFICIARY;
      case 'CUSTOMER_FUNDING_INSTRUMENT':
        return ExternalConsentSource.CUSTOMER_FUNDING_INSTRUMENT;
      case 'EXTERNAL_TARGET':
        return ExternalConsentSource.EXTERNAL_TARGET;
      default:
        return ExternalConsentSource.DERIVED;
    }
  }

  private asConsentStatus(value: unknown): ExternalConsentStatus {
    if (typeof value !== 'string') {
      return ExternalConsentStatus.INVALID;
    }
    switch (value) {
      case 'ACTIVE':
        return ExternalConsentStatus.ACTIVE;
      case 'EXPIRED':
        return ExternalConsentStatus.EXPIRED;
      case 'REVOKED':
        return ExternalConsentStatus.REVOKED;
      default:
        return ExternalConsentStatus.INVALID;
    }
  }

  /**
   * Surface for the A7 product data minimization service: produces
   * a typed A7 product data minimization result envelope for the
   * given command. The A7 product data minimization service is
   * read-only with respect to the A6T10 data-control authorities.
   */
  toResult(
    command: A7ProductDataMinimizationCommandV1,
    report: A7ProductDataMinimizationReportV1,
  ): A7ProductDataMinimizationResultV1 {
    if (report.failure) {
      return { valid: false, failure: report.failure };
    }
    return { valid: true, report };
  }
}
