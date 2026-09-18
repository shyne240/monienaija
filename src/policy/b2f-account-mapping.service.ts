import { createHash, randomUUID } from 'node:crypto';
import { ConflictException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { EntityManager } from 'typeorm';
import { PrivilegedActionApprovalService } from '../authorization/privileged-action-approval.service';
import { LedgerAccountType, LedgerNormalBalance } from '../ledger/ledger.enums';
import { LedgerService } from '../ledger/ledger.service';
import { AuditService } from '../operations/audit.service';
import { IdempotencyService } from '../operations/idempotency.service';
import { MetricsService } from '../operations/metrics.service';
import { OutboxService } from '../operations/outbox.service';
import { B2FFinanceAccountMapping } from './b2f-account-mapping.entity';
import type {
  B2FAccountMappingConsumerPortsV1,
  B2FAccountMappingCreateCommandV1,
  B2FAccountMappingLifecycleCommandV1,
  B2FAccountMappingResultV1,
  B2FAccountMappingVerificationRequestV1,
  B2FAccountMappingVerificationV1,
  B2FAccountMappingViewV1,
} from './b2f-account-mapping.types';
import { B2FFinanceControlService } from './b2f-finance-control.service';
import { runSerializableWithRetry } from '../common/serializable-transaction';

const SCOPE = 'b2.finance.account-mapping.idempotency.v1',
  LIFECYCLE_SCOPE = 'b2.finance.account-mapping.lifecycle.idempotency.v1',
  RETENTION = 86_400;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function stable(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stable(o[k])}`)
    .join(',')}}`;
}
function sha(v: unknown) {
  return createHash('sha256').update(stable(v)).digest('hex');
}
@Injectable()
export class B2FAccountMappingService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly ledger: LedgerService,
    private readonly idempotency: IdempotencyService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly metrics: MetricsService,
    private readonly approvals: PrivilegedActionApprovalService,
    private readonly controls: B2FFinanceControlService,
  ) {}
  getConsumerPorts(): B2FAccountMappingConsumerPortsV1 {
    return {
      contractName: 'B2F-ACCOUNT-MAPPING',
      contractVersion: 1,
      getByReference: (r, v) => this.getByReference(r, v),
      listByClassification: (b, c) => this.listByClassification(b, c),
      getByA5Account: (b, a) => this.getByA5Account(b, a),
      verify: (r) => this.verify(r),
    };
  }
  computeCreateHash(c: B2FAccountMappingCreateCommandV1) {
    return sha({
      mappingVersion: c.mappingVersion,
      bookKey: 'finance.book.ng.primary',
      bookVersion: 1,
      classificationKey: c.classificationKey,
      classificationVersion: c.classificationVersion,
      a5LedgerAccountId: c.a5LedgerAccountId,
      effectiveFrom: new Date(c.effectiveFrom).toISOString(),
      effectiveTo: c.effectiveTo ? new Date(c.effectiveTo).toISOString() : null,
      idempotencyKey: c.idempotencyKey,
    });
  }
  computeLifecycleFingerprint(mapping: B2FAccountMappingViewV1, action: string, reason: string) {
    return sha({
      action,
      mappingReference: mapping.mappingReference,
      mappingVersion: mapping.mappingVersion,
      recordVersion: mapping.recordVersion,
      requestHash: mapping.requestHash,
      decisionHash: mapping.decisionHash,
      a5SnapshotHash: mapping.a5SnapshotHash,
      effectiveFrom: mapping.effectiveFrom,
      effectiveTo: mapping.effectiveTo,
      reason: reason.trim(),
    });
  }
  async create(command: B2FAccountMappingCreateCommandV1): Promise<B2FAccountMappingResultV1> {
    const requestHash = this.computeCreateHash(command);
    return runSerializableWithRetry(
      this.dataSource,
      'B2FAccountMappingService.create',
      async (manager) => {
        const reservation = await this.idempotency.reserve(manager, {
          scope: SCOPE,
          key: command.idempotencyKey,
          requestHash,
          retentionSeconds: RETENTION,
        });
        if (reservation.kind === 'REPLAY') return this.replay(reservation.record.responseBody);
        const failure = await this.validateCandidate(command);
        if (failure) return this.rejectIdempotency(manager, reservation.record.id, failure);
        const account = await this.ledger.getAccount(command.a5LedgerAccountId);
        const effectiveFrom = new Date(command.effectiveFrom),
          effectiveTo = command.effectiveTo ? new Date(command.effectiveTo) : null;
        const semantic = {
          bookKey: 'finance.book.ng.primary',
          bookVersion: 1,
          classificationKey: command.classificationKey,
          classificationVersion: 1,
          a5LedgerAccountId: account.id,
          mappingVersion: command.mappingVersion,
        };
        const mappingReference = `b2f-account-map-${sha(semantic).slice(0, 32)}`;
        const existing = await manager.getRepository(B2FFinanceAccountMapping).findOne({
          where: {
            bookKey: 'finance.book.ng.primary',
            classificationKey: command.classificationKey,
            a5LedgerAccountId: account.id,
            mappingVersion: command.mappingVersion,
          },
        });
        if (existing)
          return this.rejectIdempotency(manager, reservation.record.id, {
            code: 'MAPPING_VERSION_EXISTS',
            message: 'mapping semantic version already exists',
          });
        const snapshot = {
          id: account.id,
          code: account.code,
          name: account.name,
          accountType: account.accountType,
          normalBalance: account.normalBalance,
          currency: account.currency,
          accountingUnit: account.accountingUnit,
          isActive: account.isActive,
          allowNegativeBalance: account.allowNegativeBalance,
        };
        const now = command.now ?? new Date();
        const entity = manager.getRepository(B2FFinanceAccountMapping).create({
          id: randomUUID(),
          mappingReference,
          mappingVersion: command.mappingVersion,
          status: 'DRAFT',
          bookKey: 'finance.book.ng.primary',
          bookVersion: 1,
          classificationKey: command.classificationKey,
          classificationVersion: 1,
          a5LedgerAccountId: account.id,
          observedA5Code: account.code,
          observedA5Name: account.name,
          observedA5AccountType: account.accountType,
          observedA5NormalBalance: account.normalBalance,
          observedA5Active: account.isActive,
          observedA5AllowNegativeBalance: account.allowNegativeBalance,
          currency: 'NGN',
          accountingUnit: 'CUSTOMER_FUNDS',
          effectiveFrom,
          effectiveTo,
          idempotencyScope: SCOPE,
          idempotencyKey: command.idempotencyKey,
          requestHash,
          decisionHash: sha({ requestHash, status: 'DRAFT', snapshot }),
          a5SnapshotHash: sha(snapshot),
          controlDecisionReference: null,
          createdBy: command.principal.principalId,
          createdRoles: [...command.principal.roles],
          approvedBy: null,
          lastReason: null,
          correlationId: command.requestContext.correlationId,
          causationId: command.causationId ?? null,
          recordVersion: 1,
          createdAt: now,
          updatedAt: now,
        });
        const saved = await manager.getRepository(B2FFinanceAccountMapping).save(entity);
        await this.record(
          manager,
          saved,
          'FINANCE_ACCOUNT_MAPPING_CREATED',
          command.principal.principalId,
          { status: saved.status },
        );
        await this.emit(manager, saved, 'B2FFinanceAccountMappingCreated');
        await this.metrics.increment(manager, 'b2f.account-mapping.created');
        const result = {
          outcome: 'CREATED',
          mapping: this.view(saved),
          replayed: false,
          failure: null,
        } as const;
        await this.idempotency.complete(manager, reservation.record.id, {
          statusCode: 201,
          responseBody: result as unknown as Record<string, unknown>,
          resourceType: 'B2F_FINANCE_ACCOUNT_MAPPING',
          resourceId: saved.id,
        });
        return result;
      },
    );
  }
  async submitForApproval(c: B2FAccountMappingLifecycleCommandV1) {
    return this.simpleTransition(
      c,
      'DRAFT',
      'PENDING_APPROVAL',
      'FINANCE_ACCOUNT_MAPPING_APPROVAL_REQUESTED',
    );
  }
  async activate(c: B2FAccountMappingLifecycleCommandV1): Promise<B2FAccountMappingResultV1> {
    return this.controlledTransition(
      c,
      'PENDING_APPROVAL',
      'ACTIVE',
      'FINANCE_ACCOUNT_MAPPING_ACTIVATE',
      'FINANCE_ACCOUNT_MAPPING_ACTIVATED',
    );
  }
  async reject(c: B2FAccountMappingLifecycleCommandV1) {
    return this.controlledTransition(
      c,
      'PENDING_APPROVAL',
      'REJECTED',
      'FINANCE_ACCOUNT_MAPPING_RETIRE',
      'FINANCE_ACCOUNT_MAPPING_REJECTED',
    );
  }
  async revoke(c: B2FAccountMappingLifecycleCommandV1) {
    return this.controlledTransition(
      c,
      'ACTIVE',
      'REVOKED',
      'FINANCE_ACCOUNT_MAPPING_REVOKE',
      'FINANCE_ACCOUNT_MAPPING_REVOKED',
    );
  }
  async expire(
    reference: string,
    version: number,
    now = new Date(),
  ): Promise<B2FAccountMappingResultV1> {
    return runSerializableWithRetry(
      this.dataSource,
      'B2FAccountMappingService.expire',
      async (manager) => {
        const mapping = await this.lock(manager, reference, version);
        if (!mapping)
          return {
            outcome: 'REJECTED',
            mapping: null,
            replayed: false,
            failure: { code: 'MAPPING_NOT_FOUND', message: 'mapping not found' },
          };
        if (mapping.status !== 'ACTIVE' || !mapping.effectiveTo || mapping.effectiveTo > now)
          return {
            outcome: 'REJECTED',
            mapping: this.view(mapping),
            replayed: false,
            failure: {
              code: 'MAPPING_NOT_EXPIRABLE',
              message: 'mapping is not active and expired',
            },
          };
        mapping.status = 'EXPIRED';
        mapping.lastReason = 'effective interval ended';
        mapping.decisionHash = sha({
          previous: 'ACTIVE',
          status: 'EXPIRED',
          mappingReference: reference,
          now: now.toISOString(),
        });
        const saved = await manager.getRepository(B2FFinanceAccountMapping).save(mapping);
        await this.record(
          manager,
          saved,
          'FINANCE_ACCOUNT_MAPPING_EXPIRED',
          'b2f-account-mapping-expiry',
          { status: 'EXPIRED' },
        );
        await this.emit(manager, saved, 'B2FFinanceAccountMappingExpired');
        return { outcome: 'UPDATED', mapping: this.view(saved), replayed: false, failure: null };
      },
    );
  }
  async verify(
    r: B2FAccountMappingVerificationRequestV1,
  ): Promise<B2FAccountMappingVerificationV1> {
    const mapping = await this.dataSource.getRepository(B2FFinanceAccountMapping).findOne({
      where: { mappingReference: r.mappingReference, mappingVersion: r.mappingVersion },
    });
    const reasons: string[] = [];
    if (!mapping) reasons.push('MAPPING_NOT_FOUND');
    else {
      if (mapping.status !== 'ACTIVE') reasons.push('MAPPING_NOT_ACTIVE');
      if (
        mapping.bookKey !== r.bookKey ||
        mapping.classificationKey !== r.classificationKey ||
        mapping.a5LedgerAccountId !== r.a5LedgerAccountId
      )
        reasons.push('MAPPING_IDENTITY_MISMATCH');
      const date = new Date(`${r.accountingDate}T00:00:00.000Z`);
      if (
        Number.isNaN(date.getTime()) ||
        date < mapping.effectiveFrom ||
        (mapping.effectiveTo && date >= mapping.effectiveTo)
      )
        reasons.push('MAPPING_NOT_EFFECTIVE');
      try {
        const account = await this.ledger.getAccount(mapping.a5LedgerAccountId);
        const expected = this.expected(mapping.classificationKey);
        const snapshot = {
          id: account.id,
          code: account.code,
          name: account.name,
          accountType: account.accountType,
          normalBalance: account.normalBalance,
          currency: account.currency,
          accountingUnit: account.accountingUnit,
          isActive: account.isActive,
          allowNegativeBalance: account.allowNegativeBalance,
        };
        if (!account.isActive) reasons.push('A5_ACCOUNT_INACTIVE');
        if (
          account.accountType !== expected.type ||
          account.normalBalance !== expected.normal ||
          account.currency !== 'NGN' ||
          account.accountingUnit !== 'CUSTOMER_FUNDS'
        )
          reasons.push('A5_ACCOUNT_INCOMPATIBLE');
        if (sha(snapshot) !== mapping.a5SnapshotHash) reasons.push('A5_ACCOUNT_METADATA_DRIFT');
      } catch {
        reasons.push('A5_ACCOUNT_NOT_FOUND');
      }
    }
    return {
      compatible: reasons.length === 0,
      readOnly: true,
      mapping: mapping ? this.view(mapping) : null,
      reasons,
      verifiedAt: new Date().toISOString(),
    };
  }
  async getByReference(reference: string, version: number) {
    const m = await this.dataSource
      .getRepository(B2FFinanceAccountMapping)
      .findOne({ where: { mappingReference: reference, mappingVersion: version } });
    return m ? this.view(m) : null;
  }
  async listByClassification(bookKey: 'finance.book.ng.primary', classificationKey: string) {
    const rows = await this.dataSource
      .getRepository(B2FFinanceAccountMapping)
      .find({ where: { bookKey, classificationKey }, order: { mappingVersion: 'ASC' } });
    return rows.map((r) => this.view(r));
  }
  async getByA5Account(bookKey: 'finance.book.ng.primary', a5LedgerAccountId: string) {
    const rows = await this.dataSource
      .getRepository(B2FFinanceAccountMapping)
      .find({ where: { bookKey, a5LedgerAccountId }, order: { mappingVersion: 'ASC' } });
    return rows.map((r) => this.view(r));
  }
  private async simpleTransition(
    c: B2FAccountMappingLifecycleCommandV1,
    from: 'DRAFT',
    to: 'PENDING_APPROVAL',
    action: string,
  ) {
    return runSerializableWithRetry(
      this.dataSource,
      'B2FAccountMappingService.simpleTransition',
      async (manager) => {
        const requestHash = sha({
          reference: c.mappingReference,
          version: c.mappingVersion,
          expected: c.expectedRecordVersion,
          from,
          to,
          reason: c.reason,
          idempotencyKey: c.idempotencyKey,
        });
        const reservation = await this.idempotency.reserve(manager, {
          scope: LIFECYCLE_SCOPE,
          key: c.idempotencyKey,
          requestHash,
          retentionSeconds: RETENTION,
        });
        if (reservation.kind === 'REPLAY') return this.replay(reservation.record.responseBody);
        const m = await this.lock(manager, c.mappingReference, c.mappingVersion);
        if (!m || m.status !== from || m.recordVersion !== c.expectedRecordVersion)
          return this.rejectIdempotency(
            manager,
            reservation.record.id,
            { code: 'INVALID_STATE_OR_VERSION', message: 'mapping state/version invalid' },
            m ?? undefined,
          );
        m.status = to;
        m.lastReason = c.reason.trim();
        const saved = await manager.getRepository(B2FFinanceAccountMapping).save(m);
        await this.record(manager, saved, action, c.principal.principalId, { status: to });
        const result = {
          outcome: 'UPDATED',
          mapping: this.view(saved),
          replayed: false,
          failure: null,
        } as const;
        await this.idempotency.complete(manager, reservation.record.id, {
          statusCode: 200,
          responseBody: result as unknown as Record<string, unknown>,
          resourceType: 'B2F_FINANCE_ACCOUNT_MAPPING',
          resourceId: saved.id,
        });
        return result;
      },
    );
  }
  private async controlledTransition(
    c: B2FAccountMappingLifecycleCommandV1,
    from: 'PENDING_APPROVAL' | 'ACTIVE',
    to: 'ACTIVE' | 'REJECTED' | 'REVOKED',
    controlAction:
      | 'FINANCE_ACCOUNT_MAPPING_ACTIVATE'
      | 'FINANCE_ACCOUNT_MAPPING_RETIRE'
      | 'FINANCE_ACCOUNT_MAPPING_REVOKE',
    auditAction: string,
  ): Promise<B2FAccountMappingResultV1> {
    const requestHash = sha({
      reference: c.mappingReference,
      version: c.mappingVersion,
      expected: c.expectedRecordVersion,
      from,
      to,
      reason: c.reason,
      approvalId: c.approvalId,
      idempotencyKey: c.idempotencyKey,
    });
    return runSerializableWithRetry(
      this.dataSource,
      'B2FAccountMappingService.controlledTransition',
      async (manager) => {
        const reservation = await this.idempotency.reserve(manager, {
          scope: LIFECYCLE_SCOPE,
          key: c.idempotencyKey,
          requestHash,
          retentionSeconds: RETENTION,
        });
        if (reservation.kind === 'REPLAY') return this.replay(reservation.record.responseBody);
        const m = await this.lock(manager, c.mappingReference, c.mappingVersion);
        if (!m || m.status !== from || m.recordVersion !== c.expectedRecordVersion)
          return this.rejectIdempotency(
            manager,
            reservation.record.id,
            { code: 'INVALID_STATE_OR_VERSION', message: 'mapping state/version invalid' },
            m ?? undefined,
          );
        const compatibility = await this.verify({
          ...this.verifyRequest(m),
          accountingDate: (c.now ?? new Date()).toISOString().slice(0, 10),
        });
        if (to === 'ACTIVE' && compatibility.reasons.some((r) => r.startsWith('A5_')))
          return this.rejectIdempotency(
            manager,
            reservation.record.id,
            { code: 'A5_ACCOUNT_INCOMPATIBLE', message: compatibility.reasons.join(',') },
            m,
          );
        if (!c.approvalId)
          return this.rejectIdempotency(
            manager,
            reservation.record.id,
            { code: 'APPROVAL_REQUIRED', message: 'A2 approval is required' },
            m,
          );
        const fingerprint = this.computeLifecycleFingerprint(this.view(m), controlAction, c.reason);
        const approval = await this.approvals.consumeInTransaction(manager, {
          principal: c.principal,
          approvalId: c.approvalId,
          actionType: controlAction,
          resource: { type: 'B2F_FINANCE_ACCOUNT_MAPPING', id: m.id },
          actionFingerprint: fingerprint,
          now: c.now,
        });
        if (!approval.approved || !approval.approval)
          return this.rejectIdempotency(
            manager,
            reservation.record.id,
            {
              code: 'APPROVAL_REJECTED',
              message: `A2 approval rejected: ${approval.reason ?? 'unknown'}`,
            },
            m,
          );
        if (to === 'ACTIVE') {
          const overlap = await manager
            .getRepository(B2FFinanceAccountMapping)
            .createQueryBuilder('mapping')
            .where(
              "mapping.book_key = :book AND mapping.a5_ledger_account_id = :accountId AND mapping.status = 'ACTIVE' AND mapping.id <> :id",
              { book: m.bookKey, accountId: m.a5LedgerAccountId, id: m.id },
            )
            .andWhere('(mapping.effective_to IS NULL OR mapping.effective_to > :from)', {
              from: m.effectiveFrom,
            })
            .andWhere('(:to::timestamptz IS NULL OR mapping.effective_from < :to)', {
              to: m.effectiveTo,
            })
            .setLock('pessimistic_write')
            .getOne();
          if (overlap)
            return this.rejectIdempotency(
              manager,
              reservation.record.id,
              {
                code: 'OVERLAPPING_ACTIVE_MAPPING',
                message: 'A5 account already has overlapping active primary mapping',
              },
              m,
            );
        }
        const requiredRoles = Array.isArray(approval.approval.policy.requiredRoles)
          ? approval.approval.policy.requiredRoles.filter((r): r is string => typeof r === 'string')
          : m.createdRoles;
        const control = await this.controls.evaluateInTransaction(manager, {
          action: controlAction,
          amountMinor: '0',
          resourceType: 'B2F_FINANCE_ACCOUNT_MAPPING',
          resourceId: m.id,
          resourceVersion: m.recordVersion,
          resourceHash: fingerprint,
          makerPrincipalId: m.createdBy,
          makerRoles: requiredRoles,
          executorPrincipal: c.principal,
          approvals: [approval.approval],
          overrideEvidenceReference: c.overrideEvidenceReference,
          idempotencyKey: `${c.idempotencyKey}:control`,
          requestContext: c.requestContext,
          evaluatedAt: c.now,
        });
        if (control.outcome !== 'ALLOW')
          return this.rejectIdempotency(
            manager,
            reservation.record.id,
            { code: 'FINANCE_CONTROL_DENIED', message: control.reasons.join(',') },
            m,
          );
        m.status = to;
        m.controlDecisionReference = control.decisionReference;
        m.approvedBy = c.principal.principalId;
        m.lastReason = c.reason.trim();
        m.decisionHash = sha({
          requestHash,
          status: to,
          controlDecisionReference: control.decisionReference,
        });
        const saved = await manager.getRepository(B2FFinanceAccountMapping).save(m);
        await this.record(manager, saved, auditAction, c.principal.principalId, {
          status: to,
          controlDecisionReference: control.decisionReference,
        });
        await this.emit(
          manager,
          saved,
          `B2FFinanceAccountMapping${to[0]}${to.slice(1).toLowerCase()}`,
        );
        await this.metrics.increment(manager, `b2f.account-mapping.${to.toLowerCase()}`);
        const result = {
          outcome: 'UPDATED',
          mapping: this.view(saved),
          replayed: false,
          failure: null,
        } as const;
        await this.idempotency.complete(manager, reservation.record.id, {
          statusCode: 200,
          responseBody: result as unknown as Record<string, unknown>,
          resourceType: 'B2F_FINANCE_ACCOUNT_MAPPING',
          resourceId: saved.id,
        });
        return result;
      },
    );
  }
  private async validateCandidate(c: B2FAccountMappingCreateCommandV1) {
    if (
      !Number.isInteger(c.mappingVersion) ||
      c.mappingVersion < 1 ||
      c.classificationVersion !== 1 ||
      !UUID.test(c.a5LedgerAccountId) ||
      !/^finance\.(asset|liability|equity|revenue|expense)\.[a-z0-9.-]+$/.test(c.classificationKey)
    )
      return { code: 'INVALID_MAPPING_COMMAND', message: 'mapping identity is invalid' };
    const from = new Date(c.effectiveFrom),
      to = c.effectiveTo ? new Date(c.effectiveTo) : null;
    if (Number.isNaN(from.getTime()) || (to && (Number.isNaN(to.getTime()) || to <= from)))
      return { code: 'INVALID_EFFECTIVE_INTERVAL', message: 'effective interval is invalid' };
    try {
      const a = await this.ledger.getAccount(c.a5LedgerAccountId),
        expected = this.expected(c.classificationKey);
      if (!a.isActive) return { code: 'A5_ACCOUNT_INACTIVE', message: 'A5 account is inactive' };
      if (a.accountType !== expected.type)
        return { code: 'A5_TYPE_INCOMPATIBLE', message: 'A5 account type is incompatible' };
      if (a.normalBalance !== expected.normal)
        return {
          code: 'A5_NORMAL_BALANCE_INCOMPATIBLE',
          message: 'A5 normal balance is incompatible',
        };
      if (a.currency !== 'NGN' || a.accountingUnit !== 'CUSTOMER_FUNDS')
        return { code: 'A5_DIMENSION_INCOMPATIBLE', message: 'A5 dimensions are incompatible' };
      if (c.classificationKey === 'finance.liability.customer-funds' && a.allowNegativeBalance)
        return {
          code: 'A5_NEGATIVE_POLICY_INCOMPATIBLE',
          message: 'customer funds account cannot allow negative balance',
        };
    } catch {
      return { code: 'A5_ACCOUNT_NOT_FOUND', message: 'canonical A5 account not found' };
    }
    return null;
  }
  private expected(key: string) {
    if (key.startsWith('finance.asset.'))
      return { type: LedgerAccountType.ASSET, normal: LedgerNormalBalance.DEBIT };
    if (key.startsWith('finance.liability.'))
      return { type: LedgerAccountType.LIABILITY, normal: LedgerNormalBalance.CREDIT };
    if (key.startsWith('finance.equity.'))
      return { type: LedgerAccountType.EQUITY, normal: LedgerNormalBalance.CREDIT };
    if (key.startsWith('finance.revenue.'))
      return { type: LedgerAccountType.REVENUE, normal: LedgerNormalBalance.CREDIT };
    return { type: LedgerAccountType.EXPENSE, normal: LedgerNormalBalance.DEBIT };
  }
  private async lock(manager: EntityManager, reference: string, version: number) {
    return manager
      .getRepository(B2FFinanceAccountMapping)
      .createQueryBuilder('mapping')
      .where('mapping.mapping_reference = :reference AND mapping.mapping_version = :version', {
        reference,
        version,
      })
      .setLock('pessimistic_write')
      .getOne();
  }
  private verifyRequest(m: B2FFinanceAccountMapping): B2FAccountMappingVerificationRequestV1 {
    return {
      mappingReference: m.mappingReference,
      mappingVersion: m.mappingVersion,
      bookKey: 'finance.book.ng.primary',
      classificationKey: m.classificationKey,
      a5LedgerAccountId: m.a5LedgerAccountId,
      accountingDate: m.effectiveFrom.toISOString().slice(0, 10),
    };
  }
  private replay(body: Record<string, unknown> | null): B2FAccountMappingResultV1 {
    if (!body) throw new ConflictException('mapping replay body missing');
    return {
      ...(body as unknown as B2FAccountMappingResultV1),
      outcome: 'REPLAYED',
      replayed: true,
    };
  }
  private async rejectIdempotency(
    manager: EntityManager,
    id: string,
    failure: { code: string; message: string },
    mapping?: B2FFinanceAccountMapping,
  ): Promise<B2FAccountMappingResultV1> {
    const result = {
      outcome: 'REJECTED',
      mapping: mapping ? this.view(mapping) : null,
      replayed: false,
      failure,
    } as const;
    await this.idempotency.fail(manager, id, {
      statusCode: 409,
      responseBody: result as unknown as Record<string, unknown>,
      ...(mapping ? { resourceType: 'B2F_FINANCE_ACCOUNT_MAPPING', resourceId: mapping.id } : {}),
    });
    if (mapping)
      await this.record(
        manager,
        mapping,
        'FINANCE_ACCOUNT_MAPPING_COMPATIBILITY_REJECTED',
        'b2f-account-mapping',
        { failure },
      );
    return result;
  }
  private async record(
    manager: EntityManager,
    m: B2FFinanceAccountMapping,
    action: string,
    actor: string,
    values: Record<string, unknown>,
  ) {
    await this.audit.record(manager, {
      entityType: 'B2F_FINANCE_ACCOUNT_MAPPING',
      entityId: m.id,
      action,
      actor,
      correlationId: m.correlationId,
      newValues: {
        mappingReference: m.mappingReference,
        mappingVersion: m.mappingVersion,
        classificationKey: m.classificationKey,
        a5LedgerAccountId: m.a5LedgerAccountId,
        ...values,
      },
    });
  }
  private async emit(manager: EntityManager, m: B2FFinanceAccountMapping, eventType: string) {
    await this.outbox.enqueueOnce(manager, {
      eventType,
      aggregateType: 'B2F_FINANCE_ACCOUNT_MAPPING',
      aggregateId: m.id,
      eventKey: `b2f.account-mapping:${m.mappingReference}:${m.mappingVersion}:${m.status}`,
      schemaVersion: 1,
      classification: 'CONFIDENTIAL',
      retentionClass: 'FINANCE_ACCOUNT_MAPPING_HISTORY',
      correlationId: m.correlationId,
      causationId: m.causationId ?? undefined,
      payload: {
        mappingReference: m.mappingReference,
        mappingVersion: m.mappingVersion,
        status: m.status,
        classificationKey: m.classificationKey,
        a5LedgerAccountId: m.a5LedgerAccountId,
        decisionHash: m.decisionHash,
      },
    });
  }
  private view(m: B2FFinanceAccountMapping): B2FAccountMappingViewV1 {
    return {
      mappingReference: m.mappingReference,
      mappingVersion: m.mappingVersion,
      status: m.status,
      bookKey: 'finance.book.ng.primary',
      bookVersion: 1,
      classificationKey: m.classificationKey,
      classificationVersion: 1,
      a5LedgerAccountId: m.a5LedgerAccountId,
      observedA5Code: m.observedA5Code,
      observedA5Name: m.observedA5Name,
      observedA5AccountType: m.observedA5AccountType,
      observedA5NormalBalance: m.observedA5NormalBalance,
      observedA5Active: m.observedA5Active,
      observedA5AllowNegativeBalance: m.observedA5AllowNegativeBalance,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      effectiveFrom: m.effectiveFrom.toISOString(),
      effectiveTo: m.effectiveTo?.toISOString() ?? null,
      idempotencyScope: SCOPE,
      idempotencyKey: m.idempotencyKey,
      requestHash: m.requestHash,
      decisionHash: m.decisionHash,
      a5SnapshotHash: m.a5SnapshotHash,
      controlDecisionReference: m.controlDecisionReference,
      createdBy: m.createdBy,
      createdRoles: m.createdRoles,
      approvedBy: m.approvedBy,
      correlationId: m.correlationId,
      causationId: m.causationId,
      recordVersion: m.recordVersion,
      createdAt: m.createdAt.toISOString(),
      updatedAt: m.updatedAt.toISOString(),
    };
  }
}
