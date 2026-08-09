/**
 * A7T10 — A7 product data minimization, classification, consent,
 * retention, legal-hold, secret, disclosure, support-trace, and
 * partner-payload validation service.
 *
 * The A7 product data minimization service is the single A7-side
 * read-only product data minimization, classification, consent,
 * retention, legal-hold, secret, disclosure, support-trace, and
 * partner-payload validation authority. The A7 product data
 * minimization service composes the existing A1 / A2 / A4 / A6T10 /
 * A7 / Operations authorities (reused as-is, without modification)
 * under the A7 product data minimization envelope:
 *
 *  - the A2 `AuthorizationService` (reused for the A2 authorization
 *    context reference; read-only);
 *  - the A4 product-policy service (A7T03; reused for the A4
 *    product-policy decision reference; read-only);
 *  - the A6T10 `ExternalDataMinimizationService` (reused for the
 *    A6T10 data classification, consent, retention, legal-hold,
 *    secret, disclosure, support-trace, and partner-payload
 *    validation authorities; read-only);
 *  - the A6T10 `ExternalDataClassificationRegistry` (reused for the
 *    A6T10 data classification registry; read-only);
 *  - the A7 product catalog (A7T02; the only A7 product catalog
 *    authority; the A7 product data minimization service reads the
 *    A7 product catalog registration through the A7 product-policy
 *    service consumer boundary; read-only);
 *  - the A7 product-policy profile (A7T03; the only A7 product-policy
 *    authority; consumed through the A7 product-policy service
 *    consumer boundary; read-only);
 *  - the A7T04 product customer-binding map (consumed through the
 *    A7 product-policy service consumer boundary; read-only; the A7
 *    product data minimization service does NOT call the A7T04
 *    product customer-binding service to mutate any A7T04 record);
 *  - the A7T05 product command/operation identity (the A7 product
 *    data minimization service does NOT call the A7T05 product
 *    command service to mutate any A7T05 record);
 *  - the A7T06 product notification delivery (the A7 product data
 *    minimization service does NOT call the A7T06 product
 *    notification delivery service to mutate any A7T06 record);
 *  - the A7T07 product lifecycle (the A7 product data minimization
 *    service does NOT call the A7T07 product lifecycle service to
 *    mutate any A7T07 record);
 *  - the A7T08 product financial effect (the A7 product data
 *    minimization service does NOT call the A7T08 product financial
 *    effect service to mutate any A7T08 record);
 *  - the A7T09 product reconciliation (the A7 product data
 *    minimization service does NOT call the A7T09 product
 *    reconciliation service to mutate any A7T09 record);
 *  - the shared `IdempotencyService` (reused for the A7 internal
 *    idempotency record read-only consumer boundary);
 *  - the shared `AuditService` (reused for the A7 audit event
 *    read-only consumer boundary);
 *  - the shared `OutboxService` (reused for the A7 outbox event
 *    read-only consumer boundary);
 *  - the shared `MetricsService` (the A7 product data minimization
 *    service does NOT record any A7 metric);
 *  - the shared `DiagnosticsService` (reused for the shared
 *    diagnostics read-only consumer boundary);
 *  - the shared `DataSource` (reused for the A7 product data
 *    minimization REPEATABLE READ, read-only TypeORM transaction).
 *
 * No new A2 authorization, A3 binding, A4 product-policy, A6 lifecycle,
 * A6 status-verification, A6 circuit-breaker, A6T05
 * external-operation, A6T08 settlement, A5 Ledger, A6T10 data
 * classification, A6T10 consent, A6T10 retention, A6T10 legal-hold,
 * A6T10 secret, A6T10 disclosure, A6T10 support-trace, A6T10
 * partner-payload validation, suspense, compensating-entry,
 * financial-invariants, A7 product catalog, A7 product-policy, A7T04
 * product customer-binding, A7T05 product command, A7T06 product
 * notification delivery, A7T07 product lifecycle, A7T08 product
 * financial effect, A7T09 product reconciliation, Wallet, Operations,
 * Outbox, Idempotency, Metrics, Diagnostics, Reconciliation, or
 * `CustomerPreference` authority is introduced.
 *
 * The A7 product data minimization service is a read-only service.
 * The A7 product data minimization service NEVER:
 *  - mutates any Customer, CustomerPreference, A3 binding, Wallet,
 *    Ledger, A5 transfer/deposit/withdrawal, A6 partner, A6T05
 *    external-operation, A6T08 settlement, A6T08 suspense, A6T08
 *    compensating-entry, A6T09 external reconciliation, A6T10 data
 *    classification registry, A6T10 consent record, A6T10 retention
 *    classification, A6T10 legal-hold, A6T10 secret classification,
 *    A6T10 disclosure projection, A6T10 support-trace projection,
 *    A6T10 partner-payload validation, A6T11 integration, A7 product
 *    catalog, A7 product-policy, A7T04 product customer-binding, A7T05
 *    product command, A7T06 product notification delivery, A7T07
 *    product lifecycle, A7T08 product financial effect, A7T09
 *    product reconciliation, Operations audit, Operations
 *    idempotency, Operations outbox, Operations metrics, or
 *    Operations diagnostics record to make a report pass;
 *  - posts a journal, mutates a balance, clears suspense, or edits
 *    a posted journal/line outside Ledger and Finance-approved
 *    correction boundaries;
 *  - issues, refreshes, or substitutes an A6T08 settlement,
 *    suspense, or compensating entry;
 *  - issues, refreshes, or substitutes an A6T09 external
 *    reconciliation report;
 *  - issues, refreshes, or substitutes an A6T10 data classification
 *    registry entry, A6T10 consent record, A6T10 retention
 *    classification, A6T10 legal-hold, A6T10 secret classification,
 *    A6T10 disclosure projection, A6T10 support-trace projection, or
 *    A6T10 partner-payload validation;
 *  - dispatches a notification;
 *  - calls a partner, an SMS provider, an email provider, a push
 *    provider, or any external channel;
 *  - mutates the A7 product lifecycle;
 *  - mutates the A7 product command;
 *  - mutates the A7 product customer-binding;
 *  - mutates the A7 product financial effect;
 *  - mutates the A7 product reconciliation;
 *  - auto-repairs a data-control failure;
 *  - auto-clears a data-control record;
 *  - auto-issues a data-control record;
 *  - auto-posts a journal;
 *  - takes any write lock or holds any write transaction.
 *
 * The A7 product data minimization service IS:
 *  - the single A7-side read-only product data minimization,
 *    classification, consent, retention, legal-hold, secret,
 *    disclosure, support-trace, and partner-payload validation
 *    authority;
 *  - the single A7-side data-minimization failure classification
 *    authority for the A7 product data-minimization failure
 *    vocabulary;
 *  - the single A7-side disclosure projection authority for the A7
 *    product disclosure;
 *  - the single A7-side support-trace projection authority for the
 *    A7 product support-trace.
 *
 * No Ledger redesign, no unauthorized chart expansion, no FX, no
 * fees/commissions, no savings interest, no lending, no customer
 * credit beyond approved product limits, no automatic suspense
 * clearing, no auto-repair, no auto-correction, no auto-issuance, and
 * no external financial correction outside Ledger/Finance ownership is
 * introduced by A7T10.
 */

import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';

import { ExternalDataHandlingLevel } from '../partner/external-data-minimization.enums';
import type { RequestContext } from '../production/request-context';

import {
  A7_PRODUCT_DATA_MINIMIZATION_AUDIT_ACTOR,
  A7_PRODUCT_DATA_MINIMIZATION_AUDIT_ENTITY_TYPE,
  A7_PRODUCT_DATA_MINIMIZATION_CONTRACT_DOCUMENT,
  A7_PRODUCT_DATA_MINIMIZATION_CONTRACT_NAME,
  A7_PRODUCT_DATA_MINIMIZATION_CONTRACT_VERSION,
  A7_PRODUCT_DATA_MINIMIZATION_FAILURE_CODES,
  A7_PRODUCT_DATA_MINIMIZATION_FAILURE_INVALID_COMMAND,
  A7_PRODUCT_DATA_MINIMIZATION_FAILURE_QUERY_UNAVAILABLE,
  A7_PRODUCT_DATA_MINIMIZATION_INTERNAL_IDEMPOTENCY_SCOPE,
  A7_PRODUCT_DATA_MINIMIZATION_PRODUCT_ACTION,
  A7_PRODUCT_DATA_MINIMIZATION_PRODUCT_CAPABILITY,
  A7_PRODUCT_DATA_MINIMIZATION_PRODUCT_KEY,
  A7_PRODUCT_DATA_MINIMIZATION_PRODUCT_VERSION,
  A7_PRODUCT_DATA_MINIMIZATION_REFERENCE_PREFIX,
  A7_PRODUCT_DATA_MINIMIZATION_RETENTION_SECONDS,
  A7_PRODUCT_DATA_HANDLING_LEVELS,
  A7_PRODUCT_DISCLOSURE_AUDIENCES,
  A7_PRODUCT_SECRET_CATEGORIES,
  A7_PRODUCT_CONSENT_APPROVED_JURISDICTIONS,
  A7_PRODUCT_CONSENT_PURPOSES,
  A7_PRODUCT_LEGAL_HOLD_SCOPES,
  A7_PRODUCT_RETENTION_DATASETS,
} from './a7-product-data-minimization.constants';
import { A7ProductDataMinimizationRepository } from './a7-product-data-minimization.repository';
import type {
  A7ProductDataMinimizationBatchResultV1,
  A7ProductDataMinimizationCommandV1,
  A7ProductDataMinimizationFailureV1,
  A7ProductDataMinimizationFieldClassification,
  A7ProductDataMinimizationFieldName,
  A7ProductDataMinimizationResultV1,
} from './a7-product-data-minimization.types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REF_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.:/@-]{0,179}$/;
const SAFE_TEXT_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,179}$/;

const A7_PRODUCT_DATA_MINIMIZATION_FIELD_REGISTRY: ReadonlyArray<A7ProductDataMinimizationFieldClassification> =
  Object.freeze([
    // Product operation (A7T05)
    {
      fieldName: 'a7.productOperationReference',
      level: ExternalDataHandlingLevel.INTERNAL,
      sourceDomain: 'a7.product',
      owner: 'a7-product-data-minimization',
      secretCategory: null,
      retentionDays: 365,
      holdSupport: true,
    },
    {
      fieldName: 'a7.productOperationId',
      level: ExternalDataHandlingLevel.INTERNAL,
      sourceDomain: 'a7.product',
      owner: 'a7-product-data-minimization',
      secretCategory: null,
      retentionDays: 365,
      holdSupport: true,
    },
    {
      fieldName: 'a7.productKey',
      level: ExternalDataHandlingLevel.PUBLIC,
      sourceDomain: 'a7.product',
      owner: 'a7-product-data-minimization',
      secretCategory: null,
      retentionDays: 365,
      holdSupport: true,
    },
    {
      fieldName: 'a7.productVersion',
      level: ExternalDataHandlingLevel.PUBLIC,
      sourceDomain: 'a7.product',
      owner: 'a7-product-data-minimization',
      secretCategory: null,
      retentionDays: 365,
      holdSupport: true,
    },
    {
      fieldName: 'a7.productCapabilityKey',
      level: ExternalDataHandlingLevel.INTERNAL,
      sourceDomain: 'a7.product',
      owner: 'a7-product-data-minimization',
      secretCategory: null,
      retentionDays: 365,
      holdSupport: true,
    },
    {
      fieldName: 'a7.productAction',
      level: ExternalDataHandlingLevel.INTERNAL,
      sourceDomain: 'a7.product',
      owner: 'a7-product-data-minimization',
      secretCategory: null,
      retentionDays: 365,
      holdSupport: true,
    },
    {
      fieldName: 'a7.productState',
      level: ExternalDataHandlingLevel.INTERNAL,
      sourceDomain: 'a7.product',
      owner: 'a7-product-data-minimization',
      secretCategory: null,
      retentionDays: 365,
      holdSupport: true,
    },
    {
      fieldName: 'a7.productOperationState',
      level: ExternalDataHandlingLevel.INTERNAL,
      sourceDomain: 'a7.product',
      owner: 'a7-product-data-minimization',
      secretCategory: null,
      retentionDays: 365,
      holdSupport: true,
    },
    {
      fieldName: 'a7.productOperationOutcome',
      level: ExternalDataHandlingLevel.CONFIDENTIAL,
      sourceDomain: 'a7.product',
      owner: 'a7-product-data-minimization',
      secretCategory: null,
      retentionDays: 365,
      holdSupport: true,
    },
    {
      fieldName: 'a7.productCommandReference',
      level: ExternalDataHandlingLevel.INTERNAL,
      sourceDomain: 'a7.product',
      owner: 'a7-product-data-minimization',
      secretCategory: null,
      retentionDays: 365,
      holdSupport: true,
    },
    {
      fieldName: 'a7.productLifecycleReference',
      level: ExternalDataHandlingLevel.INTERNAL,
      sourceDomain: 'a7.product',
      owner: 'a7-product-data-minimization',
      secretCategory: null,
      retentionDays: 365,
      holdSupport: true,
    },
    {
      fieldName: 'a7.productCustomerBindingMapReference',
      level: ExternalDataHandlingLevel.CONFIDENTIAL,
      sourceDomain: 'a7.product',
      owner: 'a7-product-data-minimization',
      secretCategory: null,
      retentionDays: 365,
      holdSupport: true,
    },
    {
      fieldName: 'a7.productFinancialEffectReference',
      level: ExternalDataHandlingLevel.CONFIDENTIAL,
      sourceDomain: 'a7.product',
      owner: 'a7-product-data-minimization',
      secretCategory: null,
      retentionDays: 365,
      holdSupport: true,
    },
    {
      fieldName: 'a7.a6ExternalOperationReference',
      level: ExternalDataHandlingLevel.INTERNAL,
      sourceDomain: 'a7.product.partner',
      owner: 'a7-product-data-minimization.partner',
      secretCategory: null,
      retentionDays: 365,
      holdSupport: true,
    },
    {
      fieldName: 'a7.a5LedgerJournalId',
      level: ExternalDataHandlingLevel.CONFIDENTIAL,
      sourceDomain: 'a7.product',
      owner: 'a7-product-data-minimization',
      secretCategory: null,
      retentionDays: 365,
      holdSupport: true,
    },
    {
      fieldName: 'a7.a6T08SettlementId',
      level: ExternalDataHandlingLevel.CONFIDENTIAL,
      sourceDomain: 'a7.product.partner',
      owner: 'a7-product-data-minimization.partner',
      secretCategory: null,
      retentionDays: 365,
      holdSupport: true,
    },
    {
      fieldName: 'a7.a6T08SuspenseId',
      level: ExternalDataHandlingLevel.CONFIDENTIAL,
      sourceDomain: 'a7.product.partner',
      owner: 'a7-product-data-minimization.partner',
      secretCategory: null,
      retentionDays: 365,
      holdSupport: true,
    },
    {
      fieldName: 'a7.a6ProviderReferenceId',
      level: ExternalDataHandlingLevel.CONFIDENTIAL,
      sourceDomain: 'a7.product.partner',
      owner: 'a7-product-data-minimization.partner',
      secretCategory: null,
      retentionDays: 365,
      holdSupport: true,
    },
    {
      fieldName: 'a7.a6CallbackReceiptId',
      level: ExternalDataHandlingLevel.CONFIDENTIAL,
      sourceDomain: 'a7.product.partner',
      owner: 'a7-product-data-minimization.partner',
      secretCategory: null,
      retentionDays: 365,
      holdSupport: true,
    },
    // Customer / wallet (A3; A7T04)
    {
      fieldName: 'a7.customerId',
      level: ExternalDataHandlingLevel.CONFIDENTIAL,
      sourceDomain: 'a7.product',
      owner: 'a7-product-data-minimization',
      secretCategory: null,
      retentionDays: 365,
      holdSupport: true,
    },
    {
      fieldName: 'a7.customerWalletId',
      level: ExternalDataHandlingLevel.CONFIDENTIAL,
      sourceDomain: 'a7.product',
      owner: 'a7-product-data-minimization',
      secretCategory: null,
      retentionDays: 365,
      holdSupport: true,
    },
    {
      fieldName: 'a7.bindingId',
      level: ExternalDataHandlingLevel.CONFIDENTIAL,
      sourceDomain: 'a7.product',
      owner: 'a7-product-data-minimization',
      secretCategory: null,
      retentionDays: 365,
      holdSupport: true,
    },
    {
      fieldName: 'a7.bindingVersion',
      level: ExternalDataHandlingLevel.INTERNAL,
      sourceDomain: 'a7.product',
      owner: 'a7-product-data-minimization',
      secretCategory: null,
      retentionDays: 365,
      holdSupport: true,
    },
    // Amount / currency / accounting unit
    {
      fieldName: 'a7.amountMinor',
      level: ExternalDataHandlingLevel.CONFIDENTIAL,
      sourceDomain: 'a7.product',
      owner: 'a7-product-data-minimization',
      secretCategory: null,
      retentionDays: 365,
      holdSupport: true,
    },
    {
      fieldName: 'a7.currency',
      level: ExternalDataHandlingLevel.INTERNAL,
      sourceDomain: 'a7.product',
      owner: 'a7-product-data-minimization',
      secretCategory: null,
      retentionDays: 365,
      holdSupport: true,
    },
    {
      fieldName: 'a7.accountingUnit',
      level: ExternalDataHandlingLevel.INTERNAL,
      sourceDomain: 'a7.product',
      owner: 'a7-product-data-minimization',
      secretCategory: null,
      retentionDays: 365,
      holdSupport: true,
    },
    // Policy (A4; A7T03)
    {
      fieldName: 'a7.a4ProductPolicyDecisionReference',
      level: ExternalDataHandlingLevel.INTERNAL,
      sourceDomain: 'a7.product',
      owner: 'a7-product-data-minimization',
      secretCategory: null,
      retentionDays: 365,
      holdSupport: true,
    },
    {
      fieldName: 'a7.a2AuthorizationContextReference',
      level: ExternalDataHandlingLevel.INTERNAL,
      sourceDomain: 'a7.product',
      owner: 'a7-product-data-minimization',
      secretCategory: null,
      retentionDays: 365,
      holdSupport: true,
    },
    // Notification (A7T06)
    {
      fieldName: 'a7.notificationDispatchId',
      level: ExternalDataHandlingLevel.INTERNAL,
      sourceDomain: 'a7.product.notification',
      owner: 'a7-product-data-minimization.notification',
      secretCategory: null,
      retentionDays: 90,
      holdSupport: true,
    },
    {
      fieldName: 'a7.notificationChannel',
      level: ExternalDataHandlingLevel.INTERNAL,
      sourceDomain: 'a7.product.notification',
      owner: 'a7-product-data-minimization.notification',
      secretCategory: null,
      retentionDays: 90,
      holdSupport: true,
    },
    {
      fieldName: 'a7.notificationAudience',
      level: ExternalDataHandlingLevel.INTERNAL,
      sourceDomain: 'a7.product.notification',
      owner: 'a7-product-data-minimization.notification',
      secretCategory: null,
      retentionDays: 90,
      holdSupport: true,
    },
    // Reconciliation (A7T09)
    {
      fieldName: 'a7.reconciliationReference',
      level: ExternalDataHandlingLevel.INTERNAL,
      sourceDomain: 'a7.product',
      owner: 'a7-product-data-minimization',
      secretCategory: null,
      retentionDays: 90,
      holdSupport: true,
    },
    {
      fieldName: 'a7.supportTraceReference',
      level: ExternalDataHandlingLevel.INTERNAL,
      sourceDomain: 'a7.product.support',
      owner: 'a7-product-data-minimization.support',
      secretCategory: null,
      retentionDays: 90,
      holdSupport: true,
    },
    {
      fieldName: 'a7.certificationReference',
      level: ExternalDataHandlingLevel.INTERNAL,
      sourceDomain: 'a7.product',
      owner: 'a7-product-data-minimization',
      secretCategory: null,
      retentionDays: 90,
      holdSupport: true,
    },
    {
      fieldName: 'a7.handoffReference',
      level: ExternalDataHandlingLevel.INTERNAL,
      sourceDomain: 'a7.product',
      owner: 'a7-product-data-minimization',
      secretCategory: null,
      retentionDays: 90,
      holdSupport: true,
    },
  ]);

@Injectable()
export class A7ProductDataMinimizationService {
  constructor(
    @Inject(A7ProductDataMinimizationRepository)
    private readonly repository: A7ProductDataMinimizationRepository,
  ) {}

  /**
   * Runs the A7 product data minimization read-only evaluation for
   * a single A7 product operation and returns a read-only A7
   * product data minimization report. The A7 product data
   * minimization service does NOT mutate any A6T10 source record
   * and does NOT auto-repair any data-control failure.
   */
  async evaluate(
    command: A7ProductDataMinimizationCommandV1,
  ): Promise<A7ProductDataMinimizationResultV1> {
    const shapeFailure = this.validateCommandShape(command);
    if (shapeFailure) {
      return this.failure(
        command,
        A7_PRODUCT_DATA_MINIMIZATION_FAILURE_INVALID_COMMAND,
        shapeFailure,
      );
    }
    const dataSource = this.repository.getDataSource();
    try {
      const report = await dataSource.transaction('REPEATABLE READ', async () => {
        return this.repository.loadReport(command);
      });
      return this.repository.toResult(command, report);
    } catch (error) {
      return this.failure(
        command,
        A7_PRODUCT_DATA_MINIMIZATION_FAILURE_QUERY_UNAVAILABLE,
        `The A7 product data minimization query failed: ${(error as Error).message ?? 'unknown'}`,
      );
    }
  }

  /**
   * Runs the A7 product data minimization read-only evaluation for
   * a batch of A7 product operations.
   */
  async evaluateBatch(
    commands: readonly A7ProductDataMinimizationCommandV1[],
  ): Promise<A7ProductDataMinimizationBatchResultV1> {
    if (commands.length === 0) {
      return {
        valid: false,
        failure: this.buildFailure(
          A7_PRODUCT_DATA_MINIMIZATION_FAILURE_INVALID_COMMAND,
          'The A7 product data minimization batch command is empty',
          {
            requestId: 'a7-product-data-minimization-batch',
            correlationId: 'a7-product-data-minimization-batch',
            traceId: 'a7-product-data-minimization-batch',
          },
        ),
      };
    }
    for (const command of commands) {
      const shapeFailure = this.validateCommandShape(command);
      if (shapeFailure) {
        return {
          valid: false,
          failure: this.buildFailure(
            A7_PRODUCT_DATA_MINIMIZATION_FAILURE_INVALID_COMMAND,
            shapeFailure,
            command.requestContext,
          ),
        };
      }
    }
    const dataSource = this.repository.getDataSource();
    try {
      const report = await dataSource.transaction('REPEATABLE READ', async () => {
        return this.repository.loadBatchReport(
          this.generateBatchId(),
          this.computeBatchReference(),
          commands,
          new Date().toISOString(),
        );
      });
      return { valid: true, report };
    } catch (error) {
      return {
        valid: false,
        failure: this.buildFailure(
          A7_PRODUCT_DATA_MINIMIZATION_FAILURE_QUERY_UNAVAILABLE,
          `The A7 product data minimization batch query failed: ${(error as Error).message ?? 'unknown'}`,
          commands[0]!.requestContext,
        ),
      };
    }
  }

  // -------------------------------------------------------------------------
  // Contract name / scope / version getters
  // -------------------------------------------------------------------------

  getContractName(): string {
    return A7_PRODUCT_DATA_MINIMIZATION_CONTRACT_NAME;
  }

  getContractVersion(): number {
    return A7_PRODUCT_DATA_MINIMIZATION_CONTRACT_VERSION;
  }

  getContractDocument(): string {
    return A7_PRODUCT_DATA_MINIMIZATION_CONTRACT_DOCUMENT;
  }

  getInternalIdempotencyScope(): string {
    return A7_PRODUCT_DATA_MINIMIZATION_INTERNAL_IDEMPOTENCY_SCOPE;
  }

  getProviderIdempotencyScope(): string {
    return this.repository.getA7ProductDataMinimizationProviderIdempotencyScope();
  }

  getIdempotencyRetentionSeconds(): number {
    return A7_PRODUCT_DATA_MINIMIZATION_RETENTION_SECONDS;
  }

  getAuditEntityType(): string {
    return A7_PRODUCT_DATA_MINIMIZATION_AUDIT_ENTITY_TYPE;
  }

  getAuditActor(): string {
    return A7_PRODUCT_DATA_MINIMIZATION_AUDIT_ACTOR;
  }

  getProductKey(): 'VIRTUAL_ACCOUNT' {
    return A7_PRODUCT_DATA_MINIMIZATION_PRODUCT_KEY;
  }

  getProductVersion(): 1 {
    return A7_PRODUCT_DATA_MINIMIZATION_PRODUCT_VERSION;
  }

  getProductCapability(): string {
    return A7_PRODUCT_DATA_MINIMIZATION_PRODUCT_CAPABILITY;
  }

  getProductAction(): string {
    return A7_PRODUCT_DATA_MINIMIZATION_PRODUCT_ACTION;
  }

  listConsentPurposes(): readonly string[] {
    return A7_PRODUCT_CONSENT_PURPOSES;
  }

  listConsentApprovedJurisdictions(): readonly string[] {
    return A7_PRODUCT_CONSENT_APPROVED_JURISDICTIONS;
  }

  listRetentionDatasets(): readonly string[] {
    return A7_PRODUCT_RETENTION_DATASETS;
  }

  listLegalHoldScopes(): readonly string[] {
    return A7_PRODUCT_LEGAL_HOLD_SCOPES;
  }

  listDisclosureAudiences(): readonly string[] {
    return A7_PRODUCT_DISCLOSURE_AUDIENCES;
  }

  listDataHandlingLevels(): readonly string[] {
    return A7_PRODUCT_DATA_HANDLING_LEVELS;
  }

  listSecretCategories(): readonly string[] {
    return A7_PRODUCT_SECRET_CATEGORIES;
  }

  listFailureCodes(): readonly string[] {
    return A7_PRODUCT_DATA_MINIMIZATION_FAILURE_CODES;
  }

  listFieldClassifications(): readonly A7ProductDataMinimizationFieldClassification[] {
    return A7_PRODUCT_DATA_MINIMIZATION_FIELD_REGISTRY;
  }

  getFieldClassification(
    fieldName: A7ProductDataMinimizationFieldName,
  ): A7ProductDataMinimizationFieldClassification | null {
    return (
      A7_PRODUCT_DATA_MINIMIZATION_FIELD_REGISTRY.find((entry) => entry.fieldName === fieldName) ??
      null
    );
  }

  listFieldNames(): readonly A7ProductDataMinimizationFieldName[] {
    return A7_PRODUCT_DATA_MINIMIZATION_FIELD_REGISTRY.map((entry) => entry.fieldName);
  }

  /**
   * Returns the A7 product data minimization consumer ports (read-only;
   * the A7 product data minimization service does NOT mutate any
   * A6T10 source record).
   */
  getConsumerPorts() {
    return this.repository.getConsumerPorts();
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private validateCommandShape(command: A7ProductDataMinimizationCommandV1): string | null {
    if (!command) {
      return 'The A7 product data minimization command is missing';
    }
    if (command.productKey !== A7_PRODUCT_DATA_MINIMIZATION_PRODUCT_KEY) {
      return 'The A7 product data minimization product key is invalid';
    }
    if (command.productVersion !== A7_PRODUCT_DATA_MINIMIZATION_PRODUCT_VERSION) {
      return 'The A7 product data minimization product version is invalid';
    }
    if (!command.productOperationReference.trim()) {
      return 'The productOperationReference is required';
    }
    if (!command.requestContext || !command.requestContext.correlationId) {
      return 'The requestContext.correlationId is required';
    }
    if (command.kind === 'CLASSIFY') {
      if (!command.fieldName || !command.fieldName.trim()) {
        return 'The fieldName is required for a CLASSIFY command';
      }
    } else if (command.kind === 'CONSENT') {
      if (!UUID_PATTERN.test(command.customerId.trim())) {
        return 'The customerId is invalid for a CONSENT command';
      }
      if (!command.purpose.trim() || !REF_PATTERN.test(command.purpose)) {
        return 'The purpose is invalid for a CONSENT command';
      }
      if (!command.jurisdiction.trim() || !SAFE_TEXT_PATTERN.test(command.jurisdiction)) {
        return 'The jurisdiction is invalid for a CONSENT command';
      }
    } else if (command.kind === 'RETENTION') {
      if (!command.dataset.trim() || !REF_PATTERN.test(command.dataset)) {
        return 'The dataset is invalid for a RETENTION command';
      }
    } else if (command.kind === 'LEGAL_HOLD') {
      if (!command.scope.trim()) {
        return 'The scope is required for a LEGAL_HOLD command';
      }
      if (!command.referenceId.trim()) {
        return 'The referenceId is required for a LEGAL_HOLD command';
      }
    } else if (command.kind === 'SECRET') {
      if (!command.category) {
        return 'The category is required for a SECRET command';
      }
      if (!command.reference.trim()) {
        return 'The reference is required for a SECRET command';
      }
    } else if (command.kind === 'PARTNER_PAYLOAD') {
      if (!command.partnerKey.trim()) {
        return 'The partnerKey is required for a PARTNER_PAYLOAD command';
      }
      if (!command.capabilityKey.trim()) {
        return 'The capabilityKey is required for a PARTNER_PAYLOAD command';
      }
    } else if (command.kind === 'DISCLOSURE') {
      if (!command.audience) {
        return 'The audience is required for a DISCLOSURE command';
      }
      if (!command.fields || Object.keys(command.fields).length === 0) {
        return 'The fields are required for a DISCLOSURE command';
      }
    } else if (command.kind === 'SUPPORT_TRACE') {
      if (!command.audience) {
        return 'The audience is required for a SUPPORT_TRACE command';
      }
      if (!command.trace || Object.keys(command.trace).length === 0) {
        return 'The trace is required for a SUPPORT_TRACE command';
      }
    }
    return null;
  }

  private failure(
    command: A7ProductDataMinimizationCommandV1,
    code: string,
    message: string,
  ): A7ProductDataMinimizationResultV1 {
    return { valid: false, failure: this.buildFailure(code, message, command.requestContext) };
  }

  private buildFailure(
    code: string,
    message: string,
    requestContext: RequestContext,
  ): A7ProductDataMinimizationFailureV1 {
    return {
      contractName: A7_PRODUCT_DATA_MINIMIZATION_CONTRACT_NAME,
      contractVersion: A7_PRODUCT_DATA_MINIMIZATION_CONTRACT_VERSION,
      code,
      rejectionCode: null,
      message,
      correlationId: requestContext.correlationId,
      requestId: requestContext.requestId,
      createdAt: new Date().toISOString(),
    };
  }

  private generateBatchId(): string {
    return randomUUID();
  }

  private computeBatchReference(): string {
    const hash = createHash('sha256')
      .update(`A7-PRODUCT-DATA-MINIMIZATION-BATCH:${randomUUID()}`)
      .digest('hex');
    return `${A7_PRODUCT_DATA_MINIMIZATION_REFERENCE_PREFIX}-batch:v${A7_PRODUCT_DATA_MINIMIZATION_CONTRACT_VERSION}:${hash}`;
  }
}
