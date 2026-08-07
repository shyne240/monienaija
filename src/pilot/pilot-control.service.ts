import { createHash, randomUUID } from 'node:crypto';

import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';

import { AuthorizationService } from '../authorization/authorization.service';
import type { AuthorizationPolicy } from '../authorization/authorization.types';
import { normalizeCurrency, parsePositiveMinorUnits } from '../common/money';
import { AuditService } from '../operations/audit.service';
import { IdempotencyService } from '../operations/idempotency.service';
import { MetricsService } from '../operations/metrics.service';
import { PilotControl } from './pilot-control.entity';
import {
  INTERNAL_TRANSFER_PILOT_CONTROL_KEY,
  PILOT_CONTROL_IDEMPOTENCY_SCOPE,
  type PilotControlDecision,
  type PilotControlDecisionCode,
  type PilotControlEvaluationCommand,
  type PilotControlMutationCommand,
  type PilotControlView,
  type PilotSafetySignals,
  type PilotSafetyThresholds,
} from './pilot-control.types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_CONTEXT_LENGTH = 255;
const SYSTEM_ENTITY_ID = '00000000-0000-4000-8000-000000000000';
const PILOT_CONTROL_WRITE_POLICY: AuthorizationPolicy = {
  resourceType: 'pilot-control',
  action: 'pilot:control:write',
  requiredScopes: ['pilot:control:write'],
  allowedPrincipalTypes: ['OPERATOR', 'SERVICE', 'PRIVILEGED'],
  customerAccess: 'ANY',
};

export class PilotControlUnavailableException extends ConflictException {
  constructor(message = 'Pilot control evidence is unavailable') {
    super({ code: 'PILOT_CONTROL_UNAVAILABLE', message });
  }
}

@Injectable()
export class PilotControlService {
  constructor(
    @InjectRepository(PilotControl)
    private readonly repository: Repository<PilotControl>,
    private readonly dataSource: DataSource,
    private readonly authorizationService: AuthorizationService,
    private readonly auditService: AuditService,
    private readonly idempotencyService: IdempotencyService,
    private readonly metricsService: MetricsService,
    private readonly configService: ConfigService,
  ) {}

  async evaluate(command: PilotControlEvaluationCommand): Promise<PilotControlDecision> {
    const normalized = this.normalizeEvaluation(command);
    let control: PilotControl | null;
    try {
      control = await this.repository.findOne({
        where: { controlKey: INTERNAL_TRANSFER_PILOT_CONTROL_KEY },
      });
    } catch {
      throw new PilotControlUnavailableException();
    }

    let decision: PilotControlDecision;
    if (!normalized.authorizationDecision.allowed) {
      decision = this.decision(
        'PILOT_AUTHORIZATION_REQUIRED',
        'A2 authorization is required before pilot evaluation',
        control,
        false,
        false,
      );
    } else if (this.configService.get<boolean>('A5_PILOT_EMERGENCY_STOP') === true) {
      decision = this.decision(
        'PILOT_EMERGENCY_STOP',
        'The A5 pilot emergency stop is active',
        control,
        false,
        true,
      );
    } else if (!control) {
      decision = this.decision(
        'PILOT_CONTROL_UNAVAILABLE',
        'No durable pilot control is configured',
        null,
        false,
        false,
      );
    } else {
      decision = await this.evaluateControl(control, normalized);
    }

    await this.recordDecision(normalized, decision);
    return decision;
  }

  async configure(command: PilotControlMutationCommand): Promise<PilotControlView> {
    const normalized = this.normalizeMutation(command);
    const authorization = await this.authorizationService.authorize(
      normalized.principal,
      PILOT_CONTROL_WRITE_POLICY,
      { type: 'pilot-control', id: SYSTEM_ENTITY_ID },
    );
    if (!authorization.allowed) {
      throw new ForbiddenException(`Authorization denied: ${authorization.reason ?? 'UNKNOWN'}`);
    }
    const requestHash = this.mutationRequestHash(normalized);
    return this.dataSource.transaction('SERIALIZABLE', (manager) =>
      this.configureWithinTransaction(manager, normalized, requestHash),
    );
  }

  async setEnabled(command: {
    controlKey: string;
    enabled: boolean;
    reason: string;
    principal: PilotControlMutationCommand['principal'];
    idempotencyKey: string;
    requestContext: PilotControlMutationCommand['requestContext'];
  }): Promise<PilotControlView> {
    const current = await this.repository.findOne({ where: { controlKey: command.controlKey } });
    if (!current) {
      throw new ConflictException('The requested pilot control does not exist');
    }
    return this.configure({
      controlKey: current.controlKey,
      capability: current.capability,
      action: current.action,
      scope: current.scope,
      enabled: command.enabled,
      cohortCustomerIds: current.cohortCustomerIds,
      currency: current.currency,
      minTransactionAmountMinor: current.minTransactionAmountMinor,
      maxTransactionAmountMinor: current.maxTransactionAmountMinor,
      dailyTransactionCountLimit: current.dailyTransactionCountLimit,
      dailyTransactionAmountMinor: current.dailyTransactionAmountMinor,
      safetyThresholds: this.toThresholds(current.safetyThresholds),
      reason: command.reason,
      principal: command.principal,
      idempotencyKey: command.idempotencyKey,
      requestContext: command.requestContext,
    });
  }

  async get(controlKey = INTERNAL_TRANSFER_PILOT_CONTROL_KEY): Promise<PilotControlView | null> {
    const control = await this.repository.findOne({ where: { controlKey } });
    return control ? this.toView(control) : null;
  }

  private async evaluateControl(
    control: PilotControl,
    command: PilotControlEvaluationCommand,
  ): Promise<PilotControlDecision> {
    if (
      !control.enabled ||
      control.capability !== command.capability ||
      control.action !== command.action ||
      control.scope !== command.scope
    ) {
      return this.decision(
        'PILOT_DISABLED',
        'The internal transfer pilot is disabled or not configured for this command',
        control,
        false,
        false,
      );
    }
    if (control.currency !== command.currency) {
      return this.decision(
        'PILOT_CURRENCY_DENIED',
        'The transfer currency is outside the pilot boundary',
        control,
        false,
        false,
      );
    }
    if (!control.cohortCustomerIds.includes(command.customerId)) {
      return this.decision(
        'PILOT_COHORT_DENIED',
        'The customer is outside the internal pilot cohort',
        control,
        false,
        false,
      );
    }

    const amount = BigInt(command.amountMinor);
    if (amount < BigInt(control.minTransactionAmountMinor)) {
      return this.decision(
        'PILOT_AMOUNT_BELOW_MINIMUM',
        'The transfer amount is below the pilot minimum',
        control,
        false,
        false,
      );
    }
    if (amount > BigInt(control.maxTransactionAmountMinor)) {
      return this.decision(
        'PILOT_TRANSACTION_LIMIT_EXCEEDED',
        'The transfer amount exceeds the pilot transaction limit',
        control,
        false,
        false,
      );
    }
    if (control.dailyTransactionCountLimit !== null) {
      if (command.dailyTransactionCount === undefined) {
        return this.decision(
          'PILOT_USAGE_UNAVAILABLE',
          'Daily pilot transaction usage is unavailable',
          control,
          false,
          false,
        );
      }
      if (command.dailyTransactionCount + 1 > control.dailyTransactionCountLimit) {
        return this.decision(
          'PILOT_DAILY_COUNT_LIMIT_EXCEEDED',
          'The customer daily pilot transaction limit is exceeded',
          control,
          false,
          false,
        );
      }
    }
    if (control.dailyTransactionAmountMinor !== null) {
      if (command.dailyTransactionAmountMinor === undefined) {
        return this.decision(
          'PILOT_USAGE_UNAVAILABLE',
          'Daily pilot amount usage is unavailable',
          control,
          false,
          false,
        );
      }
      if (
        BigInt(command.dailyTransactionAmountMinor) + amount >
        BigInt(control.dailyTransactionAmountMinor)
      ) {
        return this.decision(
          'PILOT_DAILY_AMOUNT_LIMIT_EXCEEDED',
          'The customer daily pilot amount limit is exceeded',
          control,
          false,
          false,
        );
      }
    }

    const safetyDecision = await this.evaluateSafety(control);
    if (safetyDecision) return safetyDecision;
    return this.decision(
      'PILOT_ALLOWED',
      'The internal transfer pilot is enabled',
      control,
      true,
      false,
      true,
    );
  }

  private async evaluateSafety(control: PilotControl): Promise<PilotControlDecision | null> {
    const thresholds = this.toThresholds(control.safetyThresholds);
    const configured = Object.values(thresholds).some((value) => value !== undefined);
    if (!configured) return null;
    let metrics: Record<string, string>;
    try {
      metrics = (await this.metricsService.getMetrics()).metrics;
    } catch {
      return this.decision(
        'PILOT_SAFETY_SIGNAL_UNAVAILABLE',
        'Pilot safety signals are unavailable',
        control,
        false,
        false,
      );
    }
    const observed = {
      unknownOutcomeCount: this.metric(metrics, 'transfers.unknown'),
      reconciliationErrorCount: this.metric(metrics, 'reconciliation.errors'),
      outboxFailureCount: this.metric(metrics, 'outbox.failed'),
      authorizationFailureCount: this.metric(metrics, 'authorization.denied'),
    };
    for (const [thresholdKey, observedValue] of Object.entries(observed) as Array<
      [keyof PilotSafetyThresholds, number | null]
    >) {
      if (thresholds[thresholdKey] !== undefined && observedValue === null) {
        return this.decision(
          'PILOT_SAFETY_SIGNAL_UNAVAILABLE',
          `The configured pilot safety signal ${thresholdKey} is unavailable`,
          control,
          false,
          false,
        );
      }
    }
    const signals: PilotSafetySignals = {
      unknownOutcomeCount: observed.unknownOutcomeCount ?? 0,
      reconciliationErrorCount: observed.reconciliationErrorCount ?? 0,
      outboxFailureCount: observed.outboxFailureCount ?? 0,
      authorizationFailureCount: observed.authorizationFailureCount ?? 0,
    };
    const checks: Array<[number | undefined, number, string]> = [
      [thresholds.unknownOutcomeCount, signals.unknownOutcomeCount, 'unknown outcomes'],
      [
        thresholds.reconciliationErrorCount,
        signals.reconciliationErrorCount,
        'reconciliation errors',
      ],
      [thresholds.outboxFailureCount, signals.outboxFailureCount, 'outbox failures'],
      [
        thresholds.authorizationFailureCount,
        signals.authorizationFailureCount,
        'authorization failures',
      ],
    ];
    const breached = checks.find(
      ([threshold, observed]) => threshold !== undefined && observed >= threshold,
    );
    return breached
      ? this.decision(
          'PILOT_SAFETY_STOP',
          `A pilot safety threshold is breached: ${breached[2]}`,
          control,
          false,
          false,
        )
      : null;
  }

  private metric(metrics: Record<string, string>, name: string): number | null {
    if (metrics[name] === undefined) return null;
    const value = Number(metrics[name]);
    return Number.isFinite(value) && value >= 0 ? value : null;
  }

  private decision(
    code: PilotControlDecisionCode,
    message: string,
    control: PilotControl | null,
    allowed: boolean,
    emergencyStopped: boolean,
    cohortMember = false,
  ): PilotControlDecision {
    return {
      allowed,
      decisionCode: code,
      message,
      controlId: control?.id ?? null,
      controlKey: control?.controlKey ?? INTERNAL_TRANSFER_PILOT_CONTROL_KEY,
      controlVersion: control?.version ?? null,
      cohortMember,
      emergencyStopped,
      evaluatedAt: new Date().toISOString(),
    };
  }

  private async recordDecision(
    command: PilotControlEvaluationCommand,
    decision: PilotControlDecision,
  ): Promise<void> {
    try {
      await this.dataSource.transaction((manager: EntityManager) =>
        this.auditService.record(manager, {
          entityType: 'PILOT_CONTROL',
          entityId: decision.controlId ?? SYSTEM_ENTITY_ID,
          action: decision.allowed ? 'PILOT_ALLOWED' : 'PILOT_DENIED',
          actor: command.principal.principalId,
          correlationId: command.requestContext.correlationId,
          requestId: command.requestContext.requestId,
          newValues: {
            controlKey: decision.controlKey,
            controlVersion: decision.controlVersion,
            decisionCode: decision.decisionCode,
            allowed: decision.allowed,
            customerId: command.customerId,
            amountMinor: command.amountMinor,
            currency: command.currency,
            emergencyStopped: decision.emergencyStopped,
          },
        }),
      );
    } catch {
      throw new PilotControlUnavailableException('Pilot control decision audit is unavailable');
    }
  }

  private async configureWithinTransaction(
    manager: EntityManager,
    command: NormalizedPilotControlMutation,
    requestHash: string,
  ): Promise<PilotControlView> {
    const reservation = await this.idempotencyService.reserve(manager, {
      scope: PILOT_CONTROL_IDEMPOTENCY_SCOPE,
      key: command.idempotencyKey,
      requestHash,
      retentionSeconds: 86_400,
    });
    if (reservation.kind === 'IN_PROGRESS') {
      throw new ConflictException('The pilot control mutation is already in progress');
    }
    if (reservation.kind === 'REPLAY') {
      const controlId = reservation.record.resourceId;
      if (!controlId) throw new ConflictException('The pilot control replay is incomplete');
      const replayed = await manager
        .getRepository(PilotControl)
        .findOne({ where: { id: controlId } });
      if (!replayed) throw new ConflictException('The pilot control replay record is unavailable');
      return this.toView(replayed);
    }

    const repository = manager.getRepository(PilotControl);
    const existing = await repository.findOne({ where: { controlKey: command.controlKey } });
    const control = existing ?? repository.create({ id: randomUUID() });
    control.controlKey = command.controlKey;
    control.capability = command.capability;
    control.action = command.action;
    control.scope = command.scope;
    control.enabled = command.enabled;
    control.cohortCustomerIds = [...command.cohortCustomerIds];
    control.currency = command.currency;
    control.minTransactionAmountMinor = command.minTransactionAmountMinor;
    control.maxTransactionAmountMinor = command.maxTransactionAmountMinor;
    control.dailyTransactionCountLimit = command.dailyTransactionCountLimit;
    control.dailyTransactionAmountMinor = command.dailyTransactionAmountMinor;
    control.safetyThresholds = { ...command.safetyThresholds };
    control.updatedBy = command.principal.principalId;
    control.lastCorrelationId = command.requestContext.correlationId;
    control.lastRequestId = command.requestContext.requestId;
    const saved = await repository.save(control);
    const result = this.toView(saved);
    await this.auditService.record(manager, {
      entityType: 'PILOT_CONTROL',
      entityId: saved.id,
      action: command.enabled ? 'PILOT_ENABLED' : 'PILOT_DISABLED',
      actor: command.principal.principalId,
      correlationId: command.requestContext.correlationId,
      requestId: command.requestContext.requestId,
      newValues: {
        controlKey: saved.controlKey,
        enabled: saved.enabled,
        cohortCustomerCount: saved.cohortCustomerIds.length,
        currency: saved.currency,
        minTransactionAmountMinor: saved.minTransactionAmountMinor,
        maxTransactionAmountMinor: saved.maxTransactionAmountMinor,
        reason: command.reason,
      },
    });
    await this.idempotencyService.complete(manager, reservation.record.id, {
      statusCode: 200,
      responseBody: result as unknown as Record<string, unknown>,
      resourceType: 'PILOT_CONTROL',
      resourceId: saved.id,
    });
    return result;
  }

  private normalizeEvaluation(
    command: PilotControlEvaluationCommand,
  ): PilotControlEvaluationCommand {
    const customerId = this.normalizeUuid(command.customerId, 'customerId');
    if (
      command.capability !== 'wallet.transfer' ||
      command.action !== 'create' ||
      command.scope !== 'INTERNAL_CUSTOMER_TO_CUSTOMER'
    ) {
      throw new ConflictException('Pilot control command scope is not internal transfer');
    }
    const currency = normalizeCurrency(command.currency);
    const amountMinor = parsePositiveMinorUnits(command.amountMinor).toString();
    return { ...command, customerId, currency, amountMinor };
  }

  private normalizeMutation(command: PilotControlMutationCommand): NormalizedPilotControlMutation {
    const controlKey = this.normalizeText(command.controlKey, 'controlKey');
    if (
      controlKey !== INTERNAL_TRANSFER_PILOT_CONTROL_KEY ||
      command.capability !== 'wallet.transfer' ||
      command.action !== 'create' ||
      command.scope !== 'INTERNAL_CUSTOMER_TO_CUSTOMER'
    ) {
      throw new ConflictException('Pilot control is outside the internal transfer boundary');
    }
    const cohortCustomerIds = [
      ...new Set(command.cohortCustomerIds.map((id) => this.normalizeUuid(id, 'cohortCustomerId'))),
    ];
    const currency = normalizeCurrency(command.currency);
    const minAmount = parsePositiveMinorUnits(command.minTransactionAmountMinor).toString();
    const maxAmount = parsePositiveMinorUnits(command.maxTransactionAmountMinor).toString();
    if (BigInt(maxAmount) < BigInt(minAmount)) {
      throw new ConflictException('Pilot maximum transaction amount is below the minimum');
    }
    const dailyAmount =
      command.dailyTransactionAmountMinor == null
        ? null
        : parsePositiveMinorUnits(command.dailyTransactionAmountMinor).toString();
    if (
      command.dailyTransactionCountLimit !== undefined &&
      command.dailyTransactionCountLimit !== null &&
      (!Number.isSafeInteger(command.dailyTransactionCountLimit) ||
        command.dailyTransactionCountLimit < 1)
    ) {
      throw new ConflictException('Pilot daily transaction count limit is invalid');
    }
    const reason = this.normalizeText(command.reason, 'reason');
    const idempotencyKey = this.normalizeText(command.idempotencyKey, 'idempotencyKey');
    return {
      ...command,
      controlKey,
      cohortCustomerIds,
      currency,
      minTransactionAmountMinor: minAmount,
      maxTransactionAmountMinor: maxAmount,
      dailyTransactionAmountMinor: dailyAmount,
      dailyTransactionCountLimit: command.dailyTransactionCountLimit ?? null,
      safetyThresholds: this.normalizeThresholds(command.safetyThresholds),
      reason,
      idempotencyKey,
      requestContext: command.requestContext,
    };
  }

  private mutationRequestHash(command: NormalizedPilotControlMutation): string {
    return createHash('sha256')
      .update(
        JSON.stringify({
          controlKey: command.controlKey,
          capability: command.capability,
          action: command.action,
          scope: command.scope,
          enabled: command.enabled,
          cohortCustomerIds: [...command.cohortCustomerIds].sort(),
          currency: command.currency,
          minTransactionAmountMinor: command.minTransactionAmountMinor,
          maxTransactionAmountMinor: command.maxTransactionAmountMinor,
          dailyTransactionCountLimit: command.dailyTransactionCountLimit,
          dailyTransactionAmountMinor: command.dailyTransactionAmountMinor,
          safetyThresholds: command.safetyThresholds,
          reason: command.reason,
        }),
      )
      .digest('hex');
  }

  private normalizeThresholds(
    thresholds: PilotSafetyThresholds | undefined,
  ): PilotSafetyThresholds {
    const output: PilotSafetyThresholds = {};
    for (const key of [
      'unknownOutcomeCount',
      'reconciliationErrorCount',
      'outboxFailureCount',
      'authorizationFailureCount',
    ] as const) {
      const value = thresholds?.[key];
      if (value !== undefined) {
        if (!Number.isSafeInteger(value) || value < 1)
          throw new ConflictException(`Pilot safety threshold ${key} is invalid`);
        output[key] = value;
      }
    }
    return output;
  }

  private toThresholds(value: Record<string, unknown>): PilotSafetyThresholds {
    return this.normalizeThresholds({
      unknownOutcomeCount: this.optionalNumber(value.unknownOutcomeCount),
      reconciliationErrorCount: this.optionalNumber(value.reconciliationErrorCount),
      outboxFailureCount: this.optionalNumber(value.outboxFailureCount),
      authorizationFailureCount: this.optionalNumber(value.authorizationFailureCount),
    });
  }

  private optionalNumber(value: unknown): number | undefined {
    return typeof value === 'number' ? value : undefined;
  }

  private normalizeUuid(value: string, field: string): string {
    const normalized = value.trim().toLowerCase();
    if (!UUID_PATTERN.test(normalized)) throw new ConflictException(`${field} must be a UUID`);
    return normalized;
  }

  private normalizeText(value: string, field: string): string {
    const normalized = value.trim();
    if (!normalized || normalized.length > MAX_CONTEXT_LENGTH)
      throw new ConflictException(`${field} is invalid`);
    return normalized;
  }

  private toView(control: PilotControl): PilotControlView {
    return {
      id: control.id,
      controlKey: control.controlKey,
      capability: control.capability,
      action: control.action,
      scope: control.scope,
      enabled: control.enabled,
      cohortCustomerIds: [...control.cohortCustomerIds],
      currency: control.currency,
      minTransactionAmountMinor: control.minTransactionAmountMinor,
      maxTransactionAmountMinor: control.maxTransactionAmountMinor,
      dailyTransactionCountLimit: control.dailyTransactionCountLimit,
      dailyTransactionAmountMinor: control.dailyTransactionAmountMinor,
      safetyThresholds: this.toThresholds(control.safetyThresholds),
      version: control.version,
      updatedBy: control.updatedBy,
      lastCorrelationId: control.lastCorrelationId,
      lastRequestId: control.lastRequestId,
      updatedAt: control.updatedAt,
    };
  }
}

interface NormalizedPilotControlMutation
  extends Omit<
    PilotControlMutationCommand,
    | 'cohortCustomerIds'
    | 'currency'
    | 'minTransactionAmountMinor'
    | 'maxTransactionAmountMinor'
    | 'dailyTransactionAmountMinor'
    | 'dailyTransactionCountLimit'
    | 'safetyThresholds'
    | 'reason'
    | 'idempotencyKey'
  > {
  controlKey: string;
  cohortCustomerIds: string[];
  currency: string;
  minTransactionAmountMinor: string;
  maxTransactionAmountMinor: string;
  dailyTransactionCountLimit: number | null;
  dailyTransactionAmountMinor: string | null;
  safetyThresholds: PilotSafetyThresholds;
  reason: string;
  idempotencyKey: string;
}
