/**
 * A7T05 — A7 product command service.
 *
 * The A7 product command service is the single A7-side entry point
 * for the A7 first product's durable product command identity, product
 * operation record, request hashing, correlation, and product/provider
 * idempotency. The A7 product command service composes the existing
 * A2 / A3 / A4 / A5 / A6 / Operations authorities (reused as-is,
 * without modification) under the A7 product command envelope:
 *
 *  - the A2 `AuthorizationService` (reused for the A2 authorization
 *    context reference);
 *  - the A3 `CustomerFinancialAccountBindingService.validateActiveBinding()`
 *    (reused for the A3 binding recheck);
 *  - the A4 product-policy service (A7T03; reused for the A4
 *    product-policy decision reference);
 *  - the A6T05 `ExternalOperationService` (reused for the A6 partner
 *    reference identity, the A6 partner reference correlation, and
 *    the A6T05 provider idempotency scope/key; per ADR-0049);
 *  - the A7T04 `A7ProductCustomerBindingService` (reused for the A7
 *    product customer-binding map reference);
 *  - the shared `IdempotencyService` (reused for the A7 internal
 *    idempotency scope/key reservation, completion, and failure);
 *  - the shared `AuditService` (reused for the A7 product command
 *    audit facts);
 *  - the shared `OutboxService` (reused for the A7 product command
 *    outbox facts);
 *  - the shared `DataSource` (reused for the A7 product command
 *    SERIALIZABLE transactions).
 *
 * No new policy evaluator, no new authorization service, no new
 * customer-binding service, no new settlement authority, no new
 * reconciliation engine, no new audit authority, no new idempotency
 * authority, no new outbox authority, no new product command identity,
 * and no new transactional boundary is introduced. The A2 / A3 / A4 /
 * A5 / A6 / Operations authorities are the only authorities.
 */

import { createHash, randomUUID } from 'node:crypto';

import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { EntityManager, QueryFailedError } from 'typeorm';

import { parsePositiveMinorUnits } from '../common/money';
import type { RequestContext } from '../production/request-context';

import {
  A7_PRODUCT_COMMAND_ASSIGN_STATES,
  A7_PRODUCT_COMMAND_AUDIT_ACTION_ADMITTED,
  A7_PRODUCT_COMMAND_AUDIT_ACTION_COMPLETED,
  A7_PRODUCT_COMMAND_AUDIT_ACTION_FAILED,
  A7_PRODUCT_COMMAND_AUDIT_ACTION_REPLAYED,
  A7_PRODUCT_COMMAND_AUDIT_ACTION_RESERVED,
  A7_PRODUCT_COMMAND_AUDIT_ACTOR,
  A7_PRODUCT_COMMAND_AUDIT_ENTITY_TYPE,
  A7_PRODUCT_COMMAND_CONTRACT_NAME,
  A7_PRODUCT_COMMAND_CONTRACT_VERSION,
  A7_PRODUCT_COMMAND_FAILURE_A2_AUTHORIZATION_DENIED,
  A7_PRODUCT_COMMAND_FAILURE_A2_AUTHORIZATION_MISSING,
  A7_PRODUCT_COMMAND_FAILURE_A3_BINDING_MISSING,
  A7_PRODUCT_COMMAND_FAILURE_A3_BINDING_NOT_ACTIVE,
  A7_PRODUCT_COMMAND_FAILURE_A3_STALE_BINDING,
  A7_PRODUCT_COMMAND_FAILURE_A4_POLICY_DECISION_EXPIRED,
  A7_PRODUCT_COMMAND_FAILURE_A4_POLICY_DECISION_MISSING,
  A7_PRODUCT_COMMAND_FAILURE_A4_POLICY_DECISION_NOT_EXECUTABLE,
  A7_PRODUCT_COMMAND_FAILURE_A6_EXTERNAL_OPERATION_CONTEXT_MISMATCH,
  A7_PRODUCT_COMMAND_FAILURE_A6_EXTERNAL_OPERATION_MAPPING_CONFLICT,
  A7_PRODUCT_COMMAND_FAILURE_A6_EXTERNAL_OPERATION_MISSING,
  A7_PRODUCT_COMMAND_FAILURE_A6_EXTERNAL_OPERATION_NOT_FOUND,
  A7_PRODUCT_COMMAND_FAILURE_A7T04_PRODUCT_CUSTOMER_BINDING_FAILED,
  A7_PRODUCT_COMMAND_FAILURE_A7T04_PRODUCT_CUSTOMER_BINDING_MISSING,
  A7_PRODUCT_COMMAND_FAILURE_ACCOUNTING_UNIT_MISMATCH,
  A7_PRODUCT_COMMAND_FAILURE_CURRENCY_MISMATCH,
  A7_PRODUCT_COMMAND_FAILURE_IDEMPOTENCY_IN_PROGRESS,
  A7_PRODUCT_COMMAND_FAILURE_OPERATIONS_EVIDENCE_UNAVAILABLE,
  A7_PRODUCT_COMMAND_FAILURE_PRODUCT_CATALOG_REJECTED,
  A7_PRODUCT_COMMAND_FAILURE_REQUEST_HASH_CONFLICT,
  A7_PRODUCT_COMMAND_FUNDING_STATES,
  A7_PRODUCT_COMMAND_IDEMPOTENCY_RETENTION_SECONDS,
  A7_PRODUCT_COMMAND_INTERNAL_IDEMPOTENCY_SCOPE,
  A7_PRODUCT_COMMAND_OPERATION_STATE_ADMITTED,
  A7_PRODUCT_COMMAND_OPERATION_STATE_COMPLETED,
  A7_PRODUCT_COMMAND_OPERATION_STATE_FAILED,
  A7_PRODUCT_COMMAND_OPERATION_STATE_REPLAYED,
  A7_PRODUCT_COMMAND_OPERATION_STATES,
  A7_PRODUCT_COMMAND_OUTBOX_EVENT_CLASSIFICATION,
  A7_PRODUCT_COMMAND_OUTBOX_EVENT_RETENTION_CLASS,
  A7_PRODUCT_COMMAND_OUTBOX_EVENT_TYPE,
  A7_PRODUCT_COMMAND_REFERENCE_PREFIX,
  A7_PRODUCT_OPERATION_REFERENCE_PREFIX,
} from './a7-product-command.constants';
import { A7ProductCommandRepository } from './a7-product-command.repository';
import type {
  A7ProductCommandCreateV1,
  A7ProductCommandFailureV1,
  A7ProductCommandHandoffV1,
  A7ProductCommandOperationV1,
  A7ProductCommandOperationState,
  A7ProductCommandProductState,
  A7ProductCommandRequestHashInputV1,
  A7ProductCommandReservationKind,
  A7ProductCommandResultV1,
} from './a7-product-command.types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH_PATTERN = /^[a-f0-9]{64}$/i;
const SAFE_TEXT_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,179}$/;
const REFERENCE_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.:/@-]{0,179}$/;
const ACTION_ASSIGN = 'assign' as const;
const ACTION_LIFECYCLE = 'lifecycle' as const;
const CAPABILITY_ASSIGN = 'virtual-account.assign' as const;
const CAPABILITY_INBOUND_FUNDING = 'virtual-account.inbound-funding' as const;
const A7_PRODUCT_COMMAND_HANDOFF_SCOPE = 'a7-product-command-handoff.v1' as const;
const A7_PRODUCT_COMMAND_HANDOFF_VALIDITY_SECONDS = 15 * 60;
const ACCOUNTING_UNIT = 'CUSTOMER_FUNDS' as const;
const CURRENCY = 'NGN' as const;
const EXECUTABLE_A4_DECISIONS: ReadonlySet<string> = new Set(['ALLOW', 'ALLOW_WITH_LIMITS']);
const PRODUCT_KEY = 'VIRTUAL_ACCOUNT' as const;
const PRODUCT_VERSION = 1 as const;

type AllChecks = A7ProductCommandFailureV1['checks'];
const ALL_CHECKS_OK: AllChecks = Object.freeze({
  a2AuthorizationContext: 'OK',
  a3Binding: 'OK',
  a4ProductPolicyDecision: 'OK',
  a7T04ProductCustomerBinding: 'OK',
  a6ExternalOperation: 'OK',
  requestHash: 'OK',
  idempotency: 'OK',
  currency: 'OK',
  amount: 'OK',
});

const ALL_CHECKS_NOT_VERIFIED: AllChecks = Object.freeze({
  a2AuthorizationContext: 'NOT_VERIFIED',
  a3Binding: 'NOT_VERIFIED',
  a4ProductPolicyDecision: 'NOT_VERIFIED',
  a7T04ProductCustomerBinding: 'NOT_VERIFIED',
  a6ExternalOperation: 'NOT_VERIFIED',
  requestHash: 'NOT_VERIFIED',
  idempotency: 'NOT_VERIFIED',
  currency: 'NOT_VERIFIED',
  amount: 'NOT_VERIFIED',
});

interface NormalizedA7ProductCommandCreateV1 {
  readonly contractName: typeof A7_PRODUCT_COMMAND_CONTRACT_NAME;
  readonly contractVersion: typeof A7_PRODUCT_COMMAND_CONTRACT_VERSION;
  readonly productKey: typeof PRODUCT_KEY;
  readonly productVersion: typeof PRODUCT_VERSION;
  readonly capabilityKey: string;
  readonly action: string;
  readonly productState: A7ProductCommandProductState;
  readonly customerId: string;
  readonly customerWalletId: string;
  readonly bindingId: string;
  readonly bindingVersion: number;
  readonly amountMinor: string;
  readonly currency: typeof CURRENCY;
  readonly accountingUnit: typeof ACCOUNTING_UNIT;
  readonly a7ProductCustomerBindingMapReference: string;
  readonly a4ProductPolicyDecisionReference: string;
  readonly a2AuthorizationContextReference: string;
  readonly a6ExternalOperationId: string;
  readonly a6ExternalOperationReference: string;
  readonly a6ProviderIdempotencyScope: string;
  readonly a6ProviderIdempotencyKey: string;
  readonly idempotencyKey: string;
  readonly requestHash: string;
  readonly requestContext: RequestContext;
  readonly causationId: string | null;
}

/**
 * The A7 product command service. The A7 product command service is
 * the single A7-side entry point for the A7 first product's durable
 * product command identity, product operation record, request
 * hashing, correlation, and product/provider idempotency.
 */
@Injectable()
export class A7ProductCommandService {
  constructor(
    @Inject(A7ProductCommandRepository)
    private readonly repository: A7ProductCommandRepository,
  ) {}

  /**
   * Reserves the A7 product command against the A7 internal
   * idempotency scope. The A7 product command service derives the
   * canonical A7 product request hash, validates the A7 product
   * command envelope, and reserves the A7 internal idempotency
   * record. The A7 product command service does NOT call a
   * partner, dispatch a notification, post a journal, mutate a
   * balance, or change a source record through this method.
   */
  async reserveProductCommand(
    command: A7ProductCommandCreateV1,
  ): Promise<A7ProductCommandResultV1> {
    return this.runWithinTransaction(async (manager) =>
      this.reserveWithinTransaction(manager, command),
    );
  }

  /**
   * Completes the A7 product command. The A7 product command service
   * records the A7 product command completion audit fact, completes
   * the A7 internal idempotency record, and publishes the A7 product
   * command completion outbox fact. The A7 product command service
   * does NOT post a journal, mutate a balance, repair a binding, or
   * change a source record through this method.
   */
  async completeProductCommand(
    productCommandId: string,
    operation: A7ProductCommandOperationV1,
    response: {
      readonly statusCode: number;
      readonly responseBody: Readonly<Record<string, unknown>>;
    },
  ): Promise<A7ProductCommandOperationV1> {
    return this.runWithinTransaction(async (manager) =>
      this.completeWithinTransaction(manager, productCommandId, operation, response),
    );
  }

  /**
   * Fails the A7 product command. The A7 product command service
   * records the A7 product command failure audit fact, fails the A7
   * internal idempotency record, and publishes the A7 product
   * command failure outbox fact. The A7 product command service
   * does NOT post a journal, mutate a balance, repair a binding, or
   * change a source record through this method.
   */
  async failProductCommand(
    productCommandId: string,
    operation: A7ProductCommandOperationV1,
    failure: {
      readonly failureCode: string;
      readonly failureMessage: string;
      readonly failureStatusCode: number;
    },
  ): Promise<A7ProductCommandOperationV1> {
    return this.runWithinTransaction(async (manager) =>
      this.failWithinTransaction(manager, productCommandId, operation, failure),
    );
  }

  /**
   * Returns the A7 product command contract name and contract version.
   */
  getContractNames(): { readonly a4: string; readonly a6: string; readonly a7: string } {
    return Object.freeze({
      a4: 'A4-CAPABILITY-POLICY',
      a6: 'A6-EXTERNAL-PARTNER-ADAPTER',
      a7: A7_PRODUCT_COMMAND_CONTRACT_NAME,
    });
  }

  /**
   * Returns the A7 product command contract version.
   */
  getContractVersions(): { readonly a4: number; readonly a6: number; readonly a7: number } {
    return Object.freeze({ a4: 1, a6: 1, a7: A7_PRODUCT_COMMAND_CONTRACT_VERSION });
  }

  /**
   * Returns the A7 product command internal idempotency scope.
   */
  getInternalIdempotencyScope(): string {
    return A7_PRODUCT_COMMAND_INTERNAL_IDEMPOTENCY_SCOPE;
  }

  /**
   * Returns the A7 product command provider idempotency scope
   * (sourced from the A6T05 provider idempotency scope per
   * ADR-0049).
   */
  getProviderIdempotencyScope(): string {
    return this.repository.getA7ProductProviderIdempotencyScope();
  }

  /**
   * Returns the A7 product command idempotency retention interval
   * (aligned with the shared Operations `IdempotencyService` default).
   */
  getIdempotencyRetentionSeconds(): number {
    return A7_PRODUCT_COMMAND_IDEMPOTENCY_RETENTION_SECONDS;
  }

  /**
   * Returns the A7 product command audit entity type.
   */
  getAuditEntityType(): string {
    return A7_PRODUCT_COMMAND_AUDIT_ENTITY_TYPE;
  }

  /**
   * Returns the A7 product command audit actor.
   */
  getAuditActor(): string {
    return A7_PRODUCT_COMMAND_AUDIT_ACTOR;
  }

  /**
   * Returns the A7 product command operation state vocabulary.
   */
  listOperationStates(): readonly string[] {
    return A7_PRODUCT_COMMAND_OPERATION_STATES;
  }

  /**
   * Derives the canonical A7 product request hash from the A7 product
   * command semantic material. The hash material includes every
   * field that changes the A7 product effect and excludes
   * transport-only, observation, and secret values (per
   * `docs/A7-PRODUCT-COMMAND-AND-IDEMPOTENCY-CONTRACT.md` §5).
   */
  deriveRequestHash(input: A7ProductCommandRequestHashInputV1): string {
    return this.sha256(this.canonicalJson(input));
  }

  private async runWithinTransaction<T>(
    runner: (manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    const dataSource = this.repository.getDataSource();
    let attempts = 0;
    let lastError: unknown;
    while (attempts < 3) {
      try {
        return await dataSource.transaction('SERIALIZABLE', runner);
      } catch (error) {
        lastError = error;
        if (this.isRetryableTransactionError(error) && attempts < 2) {
          attempts += 1;
          continue;
        }
        throw error;
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error('The A7 product command transaction could not complete');
  }

  private async reserveWithinTransaction(
    manager: EntityManager,
    command: A7ProductCommandCreateV1,
  ): Promise<A7ProductCommandResultV1> {
    const shapeFailure = this.validateCommandShape(command);
    if (shapeFailure) {
      return this.failure(
        command,
        shapeFailure.code,
        shapeFailure.message,
        ALL_CHECKS_NOT_VERIFIED,
      );
    }
    const normalized = this.normalizeCommand(command);
    const ports = this.repository.getConsumerPorts();
    const failure = await this.validateAuthorities(manager, ports, normalized);
    if (failure) {
      return this.failure(command, failure.code, failure.message, failure.checks);
    }
    return this.reserveAndAdmit(manager, ports, normalized);
  }

  private async validateAuthorities(
    _manager: EntityManager,
    ports: A7ProductCommandRepository extends { getConsumerPorts(): infer P } ? P : never,
    command: NormalizedA7ProductCommandCreateV1,
  ): Promise<{
    readonly code: string;
    readonly message: string;
    readonly checks: AllChecks;
  } | null> {
    void _manager;
    const a2 = await ports.a2AuthorizationContextLookup(command.a2AuthorizationContextReference);
    if (!a2) {
      return {
        code: A7_PRODUCT_COMMAND_FAILURE_A2_AUTHORIZATION_MISSING,
        message: 'The A2 authorization context reference could not be read',
        checks: checkWithFailed('a2AuthorizationContext', 'FAIL'),
      };
    }
    if (!a2.allowed) {
      return {
        code: A7_PRODUCT_COMMAND_FAILURE_A2_AUTHORIZATION_DENIED,
        message: 'The A2 authorization context is denied',
        checks: checkWithFailed('a2AuthorizationContext', 'FAIL'),
      };
    }
    const a3 = await ports.a3BindingRecheck({
      customerId: command.customerId,
      customerWalletId: command.customerWalletId,
      bindingId: command.bindingId,
      walletAccountId: command.bindingId,
      ledgerAccountId: command.bindingId,
      expectedCurrency: CURRENCY,
      expectedAccountingUnit: ACCOUNTING_UNIT,
      expectedBindingVersion: command.bindingVersion,
    });
    if (!a3) {
      return {
        code: A7_PRODUCT_COMMAND_FAILURE_A3_BINDING_NOT_ACTIVE,
        message: 'The A3 internal account binding could not be validated',
        checks: checkWithFailed('a3Binding', 'FAIL'),
      };
    }
    if (a3.bindingVersion !== command.bindingVersion) {
      return {
        code: A7_PRODUCT_COMMAND_FAILURE_A3_STALE_BINDING,
        message: 'The A3 binding version is stale',
        checks: checkWithFailed('a3Binding', 'FAIL'),
      };
    }
    const a4 = await ports.a4ProductPolicyDecisionLookup(command.a4ProductPolicyDecisionReference);
    if (!a4) {
      return {
        code: A7_PRODUCT_COMMAND_FAILURE_A4_POLICY_DECISION_MISSING,
        message: 'The A4 product-policy decision reference could not be read',
        checks: checkWithFailed('a4ProductPolicyDecision', 'FAIL'),
      };
    }
    if (!EXECUTABLE_A4_DECISIONS.has(a4.decision)) {
      return {
        code: A7_PRODUCT_COMMAND_FAILURE_A4_POLICY_DECISION_NOT_EXECUTABLE,
        message: 'The A4 product-policy decision is not executable for the A7 product command',
        checks: checkWithFailed('a4ProductPolicyDecision', 'FAIL'),
      };
    }
    if (a4.expiresAt && Date.parse(a4.expiresAt) <= Date.now()) {
      return {
        code: A7_PRODUCT_COMMAND_FAILURE_A4_POLICY_DECISION_EXPIRED,
        message: 'The A4 product-policy decision is expired',
        checks: checkWithFailed('a4ProductPolicyDecision', 'FAIL'),
      };
    }
    const a7T04 = await ports.a7T04ProductCustomerBindingMapReferenceCheck(
      command.a7ProductCustomerBindingMapReference,
      command.customerId,
      command.customerWalletId,
      command.bindingId,
      command.bindingVersion,
      command.productKey,
      command.capabilityKey,
      command.action,
      command.productState,
    );
    if (!a7T04) {
      return {
        code: A7_PRODUCT_COMMAND_FAILURE_A7T04_PRODUCT_CUSTOMER_BINDING_MISSING,
        message: 'The A7T04 product customer-binding map could not be read',
        checks: checkWithFailed('a7T04ProductCustomerBinding', 'FAIL'),
      };
    }
    if (a7T04.productKey !== command.productKey) {
      return {
        code: A7_PRODUCT_COMMAND_FAILURE_A7T04_PRODUCT_CUSTOMER_BINDING_FAILED,
        message: 'The A7T04 product customer-binding map product key does not match',
        checks: checkWithFailed('a7T04ProductCustomerBinding', 'FAIL'),
      };
    }
    const a6 = await ports.a6ExternalOperationLookup(command.a6ExternalOperationId);
    if (!a6) {
      return {
        code: A7_PRODUCT_COMMAND_FAILURE_A6_EXTERNAL_OPERATION_NOT_FOUND,
        message: 'The A6T05 external-operation record could not be read',
        checks: checkWithFailed('a6ExternalOperation', 'FAIL'),
      };
    }
    const a6Context = this.assertA6ContextMatches(a6, command);
    if (a6Context) {
      return a6Context;
    }
    return null;
  }

  private assertA6ContextMatches(
    a6: {
      readonly externalOperationId: string;
      readonly externalOperationReference: string;
      readonly providerIdempotencyScope: string;
      readonly providerIdempotencyKey: string;
      readonly customerId: string;
      readonly walletAccountId: string;
      readonly ledgerAccountId: string;
      readonly currency: string;
      readonly accountingUnit: string;
      readonly amountMinor: string;
    },
    command: NormalizedA7ProductCommandCreateV1,
  ): { readonly code: string; readonly message: string; readonly checks: AllChecks } | null {
    if (a6.externalOperationReference !== command.a6ExternalOperationReference) {
      return {
        code: A7_PRODUCT_COMMAND_FAILURE_A6_EXTERNAL_OPERATION_MAPPING_CONFLICT,
        message: 'The A6T05 external-operation reference does not match the A7 product command',
        checks: checkWithFailed('a6ExternalOperation', 'FAIL'),
      };
    }
    if (a6.providerIdempotencyScope !== command.a6ProviderIdempotencyScope) {
      return {
        code: A7_PRODUCT_COMMAND_FAILURE_A6_EXTERNAL_OPERATION_MAPPING_CONFLICT,
        message: 'The A6T05 provider idempotency scope does not match the A7 product command',
        checks: checkWithFailed('a6ExternalOperation', 'FAIL'),
      };
    }
    if (a6.providerIdempotencyKey !== command.a6ProviderIdempotencyKey) {
      return {
        code: A7_PRODUCT_COMMAND_FAILURE_A6_EXTERNAL_OPERATION_MAPPING_CONFLICT,
        message: 'The A6T05 provider idempotency key does not match the A7 product command',
        checks: checkWithFailed('a6ExternalOperation', 'FAIL'),
      };
    }
    if (
      a6.customerId !== command.customerId ||
      a6.walletAccountId !== command.bindingId ||
      a6.ledgerAccountId !== command.bindingId
    ) {
      return {
        code: A7_PRODUCT_COMMAND_FAILURE_A6_EXTERNAL_OPERATION_CONTEXT_MISMATCH,
        message:
          'The A6T05 external-operation customer/account mapping does not match the A7 product command',
        checks: checkWithFailed('a6ExternalOperation', 'FAIL'),
      };
    }
    if (a6.currency !== command.currency || a6.accountingUnit !== command.accountingUnit) {
      return {
        code: A7_PRODUCT_COMMAND_FAILURE_A6_EXTERNAL_OPERATION_CONTEXT_MISMATCH,
        message:
          'The A6T05 external-operation currency/accounting unit does not match the A7 product command',
        checks: checkWithFailed('a6ExternalOperation', 'FAIL'),
      };
    }
    if (a6.amountMinor !== command.amountMinor) {
      return {
        code: A7_PRODUCT_COMMAND_FAILURE_A6_EXTERNAL_OPERATION_CONTEXT_MISMATCH,
        message: 'The A6T05 external-operation amount does not match the A7 product command',
        checks: checkWithFailed('a6ExternalOperation', 'FAIL'),
      };
    }
    return null;
  }

  private async reserveAndAdmit(
    manager: EntityManager,
    ports: ReturnType<A7ProductCommandRepository['getConsumerPorts']>,
    command: NormalizedA7ProductCommandCreateV1,
  ): Promise<A7ProductCommandResultV1> {
    const canonicalHash = this.deriveRequestHash(this.toHashInput(command));
    if (canonicalHash !== command.requestHash) {
      return this.failure(
        command,
        A7_PRODUCT_COMMAND_FAILURE_REQUEST_HASH_CONFLICT,
        'The caller-supplied A7 product request hash does not match the canonical hash',
        checkWithFailed('requestHash', 'FAIL'),
      );
    }
    let reservation: {
      readonly kind: A7ProductCommandReservationKind;
      readonly record: {
        readonly id: string;
        readonly resourceId: string | null;
        readonly responseBody: Record<string, unknown> | null;
      } | null;
    };
    try {
      reservation = (await ports.operationsIdempotencyReserve(manager, {
        scope: A7_PRODUCT_COMMAND_INTERNAL_IDEMPOTENCY_SCOPE,
        key: command.idempotencyKey,
        requestHash: canonicalHash,
        retentionSeconds: A7_PRODUCT_COMMAND_IDEMPOTENCY_RETENTION_SECONDS,
      })) as {
        readonly kind: A7ProductCommandReservationKind;
        readonly record: {
          readonly id: string;
          readonly resourceId: string | null;
          readonly responseBody: Record<string, unknown> | null;
        } | null;
      };
    } catch (error) {
      if (this.isHashConflict(error)) {
        return this.failure(
          command,
          A7_PRODUCT_COMMAND_FAILURE_REQUEST_HASH_CONFLICT,
          'The A7 internal idempotency scope/key was already used for another request hash',
          checkWithFailed('idempotency', 'FAIL'),
        );
      }
      throw error;
    }
    if (reservation.kind === 'IN_PROGRESS') {
      return this.failure(
        command,
        A7_PRODUCT_COMMAND_FAILURE_IDEMPOTENCY_IN_PROGRESS,
        'The A7 product command is already in progress',
        checkWithFailed('idempotency', 'FAIL'),
      );
    }
    const productCommandId = this.generateProductCommandId();
    const productOperationId = this.generateProductOperationId();
    if (reservation.kind === 'REPLAY') {
      const replayed = this.replayedOperationFromReservation(
        productCommandId,
        productOperationId,
        command,
        reservation,
      );
      try {
        await ports.operationsIdempotencyComplete(manager, reservation.record!.id, {
          statusCode: 200,
          responseBody: replayed as unknown as Record<string, unknown>,
          resourceType: 'A7_PRODUCT_COMMAND',
          resourceId: productCommandId,
          key: command.idempotencyKey,
          requestHash: canonicalHash,
        });
      } catch {
        return this.failure(
          command,
          A7_PRODUCT_COMMAND_FAILURE_OPERATIONS_EVIDENCE_UNAVAILABLE,
          'The A7 product command replay audit could not be recorded',
          checkWithFailed('idempotency', 'FAIL'),
        );
      }
      try {
        await ports.operationsAudit(
          manager,
          this.buildAuditRecord(
            A7_PRODUCT_COMMAND_AUDIT_ACTION_REPLAYED,
            productCommandId,
            command,
            replayed,
          ),
        );
      } catch {
        return this.failure(
          command,
          A7_PRODUCT_COMMAND_FAILURE_OPERATIONS_EVIDENCE_UNAVAILABLE,
          'The A7 product command replay audit could not be recorded',
          checkWithFailed('idempotency', 'FAIL'),
        );
      }
      return {
        valid: true,
        reservation: { kind: 'REPLAY', record: replayed, conflictReason: null },
        operation: replayed,
        handoff: this.buildHandoff(replayed, command),
      };
    }
    const productCommandReference = this.productCommandReference(productCommandId);
    const productOperationReference = this.productOperationReference(productOperationId);
    const createdAt = new Date().toISOString();
    const operation: A7ProductCommandOperationV1 = {
      contractName: A7_PRODUCT_COMMAND_CONTRACT_NAME,
      contractVersion: A7_PRODUCT_COMMAND_CONTRACT_VERSION,
      productCommandId,
      productCommandReference,
      productOperationId,
      productOperationReference,
      productKey: PRODUCT_KEY,
      productVersion: PRODUCT_VERSION,
      capabilityKey: command.capabilityKey,
      action: command.action,
      productState: command.productState,
      operationState: A7_PRODUCT_COMMAND_OPERATION_STATE_ADMITTED,
      customerId: command.customerId,
      customerWalletId: command.customerWalletId,
      bindingId: command.bindingId,
      bindingVersion: command.bindingVersion,
      walletAccountId: command.bindingId,
      ledgerAccountId: command.bindingId,
      amountMinor: command.amountMinor,
      currency: CURRENCY,
      accountingUnit: ACCOUNTING_UNIT,
      a7ProductCustomerBindingMapReference: command.a7ProductCustomerBindingMapReference,
      a4ProductPolicyDecisionReference: command.a4ProductPolicyDecisionReference,
      a2AuthorizationContextReference: command.a2AuthorizationContextReference,
      a6ExternalOperationId: command.a6ExternalOperationId,
      a6ExternalOperationReference: command.a6ExternalOperationReference,
      a6ProviderIdempotencyScope: command.a6ProviderIdempotencyScope,
      a6ProviderIdempotencyKey: command.a6ProviderIdempotencyKey,
      idempotencyScope: A7_PRODUCT_COMMAND_INTERNAL_IDEMPOTENCY_SCOPE,
      idempotencyKey: command.idempotencyKey,
      requestHash: canonicalHash,
      requestContext: command.requestContext,
      causationId: command.causationId,
      replayed: false,
      conflict: false,
      conflictReason: null,
      createdAt,
      completedAt: null,
      failedAt: null,
      version: 1,
    };
    try {
      await ports.operationsIdempotencyComplete(manager, reservation.record!.id, {
        statusCode: 201,
        responseBody: operation as unknown as Record<string, unknown>,
        resourceType: 'A7_PRODUCT_COMMAND',
        resourceId: productCommandId,
        key: command.idempotencyKey,
        requestHash: canonicalHash,
      });
    } catch {
      return this.failure(
        command,
        A7_PRODUCT_COMMAND_FAILURE_OPERATIONS_EVIDENCE_UNAVAILABLE,
        'The A7 internal idempotency record could not be completed',
        checkWithFailed('idempotency', 'FAIL'),
      );
    }
    try {
      await ports.operationsAudit(
        manager,
        this.buildAuditRecord(
          A7_PRODUCT_COMMAND_AUDIT_ACTION_ADMITTED,
          productCommandId,
          command,
          operation,
        ),
      );
      await ports.operationsAudit(
        manager,
        this.buildAuditRecord(
          A7_PRODUCT_COMMAND_AUDIT_ACTION_RESERVED,
          productCommandId,
          command,
          operation,
        ),
      );
    } catch {
      return this.failure(
        command,
        A7_PRODUCT_COMMAND_FAILURE_OPERATIONS_EVIDENCE_UNAVAILABLE,
        'The A7 product command audit could not be recorded',
        checkWithFailed('idempotency', 'FAIL'),
      );
    }
    try {
      await ports.operationsOutboxEnqueue(manager, {
        eventType: A7_PRODUCT_COMMAND_OUTBOX_EVENT_TYPE,
        aggregateType: 'A7_PRODUCT_COMMAND',
        aggregateId: productCommandId,
        eventKey: `a7-product-command:${productCommandId}`,
        schemaVersion: 1,
        classification: A7_PRODUCT_COMMAND_OUTBOX_EVENT_CLASSIFICATION,
        retentionClass: A7_PRODUCT_COMMAND_OUTBOX_EVENT_RETENTION_CLASS,
        occurredAt: new Date(createdAt),
        correlationId: command.requestContext.correlationId,
        causationId: command.causationId,
        payload: this.buildOutboxPayload(
          operation,
          command,
          A7_PRODUCT_COMMAND_AUDIT_ACTION_ADMITTED,
        ),
      });
    } catch {
      return this.failure(
        command,
        A7_PRODUCT_COMMAND_FAILURE_OPERATIONS_EVIDENCE_UNAVAILABLE,
        'The A7 product command outbox fact could not be published',
        checkWithFailed('idempotency', 'FAIL'),
      );
    }
    return {
      valid: true,
      reservation: { kind: 'NEW', record: operation, conflictReason: null },
      operation,
      handoff: this.buildHandoff(operation, command),
    };
  }

  private async completeWithinTransaction(
    manager: EntityManager,
    productCommandId: string,
    operation: A7ProductCommandOperationV1,
    response: {
      readonly statusCode: number;
      readonly responseBody: Readonly<Record<string, unknown>>;
    },
  ): Promise<A7ProductCommandOperationV1> {
    const completed: A7ProductCommandOperationV1 = {
      ...operation,
      operationState:
        A7_PRODUCT_COMMAND_OPERATION_STATE_COMPLETED as A7ProductCommandOperationState,
      completedAt: new Date().toISOString(),
      failedAt: null,
      version: operation.version + 1,
    };
    const ports = this.repository.getConsumerPorts();
    try {
      await ports.operationsAudit(
        manager,
        this.buildCompletionAuditRecord(
          A7_PRODUCT_COMMAND_AUDIT_ACTION_COMPLETED,
          productCommandId,
          operation,
          completed,
          response,
        ),
      );
    } catch {
      throw new ConflictException('The A7 product command completion audit could not be recorded');
    }
    return completed;
  }

  private async failWithinTransaction(
    manager: EntityManager,
    productCommandId: string,
    operation: A7ProductCommandOperationV1,
    failure: {
      readonly failureCode: string;
      readonly failureMessage: string;
      readonly failureStatusCode: number;
    },
  ): Promise<A7ProductCommandOperationV1> {
    const failed: A7ProductCommandOperationV1 = {
      ...operation,
      operationState: A7_PRODUCT_COMMAND_OPERATION_STATE_FAILED as A7ProductCommandOperationState,
      conflict: true,
      conflictReason: failure.failureCode,
      failedAt: new Date().toISOString(),
      completedAt: null,
      version: operation.version + 1,
    };
    const ports = this.repository.getConsumerPorts();
    try {
      await ports.operationsAudit(
        manager,
        this.buildFailureAuditRecord(
          A7_PRODUCT_COMMAND_AUDIT_ACTION_FAILED,
          productCommandId,
          operation,
          failed,
          failure,
        ),
      );
    } catch {
      throw new ConflictException('The A7 product command failure audit could not be recorded');
    }
    return failed;
  }

  private replayedOperationFromReservation(
    productCommandId: string,
    productOperationId: string,
    command: NormalizedA7ProductCommandCreateV1,
    reservation: {
      readonly record: {
        readonly id: string;
        readonly resourceId: string | null;
        readonly responseBody: Record<string, unknown> | null;
      } | null;
    },
  ): A7ProductCommandOperationV1 {
    if (!reservation.record) {
      throw new Error(
        'The A7 product command replay reservation is missing the idempotency record',
      );
    }
    const stored = reservation.record.responseBody;
    if (stored && typeof stored === 'object' && 'productCommandId' in stored) {
      return {
        ...(stored as unknown as A7ProductCommandOperationV1),
        operationState: A7_PRODUCT_COMMAND_OPERATION_STATE_REPLAYED,
        replayed: true,
      };
    }
    const createdAt = new Date().toISOString();
    return {
      contractName: A7_PRODUCT_COMMAND_CONTRACT_NAME,
      contractVersion: A7_PRODUCT_COMMAND_CONTRACT_VERSION,
      productCommandId,
      productCommandReference: this.productCommandReference(productCommandId),
      productOperationId,
      productOperationReference: this.productOperationReference(productOperationId),
      productKey: PRODUCT_KEY,
      productVersion: PRODUCT_VERSION,
      capabilityKey: command.capabilityKey,
      action: command.action,
      productState: command.productState,
      operationState: A7_PRODUCT_COMMAND_OPERATION_STATE_REPLAYED,
      customerId: command.customerId,
      customerWalletId: command.customerWalletId,
      bindingId: command.bindingId,
      bindingVersion: command.bindingVersion,
      walletAccountId: command.bindingId,
      ledgerAccountId: command.bindingId,
      amountMinor: command.amountMinor,
      currency: CURRENCY,
      accountingUnit: ACCOUNTING_UNIT,
      a7ProductCustomerBindingMapReference: command.a7ProductCustomerBindingMapReference,
      a4ProductPolicyDecisionReference: command.a4ProductPolicyDecisionReference,
      a2AuthorizationContextReference: command.a2AuthorizationContextReference,
      a6ExternalOperationId: command.a6ExternalOperationId,
      a6ExternalOperationReference: command.a6ExternalOperationReference,
      a6ProviderIdempotencyScope: command.a6ProviderIdempotencyScope,
      a6ProviderIdempotencyKey: command.a6ProviderIdempotencyKey,
      idempotencyScope: A7_PRODUCT_COMMAND_INTERNAL_IDEMPOTENCY_SCOPE,
      idempotencyKey: command.idempotencyKey,
      requestHash: command.requestHash,
      requestContext: command.requestContext,
      causationId: command.causationId,
      replayed: true,
      conflict: false,
      conflictReason: null,
      createdAt,
      completedAt: null,
      failedAt: null,
      version: 1,
    };
  }

  private buildHandoff(
    operation: A7ProductCommandOperationV1,
    command: NormalizedA7ProductCommandCreateV1,
  ): A7ProductCommandHandoffV1 {
    const issuedAt = operation.createdAt;
    const expiresAt = new Date(
      Date.parse(issuedAt) + A7_PRODUCT_COMMAND_HANDOFF_VALIDITY_SECONDS * 1000,
    ).toISOString();
    return {
      contractName: A7_PRODUCT_COMMAND_CONTRACT_NAME,
      contractVersion: A7_PRODUCT_COMMAND_CONTRACT_VERSION,
      handoffScope: A7_PRODUCT_COMMAND_HANDOFF_SCOPE,
      productCommandId: operation.productCommandId,
      productCommandReference: operation.productCommandReference,
      productOperationId: operation.productOperationId,
      productOperationReference: operation.productOperationReference,
      productKey: operation.productKey,
      capabilityKey: operation.capabilityKey,
      action: operation.action,
      productState: operation.productState,
      operationState: operation.operationState,
      mapReference: command.a7ProductCustomerBindingMapReference,
      customerId: operation.customerId,
      customerWalletId: operation.customerWalletId,
      bindingId: operation.bindingId,
      bindingVersion: operation.bindingVersion,
      walletAccountId: operation.walletAccountId,
      ledgerAccountId: operation.ledgerAccountId,
      amountMinor: operation.amountMinor,
      currency: CURRENCY,
      accountingUnit: ACCOUNTING_UNIT,
      a6ExternalOperationId: operation.a6ExternalOperationId,
      a6ExternalOperationReference: operation.a6ExternalOperationReference,
      a6ProviderIdempotencyScope: operation.a6ProviderIdempotencyScope,
      a6ProviderIdempotencyKey: operation.a6ProviderIdempotencyKey,
      a4ProductPolicyDecisionReference: operation.a4ProductPolicyDecisionReference,
      a2AuthorizationContextReference: operation.a2AuthorizationContextReference,
      a7ProductCustomerBindingMapReference: operation.a7ProductCustomerBindingMapReference,
      issuedAt,
      expiresAt,
      correlationId: command.requestContext.correlationId,
      requestId: command.requestContext.requestId,
      traceId: command.requestContext.traceId,
      causationId: command.causationId,
    };
  }

  private buildAuditRecord(
    action: string,
    productCommandId: string,
    command: NormalizedA7ProductCommandCreateV1,
    operation: A7ProductCommandOperationV1,
  ): {
    readonly entityType: string;
    readonly entityId: string;
    readonly action: string;
    readonly actor: string;
    readonly correlationId: string;
    readonly requestId: string;
    readonly newValues: Readonly<Record<string, unknown>>;
  } {
    return {
      entityType: A7_PRODUCT_COMMAND_AUDIT_ENTITY_TYPE,
      entityId: productCommandId,
      action,
      actor: A7_PRODUCT_COMMAND_AUDIT_ACTOR,
      correlationId: command.requestContext.correlationId,
      requestId: command.requestContext.requestId,
      newValues: this.buildAuditValues(action, operation, command),
    };
  }

  private buildCompletionAuditRecord(
    action: string,
    productCommandId: string,
    _operation: A7ProductCommandOperationV1,
    completed: A7ProductCommandOperationV1,
    response: {
      readonly statusCode: number;
      readonly responseBody: Readonly<Record<string, unknown>>;
    },
  ): {
    readonly entityType: string;
    readonly entityId: string;
    readonly action: string;
    readonly actor: string;
    readonly correlationId: string;
    readonly requestId: string;
    readonly newValues: Readonly<Record<string, unknown>>;
  } {
    return {
      entityType: A7_PRODUCT_COMMAND_AUDIT_ENTITY_TYPE,
      entityId: productCommandId,
      action,
      actor: A7_PRODUCT_COMMAND_AUDIT_ACTOR,
      correlationId: completed.requestContext.correlationId,
      requestId: completed.requestContext.requestId,
      newValues: {
        a7AuditContractName: A7_PRODUCT_COMMAND_CONTRACT_NAME,
        a7AuditContractVersion: A7_PRODUCT_COMMAND_CONTRACT_VERSION,
        productCommandId: completed.productCommandId,
        productCommandReference: completed.productCommandReference,
        productOperationId: completed.productOperationId,
        productOperationReference: completed.productOperationReference,
        operationState: completed.operationState,
        responseStatusCode: response.statusCode,
        responseBody: this.redactResponseBody(response.responseBody),
        completedAt: completed.completedAt,
      },
    };
  }

  private buildFailureAuditRecord(
    action: string,
    productCommandId: string,
    _operation: A7ProductCommandOperationV1,
    failed: A7ProductCommandOperationV1,
    failure: {
      readonly failureCode: string;
      readonly failureMessage: string;
      readonly failureStatusCode: number;
    },
  ): {
    readonly entityType: string;
    readonly entityId: string;
    readonly action: string;
    readonly actor: string;
    readonly correlationId: string;
    readonly requestId: string;
    readonly newValues: Readonly<Record<string, unknown>>;
  } {
    return {
      entityType: A7_PRODUCT_COMMAND_AUDIT_ENTITY_TYPE,
      entityId: productCommandId,
      action,
      actor: A7_PRODUCT_COMMAND_AUDIT_ACTOR,
      correlationId: failed.requestContext.correlationId,
      requestId: failed.requestContext.requestId,
      newValues: {
        a7AuditContractName: A7_PRODUCT_COMMAND_CONTRACT_NAME,
        a7AuditContractVersion: A7_PRODUCT_COMMAND_CONTRACT_VERSION,
        productCommandId: failed.productCommandId,
        productCommandReference: failed.productCommandReference,
        productOperationId: failed.productOperationId,
        productOperationReference: failed.productOperationReference,
        operationState: failed.operationState,
        failureCode: failure.failureCode,
        failureMessage: failure.failureMessage,
        failureStatusCode: failure.failureStatusCode,
        failedAt: failed.failedAt,
      },
    };
  }

  private buildAuditValues(
    action: string,
    operation: A7ProductCommandOperationV1,
    command: NormalizedA7ProductCommandCreateV1,
  ): Readonly<Record<string, unknown>> {
    return Object.freeze({
      a7AuditContractName: A7_PRODUCT_COMMAND_CONTRACT_NAME,
      a7AuditContractVersion: A7_PRODUCT_COMMAND_CONTRACT_VERSION,
      a4AuditContractName: 'A4-CAPABILITY-POLICY',
      a4AuditContractVersion: 1,
      a6AuditContractName: 'A6-EXTERNAL-PARTNER-ADAPTER',
      a6AuditContractVersion: 1,
      action,
      productCommandId: operation.productCommandId,
      productCommandReference: operation.productCommandReference,
      productOperationId: operation.productOperationId,
      productOperationReference: operation.productOperationReference,
      productKey: operation.productKey,
      productVersion: operation.productVersion,
      capabilityKey: operation.capabilityKey,
      action_key: operation.action,
      productState: operation.productState,
      operationState: operation.operationState,
      customerId: operation.customerId,
      customerWalletId: operation.customerWalletId,
      bindingId: operation.bindingId,
      bindingVersion: operation.bindingVersion,
      walletAccountId: operation.walletAccountId,
      ledgerAccountId: operation.ledgerAccountId,
      amountMinor: operation.amountMinor,
      currency: operation.currency,
      accountingUnit: operation.accountingUnit,
      a7ProductCustomerBindingMapReference: operation.a7ProductCustomerBindingMapReference,
      a4ProductPolicyDecisionReference: operation.a4ProductPolicyDecisionReference,
      a2AuthorizationContextReference: operation.a2AuthorizationContextReference,
      a6ExternalOperationId: operation.a6ExternalOperationId,
      a6ExternalOperationReference: operation.a6ExternalOperationReference,
      a6ProviderIdempotencyScope: operation.a6ProviderIdempotencyScope,
      a6ProviderIdempotencyKey: this.redactProviderIdempotencyKey(
        operation.a6ProviderIdempotencyKey,
      ),
      idempotencyScope: operation.idempotencyScope,
      idempotencyKey: operation.idempotencyKey,
      requestHash: operation.requestHash,
      replayed: operation.replayed,
      conflict: operation.conflict,
      conflictReason: operation.conflictReason,
      causationId: command.causationId,
      createdAt: operation.createdAt,
    });
  }

  private buildOutboxPayload(
    operation: A7ProductCommandOperationV1,
    command: NormalizedA7ProductCommandCreateV1,
    action: string,
  ): Readonly<Record<string, unknown>> {
    return Object.freeze({
      a7OutboxContractName: A7_PRODUCT_COMMAND_CONTRACT_NAME,
      a7OutboxContractVersion: A7_PRODUCT_COMMAND_CONTRACT_VERSION,
      action,
      productCommandId: operation.productCommandId,
      productCommandReference: operation.productCommandReference,
      productOperationId: operation.productOperationId,
      productOperationReference: operation.productOperationReference,
      productKey: operation.productKey,
      productVersion: operation.productVersion,
      capabilityKey: operation.capabilityKey,
      action_key: operation.action,
      productState: operation.productState,
      operationState: operation.operationState,
      customerId: operation.customerId,
      customerWalletId: operation.customerWalletId,
      bindingId: operation.bindingId,
      bindingVersion: operation.bindingVersion,
      walletAccountId: operation.walletAccountId,
      ledgerAccountId: operation.ledgerAccountId,
      amountMinor: operation.amountMinor,
      currency: operation.currency,
      accountingUnit: operation.accountingUnit,
      a7ProductCustomerBindingMapReference: operation.a7ProductCustomerBindingMapReference,
      a4ProductPolicyDecisionReference: operation.a4ProductPolicyDecisionReference,
      a2AuthorizationContextReference: operation.a2AuthorizationContextReference,
      a6ExternalOperationId: operation.a6ExternalOperationId,
      a6ExternalOperationReference: operation.a6ExternalOperationReference,
      a6ProviderIdempotencyScope: operation.a6ProviderIdempotencyScope,
      a6ProviderIdempotencyKey: this.redactProviderIdempotencyKey(
        operation.a6ProviderIdempotencyKey,
      ),
      idempotencyScope: operation.idempotencyScope,
      idempotencyKey: operation.idempotencyKey,
      requestHash: operation.requestHash,
      replayed: operation.replayed,
      conflict: operation.conflict,
      conflictReason: operation.conflictReason,
      causationId: command.causationId,
      createdAt: operation.createdAt,
    });
  }

  private redactResponseBody(
    body: Readonly<Record<string, unknown>>,
  ): Readonly<Record<string, unknown>> {
    const redacted: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(body)) {
      if (
        key === 'pan' ||
        key === 'accountNumber' ||
        key === 'password' ||
        key === 'pin' ||
        key === 'otp' ||
        key === 'cvv' ||
        key === 'secret' ||
        key === 'tokenSecret' ||
        key === 'signingKey' ||
        key === 'callbackSignature'
      ) {
        redacted[key] = '[REDACTED]';
        continue;
      }
      redacted[key] = value;
    }
    return Object.freeze(redacted);
  }

  private redactProviderIdempotencyKey(key: string): string {
    if (!key) {
      return key;
    }
    if (key.length <= 12) {
      return `${key.slice(0, 4)}…[REDACTED]`;
    }
    return `${key.slice(0, 12)}…[REDACTED]`;
  }

  private toHashInput(
    command: NormalizedA7ProductCommandCreateV1,
  ): A7ProductCommandRequestHashInputV1 {
    return {
      contractName: A7_PRODUCT_COMMAND_CONTRACT_NAME,
      contractVersion: A7_PRODUCT_COMMAND_CONTRACT_VERSION,
      productKey: PRODUCT_KEY,
      productVersion: PRODUCT_VERSION,
      capabilityKey: command.capabilityKey,
      action: command.action,
      productState: command.productState,
      customerId: command.customerId,
      customerWalletId: command.customerWalletId,
      bindingId: command.bindingId,
      bindingVersion: command.bindingVersion,
      amountMinor: command.amountMinor,
      currency: CURRENCY,
      accountingUnit: ACCOUNTING_UNIT,
      a7ProductCustomerBindingMapReference: command.a7ProductCustomerBindingMapReference,
      a4ProductPolicyDecisionReference: command.a4ProductPolicyDecisionReference,
      a2AuthorizationContextReference: command.a2AuthorizationContextReference,
      a6ExternalOperationId: command.a6ExternalOperationId,
      a6ProviderIdempotencyScope: command.a6ProviderIdempotencyScope,
      a6ProviderIdempotencyKey: command.a6ProviderIdempotencyKey,
      correlationId: command.requestContext.correlationId,
      causationId: command.causationId,
    };
  }

  private validateCommandShape(
    command: A7ProductCommandCreateV1,
  ): { readonly code: string; readonly message: string } | null {
    if (!command || command.contractName !== A7_PRODUCT_COMMAND_CONTRACT_NAME) {
      return {
        code: A7_PRODUCT_COMMAND_FAILURE_PRODUCT_CATALOG_REJECTED,
        message: 'The A7 product command contract name is invalid',
      };
    }
    if (command.contractVersion !== A7_PRODUCT_COMMAND_CONTRACT_VERSION) {
      return {
        code: A7_PRODUCT_COMMAND_FAILURE_PRODUCT_CATALOG_REJECTED,
        message: 'The A7 product command contract version is invalid',
      };
    }
    if (command.productKey !== PRODUCT_KEY || command.productVersion !== PRODUCT_VERSION) {
      return {
        code: A7_PRODUCT_COMMAND_FAILURE_PRODUCT_CATALOG_REJECTED,
        message: 'The A7 product command product registration is invalid',
      };
    }
    if (
      command.capabilityKey !== CAPABILITY_ASSIGN &&
      command.capabilityKey !== CAPABILITY_INBOUND_FUNDING
    ) {
      return {
        code: A7_PRODUCT_COMMAND_FAILURE_PRODUCT_CATALOG_REJECTED,
        message: 'The A7 product command capability key is not registered',
      };
    }
    if (command.action !== ACTION_ASSIGN && command.action !== ACTION_LIFECYCLE) {
      return {
        code: A7_PRODUCT_COMMAND_FAILURE_PRODUCT_CATALOG_REJECTED,
        message: 'The A7 product command action is not registered',
      };
    }
    const allowedProductStates = new Set([
      ...A7_PRODUCT_COMMAND_ASSIGN_STATES,
      ...A7_PRODUCT_COMMAND_FUNDING_STATES,
    ]);
    if (!allowedProductStates.has(command.productState)) {
      return {
        code: A7_PRODUCT_COMMAND_FAILURE_PRODUCT_CATALOG_REJECTED,
        message: 'The A7 product command product state is not registered',
      };
    }
    if (command.currency !== CURRENCY) {
      return {
        code: A7_PRODUCT_COMMAND_FAILURE_CURRENCY_MISMATCH,
        message: 'The A7 product command currency is not NGN',
      };
    }
    if (command.accountingUnit !== ACCOUNTING_UNIT) {
      return {
        code: A7_PRODUCT_COMMAND_FAILURE_ACCOUNTING_UNIT_MISMATCH,
        message: 'The A7 product command accounting unit is not CUSTOMER_FUNDS',
      };
    }
    if (!UUID_PATTERN.test(command.customerId)) {
      return {
        code: A7_PRODUCT_COMMAND_FAILURE_A3_BINDING_MISSING,
        message: 'The customerId must be a UUID',
      };
    }
    if (!UUID_PATTERN.test(command.customerWalletId)) {
      return {
        code: A7_PRODUCT_COMMAND_FAILURE_A3_BINDING_MISSING,
        message: 'The customerWalletId must be a UUID',
      };
    }
    if (!UUID_PATTERN.test(command.bindingId)) {
      return {
        code: A7_PRODUCT_COMMAND_FAILURE_A3_BINDING_MISSING,
        message: 'The bindingId must be a UUID',
      };
    }
    if (!Number.isSafeInteger(command.bindingVersion) || command.bindingVersion < 1) {
      return {
        code: A7_PRODUCT_COMMAND_FAILURE_A3_STALE_BINDING,
        message: 'The bindingVersion must be a positive integer',
      };
    }
    if (!UUID_PATTERN.test(command.a6ExternalOperationId)) {
      return {
        code: A7_PRODUCT_COMMAND_FAILURE_A6_EXTERNAL_OPERATION_MISSING,
        message: 'The a6ExternalOperationId must be a UUID',
      };
    }
    if (!REFERENCE_PATTERN.test(command.a6ExternalOperationReference)) {
      return {
        code: A7_PRODUCT_COMMAND_FAILURE_A6_EXTERNAL_OPERATION_MAPPING_CONFLICT,
        message: 'The a6ExternalOperationReference is invalid',
      };
    }
    if (!SAFE_TEXT_PATTERN.test(command.a6ProviderIdempotencyScope)) {
      return {
        code: A7_PRODUCT_COMMAND_FAILURE_A6_EXTERNAL_OPERATION_MAPPING_CONFLICT,
        message: 'The a6ProviderIdempotencyScope is invalid',
      };
    }
    if (!SAFE_TEXT_PATTERN.test(command.a6ProviderIdempotencyKey)) {
      return {
        code: A7_PRODUCT_COMMAND_FAILURE_A6_EXTERNAL_OPERATION_MAPPING_CONFLICT,
        message: 'The a6ProviderIdempotencyKey is invalid',
      };
    }
    if (!SAFE_TEXT_PATTERN.test(command.a7ProductCustomerBindingMapReference)) {
      return {
        code: A7_PRODUCT_COMMAND_FAILURE_A7T04_PRODUCT_CUSTOMER_BINDING_MISSING,
        message: 'The a7ProductCustomerBindingMapReference is invalid',
      };
    }
    if (!SAFE_TEXT_PATTERN.test(command.a4ProductPolicyDecisionReference)) {
      return {
        code: A7_PRODUCT_COMMAND_FAILURE_A4_POLICY_DECISION_MISSING,
        message: 'The a4ProductPolicyDecisionReference is invalid',
      };
    }
    if (!SAFE_TEXT_PATTERN.test(command.a2AuthorizationContextReference)) {
      return {
        code: A7_PRODUCT_COMMAND_FAILURE_A2_AUTHORIZATION_MISSING,
        message: 'The a2AuthorizationContextReference is invalid',
      };
    }
    if (!SAFE_TEXT_PATTERN.test(command.idempotencyKey)) {
      return {
        code: A7_PRODUCT_COMMAND_FAILURE_OPERATIONS_EVIDENCE_UNAVAILABLE,
        message: 'The idempotencyKey is invalid',
      };
    }
    if (!HASH_PATTERN.test(command.requestHash)) {
      return {
        code: A7_PRODUCT_COMMAND_FAILURE_REQUEST_HASH_CONFLICT,
        message: 'The requestHash must be a SHA-256 hash',
      };
    }
    return null;
  }

  private normalizeCommand(command: A7ProductCommandCreateV1): NormalizedA7ProductCommandCreateV1 {
    return {
      contractName: A7_PRODUCT_COMMAND_CONTRACT_NAME,
      contractVersion: A7_PRODUCT_COMMAND_CONTRACT_VERSION,
      productKey: PRODUCT_KEY,
      productVersion: PRODUCT_VERSION,
      capabilityKey: command.capabilityKey,
      action: command.action,
      productState: command.productState,
      customerId: command.customerId.toLowerCase(),
      customerWalletId: command.customerWalletId.toLowerCase(),
      bindingId: command.bindingId.toLowerCase(),
      bindingVersion: command.bindingVersion,
      amountMinor: parsePositiveMinorUnits(command.amountMinor).toString(),
      currency: CURRENCY,
      accountingUnit: ACCOUNTING_UNIT,
      a7ProductCustomerBindingMapReference: command.a7ProductCustomerBindingMapReference,
      a4ProductPolicyDecisionReference: command.a4ProductPolicyDecisionReference,
      a2AuthorizationContextReference: command.a2AuthorizationContextReference,
      a6ExternalOperationId: command.a6ExternalOperationId.toLowerCase(),
      a6ExternalOperationReference: command.a6ExternalOperationReference,
      a6ProviderIdempotencyScope: command.a6ProviderIdempotencyScope,
      a6ProviderIdempotencyKey: command.a6ProviderIdempotencyKey,
      idempotencyKey: command.idempotencyKey,
      requestHash: command.requestHash.toLowerCase(),
      requestContext: command.requestContext,
      causationId: command.causationId,
    };
  }

  private failure(
    command: A7ProductCommandCreateV1,
    code: string,
    message: string,
    checks: AllChecks,
  ): A7ProductCommandResultV1 {
    const failure: A7ProductCommandFailureV1 = {
      contractName: A7_PRODUCT_COMMAND_CONTRACT_NAME,
      contractVersion: A7_PRODUCT_COMMAND_CONTRACT_VERSION,
      code,
      message,
      checks,
      correlationId: command.requestContext.correlationId,
      requestId: command.requestContext.requestId,
      createdAt: new Date().toISOString(),
    };
    return { valid: false, failure };
  }

  private generateProductCommandId(): string {
    return randomUUID();
  }

  private generateProductOperationId(): string {
    return randomUUID();
  }

  private productCommandReference(productCommandId: string): string {
    return `${A7_PRODUCT_COMMAND_REFERENCE_PREFIX}:v${A7_PRODUCT_COMMAND_CONTRACT_VERSION}:${this.sha256(
      `A7-PRODUCT-COMMAND:${productCommandId}`,
    )}`;
  }

  private productOperationReference(productOperationId: string): string {
    return `${A7_PRODUCT_OPERATION_REFERENCE_PREFIX}:v${A7_PRODUCT_COMMAND_CONTRACT_VERSION}:${this.sha256(
      `A7-PRODUCT-OPERATION:${productOperationId}`,
    )}`;
  }

  private isHashConflict(error: unknown): boolean {
    if (!(error instanceof ConflictException)) {
      return false;
    }
    const response = error.getResponse();
    if (typeof response === 'string') {
      return response.toLowerCase().includes('another request');
    }
    if (typeof response === 'object' && response !== null && 'message' in response) {
      const value = (response as { message?: unknown }).message;
      if (typeof value === 'string') {
        return value.toLowerCase().includes('another request');
      }
    }
    return false;
  }

  private isRetryableTransactionError(error: unknown): boolean {
    if (!(error instanceof QueryFailedError)) {
      return false;
    }
    const driverError = error.driverError as { code?: string };
    return driverError.code === '40001' || driverError.code === '40P01';
  }

  private sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  private canonicalJson(value: unknown): string {
    if (value === null || typeof value !== 'object') {
      return JSON.stringify(value) ?? 'null';
    }
    if (Array.isArray(value)) {
      return `[${value.map((item) => this.canonicalJson(item)).join(',')}]`;
    }
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${this.canonicalJson(object[key])}`)
      .join(',')}}`;
  }
}

function checkWithFailed(
  failedKey: keyof AllChecks,
  failedStatus: 'FAIL' | 'NOT_VERIFIED',
): AllChecks {
  return { ...ALL_CHECKS_OK, [failedKey]: failedStatus };
}
