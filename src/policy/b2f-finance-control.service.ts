import { createHash, randomUUID } from 'node:crypto';
import { ConflictException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { EntityManager } from 'typeorm';
import { PrivilegedActionApprovalStatus } from '../authorization/privileged-action-approval.enums';
import { PrivilegedActionApprovalService } from '../authorization/privileged-action-approval.service';
import { AuditService } from '../operations/audit.service';
import { IdempotencyService } from '../operations/idempotency.service';
import { B2FFinanceControlDecision, B2FFinanceControlPolicy } from './b2f-finance-control.entity';
import type {
  B2FActionControlV1,
  B2FFinanceControlConsumerPortsV1,
  B2FFinanceControlDecisionV1,
  B2FFinanceControlEvaluationV1,
  B2FFinanceControlPolicyCommandV1,
  B2FFinanceControlPolicyDefinitionV1,
  B2FMaterialityBandV1,
} from './b2f-finance-control.types';
import { runSerializableWithRetry } from '../common/serializable-transaction';

const POLICY_SCOPE = 'b2.finance.control-policy.idempotency.v1',
  DECISION_SCOPE = 'b2.finance.control-decision.idempotency.v1',
  RETENTION = 86_400;
function stable(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stable(o[k])}`)
    .join(',')}}`;
}
function hash(v: unknown) {
  return createHash('sha256').update(stable(v)).digest('hex');
}
@Injectable()
export class B2FFinanceControlService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly idempotency: IdempotencyService,
    private readonly audit: AuditService,
    private readonly approvals: PrivilegedActionApprovalService,
  ) {}
  getConsumerPorts(): B2FFinanceControlConsumerPortsV1 {
    return {
      contractName: 'B2F-FINANCE-CONTROL',
      contractVersion: 1,
      evaluate: (r) => this.evaluate(r),
      getActivePolicy: () => this.getActivePolicy(),
    };
  }
  computePolicyHash(definition: B2FFinanceControlPolicyDefinitionV1) {
    return hash(definition);
  }
  computeActivationFingerprint(
    policyReference: string,
    policyKey: B2FFinanceControlPolicyDefinitionV1['policyKey'],
    policyVersion: number,
    definitionHash: string,
    effectiveFrom: string,
    effectiveTo: string | null,
    expectedRecordVersion: number,
  ) {
    return hash({
      action: 'FINANCE_CONTROL_POLICY_ACTIVATE',
      policyReference,
      policyKey,
      policyVersion,
      definitionHash,
      effectiveFrom: new Date(effectiveFrom).toISOString(),
      effectiveTo: effectiveTo ? new Date(effectiveTo).toISOString() : null,
      expectedRecordVersion,
    });
  }
  async createPolicy(command: B2FFinanceControlPolicyCommandV1) {
    this.validateDefinition(command.definition);
    const requestHash = hash({
      definition: command.definition,
      idempotencyKey: command.idempotencyKey,
    });
    return runSerializableWithRetry(
      this.dataSource,
      'B2FFinanceControlService.createPolicy',
      async (manager) => {
        const reservation = await this.idempotency.reserve(manager, {
          scope: POLICY_SCOPE,
          key: command.idempotencyKey,
          requestHash,
          retentionSeconds: RETENTION,
        });
        if (reservation.kind === 'REPLAY') return reservation.record.responseBody;
        const definitionHash = this.computePolicyHash(command.definition);
        const reference = `b2f-control-policy-${definitionHash.slice(0, 32)}`;
        const existing = await manager.getRepository(B2FFinanceControlPolicy).findOne({
          where: {
            policyKey: command.definition.policyKey,
            policyVersion: command.definition.policyVersion,
          },
        });
        if (existing) throw new ConflictException('Finance control policy version already exists');
        const now = command.now ?? new Date();
        const saved = await manager.getRepository(B2FFinanceControlPolicy).save(
          manager.getRepository(B2FFinanceControlPolicy).create({
            id: randomUUID(),
            policyReference: reference,
            policyKey: command.definition.policyKey,
            policyVersion: command.definition.policyVersion,
            status: 'DRAFT',
            definitionHash,
            definition: command.definition,
            effectiveFrom: new Date(command.definition.effectiveFrom),
            effectiveTo: command.definition.effectiveTo
              ? new Date(command.definition.effectiveTo)
              : null,
            createdBy: command.principal.principalId,
            approvalId: null,
            recordVersion: 1,
            createdAt: now,
            updatedAt: now,
          }),
        );
        await this.audit.record(manager, {
          entityType: 'B2F_FINANCE_CONTROL_POLICY',
          entityId: saved.id,
          action: 'FINANCE_CONTROL_POLICY_CREATED',
          actor: command.principal.principalId,
          correlationId: command.requestContext.correlationId,
          newValues: {
            policyReference: reference,
            policyVersion: saved.policyVersion,
            definitionHash,
          },
        });
        const response = {
          policyReference: reference,
          status: 'DRAFT',
          definitionHash,
          recordVersion: saved.recordVersion,
        };
        await this.idempotency.complete(manager, reservation.record.id, {
          statusCode: 201,
          responseBody: response,
          resourceType: 'B2F_FINANCE_CONTROL_POLICY',
          resourceId: saved.id,
        });
        return response;
      },
    );
  }
  async activatePolicy(input: {
    policyReference: string;
    expectedRecordVersion: number;
    approvalId: string;
    principal: B2FFinanceControlEvaluationV1['executorPrincipal'];
    idempotencyKey: string;
    requestContext: B2FFinanceControlEvaluationV1['requestContext'];
    now?: Date;
  }) {
    const requestHash = hash(input);
    return runSerializableWithRetry(
      this.dataSource,
      'B2FFinanceControlService.activatePolicy',
      async (manager) => {
        const reservation = await this.idempotency.reserve(manager, {
          scope: POLICY_SCOPE,
          key: input.idempotencyKey,
          requestHash,
          retentionSeconds: RETENTION,
        });
        if (reservation.kind === 'REPLAY') return reservation.record.responseBody;
        const repo = manager.getRepository(B2FFinanceControlPolicy);
        const policy = await repo
          .createQueryBuilder('policy')
          .where('policy.policy_reference = :reference', { reference: input.policyReference })
          .setLock('pessimistic_write')
          .getOne();
        if (
          !policy ||
          policy.status !== 'DRAFT' ||
          policy.recordVersion !== input.expectedRecordVersion
        )
          throw new ConflictException('Finance control policy state/version is invalid');
        const approval = await this.approvals.consumeInTransaction(manager, {
          principal: input.principal,
          approvalId: input.approvalId,
          actionType: 'FINANCE_CONTROL_POLICY_ACTIVATE',
          resource: { type: 'B2F_FINANCE_CONTROL_POLICY', id: policy.id },
          actionFingerprint: this.computeActivationFingerprint(
            policy.policyReference,
            policy.policyKey,
            policy.policyVersion,
            policy.definitionHash,
            policy.effectiveFrom.toISOString(),
            policy.effectiveTo?.toISOString() ?? null,
            input.expectedRecordVersion,
          ),
          now: input.now,
        });
        if (!approval.approved)
          throw new ConflictException(
            `Finance control policy approval rejected: ${approval.reason ?? 'unknown'}`,
          );
        const active = await repo.findOne({
          where: { policyKey: policy.policyKey, status: 'ACTIVE' },
        });
        if (active) {
          active.status = 'RETIRED';
          await repo.save(active);
        }
        policy.status = 'ACTIVE';
        policy.approvalId = input.approvalId;
        const saved = await repo.save(policy);
        await this.audit.record(manager, {
          entityType: 'B2F_FINANCE_CONTROL_POLICY',
          entityId: saved.id,
          action: 'FINANCE_CONTROL_POLICY_ACTIVATED',
          actor: input.principal.principalId,
          correlationId: input.requestContext.correlationId,
          newValues: {
            policyVersion: saved.policyVersion,
            definitionHash: saved.definitionHash,
            approvalId: input.approvalId,
          },
        });
        const response = {
          policyReference: saved.policyReference,
          status: saved.status,
          recordVersion: saved.recordVersion,
        };
        await this.idempotency.complete(manager, reservation.record.id, {
          statusCode: 200,
          responseBody: response,
          resourceType: 'B2F_FINANCE_CONTROL_POLICY',
          resourceId: saved.id,
        });
        return response;
      },
    );
  }
  async getActivePolicy(): Promise<B2FFinanceControlPolicyDefinitionV1 | null> {
    const now = new Date();
    const policy = await this.dataSource
      .getRepository(B2FFinanceControlPolicy)
      .findOne({ where: { policyKey: 'finance.control-policy.ng.primary', status: 'ACTIVE' } });
    if (!policy || policy.effectiveFrom > now || (policy.effectiveTo && policy.effectiveTo <= now))
      return null;
    return policy.definition;
  }
  async evaluate(request: B2FFinanceControlEvaluationV1): Promise<B2FFinanceControlDecisionV1> {
    return runSerializableWithRetry(
      this.dataSource,
      'B2FFinanceControlService.evaluate',
      (manager) => this.evaluateInTransaction(manager, request),
    );
  }

  /**
   * Transaction-aware variant of {@link evaluate}.
   *
   * Callers that already own a SERIALIZABLE transaction must use this method. Calling
   * {@link evaluate} from inside such a boundary opens a nested transaction on a second
   * pooled connection, which cannot observe the caller's uncommitted writes and yields
   * PostgreSQL serialization/atomicity failures.
   *
   * Control evaluation, segregation-of-duties enforcement and idempotency semantics are
   * identical to {@link evaluate}; only the transaction boundary differs.
   */
  async evaluateInTransaction(
    manager: EntityManager,
    request: B2FFinanceControlEvaluationV1,
  ): Promise<B2FFinanceControlDecisionV1> {
    const requestHash = hash({ ...request, evaluatedAt: undefined });
    const reservation = await this.idempotency.reserve(manager, {
      scope: DECISION_SCOPE,
      key: request.idempotencyKey,
      requestHash,
      retentionSeconds: RETENTION,
    });
    if (reservation.kind === 'REPLAY') {
      const original = reservation.record.responseBody as unknown as B2FFinanceControlDecisionV1;
      if (!original) throw new ConflictException('Finance control replay body missing');
      return { ...original, replayed: true };
    }
    const policy = await manager
      .getRepository(B2FFinanceControlPolicy)
      .findOne({ where: { policyKey: 'finance.control-policy.ng.primary', status: 'ACTIVE' } });
    const evaluatedAt = request.evaluatedAt ?? new Date();
    const reasons: string[] = [];
    let band: B2FMaterialityBandV1 | null = null;
    let control: B2FActionControlV1 | null = null;
    if (
      !policy ||
      policy.effectiveFrom > evaluatedAt ||
      (policy.effectiveTo && policy.effectiveTo <= evaluatedAt)
    )
      reasons.push('ACTIVE_CONTROL_POLICY_NOT_FOUND');
    else {
      control = policy.definition.actionControls.find((c) => c.action === request.action) ?? null;
      if (!control) reasons.push('ACTION_CONTROL_NOT_FOUND');
      const amount = this.parseAmount(request.amountMinor, reasons);
      if (control?.materialityApplies && amount !== null) {
        band =
          policy.definition.materialityBands.find(
            (b) =>
              amount >= BigInt(b.minimumMinor) &&
              (b.maximumMinor === null || amount <= BigInt(b.maximumMinor)),
          ) ?? null;
        if (!band) reasons.push('MATERIALITY_BAND_NOT_FOUND');
      }
      const approvals = [...request.approvals];
      const checkers = [
        ...new Set(approvals.map((a) => a.approvedBy).filter((v): v is string => !!v)),
      ];
      if (
        request.makerPrincipalId === request.executorPrincipal.principalId ||
        checkers.includes(request.makerPrincipalId)
      )
        reasons.push('SELF_APPROVAL_FORBIDDEN');
      if (!control?.makerRoles.some((role) => request.makerRoles.includes(role)))
        reasons.push('MAKER_ROLE_INSUFFICIENT');
      const requiredRoles = [
        ...new Set([...(control?.checkerRoles ?? []), ...(band?.requiredCheckerRoles ?? [])]),
      ];
      if (!requiredRoles.some((role) => request.executorPrincipal.roles.includes(role)))
        reasons.push('CHECKER_ROLE_INSUFFICIENT');
      const minimum = Math.max(control?.minimumApprovals ?? 1, band?.requiredApprovalCount ?? 0);
      if (checkers.length < minimum) reasons.push('APPROVAL_COUNT_INSUFFICIENT');
      if (
        approvals.some(
          (a) =>
            a.status !== PrivilegedActionApprovalStatus.CONSUMED ||
            a.resourceType !== request.resourceType ||
            a.resourceId !== request.resourceId ||
            a.approvedBy !== request.executorPrincipal.principalId,
        )
      )
        reasons.push('APPROVAL_STALE_OR_MISMATCHED');
      if (
        (control?.overrideEvidenceRequired || band?.overrideEvidenceRequired) &&
        !request.overrideEvidenceReference
      )
        reasons.push('OVERRIDE_EVIDENCE_REQUIRED');
    }
    const outcome: 'ALLOW' | 'DENY' = reasons.length ? 'DENY' : 'ALLOW';
    const policyKey = policy?.policyKey ?? 'finance.control-policy.ng.primary',
      policyVersion = policy?.policyVersion ?? 0;
    const decisionPayload = {
      outcome,
      action: request.action,
      materialityBand: band?.name ?? null,
      policyKey,
      policyVersion,
      makerPrincipalId: request.makerPrincipalId,
      checkerPrincipalIds: [
        ...new Set(request.approvals.map((a) => a.approvedBy).filter((v): v is string => !!v)),
      ].sort(),
      executorPrincipalId: request.executorPrincipal.principalId,
      approvalReferences: request.approvals.map((a) => a.id).sort(),
      resourceType: request.resourceType,
      resourceId: request.resourceId,
      resourceVersion: request.resourceVersion,
      resourceHash: request.resourceHash,
      requestHash,
      reasons: [...reasons].sort(),
      overrideEvidenceReference: request.overrideEvidenceReference ?? null,
      evaluatedAt: evaluatedAt.toISOString(),
    };
    const decisionHash = hash(decisionPayload);
    const decision: B2FFinanceControlDecisionV1 = {
      decisionReference: `b2f-control-decision-${decisionHash.slice(0, 32)}`,
      ...decisionPayload,
      decisionHash,
      replayed: false,
    };
    const saved = await manager.getRepository(B2FFinanceControlDecision).save(
      manager.getRepository(B2FFinanceControlDecision).create({
        id: randomUUID(),
        decisionReference: decision.decisionReference,
        outcome,
        action: request.action,
        materialityBand: decision.materialityBand,
        policyKey,
        policyVersion,
        resourceType: request.resourceType,
        resourceId: request.resourceId,
        requestHash,
        decisionHash,
        decision,
        createdAt: evaluatedAt,
      }),
    );
    await this.audit.record(manager, {
      entityType: 'B2F_FINANCE_CONTROL_DECISION',
      entityId: saved.id,
      action: outcome === 'ALLOW' ? 'FINANCE_CONTROL_ALLOWED' : 'FINANCE_CONTROL_DENIED',
      actor: request.executorPrincipal.principalId,
      correlationId: request.requestContext.correlationId,
      newValues: {
        decisionReference: decision.decisionReference,
        action: decision.action,
        materialityBand: decision.materialityBand,
        reasons: decision.reasons,
        resourceType: decision.resourceType,
        resourceId: decision.resourceId,
        policyVersion,
      },
    });
    await this.idempotency.complete(manager, reservation.record.id, {
      statusCode: outcome === 'ALLOW' ? 200 : 403,
      responseBody: decision as unknown as Record<string, unknown>,
      resourceType: 'B2F_FINANCE_CONTROL_DECISION',
      resourceId: saved.id,
    });
    return decision;
  }
  private parseAmount(value: string, reasons: string[]): bigint | null {
    if (!/^\d+$/.test(value)) {
      reasons.push('AMOUNT_INVALID');
      return null;
    }
    return BigInt(value);
  }
  private validateDefinition(d: B2FFinanceControlPolicyDefinitionV1) {
    if (
      d.policyKey !== 'finance.control-policy.ng.primary' ||
      !Number.isInteger(d.policyVersion) ||
      d.policyVersion < 1
    )
      throw new ConflictException('Invalid Finance control policy identity');
    if (
      d.materialityBands.length !== 3 ||
      new Set(d.materialityBands.map((b) => b.name)).size !== 3
    )
      throw new ConflictException('Exactly three unique materiality bands are required');
    const sorted = [...d.materialityBands].sort((a, b) =>
      Number(BigInt(a.minimumMinor) - BigInt(b.minimumMinor)),
    );
    if (sorted[0]?.minimumMinor !== '0')
      throw new ConflictException('Materiality bands must start at zero');
    for (let i = 0; i < sorted.length; i++) {
      const b = sorted[i]!;
      if (
        !/^\d+$/.test(b.minimumMinor) ||
        (b.maximumMinor !== null && !/^\d+$/.test(b.maximumMinor)) ||
        b.requiredApprovalCount < 1
      )
        throw new ConflictException('Invalid materiality band');
      if (i < sorted.length - 1) {
        if (
          b.maximumMinor === null ||
          BigInt(sorted[i + 1]!.minimumMinor) !== BigInt(b.maximumMinor) + 1n
        )
          throw new ConflictException('Materiality bands must be contiguous');
      } else if (b.maximumMinor !== null)
        throw new ConflictException('Final materiality band must be open-ended');
    }
    if (new Set(d.actionControls.map((c) => c.action)).size !== d.actionControls.length)
      throw new ConflictException('Duplicate action control');
  }
}
