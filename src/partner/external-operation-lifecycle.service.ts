import { createHash } from 'node:crypto';

import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';

import { AuditService } from '../operations/audit.service';
import { IdempotencyService } from '../operations/idempotency.service';
import type { RequestContext } from '../production/request-context';
import { ExternalOperation } from './external-operation.entity';
import {
  assertExternalOperationTransition,
  ExternalOperationLifecycleState,
  isTerminalExternalOperationState,
} from './external-operation-lifecycle.enums';
import type {
  ExternalOperationLifecycleView,
  ExternalOperationStatusVerificationRequest,
  TransitionExternalOperationCommand,
} from './external-operation-lifecycle.types';
import { EXTERNAL_OPERATION_LIFECYCLE_IDEMPOTENCY_SCOPE } from './external-operation-lifecycle.types';
import { ExternalOperationReference } from './external-operation-reference.entity';
import { ExternalOperationService } from './external-operation.service';
import {
  EXTERNAL_OPERATION_STATUS_VERIFIER,
  type ExternalOperationStatusVerificationResult,
  type ExternalOperationStatusVerifier,
} from './external-operation-status-verifier';
import { PartnerCircuitBreakerService } from './partner-circuit-breaker.service';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RECOVERY_REFERENCE_PATTERN = /^external-operation-recovery:[a-f0-9]{64}$/;

export class ExternalOperationLifecycleException extends ConflictException {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super({ code, message });
  }
}

interface NormalizedTransition
  extends Omit<
    TransitionExternalOperationCommand,
    | 'externalOperationId'
    | 'idempotencyKey'
    | 'requestContext'
    | 'providerStatus'
    | 'recoveryReference'
    | 'failureCode'
    | 'failureMessage'
    | 'reason'
  > {
  externalOperationId: string;
  idempotencyKey: string;
  requestContext: RequestContext;
  providerStatus: string | null;
  recoveryReference: string | null;
  failureCode: string | null;
  failureMessage: string | null;
  reason: string | null;
  requestHash: string;
}

@Injectable()
export class ExternalOperationLifecycleService {
  constructor(
    @InjectRepository(ExternalOperation)
    private readonly operationRepository: Repository<ExternalOperation>,
    @InjectRepository(ExternalOperationReference)
    private readonly referenceRepository: Repository<ExternalOperationReference>,
    private readonly dataSource: DataSource,
    private readonly externalOperationService: ExternalOperationService,
    private readonly idempotencyService: IdempotencyService,
    private readonly auditService: AuditService,
    private readonly circuitBreaker: PartnerCircuitBreakerService,
    @Inject(EXTERNAL_OPERATION_STATUS_VERIFIER)
    private readonly statusVerifier: ExternalOperationStatusVerifier,
  ) {}

  async get(externalOperationId: string): Promise<ExternalOperationLifecycleView> {
    const operation = await this.externalOperationService.get(externalOperationId);
    return { ...operation, transitionReplayed: false };
  }

  async transition(
    command: TransitionExternalOperationCommand,
  ): Promise<ExternalOperationLifecycleView> {
    const normalized = this.normalizeTransition(command);
    return this.dataSource.transaction('SERIALIZABLE', (manager) =>
      this.transitionWithinTransaction(manager, normalized),
    );
  }

  async beginAttempt(
    externalOperationId: string,
    idempotencyKey: string,
    requestContext: RequestContext,
    expectedVersion?: number,
  ): Promise<ExternalOperationLifecycleView> {
    const operation = await this.externalOperationService.get(externalOperationId);
    if (!this.circuitBreaker.allowAttempt(operation.partnerKey)) {
      throw new ExternalOperationLifecycleException(
        'CIRCUIT_OPEN',
        'The partner circuit is open and new external attempts are blocked',
      );
    }
    return this.transition({
      externalOperationId,
      nextState: ExternalOperationLifecycleState.SUBMITTING,
      idempotencyKey,
      requestContext,
      ...(expectedVersion === undefined ? {} : { expectedVersion }),
      reason: 'EXTERNAL_ATTEMPT_BEGIN',
    });
  }

  async markProviderAccepted(
    externalOperationId: string,
    providerStatus: string,
    idempotencyKey: string,
    requestContext: RequestContext,
    expectedVersion?: number,
  ): Promise<ExternalOperationLifecycleView> {
    const operation = await this.externalOperationService.get(externalOperationId);
    const result = await this.transition({
      externalOperationId,
      nextState: ExternalOperationLifecycleState.PENDING_PROVIDER,
      idempotencyKey,
      requestContext,
      providerStatus,
      ...(expectedVersion === undefined ? {} : { expectedVersion }),
      reason: 'PROVIDER_ACCEPTED_NOT_SETTLED',
    });
    this.circuitBreaker.recordSuccess(operation.partnerKey);
    return result;
  }

  async markTimeout(
    externalOperationId: string,
    idempotencyKey: string,
    requestContext: RequestContext,
    expectedVersion?: number,
  ): Promise<ExternalOperationLifecycleView> {
    const operation = await this.externalOperationService.get(externalOperationId);
    const result = await this.transition({
      externalOperationId,
      nextState: ExternalOperationLifecycleState.UNKNOWN,
      idempotencyKey,
      requestContext,
      recoveryReference: this.recoveryReference(externalOperationId),
      failureCode: 'TIMEOUT_AFTER_SEND_UNKNOWN',
      failureMessage: 'The provider outcome could not be established after the deadline',
      failureStatusCode: 504,
      reason: 'EXTERNAL_OUTCOME_UNKNOWN',
      ...(expectedVersion === undefined ? {} : { expectedVersion }),
    });
    this.circuitBreaker.recordFailure(operation.partnerKey);
    return result;
  }

  async recover(
    command: TransitionExternalOperationCommand,
  ): Promise<ExternalOperationLifecycleView> {
    if (
      command.nextState !== ExternalOperationLifecycleState.PENDING_VERIFICATION &&
      command.nextState !== ExternalOperationLifecycleState.MANUAL_REVIEW &&
      command.nextState !== ExternalOperationLifecycleState.FAILED
    ) {
      throw new ExternalOperationLifecycleException(
        'INVALID_TRANSITION',
        'Recovery may only verify, hold for manual review, or fail an operation',
      );
    }
    return this.transition(command);
  }

  async verifyStatus(
    externalOperationId: string,
    requestContext: RequestContext,
  ): Promise<ExternalOperationStatusVerificationResult> {
    const operation = await this.externalOperationService.get(externalOperationId);
    const request: ExternalOperationStatusVerificationRequest = {
      externalOperationId: operation.externalOperationId,
      externalOperationReference: operation.externalOperationReference,
      providerIdempotencyKey: operation.providerIdempotencyKey,
      providerReferences: operation.providerReferences,
      correlationId: operation.requestContext.correlationId,
    };
    return this.statusVerifier.verify({
      operation,
      ...request,
      requestedAt: new Date().toISOString(),
      correlationId: requestContext.correlationId,
    });
  }

  private async transitionWithinTransaction(
    manager: EntityManager,
    command: NormalizedTransition,
  ): Promise<ExternalOperationLifecycleView> {
    const reservation = await this.idempotencyService.reserve(manager, {
      scope: EXTERNAL_OPERATION_LIFECYCLE_IDEMPOTENCY_SCOPE,
      key: `external-operation:${command.externalOperationId}:${command.idempotencyKey}`,
      requestHash: command.requestHash,
      retentionSeconds: 86_400,
    });
    if (reservation.kind === 'IN_PROGRESS') {
      throw new ExternalOperationLifecycleException(
        'LIFECYCLE_IDEMPOTENCY_CONFLICT',
        'The external-operation lifecycle request is already in progress',
      );
    }
    if (reservation.kind === 'REPLAY') {
      return this.replayFromReservation(
        manager,
        reservation.record.resourceId,
        reservation.record.responseBody,
      );
    }

    const operation = await manager
      .getRepository(ExternalOperation)
      .createQueryBuilder('operation')
      .where('operation.id = :externalOperationId', {
        externalOperationId: command.externalOperationId,
      })
      .setLock('pessimistic_write')
      .getOne();
    if (!operation) {
      throw new NotFoundException(
        `External operation ${command.externalOperationId} was not found`,
      );
    }
    if (command.expectedVersion !== undefined && command.expectedVersion !== operation.version) {
      throw new ExternalOperationLifecycleException(
        'STALE_LIFECYCLE_VERSION',
        'The external-operation lifecycle version is stale',
      );
    }

    const previousState = operation.lifecycleState;
    let nextState = command.nextState;
    let failureCode = command.failureCode;
    let failureMessage = command.failureMessage;
    if (
      nextState === ExternalOperationLifecycleState.SUBMITTING &&
      operation.attemptCount >= operation.maxAttempts
    ) {
      nextState = ExternalOperationLifecycleState.FAILED;
      failureCode = 'RETRY_EXHAUSTED';
      failureMessage = `The partner operation exhausted ${operation.maxAttempts} bounded attempts`;
    }
    try {
      assertExternalOperationTransition(previousState, nextState);
    } catch {
      if (isTerminalExternalOperationState(previousState)) {
        throw new ExternalOperationLifecycleException(
          'LIFECYCLE_TERMINAL',
          `The external operation is already terminal at ${previousState}`,
        );
      }
      throw new ExternalOperationLifecycleException(
        'INVALID_TRANSITION',
        `Invalid external operation transition from ${previousState} to ${nextState}`,
      );
    }

    const recoveryReference = this.resolveRecoveryReference(operation, command.recoveryReference);
    if (
      (nextState === ExternalOperationLifecycleState.UNKNOWN ||
        nextState === ExternalOperationLifecycleState.MANUAL_REVIEW) &&
      !recoveryReference
    ) {
      throw new ExternalOperationLifecycleException(
        'RECOVERY_REFERENCE_REQUIRED',
        `${nextState} requires a recovery reference`,
      );
    }
    if (
      (previousState === ExternalOperationLifecycleState.UNKNOWN ||
        previousState === ExternalOperationLifecycleState.MANUAL_REVIEW) &&
      nextState !== ExternalOperationLifecycleState.FAILED &&
      !recoveryReference
    ) {
      throw new ExternalOperationLifecycleException(
        'RECOVERY_REFERENCE_REQUIRED',
        'Recovery resolution requires the existing recovery reference',
      );
    }
    if (nextState === ExternalOperationLifecycleState.FAILED && (!failureCode || !failureMessage)) {
      throw new ExternalOperationLifecycleException(
        'INVALID_TRANSITION',
        'FAILED requires a failure code and message',
      );
    }

    this.applyTransition(
      operation,
      nextState,
      command,
      recoveryReference,
      failureCode,
      failureMessage,
    );
    await manager.getRepository(ExternalOperation).save(operation);
    const result: ExternalOperationLifecycleView = {
      ...(await this.externalOperationService.getInTransaction(manager, operation.id)),
      transitionReplayed: false,
    };
    await this.auditTransition(manager, result, previousState, nextState, command);
    await this.idempotencyService.complete(manager, reservation.record.id, {
      statusCode: 200,
      responseBody: result as unknown as Record<string, unknown>,
      resourceType: 'EXTERNAL_OPERATION',
      resourceId: operation.id,
    });
    return result;
  }

  private applyTransition(
    operation: ExternalOperation,
    nextState: ExternalOperationLifecycleState,
    command: NormalizedTransition,
    recoveryReference: string | null,
    failureCode: string | null,
    failureMessage: string | null,
  ): void {
    const now = new Date();
    operation.lifecycleState = nextState;
    operation.recoveryReference = recoveryReference;
    operation.providerStatus = command.providerStatus ?? operation.providerStatus;
    switch (nextState) {
      case ExternalOperationLifecycleState.SUBMITTING:
        operation.attemptCount += 1;
        operation.lastAttemptAt = now;
        operation.submittingAt ??= now;
        operation.nextRetryAt = null;
        operation.failureCode = null;
        operation.failureMessage = null;
        operation.failureStatusCode = null;
        break;
      case ExternalOperationLifecycleState.PENDING_PROVIDER:
        operation.pendingAt ??= now;
        operation.failureCode = null;
        operation.failureMessage = null;
        operation.failureStatusCode = null;
        break;
      case ExternalOperationLifecycleState.PENDING_VERIFICATION:
        operation.pendingVerificationAt ??= now;
        operation.nextRetryAt = null;
        break;
      case ExternalOperationLifecycleState.UNKNOWN:
        operation.unknownAt ??= now;
        operation.failureCode = failureCode ?? 'UNKNOWN_OUTCOME';
        operation.failureMessage =
          failureMessage ?? command.reason ?? 'The provider outcome is unknown';
        operation.failureStatusCode = command.failureStatusCode ?? 409;
        operation.nextRetryAt = null;
        break;
      case ExternalOperationLifecycleState.MANUAL_REVIEW:
        operation.manualReviewAt ??= now;
        operation.failureCode = failureCode ?? 'MANUAL_REVIEW_REQUIRED';
        operation.failureMessage = failureMessage ?? command.reason ?? 'Manual review is required';
        operation.failureStatusCode = command.failureStatusCode ?? 409;
        operation.nextRetryAt = null;
        break;
      case ExternalOperationLifecycleState.FAILED:
        operation.failedAt ??= now;
        operation.failureCode = failureCode;
        operation.failureMessage = failureMessage;
        operation.failureStatusCode = command.failureStatusCode ?? 422;
        operation.nextRetryAt = null;
        break;
      case ExternalOperationLifecycleState.CANCELLED:
        operation.cancelledAt ??= now;
        operation.failureCode = failureCode ?? 'CANCELLED';
        operation.failureMessage =
          failureMessage ?? command.reason ?? 'The operation was cancelled';
        operation.failureStatusCode = command.failureStatusCode ?? 409;
        operation.nextRetryAt = null;
        break;
      case ExternalOperationLifecycleState.CREATED:
        throw new ExternalOperationLifecycleException(
          'INVALID_TRANSITION',
          'An external operation cannot transition back to CREATED',
        );
    }
  }

  private async auditTransition(
    manager: EntityManager,
    result: ExternalOperationLifecycleView,
    previousState: ExternalOperationLifecycleState,
    nextState: ExternalOperationLifecycleState,
    command: NormalizedTransition,
  ): Promise<void> {
    await this.auditService.record(manager, {
      entityType: 'A6_EXTERNAL_OPERATION',
      entityId: result.externalOperationId,
      action: 'LIFECYCLE_TRANSITIONED',
      actor: 'a6-external-operation-lifecycle',
      correlationId: command.requestContext.correlationId,
      requestId: command.requestContext.requestId,
      newValues: {
        externalOperationReference: result.externalOperationReference,
        previousState,
        nextState,
        attemptCount: result.attemptCount,
        maxAttempts: result.maxAttempts,
        providerStatus: result.providerStatus,
        recoveryReference: result.recoveryReference,
        failureCode: result.failureCode,
        requestHash: command.requestHash,
      },
    });
  }

  private resolveRecoveryReference(
    operation: ExternalOperation,
    supplied: string | null,
  ): string | null {
    if (operation.recoveryReference && supplied && operation.recoveryReference !== supplied) {
      throw new ExternalOperationLifecycleException(
        'RECOVERY_REFERENCE_MISMATCH',
        'The external-operation recovery reference is immutable',
      );
    }
    return operation.recoveryReference ?? supplied;
  }

  private async replayFromReservation(
    manager: EntityManager,
    resourceId: string | null,
    responseBody: Record<string, unknown> | null,
  ): Promise<ExternalOperationLifecycleView> {
    if (responseBody && typeof responseBody.externalOperationId === 'string') {
      return this.restoreView(responseBody);
    }
    if (!resourceId || !UUID_PATTERN.test(resourceId)) {
      throw new ExternalOperationLifecycleException(
        'LIFECYCLE_IDEMPOTENCY_CONFLICT',
        'The lifecycle replay result is incomplete',
      );
    }
    return {
      ...(await this.externalOperationService.getInTransaction(manager, resourceId)),
      transitionReplayed: true,
    };
  }

  private restoreView(body: Record<string, unknown>): ExternalOperationLifecycleView {
    const date = (value: unknown): Date | null => {
      if (value === null || value === undefined) return null;
      if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
      if (typeof value !== 'string' && typeof value !== 'number') return null;
      const parsed = new Date(value);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    };
    const providerReferences = Array.isArray(body.providerReferences)
      ? (body.providerReferences as ExternalOperationLifecycleView['providerReferences'])
      : [];
    return {
      ...(body as unknown as ExternalOperationLifecycleView),
      requestContext: body.requestContext as RequestContext,
      providerReferences,
      nextRetryAt: date(body.nextRetryAt),
      lastAttemptAt: date(body.lastAttemptAt),
      submittingAt: date(body.submittingAt),
      pendingAt: date(body.pendingAt),
      pendingVerificationAt: date(body.pendingVerificationAt),
      unknownAt: date(body.unknownAt),
      manualReviewAt: date(body.manualReviewAt),
      failedAt: date(body.failedAt),
      cancelledAt: date(body.cancelledAt),
      createdAt: date(body.createdAt) ?? new Date(0),
      updatedAt: date(body.updatedAt) ?? new Date(0),
      transitionReplayed: true,
    };
  }

  private normalizeTransition(command: TransitionExternalOperationCommand): NormalizedTransition {
    if (!Object.values(ExternalOperationLifecycleState).includes(command.nextState)) {
      throw new ExternalOperationLifecycleException(
        'INVALID_TRANSITION',
        'The lifecycle state is invalid',
      );
    }
    const externalOperationId = this.normalizeUuid(
      command.externalOperationId,
      'externalOperationId',
    );
    const idempotencyKey = this.normalizeText(command.idempotencyKey, 'idempotencyKey');
    const requestContext = this.normalizeRequestContext(command.requestContext);
    const providerStatus = command.providerStatus
      ? this.normalizeText(command.providerStatus, 'providerStatus', 80)
      : null;
    const recoveryReference = command.recoveryReference
      ? this.normalizeRecoveryReference(command.recoveryReference)
      : null;
    const failureCode = command.failureCode
      ? this.normalizeText(command.failureCode, 'failureCode', 80)
      : null;
    const failureMessage = command.failureMessage
      ? this.normalizeText(command.failureMessage, 'failureMessage', 255)
      : null;
    const reason = command.reason ? this.normalizeText(command.reason, 'reason', 255) : null;
    if (
      command.expectedVersion !== undefined &&
      (!Number.isSafeInteger(command.expectedVersion) || command.expectedVersion < 1)
    ) {
      throw new ExternalOperationLifecycleException(
        'STALE_LIFECYCLE_VERSION',
        'expectedVersion must be a positive integer',
      );
    }
    const requestHash = createHash('sha256')
      .update(
        this.canonicalJson({
          externalOperationId,
          nextState: command.nextState,
          expectedVersion: command.expectedVersion ?? null,
          providerStatus,
          recoveryReference,
          failureCode,
          failureMessage,
          failureStatusCode: command.failureStatusCode ?? null,
          reason,
        }),
      )
      .digest('hex');
    return {
      ...command,
      externalOperationId,
      idempotencyKey,
      requestContext,
      providerStatus,
      recoveryReference,
      failureCode,
      failureMessage,
      reason,
      requestHash,
    };
  }

  private normalizeRequestContext(context: RequestContext): RequestContext {
    return {
      requestId: this.normalizeText(context.requestId, 'requestId'),
      correlationId: this.normalizeText(context.correlationId, 'correlationId'),
      traceId: this.normalizeText(context.traceId, 'traceId'),
    };
  }

  private normalizeUuid(value: string, field: string): string {
    const normalized = value.trim().toLowerCase();
    if (!UUID_PATTERN.test(normalized))
      throw new ExternalOperationLifecycleException('INVALID_TRANSITION', `${field} is invalid`);
    return normalized;
  }

  private normalizeText(value: string, field: string, maxLength = 255): string {
    const normalized = value.trim();
    if (!normalized || normalized.length > maxLength || !/^[\x20-\x7E]+$/.test(normalized)) {
      throw new ExternalOperationLifecycleException('INVALID_TRANSITION', `${field} is invalid`);
    }
    return normalized;
  }

  private normalizeRecoveryReference(value: string): string {
    const normalized = value.trim().toLowerCase();
    if (!RECOVERY_REFERENCE_PATTERN.test(normalized)) {
      throw new ExternalOperationLifecycleException(
        'RECOVERY_REFERENCE_REQUIRED',
        'The recovery reference is invalid',
      );
    }
    return normalized;
  }

  private recoveryReference(externalOperationId: string): string {
    return `external-operation-recovery:${createHash('sha256')
      .update(`${externalOperationId}:provider-status`)
      .digest('hex')}`;
  }

  private canonicalJson(value: unknown): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
    if (Array.isArray(value)) return `[${value.map((item) => this.canonicalJson(item)).join(',')}]`;
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${this.canonicalJson(object[key])}`)
      .join(',')}}`;
  }
}
