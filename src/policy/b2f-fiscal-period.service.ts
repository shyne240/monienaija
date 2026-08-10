import { Injectable } from '@nestjs/common';
import type { DataSource, EntityManager } from 'typeorm';

import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import { PrivilegedActionApprovalService } from '../authorization/privileged-action-approval.service';
import { AuditService } from '../operations/audit.service';
import { IdempotencyService } from '../operations/idempotency.service';
import {
  B2F_ACCOUNTING_PERIOD_AUDIT_ENTITY_TYPE,
  B2F_ACCOUNTING_PERIOD_RESOURCE_TYPE,
  B2F_FISCAL_PERIOD_AUDIT_ACTOR,
  B2F_FISCAL_PERIOD_CONTRACT_NAME,
  B2F_FISCAL_PERIOD_CONTRACT_VERSION,
  B2F_FISCAL_PERIOD_IDEMPOTENCY_RETENTION_SECONDS,
  B2F_FISCAL_YEAR_AUDIT_ENTITY_TYPE,
  B2F_FISCAL_YEAR_CREATE_IDEMPOTENCY_SCOPE,
  B2F_PERIOD_LIFECYCLE_IDEMPOTENCY_SCOPE,
} from './b2f-fiscal-period.constants';
import { B2FFinanceAccountingPeriod } from './b2f-accounting-period.entity';
import { B2FFinanceControlService } from './b2f-finance-control.service';
import type { B2FFinanceControlAction } from './b2f-finance-control.types';
import { b2fSha256, B2FFiscalPeriodRepository } from './b2f-fiscal-period.repository';
import type {
  B2FFiscalPeriodConsumerPortsV1,
  B2FFiscalPeriodFailureV1,
  B2FFiscalYearCreateCommandV1,
  B2FFiscalYearCreateResultV1,
  B2FFiscalYearViewV1,
  B2FAccountingPeriodViewV1,
  B2FPeriodAdmissionDecisionV1,
  B2FPeriodAdmissionRequestV1,
  B2FPeriodTransitionCommandV1,
  B2FPeriodTransitionDecisionV1,
} from './b2f-fiscal-period.types';
import { B2FFinanceFiscalYear } from './b2f-fiscal-year.entity';

@Injectable()
export class B2FFiscalPeriodService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly repository: B2FFiscalPeriodRepository,
    private readonly idempotencyService: IdempotencyService,
    private readonly auditService: AuditService,
    private readonly privilegedApprovalService: PrivilegedActionApprovalService,
    private readonly financeControlService: B2FFinanceControlService,
  ) {}

  getConsumerPorts(): B2FFiscalPeriodConsumerPortsV1 {
    return {
      contractName: B2F_FISCAL_PERIOD_CONTRACT_NAME,
      contractVersion: B2F_FISCAL_PERIOD_CONTRACT_VERSION,
      lifecycleIdempotencyScope: B2F_PERIOD_LIFECYCLE_IDEMPOTENCY_SCOPE,
      checkAdmission: (request) => this.checkAdmission(request),
      getPeriodByKey: (key) => this.getPeriodByKey(key),
    };
  }

  computeTransitionActionFingerprint(command: B2FPeriodTransitionCommandV1): string {
    return this.repository.computeActionFingerprint(command);
  }

  async createFiscalYear(
    command: B2FFiscalYearCreateCommandV1,
  ): Promise<B2FFiscalYearCreateResultV1> {
    const compatibility = this.repository.validateCreate(command);
    const requestHash = this.repository.computeCreateRequestHash(command);
    if (!compatibility.compatible)
      return {
        outcome: 'REJECTED',
        fiscalYear: null,
        requestHash,
        decisionHash: b2fSha256({ requestHash, failure: compatibility.failure }),
        replayed: false,
        failure: compatibility.failure,
      };
    return this.dataSource.transaction('SERIALIZABLE', async (manager) => {
      const reservation = await this.idempotencyService.reserve(manager, {
        scope: B2F_FISCAL_YEAR_CREATE_IDEMPOTENCY_SCOPE,
        key: command.idempotencyKey,
        requestHash,
        retentionSeconds: B2F_FISCAL_PERIOD_IDEMPOTENCY_RETENTION_SECONDS,
      });
      if (reservation.kind === 'REPLAY')
        return this.replayCreateResult(reservation.record.responseBody, requestHash);

      const key = `finance.fiscal-year.ng.${command.fiscalYear}`;
      const existing = await this.repository.findFiscalYear(manager, key);
      if (existing) {
        const failure = {
          code: 'B2F_FISCAL_YEAR_ALREADY_EXISTS' as const,
          message: `Fiscal year ${key} already exists`,
          field: 'fiscalYear',
        };
        const result: B2FFiscalYearCreateResultV1 = {
          outcome: 'REJECTED',
          fiscalYear: null,
          requestHash,
          decisionHash: b2fSha256({ requestHash, failure }),
          replayed: false,
          failure,
        };
        await this.idempotencyService.fail(manager, reservation.record.id, {
          statusCode: 409,
          responseBody: result as unknown as Record<string, unknown>,
        });
        return result;
      }

      const now = command.now ?? new Date();
      const definitions = this.repository.buildDefinitions(command, now);
      const fiscalRepository = manager.getRepository(B2FFinanceFiscalYear);
      const periodRepository = manager.getRepository(B2FFinanceAccountingPeriod);
      const fiscal = await fiscalRepository.save(definitions.fiscalYear);
      for (const period of definitions.periods) period.fiscalYearId = fiscal.id;
      const periods = await periodRepository.save(definitions.periods);
      await this.auditService.record(manager, {
        entityType: B2F_FISCAL_YEAR_AUDIT_ENTITY_TYPE,
        entityId: fiscal.id,
        action: 'FISCAL_YEAR_CREATED',
        actor: command.principal.principalId,
        correlationId: command.requestContext.correlationId,
        requestId: command.requestContext.requestId,
        newValues: {
          fiscalYearReference: fiscal.fiscalYearReference,
          fiscalYearKey: fiscal.fiscalYearKey,
          definitionHash: fiscal.definitionHash,
          periodCount: periods.length,
        },
        occurredAt: now,
      });
      for (const period of periods)
        await this.auditService.record(manager, {
          entityType: B2F_ACCOUNTING_PERIOD_AUDIT_ENTITY_TYPE,
          entityId: period.id,
          action: 'ACCOUNTING_PERIOD_CREATED',
          actor: B2F_FISCAL_PERIOD_AUDIT_ACTOR,
          correlationId: command.requestContext.correlationId,
          requestId: command.requestContext.requestId,
          newValues: {
            periodReference: period.periodReference,
            periodKey: period.periodKey,
            state: period.state,
            definitionHash: period.definitionHash,
          },
          occurredAt: now,
        });
      const view = this.repository.toFiscalYearView(fiscal, periods);
      const result: B2FFiscalYearCreateResultV1 = {
        outcome: 'CREATED',
        fiscalYear: view,
        requestHash,
        decisionHash: b2fSha256({
          requestHash,
          fiscalYearReference: fiscal.fiscalYearReference,
          definitionHash: fiscal.definitionHash,
        }),
        replayed: false,
        failure: null,
      };
      await this.idempotencyService.complete(manager, reservation.record.id, {
        statusCode: 201,
        responseBody: result as unknown as Record<string, unknown>,
        resourceType: B2F_FISCAL_YEAR_AUDIT_ENTITY_TYPE,
        resourceId: fiscal.id,
      });
      return result;
    });
  }

  async transitionPeriod(
    command: B2FPeriodTransitionCommandV1,
  ): Promise<B2FPeriodTransitionDecisionV1> {
    const requestHash = this.repository.computeTransitionRequestHash(command);
    return this.dataSource.transaction('SERIALIZABLE', async (manager) => {
      const reservation = await this.idempotencyService.reserve(manager, {
        scope: B2F_PERIOD_LIFECYCLE_IDEMPOTENCY_SCOPE,
        key: command.idempotencyKey,
        requestHash,
        retentionSeconds: B2F_FISCAL_PERIOD_IDEMPOTENCY_RETENTION_SECONDS,
      });
      if (reservation.kind === 'REPLAY')
        return this.replayTransitionDecision(reservation.record.responseBody, requestHash);

      const period = await this.repository.findPeriodByReference(
        manager,
        command.periodReference,
        true,
      );
      if (!period)
        return this.rejectTransition(
          manager,
          reservation.record.id,
          command,
          requestHash,
          null,
          'B2F_FISCAL_PERIOD_NOT_FOUND',
          'period was not found',
          404,
        );
      const now = command.now ?? new Date();
      const compatibility = this.repository.validateTransition(period, command, now);
      if (!compatibility.compatible)
        return this.rejectTransition(
          manager,
          reservation.record.id,
          command,
          requestHash,
          period,
          compatibility.failure!.code,
          compatibility.failure!.message,
          409,
        );

      const action = this.repository.actionFor(command.targetState)!;
      const approval = await this.privilegedApprovalService.consume({
        principal: command.principal,
        approvalId: command.approvalId,
        actionType: action,
        resource: { type: B2F_ACCOUNTING_PERIOD_RESOURCE_TYPE, id: period.id },
        actionFingerprint: this.repository.computeActionFingerprint(command),
        now,
      });
      if (!approval.approved)
        return this.rejectTransition(
          manager,
          reservation.record.id,
          command,
          requestHash,
          period,
          'B2F_FISCAL_PERIOD_APPROVAL_REQUIRED',
          `privileged approval rejected: ${approval.reason ?? 'unknown'}`,
          403,
        );

      const approvalView = approval.approval;
      if (!approvalView)
        return this.rejectTransition(
          manager,
          reservation.record.id,
          command,
          requestHash,
          period,
          'B2F_FISCAL_PERIOD_APPROVAL_REQUIRED',
          'consumed A2 approval evidence is missing',
          403,
        );
      const makerRoles = Array.isArray(approvalView.policy.requiredRoles)
        ? approvalView.policy.requiredRoles.filter(
            (role): role is string => typeof role === 'string',
          )
        : [];
      const control = await this.financeControlService.evaluate({
        action: action as B2FFinanceControlAction,
        amountMinor: '0',
        resourceType: B2F_ACCOUNTING_PERIOD_RESOURCE_TYPE,
        resourceId: period.id,
        resourceVersion: period.recordVersion,
        resourceHash: this.repository.computeActionFingerprint(command),
        makerPrincipalId: approvalView.requesterPrincipalId,
        makerRoles,
        executorPrincipal: command.principal,
        approvals: [approvalView],
        overrideEvidenceReference: command.controlEvidence.materialityReference,
        idempotencyKey: `${command.idempotencyKey}:control`,
        requestContext: command.requestContext,
        evaluatedAt: now,
      });
      if (control.outcome !== 'ALLOW')
        return this.rejectTransition(
          manager,
          reservation.record.id,
          command,
          requestHash,
          period,
          'B2F_FISCAL_PERIOD_APPROVAL_REQUIRED',
          `Finance control denied: ${control.reasons.join(',')}`,
          403,
        );

      const previousState = period.state;
      const decisionHash = this.repository.applyTransition(period, command, now, requestHash);
      const saved = await manager.getRepository(B2FFinanceAccountingPeriod).save(period);
      await this.synchronizeFiscalYearState(
        manager,
        saved.fiscalYearId,
        command.principal,
        command.requestContext.correlationId,
      );
      const decision: B2FPeriodTransitionDecisionV1 = {
        decisionReference: this.repository.decisionReference(requestHash),
        outcome: 'APPLIED',
        periodReference: saved.periodReference,
        previousState,
        targetState: command.targetState,
        resultingState: saved.state,
        requestHash,
        decisionHash,
        idempotencyScope: B2F_PERIOD_LIFECYCLE_IDEMPOTENCY_SCOPE,
        idempotencyKey: command.idempotencyKey,
        approvalId: command.approvalId,
        reason: command.reason.trim(),
        controlEvidence: command.controlEvidence,
        correlationId: command.requestContext.correlationId,
        causationId: command.causationId ?? null,
        decidedAt: now.toISOString(),
        recordVersion: saved.recordVersion,
        replayed: false,
        failure: null,
      };
      await this.auditService.record(manager, {
        entityType: B2F_ACCOUNTING_PERIOD_AUDIT_ENTITY_TYPE,
        entityId: saved.id,
        action: this.auditAction(command.targetState),
        actor: command.principal.principalId,
        correlationId: command.requestContext.correlationId,
        requestId: command.requestContext.requestId,
        previousValues: { state: previousState, recordVersion: command.expectedRecordVersion },
        newValues: {
          state: saved.state,
          stateVersion: saved.stateVersion,
          recordVersion: saved.recordVersion,
          decisionHash,
          approvalId: command.approvalId,
          controlEvidence: command.controlEvidence,
        },
        occurredAt: now,
      });
      await this.idempotencyService.complete(manager, reservation.record.id, {
        statusCode: 200,
        responseBody: decision as unknown as Record<string, unknown>,
        resourceType: B2F_ACCOUNTING_PERIOD_AUDIT_ENTITY_TYPE,
        resourceId: saved.id,
      });
      return decision;
    });
  }

  async getFiscalYear(fiscalYear: number): Promise<B2FFiscalYearViewV1 | null> {
    const fiscal = await this.repository.findFiscalYear(
      this.dataSource,
      `finance.fiscal-year.ng.${fiscalYear}`,
    );
    if (!fiscal) return null;
    return this.repository.toFiscalYearView(
      fiscal,
      await this.repository.listPeriods(this.dataSource, fiscal.id),
    );
  }

  async getPeriodByKey(periodKey: string): Promise<B2FAccountingPeriodViewV1 | null> {
    const period = await this.repository.findPeriodByKey(this.dataSource, periodKey);
    return period ? this.repository.toPeriodView(period) : null;
  }

  async checkAdmission(
    request: B2FPeriodAdmissionRequestV1,
  ): Promise<B2FPeriodAdmissionDecisionV1> {
    const period = await this.repository.findPeriodByKey(this.dataSource, request.periodKey);
    return this.repository.evaluateAdmission(period, request);
  }

  private async rejectTransition(
    manager: EntityManager,
    idempotencyRecordId: string,
    command: B2FPeriodTransitionCommandV1,
    requestHash: string,
    period: B2FFinanceAccountingPeriod | null,
    code: B2FFiscalPeriodFailureV1['code'],
    message: string,
    statusCode: number,
  ): Promise<B2FPeriodTransitionDecisionV1> {
    const now = command.now ?? new Date();
    const failure: B2FFiscalPeriodFailureV1 = {
      code,
      message,
      field: null,
    };
    const previousState = period?.state ?? 'PLANNED';
    const decision: B2FPeriodTransitionDecisionV1 = {
      decisionReference: this.repository.decisionReference(requestHash),
      outcome: 'REJECTED',
      periodReference: command.periodReference,
      previousState,
      targetState: command.targetState,
      resultingState: previousState,
      requestHash,
      decisionHash: b2fSha256({ requestHash, failure, resultingState: previousState }),
      idempotencyScope: B2F_PERIOD_LIFECYCLE_IDEMPOTENCY_SCOPE,
      idempotencyKey: command.idempotencyKey,
      approvalId: command.approvalId,
      reason: command.reason.trim(),
      controlEvidence: command.controlEvidence,
      correlationId: command.requestContext.correlationId,
      causationId: command.causationId ?? null,
      decidedAt: now.toISOString(),
      recordVersion: period?.recordVersion ?? 0,
      replayed: false,
      failure,
    };
    if (period)
      await this.auditService.record(manager, {
        entityType: B2F_ACCOUNTING_PERIOD_AUDIT_ENTITY_TYPE,
        entityId: period.id,
        action: 'ACCOUNTING_PERIOD_TRANSITION_REJECTED',
        actor: command.principal.principalId,
        correlationId: command.requestContext.correlationId,
        requestId: command.requestContext.requestId,
        previousValues: { state: period.state, recordVersion: period.recordVersion },
        newValues: { targetState: command.targetState, failure },
        occurredAt: now,
      });
    await this.idempotencyService.fail(manager, idempotencyRecordId, {
      statusCode,
      responseBody: decision as unknown as Record<string, unknown>,
      ...(period
        ? { resourceType: B2F_ACCOUNTING_PERIOD_AUDIT_ENTITY_TYPE, resourceId: period.id }
        : {}),
    });
    return decision;
  }

  private async synchronizeFiscalYearState(
    manager: EntityManager,
    fiscalYearId: string,
    principal: AuthorizationPrincipal,
    correlationId: string,
  ): Promise<void> {
    const fiscalRepository = manager.getRepository(B2FFinanceFiscalYear);
    const fiscal = await fiscalRepository.findOne({ where: { id: fiscalYearId } });
    if (!fiscal) return;
    const periods = await this.repository.listPeriods(manager, fiscalYearId);
    const previous = fiscal.state;
    if (periods.every((period) => period.state === 'RETIRED')) fiscal.state = 'RETIRED';
    else if (
      periods.every((period) => period.state === 'HARD_CLOSED' || period.state === 'RETIRED')
    )
      fiscal.state = 'CLOSED';
    else if (periods.some((period) => period.state !== 'PLANNED')) fiscal.state = 'ACTIVE';
    if (fiscal.state !== previous) {
      fiscal.lastCorrelationId = correlationId;
      const saved = await fiscalRepository.save(fiscal);
      await this.auditService.record(manager, {
        entityType: B2F_FISCAL_YEAR_AUDIT_ENTITY_TYPE,
        entityId: saved.id,
        action: 'FISCAL_YEAR_STATE_SYNCHRONIZED',
        actor: principal.principalId,
        correlationId,
        previousValues: { state: previous },
        newValues: { state: saved.state },
      });
    }
  }

  private auditAction(target: B2FPeriodTransitionCommandV1['targetState']): string {
    return target === 'OPEN'
      ? 'ACCOUNTING_PERIOD_OPENED'
      : target === 'SOFT_CLOSED'
        ? 'ACCOUNTING_PERIOD_SOFT_CLOSED'
        : target === 'HARD_CLOSED'
          ? 'ACCOUNTING_PERIOD_HARD_CLOSED'
          : target === 'REOPENED'
            ? 'ACCOUNTING_PERIOD_REOPENED'
            : 'ACCOUNTING_PERIOD_RETIRED';
  }

  private replayCreateResult(
    body: Record<string, unknown> | null,
    requestHash: string,
  ): B2FFiscalYearCreateResultV1 {
    if (!body) throw new Error('B2F fiscal-year idempotency replay body is missing');
    return {
      ...(body as unknown as B2FFiscalYearCreateResultV1),
      outcome: 'REPLAYED',
      requestHash,
      replayed: true,
    };
  }

  private replayTransitionDecision(
    body: Record<string, unknown> | null,
    requestHash: string,
  ): B2FPeriodTransitionDecisionV1 {
    if (!body) throw new Error('B2F period lifecycle idempotency replay body is missing');
    return {
      ...(body as unknown as B2FPeriodTransitionDecisionV1),
      outcome: 'REPLAYED',
      requestHash,
      replayed: true,
    };
  }
}
