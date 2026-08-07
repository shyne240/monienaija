import { createHash } from 'node:crypto';

import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';

import { AuthorizationService } from '../authorization/authorization.service';
import type {
  AuthorizationDecision,
  AuthorizationPolicy,
} from '../authorization/authorization.types';
import {
  normalizeAccountingUnit,
  normalizeCurrency,
  parsePositiveMinorUnits,
} from '../common/money';
import {
  PolicyCollectionStatus,
  PolicyDecisionState,
  PolicyEvidenceFreshnessState,
  PolicySourceClass,
} from '../policy/capability-policy.enums';
import { CapabilityPolicyEvaluationService } from '../policy/capability-policy.service';
import { PolicySourceEvidenceCoordinator } from '../policy/capability-policy-evidence.coordinator';
import type {
  PolicyDecisionResult,
  PolicyEvaluationCommand,
  PolicyEvidenceSnapshot,
  PolicyLimitOutput,
} from '../policy/capability-policy.types';
import type { PolicyEvidenceCollectionCommand } from '../policy/capability-policy-evidence.types';
import {
  PilotControlService,
  PilotControlUnavailableException,
} from '../pilot/pilot-control.service';
import type { PilotControlDecision } from '../pilot/pilot-control.types';
import type {
  CustomerFinancialAccountBindingAssertion,
  CustomerFinancialAccountBindingValidation,
  CustomerFinancialAccountBindingValidationFailureCode,
} from '../wallet/customer-financial-account-binding.types';
import {
  INTERNAL_TRANSFER_AUDIT_PORT,
  INTERNAL_TRANSFER_BINDING_PORT,
  INTERNAL_TRANSFER_GATE_IDEMPOTENCY_SCOPE,
  INTERNAL_TRANSFER_IDEMPOTENCY_PORT,
  INTERNAL_TRANSFER_POLICY_EVIDENCE_PROFILE,
  INTERNAL_TRANSFER_POLICY_IDEMPOTENCY_SCOPE,
  type InternalTransferBindingPort,
  type InternalTransferEvidenceCoordinatorPort,
  type InternalTransferGateAuditFact,
  type InternalTransferGateAuditPort,
  type InternalTransferGateCommand,
  type InternalTransferGateFailure,
  type InternalTransferGateFailureCode,
  type InternalTransferGateIdempotencyPort,
  type InternalTransferGateResult,
  type InternalTransferGateBindingView,
  type InternalTransferGatePolicyView,
  type InternalTransferPolicyContext,
  type NormalizedInternalTransferGateCommand,
  type InternalTransferPolicyEvaluationPort,
} from './internal-transfer-gate.types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH_PATTERN = /^[a-f0-9]{64}$/i;
const POLICY_KEY_PATTERN = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*){0,2}$/;
const MAX_TEXT_LENGTH = 255;
const TRANSFER_AUTHORIZATION_RESOURCE_TYPE = 'wallet-transfer-command';
const TRANSFER_AUTHORIZATION_ACTION = 'wallet:transfer:create';

export const INTERNAL_TRANSFER_AUTHORIZATION_POLICY_BASE: AuthorizationPolicy = {
  resourceType: TRANSFER_AUTHORIZATION_RESOURCE_TYPE,
  action: TRANSFER_AUTHORIZATION_ACTION,
};

export class InternalTransferGateException extends HttpException {
  constructor(readonly failure: InternalTransferGateFailure) {
    super({ code: failure.code, message: failure.message }, failure.statusCode);
  }
}

@Injectable()
export class InternalTransferGateService {
  constructor(
    private readonly authorizationService: AuthorizationService,
    private readonly pilotControlService: PilotControlService,
    @Inject(CapabilityPolicyEvaluationService)
    private readonly policyService: InternalTransferPolicyEvaluationPort,
    @Inject(PolicySourceEvidenceCoordinator)
    private readonly evidenceCoordinator: InternalTransferEvidenceCoordinatorPort,
    @Inject(INTERNAL_TRANSFER_BINDING_PORT)
    private readonly bindingPort: InternalTransferBindingPort,
    @Inject(INTERNAL_TRANSFER_IDEMPOTENCY_PORT)
    private readonly idempotencyPort: InternalTransferGateIdempotencyPort,
    @Inject(INTERNAL_TRANSFER_AUDIT_PORT)
    private readonly auditPort: InternalTransferGateAuditPort,
  ) {}

  async validate(command: InternalTransferGateCommand): Promise<InternalTransferGateResult> {
    const normalized = this.normalizeCommand(command);
    let authorization: AuthorizationDecision;
    try {
      authorization = await this.authorize(normalized);
    } catch (error) {
      const failure =
        error instanceof InternalTransferGateException
          ? error.failure
          : this.failure(
              'AUTHORIZATION_REQUIRED',
              'A2 authorization could not be established',
              HttpStatus.FORBIDDEN,
            );
      try {
        await this.recordAudit(normalized, failure);
      } catch {
        throw new InternalTransferGateException(
          this.failure(
            'OPERATIONS_EVIDENCE_UNAVAILABLE',
            'The authorization rejection audit fact could not be recorded',
            HttpStatus.SERVICE_UNAVAILABLE,
          ),
        );
      }
      throw new InternalTransferGateException(failure);
    }
    if (!authorization.allowed) {
      const failure = this.failure(
        'AUTHORIZATION_REQUIRED',
        `A2 authorization denied: ${authorization.reason ?? 'UNKNOWN'}`,
        HttpStatus.FORBIDDEN,
      );
      await this.recordAudit(normalized, failure);
      throw new InternalTransferGateException(failure);
    }

    let pilotDecision: PilotControlDecision;
    try {
      const usage = normalized.policy.limitUsage;
      pilotDecision = await this.pilotControlService.evaluate({
        customerId: normalized.sourceCustomerId,
        capability: normalized.capability,
        action: normalized.action,
        scope: normalized.scope,
        amountMinor: normalized.amountMinor,
        currency: normalized.currency,
        principal: normalized.principal,
        authorizationDecision: authorization,
        requestContext: {
          requestId: normalized.requestContext.requestId,
          correlationId: normalized.requestContext.correlationId,
          traceId: normalized.requestContext.traceId ?? normalized.requestContext.requestId,
        },
        ...(usage?.dailyUsedCount !== undefined
          ? { dailyTransactionCount: usage.dailyUsedCount }
          : {}),
        ...(usage?.dailyUsedAmountMinor !== undefined
          ? { dailyTransactionAmountMinor: usage.dailyUsedAmountMinor }
          : {}),
      });
    } catch (error) {
      if (error instanceof PilotControlUnavailableException) {
        const failure = this.failure(
          'PILOT_CONTROL_UNAVAILABLE',
          error.message,
          HttpStatus.SERVICE_UNAVAILABLE,
        );
        await this.recordAudit(normalized, failure);
        throw new InternalTransferGateException(failure);
      }
      const failure = this.failure(
        'PILOT_CONTROL_UNAVAILABLE',
        'Pilot control evaluation could not be established',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
      await this.recordAudit(normalized, failure);
      throw new InternalTransferGateException(failure);
    }
    if (!pilotDecision.allowed) {
      const failure = this.failure(
        pilotDecision.decisionCode,
        pilotDecision.message,
        HttpStatus.CONFLICT,
      );
      await this.recordAudit(normalized, failure, 'REJECTED', undefined, pilotDecision);
      throw new InternalTransferGateException(failure);
    }

    let reservation;
    try {
      reservation = await this.idempotencyPort.reserve({
        scope: INTERNAL_TRANSFER_GATE_IDEMPOTENCY_SCOPE,
        key: normalized.idempotencyKey,
        requestHash: normalized.requestHash,
      });
    } catch (error) {
      const failure = this.toIdempotencyFailure(error);
      await this.recordAudit(normalized, failure);
      throw new InternalTransferGateException(failure);
    }

    if (reservation.kind === 'IN_PROGRESS') {
      const failure = this.failure(
        'IDEMPOTENCY_IN_PROGRESS',
        'The internal transfer gate request is already in progress',
        HttpStatus.CONFLICT,
      );
      await this.recordAudit(normalized, failure);
      throw new InternalTransferGateException(failure);
    }
    if (reservation.kind === 'REPLAY') {
      if (reservation.result) {
        const replay = { ...reservation.result, replayed: true };
        try {
          await this.recordAudit(
            normalized,
            undefined,
            'REPLAYED',
            replay.policy,
            replay.pilotControl,
          );
        } catch (error) {
          throw new InternalTransferGateException(
            this.failure(
              'OPERATIONS_EVIDENCE_UNAVAILABLE',
              'The replay audit fact could not be recorded',
              HttpStatus.SERVICE_UNAVAILABLE,
              error,
            ),
          );
        }
        return replay;
      }
      const failure =
        reservation.failure ??
        this.failure(
          'OPERATIONS_EVIDENCE_UNAVAILABLE',
          'The idempotent gate result is unavailable',
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      await this.recordAudit(normalized, failure, 'REPLAYED');
      throw new InternalTransferGateException(failure);
    }

    try {
      const { policy, snapshot } = await this.evaluatePolicy(normalized, authorization);
      const sourceBinding = await this.validateBinding(normalized, 'source');
      const destinationBinding = await this.validateBinding(normalized, 'destination');
      const result: InternalTransferGateResult = {
        gateVersion: 1,
        status: 'PASSED',
        commandId: normalized.commandId,
        requestHash: normalized.requestHash,
        idempotencyScope: INTERNAL_TRANSFER_GATE_IDEMPOTENCY_SCOPE,
        idempotencyKey: normalized.idempotencyKey,
        replayed: false,
        sourceCustomerId: normalized.sourceCustomerId,
        destinationCustomerId: normalized.destinationCustomerId,
        sourceWalletAccountId: normalized.sourceWalletAccountId,
        destinationWalletAccountId: normalized.destinationWalletAccountId,
        sourceLedgerAccountId: normalized.sourceLedgerAccountId,
        destinationLedgerAccountId: normalized.destinationLedgerAccountId,
        amountMinor: normalized.amountMinor,
        currency: normalized.currency,
        accountingUnit: normalized.accountingUnit,
        a2Authorization: {
          allowed: true,
          principalType: authorization.principalType,
          principalId: authorization.principalId ?? normalized.principal.principalId,
          resourceType: authorization.resourceType,
          action: authorization.action,
          evaluatedAt: authorization.evaluatedAt.toISOString(),
        },
        pilotControl: pilotDecision,
        policy: this.policyView(policy, snapshot),
        sourceBinding,
        destinationBinding,
        requestContext: normalized.requestContext,
      };

      await this.recordAudit(normalized, undefined, 'PASSED', result.policy, pilotDecision);
      await this.idempotencyPort.complete(reservation.reservationId, result);
      return result;
    } catch (error) {
      const failure = this.toGateFailure(error);
      try {
        await this.idempotencyPort.fail(reservation.reservationId, failure);
      } catch {
        // The original gate failure remains authoritative; no financial effect is
        // possible from this service, and the caller must fail closed.
      }
      try {
        await this.recordAudit(normalized, failure);
      } catch {
        throw new InternalTransferGateException(
          this.failure(
            'OPERATIONS_EVIDENCE_UNAVAILABLE',
            'The gate rejection audit fact could not be recorded',
            HttpStatus.SERVICE_UNAVAILABLE,
          ),
        );
      }
      if (error instanceof InternalTransferGateException) {
        throw error;
      }
      throw new InternalTransferGateException(failure);
    }
  }

  private async authorize(
    command: NormalizedInternalTransferGateCommand,
  ): Promise<AuthorizationDecision> {
    try {
      return await this.authorizationService.authorize(
        command.principal,
        this.authorizationPolicy(command.principal),
        {
          type: TRANSFER_AUTHORIZATION_RESOURCE_TYPE,
          id: command.commandId,
          customerId: command.sourceCustomerId,
          scope: `${command.sourceWalletAccountId}:${command.destinationWalletAccountId}`,
        },
      );
    } catch (error) {
      throw new InternalTransferGateException(
        this.failure(
          'AUTHORIZATION_REQUIRED',
          'A2 authorization could not be established',
          HttpStatus.FORBIDDEN,
          error,
        ),
      );
    }
  }

  private authorizationPolicy(
    principal: InternalTransferGateCommand['principal'],
  ): AuthorizationPolicy {
    if (principal.type === 'CUSTOMER') {
      return {
        ...INTERNAL_TRANSFER_AUTHORIZATION_POLICY_BASE,
        allowedPrincipalTypes: ['CUSTOMER'],
        customerAccess: 'SELF',
      };
    }
    return {
      ...INTERNAL_TRANSFER_AUTHORIZATION_POLICY_BASE,
      requiredScopes: [TRANSFER_AUTHORIZATION_ACTION],
      allowedPrincipalTypes: ['SERVICE', 'OPERATOR', 'PRIVILEGED'],
      customerAccess: 'ASSIGNED',
    };
  }

  private async evaluatePolicy(
    command: NormalizedInternalTransferGateCommand,
    authorization: AuthorizationDecision,
  ): Promise<{ policy: PolicyDecisionResult; snapshot: PolicyEvidenceSnapshot }> {
    const evidenceProfile =
      command.policy.evidenceProfile ?? INTERNAL_TRANSFER_POLICY_EVIDENCE_PROFILE;
    if (evidenceProfile !== INTERNAL_TRANSFER_POLICY_EVIDENCE_PROFILE) {
      throw new InternalTransferGateException(
        this.failure(
          'POLICY_NOT_EXECUTABLE',
          'The transfer command uses an unapproved A4 evidence profile',
          HttpStatus.CONFLICT,
        ),
      );
    }

    const evaluationContext = {
      currency: command.currency,
      targetBindingId: command.sourceBindingId,
      ...(command.policy.limitUsage ? { limitUsage: command.policy.limitUsage } : {}),
    };
    const actorContext = {
      principal: command.principal,
      authorizationDecision: authorization,
    };
    const requestContext = {
      requestId: command.requestContext.requestId,
      correlationId: command.requestContext.correlationId,
      ...(command.requestContext.traceId ? { traceId: command.requestContext.traceId } : {}),
      ...(command.requestContext.causationId
        ? { causationId: command.requestContext.causationId }
        : {}),
    };
    const requestedAt = command.requestedAt;
    const evidenceCommand: PolicyEvidenceCollectionCommand = {
      customerId: command.sourceCustomerId,
      capability: command.capability,
      action: command.action,
      requestedAt,
      asOf: requestedAt,
      evidenceProfile,
      requiredSourceClasses: Object.values(PolicySourceClass),
      ...(command.policy.policyVersionHint
        ? { policyVersionHint: command.policy.policyVersionHint }
        : {}),
      evaluationContext,
      targetBindingId: command.sourceBindingId,
      actorContext,
      requestContext,
    };

    let snapshot: PolicyEvidenceSnapshot;
    try {
      snapshot = await this.evidenceCoordinator.collect(evidenceCommand);
    } catch (error) {
      throw new InternalTransferGateException(
        this.failure(
          'POLICY_NOT_EXECUTABLE',
          'A4 policy evidence could not be collected',
          HttpStatus.CONFLICT,
          error,
        ),
      );
    }

    const evaluationCommand: PolicyEvaluationCommand = {
      contractName: 'A4-CAPABILITY-POLICY',
      contractVersion: 1,
      subject: { type: 'CUSTOMER', customerId: command.sourceCustomerId },
      capability: command.capability,
      action: command.action,
      requestedAt,
      evaluationContext,
      actorContext,
      sourceEvidenceRequest: {
        evidenceProfile,
        asOf: requestedAt,
        requiredSourceClasses: Object.values(PolicySourceClass),
      },
      ...(command.policy.policyVersionHint
        ? { policyVersionHint: command.policy.policyVersionHint }
        : {}),
      requestContext,
      idempotencyContext: {
        scope: INTERNAL_TRANSFER_POLICY_IDEMPOTENCY_SCOPE,
        key: `a5-transfer:${command.commandId}`,
      },
      snapshot,
    };

    let policy: PolicyDecisionResult;
    try {
      policy = await this.policyService.evaluate(evaluationCommand);
    } catch (error) {
      if (error instanceof InternalTransferGateException) throw error;
      throw new InternalTransferGateException(
        this.failure(
          'POLICY_NOT_EXECUTABLE',
          'A4 policy evaluation did not produce an executable result',
          HttpStatus.CONFLICT,
          error,
        ),
      );
    }
    this.assertPolicyResult(command, policy, snapshot);
    return { policy, snapshot };
  }

  private assertPolicyResult(
    command: NormalizedInternalTransferGateCommand,
    result: PolicyDecisionResult,
    snapshot: PolicyEvidenceSnapshot,
  ): void {
    const bindingEvidence = snapshot.sourceItems.find(
      (item) =>
        item.sourceClass === PolicySourceClass.ACCOUNT_BINDING &&
        item.customerId === command.sourceCustomerId &&
        item.normalizedValue.bindingId === command.sourceBindingId,
    );
    if (
      !bindingEvidence ||
      bindingEvidence.normalizedValue.customerWalletId !== command.sourceCustomerWalletId ||
      bindingEvidence.normalizedValue.walletAccountId !== command.sourceWalletAccountId ||
      bindingEvidence.normalizedValue.ledgerAccountId !== command.sourceLedgerAccountId
    ) {
      throw new InternalTransferGateException(
        this.failure(
          'POLICY_NOT_EXECUTABLE',
          'The A4 account-binding evidence does not match the source command assertion',
          HttpStatus.CONFLICT,
        ),
      );
    }
    if (
      result.subject.type !== 'CUSTOMER' ||
      result.subject.customerId !== command.sourceCustomerId ||
      result.capability !== command.capability ||
      result.action !== command.action ||
      result.profileReference !== INTERNAL_TRANSFER_POLICY_EVIDENCE_PROFILE ||
      result.evidenceContext.snapshotReference !== snapshot.snapshotReference ||
      result.evidenceContext.normalizedInputHash !== snapshot.evidenceSummary.normalizedInputHash ||
      result.evidenceContext.collectionStatus !== PolicyCollectionStatus.COMPLETE ||
      result.evidenceContext.freshnessSummary.some(
        (state) => state !== PolicyEvidenceFreshnessState.CURRENT,
      )
    ) {
      throw new InternalTransferGateException(
        this.failure(
          'POLICY_NOT_EXECUTABLE',
          'The A4 policy result does not match the transfer command evidence scope',
          HttpStatus.CONFLICT,
        ),
      );
    }
    if (
      command.policy.expectedDecisionReference &&
      result.decisionReference !== command.policy.expectedDecisionReference
    ) {
      throw new InternalTransferGateException(
        this.failure(
          'POLICY_NOT_EXECUTABLE',
          'The A4 decision reference does not match the command assertion',
          HttpStatus.CONFLICT,
        ),
      );
    }
    if (
      command.policy.expectedProfileReference &&
      result.profileReference !== command.policy.expectedProfileReference
    ) {
      throw new InternalTransferGateException(
        this.failure(
          'POLICY_NOT_EXECUTABLE',
          'The A4 profile reference does not match the command assertion',
          HttpStatus.CONFLICT,
        ),
      );
    }
    if (
      command.policy.expectedProfileVersion !== undefined &&
      result.profileVersion !== command.policy.expectedProfileVersion
    ) {
      throw new InternalTransferGateException(
        this.failure(
          'POLICY_NOT_EXECUTABLE',
          'The A4 profile version does not match the command assertion',
          HttpStatus.CONFLICT,
        ),
      );
    }
    if (
      command.policy.policyVersionHint &&
      result.policyVersion !== command.policy.policyVersionHint
    ) {
      throw new InternalTransferGateException(
        this.failure(
          'POLICY_NOT_EXECUTABLE',
          'The A4 policy version does not match the command assertion',
          HttpStatus.CONFLICT,
        ),
      );
    }
    if (
      command.policy.expectedEvidenceSnapshotReference &&
      result.evidenceContext.snapshotReference !== command.policy.expectedEvidenceSnapshotReference
    ) {
      throw new InternalTransferGateException(
        this.failure(
          'POLICY_NOT_EXECUTABLE',
          'The A4 evidence snapshot reference does not match the command assertion',
          HttpStatus.CONFLICT,
        ),
      );
    }
    if (
      command.policy.expectedNormalizedInputHash &&
      result.evidenceContext.normalizedInputHash !== command.policy.expectedNormalizedInputHash
    ) {
      throw new InternalTransferGateException(
        this.failure(
          'POLICY_NOT_EXECUTABLE',
          'The A4 normalized evidence hash does not match the command assertion',
          HttpStatus.CONFLICT,
        ),
      );
    }
    if (
      result.decision !== PolicyDecisionState.ALLOW &&
      result.decision !== PolicyDecisionState.ALLOW_WITH_LIMITS
    ) {
      throw new InternalTransferGateException(
        this.failure(
          'POLICY_NOT_EXECUTABLE',
          `A4 policy decision ${result.decision} is not executable`,
          HttpStatus.CONFLICT,
        ),
      );
    }
    const now = Date.now();
    const expiresAt = result.expiresAt ? Date.parse(result.expiresAt) : Number.NaN;
    if (!Number.isFinite(expiresAt) || expiresAt <= now) {
      throw new InternalTransferGateException(
        this.failure(
          'POLICY_NOT_EXECUTABLE',
          'The A4 policy result is expired',
          HttpStatus.CONFLICT,
        ),
      );
    }
    const reviewAt = result.reviewAt ? Date.parse(result.reviewAt) : null;
    if (reviewAt !== null && (!Number.isFinite(reviewAt) || reviewAt <= now)) {
      throw new InternalTransferGateException(
        this.failure(
          'POLICY_NOT_EXECUTABLE',
          'The A4 policy result requires review',
          HttpStatus.CONFLICT,
        ),
      );
    }

    const requiredObligations = new Set(
      result.obligations
        .filter((obligation) => obligation.required)
        .map((obligation) => obligation.code),
    );
    if (
      !requiredObligations.has('RECHECK_A2_AUTHORIZATION') ||
      !requiredObligations.has('RECHECK_A3_BINDING')
    ) {
      throw new InternalTransferGateException(
        this.failure(
          'POLICY_NOT_EXECUTABLE',
          'The A4 policy result does not carry required downstream recheck obligations',
          HttpStatus.CONFLICT,
        ),
      );
    }
    if (result.decision === PolicyDecisionState.ALLOW_WITH_LIMITS) {
      this.assertSingleTransactionLimit(result.limits, command.amountMinor, command.currency);
    }
  }

  private assertSingleTransactionLimit(
    limits: readonly PolicyLimitOutput[],
    amountMinor: string,
    currency: string,
  ): void {
    const limit = limits.find((candidate) => candidate.type === 'SINGLE_TRANSACTION_AMOUNT');
    if (
      !limit ||
      limit.currency !== currency ||
      typeof limit.amountMinor !== 'string' ||
      !/^\d+$/.test(limit.amountMinor) ||
      BigInt(limit.amountMinor) < BigInt(amountMinor)
    ) {
      throw new InternalTransferGateException(
        this.failure(
          'POLICY_NOT_EXECUTABLE',
          'The A4 single-transaction limit is missing or incompatible',
          HttpStatus.CONFLICT,
        ),
      );
    }
  }

  private async validateBinding(
    command: NormalizedInternalTransferGateCommand,
    side: 'source' | 'destination',
  ): Promise<InternalTransferGateBindingView> {
    const assertion: CustomerFinancialAccountBindingAssertion = {
      customerId: side === 'source' ? command.sourceCustomerId : command.destinationCustomerId,
      customerWalletId:
        side === 'source' ? command.sourceCustomerWalletId : command.destinationCustomerWalletId,
      bindingId: side === 'source' ? command.sourceBindingId : command.destinationBindingId,
      walletAccountId:
        side === 'source' ? command.sourceWalletAccountId : command.destinationWalletAccountId,
      ledgerAccountId:
        side === 'source' ? command.sourceLedgerAccountId : command.destinationLedgerAccountId,
      expectedCurrency: command.currency,
      expectedAccountingUnit: command.accountingUnit,
      expectedBindingVersion:
        side === 'source' ? command.sourceBindingVersion : command.destinationBindingVersion,
    };

    let validation: CustomerFinancialAccountBindingValidation;
    try {
      validation = await this.bindingPort.validateActiveBinding(assertion);
    } catch (error) {
      throw new InternalTransferGateException(
        this.failure(
          'BINDING_NOT_ACTIVE',
          `The ${side} customer financial-account binding could not be validated`,
          HttpStatus.CONFLICT,
          error,
        ),
      );
    }
    if (!validation.valid) {
      throw new InternalTransferGateException(
        this.failure(
          this.mapBindingFailure(validation.code),
          validation.message,
          HttpStatus.CONFLICT,
        ),
      );
    }
    if (
      validation.customerId !== assertion.customerId ||
      validation.customerWalletId !== assertion.customerWalletId ||
      validation.walletAccountId !== assertion.walletAccountId ||
      validation.ledgerAccountId !== assertion.ledgerAccountId ||
      validation.currency !== command.currency ||
      validation.accountingUnit !== command.accountingUnit ||
      validation.bindingId !== assertion.bindingId
    ) {
      throw new InternalTransferGateException(
        this.failure(
          'IDENTITY_MISMATCH',
          `The ${side} binding validation result does not match the command assertion`,
          HttpStatus.CONFLICT,
        ),
      );
    }
    if (validation.bindingVersion < 1) {
      throw new InternalTransferGateException(
        this.failure(
          'BINDING_NOT_ACTIVE',
          `The ${side} binding version is invalid`,
          HttpStatus.CONFLICT,
        ),
      );
    }
    return {
      bindingId: validation.bindingId,
      customerId: validation.customerId,
      customerWalletId: validation.customerWalletId,
      walletAccountId: validation.walletAccountId,
      ledgerAccountId: validation.ledgerAccountId,
      bindingVersion: validation.bindingVersion,
      currency: validation.currency,
      accountingUnit: validation.accountingUnit,
    };
  }

  private mapBindingFailure(
    code: CustomerFinancialAccountBindingValidationFailureCode,
  ): InternalTransferGateFailureCode {
    switch (code) {
      case 'IDENTITY_MISMATCH':
        return 'IDENTITY_MISMATCH';
      case 'ACCOUNT_DIMENSION_MISMATCH':
        return 'ACCOUNT_DIMENSION_MISMATCH';
      case 'WALLET_ACCOUNT_NOT_ACTIVE':
      case 'LEDGER_ACCOUNT_NOT_ACTIVE':
        return 'ACCOUNT_NOT_ACTIVE';
      default:
        return 'BINDING_NOT_ACTIVE';
    }
  }

  private policyView(
    policy: PolicyDecisionResult,
    snapshot: PolicyEvidenceSnapshot,
  ): InternalTransferGatePolicyView {
    return {
      decision: policy.decision,
      decisionReference: policy.decisionReference,
      profileReference: policy.profileReference,
      profileVersion: policy.profileVersion,
      policyVersion: policy.policyVersion,
      evidenceSnapshotReference: snapshot.snapshotReference,
      normalizedInputHash: snapshot.evidenceSummary.normalizedInputHash,
      expiresAt: policy.expiresAt,
      reviewAt: policy.reviewAt,
      obligations: policy.obligations.map((obligation) => ({
        obligationCode: obligation.code,
        required: obligation.required,
        ...(obligation.dueAt ? { dueAt: obligation.dueAt } : {}),
        ...(obligation.expiresAt ? { expiresAt: obligation.expiresAt } : {}),
        ...(obligation.reference ? { reference: obligation.reference } : {}),
      })),
      limits: policy.limits,
    };
  }

  private normalizeCommand(
    command: InternalTransferGateCommand,
  ): NormalizedInternalTransferGateCommand {
    if (!command || typeof command !== 'object') {
      throw new InternalTransferGateException(
        this.failure('COMMAND_INVALID', 'The transfer command is required', 400),
      );
    }
    if (!command.requestContext || typeof command.requestContext !== 'object') {
      throw new InternalTransferGateException(
        this.failure('COMMAND_INVALID', 'The transfer request context is required', 400),
      );
    }
    if (!command.principal || typeof command.principal !== 'object') {
      throw new InternalTransferGateException(
        this.failure(
          'AUTHORIZATION_REQUIRED',
          'The A2 principal is required',
          HttpStatus.FORBIDDEN,
        ),
      );
    }
    if (command.contractVersion !== 1) {
      throw new InternalTransferGateException(
        this.failure(
          'COMMAND_INVALID',
          'The transfer command contract version is unsupported',
          400,
        ),
      );
    }
    if (command.commandType !== 'INTERNAL_TRANSFER') {
      throw new InternalTransferGateException(
        this.failure('COMMAND_INVALID', 'The transfer command type is unsupported', 400),
      );
    }
    if (command.capability !== 'wallet.transfer' || command.action !== 'create') {
      throw new InternalTransferGateException(
        this.failure(
          'CAPABILITY_ACTION_UNSUPPORTED',
          'The command is outside the A5 transfer scope',
          400,
        ),
      );
    }
    if (command.scope !== 'INTERNAL_CUSTOMER_TO_CUSTOMER') {
      throw new InternalTransferGateException(
        this.failure(
          'CAPABILITY_ACTION_UNSUPPORTED',
          'The command scope is not internal transfer',
          400,
        ),
      );
    }

    const sourceCustomerId = this.uuid(command.sourceCustomerId, 'sourceCustomerId');
    const destinationCustomerId = this.uuid(command.destinationCustomerId, 'destinationCustomerId');
    const sourceCustomerWalletId = this.uuid(
      command.sourceCustomerWalletId,
      'sourceCustomerWalletId',
    );
    const destinationCustomerWalletId = this.uuid(
      command.destinationCustomerWalletId,
      'destinationCustomerWalletId',
    );
    const sourceBindingId = this.uuid(command.sourceBindingId, 'sourceBindingId');
    const destinationBindingId = this.uuid(command.destinationBindingId, 'destinationBindingId');
    const sourceWalletAccountId = this.uuid(command.sourceWalletAccountId, 'sourceWalletAccountId');
    const destinationWalletAccountId = this.uuid(
      command.destinationWalletAccountId,
      'destinationWalletAccountId',
    );
    const sourceLedgerAccountId = this.uuid(command.sourceLedgerAccountId, 'sourceLedgerAccountId');
    const destinationLedgerAccountId = this.uuid(
      command.destinationLedgerAccountId,
      'destinationLedgerAccountId',
    );
    const commandId = this.uuid(command.commandId, 'commandId');
    if (sourceCustomerId === destinationCustomerId) {
      throw new InternalTransferGateException(
        this.failure('SELF_TRANSFER', 'Source and destination customers must differ', 400),
      );
    }
    if (sourceWalletAccountId === destinationWalletAccountId) {
      throw new InternalTransferGateException(
        this.failure('SELF_TRANSFER', 'Source and destination wallet accounts must differ', 400),
      );
    }
    if (sourceLedgerAccountId === destinationLedgerAccountId) {
      throw new InternalTransferGateException(
        this.failure('SELF_TRANSFER', 'Source and destination Ledger accounts must differ', 400),
      );
    }

    let amountMinor: string;
    try {
      amountMinor = parsePositiveMinorUnits(command.amountMinor).toString();
    } catch {
      throw new InternalTransferGateException(
        this.failure(
          'AMOUNT_INVALID',
          'amountMinor must be a positive integer minor-unit value',
          400,
        ),
      );
    }
    let currency: string;
    try {
      currency = normalizeCurrency(command.currency);
    } catch {
      throw new InternalTransferGateException(
        this.failure('CURRENCY_INVALID', 'currency must be an explicit three-letter code', 400),
      );
    }
    if (typeof command.accountingUnit !== 'string' || command.accountingUnit.trim().length === 0) {
      throw new InternalTransferGateException(
        this.failure('ACCOUNTING_UNIT_MISMATCH', 'accountingUnit is required', 400),
      );
    }
    let accountingUnit: string;
    try {
      accountingUnit = normalizeAccountingUnit(command.accountingUnit);
    } catch {
      throw new InternalTransferGateException(
        this.failure('ACCOUNTING_UNIT_MISMATCH', 'accountingUnit is invalid', 400),
      );
    }
    if (accountingUnit !== 'CUSTOMER_FUNDS') {
      throw new InternalTransferGateException(
        this.failure('ACCOUNTING_UNIT_MISMATCH', 'accountingUnit must be CUSTOMER_FUNDS', 400),
      );
    }

    const policy = command.policy ?? {};
    const requestedAt = this.timestamp(command.requestedAt, 'requestedAt');
    const idempotencyKey = this.text(command.idempotencyKey, 'idempotencyKey');
    const authorizationContextReference = this.text(
      command.authorizationContextReference,
      'authorizationContextReference',
    );
    const requestContext = {
      requestId: this.text(command.requestContext.requestId, 'requestId'),
      correlationId: this.text(command.requestContext.correlationId, 'correlationId'),
      ...(command.requestContext.traceId
        ? { traceId: this.text(command.requestContext.traceId, 'traceId') }
        : {}),
      ...(command.requestContext.causationId
        ? { causationId: this.text(command.requestContext.causationId, 'causationId') }
        : {}),
    };
    const sourceBindingVersion = this.version(command.sourceBindingVersion, 'sourceBindingVersion');
    const destinationBindingVersion = this.version(
      command.destinationBindingVersion,
      'destinationBindingVersion',
    );
    if (sourceBindingVersion === null || destinationBindingVersion === null) {
      throw new InternalTransferGateException(
        this.failure('COMMAND_INVALID', 'Both binding versions are required', 400),
      );
    }
    const reference = this.optionalText(command.reference, 'reference');
    const narration = this.optionalText(command.narration, 'narration');
    const normalizedPolicy = this.normalizePolicyContext(policy);

    const withoutHash = {
      ...command,
      contractVersion: 1 as const,
      commandType: 'INTERNAL_TRANSFER' as const,
      commandId,
      sourceCustomerId,
      destinationCustomerId,
      sourceCustomerWalletId,
      destinationCustomerWalletId,
      sourceBindingId,
      destinationBindingId,
      sourceWalletAccountId,
      destinationWalletAccountId,
      sourceLedgerAccountId,
      destinationLedgerAccountId,
      sourceBindingVersion,
      destinationBindingVersion,
      amountMinor,
      currency,
      accountingUnit: accountingUnit as 'CUSTOMER_FUNDS',
      reference,
      narration,
      authorizationContextReference,
      policy: normalizedPolicy,
      requestContext,
      requestedAt,
      idempotencyKey,
    };
    const requestHash = this.requestHash(withoutHash);
    return { ...withoutHash, requestHash } as NormalizedInternalTransferGateCommand;
  }

  private normalizePolicyContext(
    policy: InternalTransferPolicyContext,
  ): InternalTransferPolicyContext {
    const normalized: InternalTransferPolicyContext = {
      ...(policy.evidenceProfile
        ? { evidenceProfile: this.policyKey(policy.evidenceProfile, 'evidenceProfile') }
        : {}),
      ...(policy.policyVersionHint
        ? { policyVersionHint: this.text(policy.policyVersionHint, 'policyVersionHint') }
        : {}),
      ...(policy.expectedDecisionReference
        ? {
            expectedDecisionReference: this.text(
              policy.expectedDecisionReference,
              'decisionReference',
            ),
          }
        : {}),
      ...(policy.expectedProfileReference
        ? {
            expectedProfileReference: this.text(
              policy.expectedProfileReference,
              'profileReference',
            ),
          }
        : {}),
      ...(policy.expectedProfileVersion !== undefined
        ? { expectedProfileVersion: this.version(policy.expectedProfileVersion, 'profileVersion')! }
        : {}),
      ...(policy.expectedEvidenceSnapshotReference
        ? {
            expectedEvidenceSnapshotReference: this.text(
              policy.expectedEvidenceSnapshotReference,
              'evidenceSnapshotReference',
            ),
          }
        : {}),
      ...(policy.expectedNormalizedInputHash
        ? {
            expectedNormalizedInputHash: this.hash(
              policy.expectedNormalizedInputHash,
              'normalizedInputHash',
            ),
          }
        : {}),
      ...(policy.limitUsage ? { limitUsage: policy.limitUsage } : {}),
    };
    return normalized;
  }

  private requestHash(command: Record<string, unknown>): string {
    const hashMaterial = {
      contractVersion: command.contractVersion,
      commandType: command.commandType,
      capability: command.capability,
      action: command.action,
      scope: command.scope,
      sourceCustomerId: command.sourceCustomerId,
      destinationCustomerId: command.destinationCustomerId,
      sourceCustomerWalletId: command.sourceCustomerWalletId,
      destinationCustomerWalletId: command.destinationCustomerWalletId,
      sourceBindingId: command.sourceBindingId,
      destinationBindingId: command.destinationBindingId,
      sourceWalletAccountId: command.sourceWalletAccountId,
      destinationWalletAccountId: command.destinationWalletAccountId,
      sourceLedgerAccountId: command.sourceLedgerAccountId,
      destinationLedgerAccountId: command.destinationLedgerAccountId,
      sourceBindingVersion: command.sourceBindingVersion ?? null,
      destinationBindingVersion: command.destinationBindingVersion ?? null,
      amountMinor: command.amountMinor,
      currency: command.currency,
      accountingUnit: command.accountingUnit,
      reference: command.reference ?? null,
      narration: command.narration ?? null,
      requestedAt: command.requestedAt,
      policy: command.policy,
    };
    return createHash('sha256').update(this.canonicalJson(hashMaterial)).digest('hex');
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

  private policyKey(value: unknown, field: string): string {
    const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
    if (!POLICY_KEY_PATTERN.test(normalized)) {
      throw new InternalTransferGateException(
        this.failure('COMMAND_INVALID', `${field} is invalid`, 400),
      );
    }
    return normalized;
  }

  private uuid(value: unknown, field: string): string {
    const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
    if (!UUID_PATTERN.test(normalized)) {
      throw new InternalTransferGateException(
        this.failure('IDENTITY_INVALID', `${field} must be a UUID`, 400),
      );
    }
    return normalized;
  }

  private timestamp(value: unknown, field: string): string {
    const parsed = new Date(typeof value === 'string' ? value : '');
    if (Number.isNaN(parsed.getTime())) {
      throw new InternalTransferGateException(
        this.failure('COMMAND_INVALID', `${field} must be a valid timestamp`, 400),
      );
    }
    return parsed.toISOString();
  }

  private text(value: unknown, field: string): string {
    const normalized = typeof value === 'string' ? value.trim() : '';
    if (!normalized || normalized.length > MAX_TEXT_LENGTH || !/^[\x20-\x7E]+$/.test(normalized)) {
      throw new InternalTransferGateException(
        this.failure('COMMAND_INVALID', `${field} is invalid`, 400),
      );
    }
    return normalized;
  }

  private optionalText(value: unknown, field: string): string | null {
    if (value === undefined || value === null) return null;
    if (typeof value !== 'string' || value.trim().length === 0) return null;
    return this.text(value, field);
  }

  private version(value: number | undefined, field: string): number | null {
    if (value === undefined) return null;
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new InternalTransferGateException(
        this.failure('COMMAND_INVALID', `${field} must be a positive integer`, 400),
      );
    }
    return value;
  }

  private hash(value: unknown, field: string): string {
    const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
    if (!HASH_PATTERN.test(normalized)) {
      throw new InternalTransferGateException(
        this.failure('COMMAND_INVALID', `${field} must be a SHA-256 hash`, 400),
      );
    }
    return normalized;
  }

  private async recordAudit(
    command: NormalizedInternalTransferGateCommand,
    failure?: InternalTransferGateFailure,
    action: InternalTransferGateAuditFact['action'] = 'REJECTED',
    policy?: InternalTransferGatePolicyView,
    pilot?: PilotControlDecision,
  ): Promise<void> {
    await this.auditPort.record({
      action,
      commandId: command.commandId,
      actor: command.principal.principalId,
      sourceCustomerId: command.sourceCustomerId,
      destinationCustomerId: command.destinationCustomerId,
      sourceBindingId: command.sourceBindingId,
      destinationBindingId: command.destinationBindingId,
      requestHash: command.requestHash,
      correlationId: command.requestContext.correlationId,
      requestId: command.requestContext.requestId,
      ...(policy?.decisionReference ? { policyDecisionReference: policy.decisionReference } : {}),
      ...(policy?.policyVersion ? { policyVersion: policy.policyVersion } : {}),
      ...(pilot ? { pilotControlKey: pilot.controlKey } : {}),
      ...(pilot ? { pilotControlVersion: pilot.controlVersion } : {}),
      ...(pilot ? { pilotDecisionCode: pilot.decisionCode } : {}),
      ...(failure?.code ? { failureCode: failure.code } : {}),
    });
  }

  private toGateFailure(error: unknown): InternalTransferGateFailure {
    if (error instanceof InternalTransferGateException) return error.failure;
    return this.failure(
      'OPERATIONS_EVIDENCE_UNAVAILABLE',
      'The transfer gate could not establish a deterministic result',
      HttpStatus.SERVICE_UNAVAILABLE,
      error,
    );
  }

  private toIdempotencyFailure(error: unknown): InternalTransferGateFailure {
    if (error instanceof InternalTransferGateException) return error.failure;
    if (error instanceof HttpException && error.getStatus() === 409) {
      return this.failure(
        'IDEMPOTENCY_KEY_CONFLICT',
        'The idempotency key was already used for another transfer command',
        HttpStatus.CONFLICT,
        error,
      );
    }
    return this.failure(
      'OPERATIONS_EVIDENCE_UNAVAILABLE',
      'The transfer gate idempotency record could not be established',
      HttpStatus.SERVICE_UNAVAILABLE,
      error,
    );
  }

  private failure(
    code: InternalTransferGateFailureCode,
    message: string,
    statusCode: number,
    cause?: unknown,
  ): InternalTransferGateFailure {
    void cause;
    return { code, message, statusCode };
  }
}
