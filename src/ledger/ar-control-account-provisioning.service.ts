import { createHash } from 'node:crypto';
import { ConflictException, Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import type { DataSource } from 'typeorm';
import { PrivilegedActionApprovalService } from '../authorization/privileged-action-approval.service';
import { AuditService } from '../operations/audit.service';
import { IdempotencyService } from '../operations/idempotency.service';
import { MetricsService } from '../operations/metrics.service';
import { OutboxService } from '../operations/outbox.service';
import { B2FFinanceControlService } from '../policy/b2f-finance-control.service';
import type {
  A5ArControlAccountDefinitionV1,
  A5ArControlAccountEvidenceV1,
  A5ArControlAccountProvisionCommandV1,
  A5ArControlAccountProvisionResultV1,
} from './ar-control-account-provisioning.types';
import { LedgerAccountType, LedgerNormalBalance } from './ledger.enums';
import { LedgerService } from './ledger.service';

const IDEMPOTENCY_SCOPE = 'a5.ar-control-account.provision.idempotency.v1';
const RETENTION_SECONDS = 86_400;
const RESOURCE_TYPE = 'A5_AR_CONTROL_ACCOUNT_PROVISION';
const ACTION = 'FINANCE_A5_AR_ACCOUNT_PROVISION';
const AUTHORIZED: A5ArControlAccountDefinitionV1 = Object.freeze({
  code: 'FINANCE-ACCOUNTS_RECEIVABLE-NGN',
  name: 'Finance accounts receivable control NGN',
  accountType: LedgerAccountType.ASSET,
  normalBalance: LedgerNormalBalance.DEBIT,
  currency: 'NGN',
  accountingUnit: 'CUSTOMER_FUNDS',
  allowNegativeBalance: false,
});
function stable(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stable(object[key])}`)
    .join(',')}}`;
}
function sha(value: unknown): string {
  return createHash('sha256').update(stable(value)).digest('hex');
}
export class A5ArProvisioningOutcomeUnknownError extends Error {
  constructor() {
    super('A5 AR control-account provisioning outcome is unknown; verify before retry');
    this.name = 'A5ArProvisioningOutcomeUnknownError';
  }
}
@Injectable()
export class A5ArControlAccountProvisioningService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly ledgerService: LedgerService,
    private readonly idempotencyService: IdempotencyService,
    private readonly approvalService: PrivilegedActionApprovalService,
    private readonly financeControlService: B2FFinanceControlService,
    private readonly auditService: AuditService,
    private readonly outboxService: OutboxService,
    private readonly metricsService: MetricsService,
  ) {}
  getAuthorizedDefinition(): A5ArControlAccountDefinitionV1 {
    return { ...AUTHORIZED };
  }
  computeDefinitionHash(definition: A5ArControlAccountDefinitionV1): string {
    return sha(definition);
  }
  computeRequestHash(command: A5ArControlAccountProvisionCommandV1): string {
    return sha({ definition: command.definition, idempotencyKey: command.idempotencyKey });
  }
  computeApprovalFingerprint(command: A5ArControlAccountProvisionCommandV1): string {
    return sha({
      action: ACTION,
      resourceType: RESOURCE_TYPE,
      resourceId: AUTHORIZED.code,
      definition: command.definition,
      definitionHash: this.computeDefinitionHash(command.definition),
    });
  }
  async provision(
    command: A5ArControlAccountProvisionCommandV1,
  ): Promise<A5ArControlAccountProvisionResultV1> {
    const requestHash = this.computeRequestHash(command);
    return this.dataSource.transaction('SERIALIZABLE', async (manager) => {
      const reservation = await this.idempotencyService.reserve(manager, {
        scope: IDEMPOTENCY_SCOPE,
        key: command.idempotencyKey,
        requestHash,
        retentionSeconds: RETENTION_SECONDS,
      });
      if (reservation.kind === 'REPLAY') {
        const original = reservation.record
          .responseBody as unknown as A5ArControlAccountProvisionResultV1;
        if (!original) throw new ConflictException('A5T11 replay evidence is missing');
        return { ...original, outcome: 'REPLAYED', replayed: true };
      }
      const validation = this.validateDefinition(command.definition);
      if (validation)
        return this.reject(manager, reservation.record.id, validation.code, validation.message);
      const preexisting = await this.findByCode();
      if (preexisting && !this.matches(preexisting))
        return this.reject(
          manager,
          reservation.record.id,
          'ACCOUNT_CODE_CONFLICT',
          'Existing A5 account code has incompatible properties',
        );

      const fingerprint = this.computeApprovalFingerprint(command);
      const approval = await this.approvalService.consume({
        principal: command.principal,
        approvalId: command.approvalId,
        actionType: ACTION,
        resource: { type: RESOURCE_TYPE, id: AUTHORIZED.code },
        actionFingerprint: fingerprint,
        now: command.now,
      });
      const approvalView = approval.approval;
      const approvedNow = approval.approved && approvalView;
      const consumedRecovery =
        preexisting &&
        approval.reason === 'CONSUMED' &&
        approvalView?.actionType === ACTION &&
        approvalView.resourceType === RESOURCE_TYPE &&
        approvalView.resourceId === AUTHORIZED.code &&
        approvalView.actionFingerprint === fingerprint;
      if (!approvedNow && !consumedRecovery)
        return this.reject(
          manager,
          reservation.record.id,
          'APPROVAL_REJECTED',
          `A2 approval rejected: ${approval.reason ?? 'unknown'}`,
        );
      const evidenceApproval = approvalView;
      const makerRoles = Array.isArray(evidenceApproval.policy.requiredRoles)
        ? evidenceApproval.policy.requiredRoles.filter(
            (role): role is string => typeof role === 'string',
          )
        : [];
      const control = await this.financeControlService.evaluate({
        action: ACTION,
        amountMinor: '0',
        resourceType: RESOURCE_TYPE,
        resourceId: AUTHORIZED.code,
        resourceVersion: 1,
        resourceHash: fingerprint,
        makerPrincipalId: evidenceApproval.requesterPrincipalId,
        makerRoles,
        executorPrincipal: command.principal,
        approvals: [evidenceApproval],
        idempotencyKey: `${command.idempotencyKey}:control`,
        requestContext: command.requestContext,
        evaluatedAt: command.now,
      });
      if (control.outcome !== 'ALLOW')
        return this.reject(
          manager,
          reservation.record.id,
          'FINANCE_CONTROL_DENIED',
          control.reasons.join(',') || 'Finance control denied',
        );

      let account = preexisting;
      let outcome: 'PROVISIONED' | 'RECOVERED' = preexisting ? 'RECOVERED' : 'PROVISIONED';
      if (!account) {
        try {
          account = await this.ledgerService.createAccount(AUTHORIZED);
        } catch {
          account = await this.findByCode();
          if (!account) throw new A5ArProvisioningOutcomeUnknownError();
          if (!this.matches(account))
            return this.reject(
              manager,
              reservation.record.id,
              'ACCOUNT_CODE_CONFLICT',
              'Concurrent A5 account has incompatible properties',
            );
          outcome = 'RECOVERED';
        }
      }
      const verified = await this.ledgerService.getAccount(account.id);
      if (!this.matches(verified))
        return this.reject(
          manager,
          reservation.record.id,
          'POST_CREATE_VERIFICATION_FAILED',
          'Canonical A5 account does not match the authorized definition',
        );
      const now = command.now ?? new Date();
      const snapshot = {
        id: verified.id,
        code: verified.code,
        name: verified.name,
        accountType: verified.accountType,
        normalBalance: verified.normalBalance,
        currency: verified.currency,
        accountingUnit: verified.accountingUnit,
        allowNegativeBalance: verified.allowNegativeBalance,
        isActive: verified.isActive,
      };
      const definitionHash = this.computeDefinitionHash(AUTHORIZED);
      const provisioningReference = `a5-ar-provision-${definitionHash.slice(0, 32)}`;
      const audit = await this.auditService.record(manager, {
        entityType: 'A5_AR_CONTROL_ACCOUNT_PROVISIONING',
        entityId: verified.id,
        action:
          outcome === 'PROVISIONED'
            ? 'AR_CONTROL_ACCOUNT_PROVISIONED'
            : 'AR_CONTROL_ACCOUNT_RECOVERED',
        actor: command.principal.principalId,
        correlationId: command.requestContext.correlationId,
        requestId: command.requestContext.requestId,
        newValues: {
          provisioningReference,
          definitionHash,
          requestHash,
          accountSnapshotHash: sha(snapshot),
          controlDecisionReference: control.decisionReference,
          approvalId: command.approvalId,
          readyForB2F03Mapping: true,
        },
        occurredAt: now,
      });
      const evidence: A5ArControlAccountEvidenceV1 = {
        provisioningReference,
        provisioningVersion: 1,
        definitionHash,
        requestHash,
        canonicalA5AccountId: verified.id,
        accountCode: verified.code,
        accountName: verified.name,
        accountType: verified.accountType,
        normalBalance: verified.normalBalance,
        currency: verified.currency,
        accountingUnit: verified.accountingUnit,
        allowNegativeBalance: false,
        isActive: true,
        accountSnapshotHash: sha(snapshot),
        approvalId: command.approvalId,
        controlDecisionReference: control.decisionReference,
        auditEventId: audit.id,
        correlationId: command.requestContext.correlationId,
        causationId: command.causationId ?? null,
        verifiedAt: now.toISOString(),
        readyForB2F03Mapping: true,
      };
      const result: A5ArControlAccountProvisionResultV1 = {
        outcome,
        evidence,
        replayed: false,
        failure: null,
      };
      await this.outboxService.enqueueOnce(manager, {
        eventType: 'A5ArControlAccountProvisioned',
        aggregateType: 'LEDGER_ACCOUNT',
        aggregateId: verified.id,
        eventKey: `a5.ar-control-account.provisioned:${verified.id}:v1`,
        schemaVersion: 1,
        classification: 'CONFIDENTIAL',
        retentionClass: 'FINANCE_ACCOUNT_MAPPING_HISTORY',
        correlationId: command.requestContext.correlationId,
        causationId: command.causationId,
        payload: {
          provisioningReference,
          canonicalA5AccountId: verified.id,
          definitionHash,
          accountSnapshotHash: evidence.accountSnapshotHash,
          readyForB2F03Mapping: true,
        },
      });
      await this.metricsService.increment(manager, 'a5.ar-control-account.provisioned');
      await this.idempotencyService.complete(manager, reservation.record.id, {
        statusCode: outcome === 'PROVISIONED' ? 201 : 200,
        responseBody: result as unknown as Record<string, unknown>,
        resourceType: 'LEDGER_ACCOUNT',
        resourceId: verified.id,
      });
      return result;
    });
  }
  private validateDefinition(definition: A5ArControlAccountDefinitionV1) {
    if (definition.code !== AUTHORIZED.code)
      return { code: 'ACCOUNT_CODE_INVALID', message: 'account code is not authorized' };
    if (definition.name !== AUTHORIZED.name)
      return { code: 'ACCOUNT_NAME_INVALID', message: 'account name is not authorized' };
    if (definition.accountType !== LedgerAccountType.ASSET)
      return { code: 'ACCOUNT_TYPE_INVALID', message: 'account type must be ASSET' };
    if (definition.normalBalance !== LedgerNormalBalance.DEBIT)
      return { code: 'NORMAL_BALANCE_INVALID', message: 'normal balance must be DEBIT' };
    if (definition.currency !== 'NGN')
      return { code: 'CURRENCY_INVALID', message: 'currency must be NGN' };
    if (definition.accountingUnit !== 'CUSTOMER_FUNDS')
      return { code: 'ACCOUNTING_UNIT_INVALID', message: 'accounting unit must be CUSTOMER_FUNDS' };
    if (definition.allowNegativeBalance)
      return { code: 'NEGATIVE_BALANCE_POLICY_INVALID', message: 'negative balance must be false' };
    return null;
  }
  private async findByCode() {
    const accounts = await this.ledgerService.listAccounts('NGN');
    return accounts.find((account) => account.code === AUTHORIZED.code) ?? null;
  }
  private matches(account: {
    code: string;
    name: string;
    accountType: LedgerAccountType;
    normalBalance: LedgerNormalBalance;
    currency: string;
    accountingUnit: string;
    allowNegativeBalance: boolean;
    isActive: boolean;
  }) {
    return (
      account.code === AUTHORIZED.code &&
      account.name === AUTHORIZED.name &&
      account.accountType === AUTHORIZED.accountType &&
      account.normalBalance === AUTHORIZED.normalBalance &&
      account.currency === AUTHORIZED.currency &&
      account.accountingUnit === AUTHORIZED.accountingUnit &&
      account.allowNegativeBalance === false &&
      account.isActive === true
    );
  }
  private async reject(
    manager: EntityManager,
    idempotencyRecordId: string,
    code: string,
    message: string,
  ): Promise<A5ArControlAccountProvisionResultV1> {
    const result: A5ArControlAccountProvisionResultV1 = {
      outcome: 'REJECTED',
      evidence: null,
      replayed: false,
      failure: { code, message },
    };
    await this.idempotencyService.fail(manager, idempotencyRecordId, {
      statusCode: 409,
      responseBody: result as unknown as Record<string, unknown>,
    });
    await this.metricsService.increment(manager, 'a5.ar-control-account.rejected');
    return result;
  }
}
