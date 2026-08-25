import { createHash, randomUUID } from 'node:crypto';
import { ConflictException, HttpException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { EntityManager } from 'typeorm';
import { runWithSystemContext } from '../authorization/authorization-context';
import { PrivilegedActionApprovalService } from '../authorization/privileged-action-approval.service';
import {
  LedgerAccountType,
  LedgerEntryDirection,
  LedgerNormalBalance,
} from '../ledger/ledger.enums';
import { LedgerService } from '../ledger/ledger.service';
import { AuditService } from '../operations/audit.service';
import { IdempotencyService } from '../operations/idempotency.service';
import { OutboxService } from '../operations/outbox.service';
import { B2FFiscalPeriodService } from './b2f-fiscal-period.service';
import { B2FAccountMappingService } from './b2f-account-mapping.service';
import { B2FFinanceControlService } from './b2f-finance-control.service';
import { B2FFinanceJournalGovernance } from './b2f-finance-journal.entity';
import type {
  B2FFinanceJournalConsumerPortsV1,
  B2FFinanceJournalCreateCommandV1,
  B2FFinanceJournalLifecycleCommandV1,
  B2FFinanceJournalLineV1,
  B2FFinanceJournalResultV1,
  B2FFinanceJournalViewV1,
} from './b2f-journal-governance.types';
import { runSerializableWithRetry } from '../common/serializable-transaction';

const CREATE_SCOPE = 'b2.finance.journal.create.idempotency.v1';
const LIFECYCLE_SCOPE = 'b2.finance.journal.lifecycle.idempotency.v1';
const POST_SCOPE = 'b2.finance.journal.post.idempotency.v1';
const RETENTION = 86_400;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;
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

@Injectable()
export class B2FJournalGovernanceService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly ledgerService: LedgerService,
    private readonly fiscalPeriodService: B2FFiscalPeriodService,
    private readonly accountMappingService: B2FAccountMappingService,
    private readonly idempotencyService: IdempotencyService,
    private readonly auditService: AuditService,
    private readonly outboxService: OutboxService,
    private readonly approvalService: PrivilegedActionApprovalService,
    private readonly financeControlService: B2FFinanceControlService,
  ) {}

  getConsumerPorts(): B2FFinanceJournalConsumerPortsV1 {
    return {
      contractName: 'B2F-JOURNAL-GOVERNANCE',
      contractVersion: 1,
      getJournal: (reference) => this.getJournal(reference),
      getPostingResult: async (reference) => {
        const journal = await this.getJournal(reference);
        return journal
          ? {
              state: journal.state,
              a5JournalId: journal.a5JournalId,
              failureCode: journal.postingFailureCode,
            }
          : null;
      },
      getProvenance: async (reference) => {
        const journal = await this.getJournal(reference);
        return journal
          ? {
              sourceDocument: journal.sourceDocument,
              requestHash: journal.requestHash,
              decisionHash: journal.decisionHash,
              a5JournalId: journal.a5JournalId,
            }
          : null;
      },
    };
  }

  computeCreateHash(command: B2FFinanceJournalCreateCommandV1): string {
    return sha({
      classification: command.classification,
      periodKey: command.periodKey,
      periodVersion: command.periodVersion,
      accountingDate: command.accountingDate,
      description: command.description.trim(),
      sourceDocument: command.sourceDocument,
      lines: [...command.lines].sort((a, b) => a.lineNumber - b.lineNumber),
      bookKey: 'finance.book.ng.primary',
      bookVersion: 1,
      legalEntityReference: 'finance.legal-entity.ng.primary',
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      accountingBasis: 'ACCRUAL',
      idempotencyKey: command.idempotencyKey,
    });
  }
  computeApprovalFingerprint(journal: B2FFinanceJournalViewV1): string {
    return sha({
      action: 'FINANCE_JOURNAL_POST',
      financeJournalReference: journal.financeJournalReference,
      financeJournalVersion: 1,
      requestHash: journal.requestHash,
      decisionHash: journal.decisionHash,
      periodKey: journal.periodKey,
      accountingDate: journal.accountingDate,
      lines: journal.lines,
      totalDebitMinor: journal.totalDebitMinor,
      totalCreditMinor: journal.totalCreditMinor,
    });
  }

  async compatibilityCheck(
    command: B2FFinanceJournalCreateCommandV1,
  ): Promise<{ compatible: boolean; failure: { code: string; message: string } | null }> {
    const failure = await this.validate(command);
    return { compatible: failure === null, failure };
  }

  async createJournal(
    command: B2FFinanceJournalCreateCommandV1,
  ): Promise<B2FFinanceJournalResultV1> {
    const requestHash = this.computeCreateHash(command);
    return runSerializableWithRetry(
      this.dataSource,
      'B2FJournalGovernanceService.createJournal',
      async (manager) => {
        const reservation = await this.idempotencyService.reserve(manager, {
          scope: CREATE_SCOPE,
          key: command.idempotencyKey,
          requestHash,
          retentionSeconds: RETENTION,
        });
        if (reservation.kind === 'REPLAY') return this.replay(reservation.record.responseBody);
        const validation = await this.validate(command);
        if (validation) return this.finishRejected(manager, reservation.record.id, validation);
        const now = command.now ?? new Date();
        const totals = this.totals(command.lines);
        const reference = `b2f-journal-${sha({ requestHash }).slice(0, 32)}`;
        const entity = manager.getRepository(B2FFinanceJournalGovernance).create({
          id: randomUUID(),
          financeJournalReference: reference,
          financeJournalVersion: 1,
          state: 'DRAFT',
          classification: command.classification,
          bookKey: 'finance.book.ng.primary',
          bookVersion: 1,
          legalEntityReference: 'finance.legal-entity.ng.primary',
          accountingBasis: 'ACCRUAL',
          periodKey: command.periodKey,
          periodVersion: command.periodVersion,
          accountingDate: command.accountingDate,
          currency: 'NGN',
          accountingUnit: 'CUSTOMER_FUNDS',
          description: command.description.trim(),
          sourceDocument: command.sourceDocument,
          lines: [...command.lines].sort((a, b) => a.lineNumber - b.lineNumber),
          totalDebitMinor: totals.debit.toString(),
          totalCreditMinor: totals.credit.toString(),
          requestHash,
          decisionHash: sha({ requestHash, state: 'DRAFT' }),
          replayHash: sha({ requestHash, reference }),
          approvalId: null,
          preparedBy: command.principal.principalId,
          preparedRoles: [...command.principal.roles],
          controlDecisionReference: null,
          a5IdempotencyKey: `b2f-a5-${requestHash}`,
          a5JournalId: null,
          a5PostedAt: null,
          postingFailureCode: null,
          postingFailureMessage: null,
          correlationId: command.requestContext.correlationId,
          causationId: command.causationId ?? null,
          recordVersion: 1,
          createdAt: now,
          updatedAt: now,
        });
        const saved = await manager.getRepository(B2FFinanceJournalGovernance).save(entity);
        await this.audit(
          manager,
          saved,
          'FINANCE_JOURNAL_CREATED',
          command.principal.principalId,
          null,
          { state: saved.state, requestHash },
        );
        const result = {
          outcome: 'CREATED',
          journal: this.view(saved),
          replayed: false,
          failure: null,
        } as const;
        await this.idempotencyService.complete(manager, reservation.record.id, {
          statusCode: 201,
          responseBody: result as unknown as Record<string, unknown>,
          resourceType: 'B2F_FINANCE_JOURNAL_GOVERNANCE',
          resourceId: saved.id,
        });
        return result;
      },
    );
  }

  async submitForApproval(
    command: B2FFinanceJournalLifecycleCommandV1,
  ): Promise<B2FFinanceJournalResultV1> {
    return this.changeState(
      command,
      'DRAFT',
      'PENDING_APPROVAL',
      'FINANCE_JOURNAL_APPROVAL_REQUESTED',
    );
  }
  async rejectJournal(
    command: B2FFinanceJournalLifecycleCommandV1,
  ): Promise<B2FFinanceJournalResultV1> {
    return this.changeState(command, 'PENDING_APPROVAL', 'REJECTED', 'FINANCE_JOURNAL_REJECTED');
  }

  async postApprovedJournal(
    command: B2FFinanceJournalLifecycleCommandV1,
  ): Promise<B2FFinanceJournalResultV1> {
    const semanticHash = sha({
      reference: command.financeJournalReference,
      expectedRecordVersion: command.expectedRecordVersion,
      approvalId: command.approvalId,
      reason: command.reason.trim(),
    });
    return runSerializableWithRetry(
      this.dataSource,
      'B2FJournalGovernanceService.postApprovedJournal',
      async (manager) => {
        const reservation = await this.idempotencyService.reserve(manager, {
          scope: POST_SCOPE,
          key: command.idempotencyKey,
          requestHash: semanticHash,
          retentionSeconds: RETENTION,
        });
        if (reservation.kind === 'REPLAY') return this.replay(reservation.record.responseBody);
        const journal = await this.lock(manager, command.financeJournalReference);
        if (!journal)
          return this.finishRejected(manager, reservation.record.id, {
            code: 'JOURNAL_NOT_FOUND',
            message: 'journal not found',
          });
        if (journal.recordVersion !== command.expectedRecordVersion)
          return this.finishRejected(manager, reservation.record.id, {
            code: 'VERSION_CONFLICT',
            message: 'journal version changed',
          });
        if (!['PENDING_APPROVAL', 'POSTING_UNKNOWN'].includes(journal.state))
          return this.finishRejected(manager, reservation.record.id, {
            code: 'INVALID_STATE',
            message: `cannot post from ${journal.state}`,
          });
        if (!command.approvalId || !UUID.test(command.approvalId))
          return this.finishRejected(manager, reservation.record.id, {
            code: 'APPROVAL_REQUIRED',
            message: 'approval is required',
          });
        if (journal.state === 'PENDING_APPROVAL') {
          const approval = await this.approvalService.consumeInTransaction(manager, {
            principal: command.principal,
            approvalId: command.approvalId,
            actionType: 'FINANCE_JOURNAL_POST',
            resource: { type: 'B2F_FINANCE_JOURNAL_GOVERNANCE', id: journal.id },
            actionFingerprint: this.computeApprovalFingerprint(this.view(journal)),
            now: command.now,
          });
          if (!approval.approved) {
            journal.state = 'REJECTED';
            journal.approvalId = command.approvalId;
            await manager.getRepository(B2FFinanceJournalGovernance).save(journal);
            await this.audit(
              manager,
              journal,
              'FINANCE_JOURNAL_APPROVAL_REJECTED',
              command.principal.principalId,
              null,
              { reason: approval.reason },
            );
            return this.finishRejected(
              manager,
              reservation.record.id,
              {
                code: 'APPROVAL_REJECTED',
                message: `approval rejected: ${approval.reason ?? 'unknown'}`,
              },
              journal,
            );
          }
          const approvalView = approval.approval;
          if (!approvalView) {
            return this.finishRejected(
              manager,
              reservation.record.id,
              {
                code: 'CONTROL_APPROVAL_EVIDENCE_MISSING',
                message: 'consumed A2 approval evidence is missing',
              },
              journal,
            );
          }
          const policyRoles = Array.isArray(approvalView.policy.requiredRoles)
            ? approvalView.policy.requiredRoles.filter(
                (role): role is string => typeof role === 'string',
              )
            : journal.preparedRoles;
          const control = await this.financeControlService.evaluateInTransaction(manager, {
            action: 'FINANCE_JOURNAL_POST',
            amountMinor: journal.totalDebitMinor,
            resourceType: 'B2F_FINANCE_JOURNAL_GOVERNANCE',
            resourceId: journal.id,
            resourceVersion: journal.recordVersion,
            resourceHash: this.computeApprovalFingerprint(this.view(journal)),
            makerPrincipalId: journal.preparedBy ?? approvalView.requesterPrincipalId,
            makerRoles: policyRoles,
            executorPrincipal: command.principal,
            approvals: [approvalView],
            idempotencyKey: `${command.idempotencyKey}:control`,
            requestContext: command.requestContext,
            evaluatedAt: command.now,
          });
          if (control.outcome !== 'ALLOW') {
            journal.state = 'REJECTED';
            journal.approvalId = command.approvalId;
            journal.controlDecisionReference = control.decisionReference;
            await manager.getRepository(B2FFinanceJournalGovernance).save(journal);
            return this.finishRejected(
              manager,
              reservation.record.id,
              {
                code: 'FINANCE_CONTROL_DENIED',
                message: control.reasons.join(',') || 'Finance control denied',
              },
              journal,
            );
          }
          journal.state = 'APPROVED';
          journal.approvalId = command.approvalId;
          journal.controlDecisionReference = control.decisionReference;
          await this.audit(
            manager,
            journal,
            'FINANCE_JOURNAL_APPROVED',
            command.principal.principalId,
            { state: 'PENDING_APPROVAL' },
            { state: 'APPROVED', approvalId: command.approvalId },
          );
        }
        journal.state = 'POSTING_REQUESTED';
        journal.updatedAt = command.now ?? new Date();
        await manager.getRepository(B2FFinanceJournalGovernance).save(journal);
        await this.audit(
          manager,
          journal,
          'FINANCE_JOURNAL_POSTING_REQUESTED',
          command.principal.principalId,
          null,
          { a5IdempotencyKey: journal.a5IdempotencyKey },
        );
        try {
          // Call LedgerService with system context (already authorized at B2F governance level)
          const a5 = await runWithSystemContext(
            `b2f-finance-journal:${journal.financeJournalReference}:posting`,
            () => this.ledgerService.postJournal({
              idempotencyKey: journal.a5IdempotencyKey,
              currency: 'NGN',
              accountingUnit: 'CUSTOMER_FUNDS',
              reference: journal.financeJournalReference,
              description: journal.description,
              correlationId: journal.correlationId,
              metadata: {
                financeJournalReference: journal.financeJournalReference,
                financeJournalVersion: 1,
                bookKey: journal.bookKey,
                periodKey: journal.periodKey,
                accountingDate: journal.accountingDate,
                sourceReference: journal.sourceDocument.sourceReference,
                approvalId: journal.approvalId,
                requestHash: journal.requestHash,
              },
              lines: journal.lines.map((line) => ({
                accountId: line.a5LedgerAccountId,
                direction:
                  line.direction === 'DEBIT'
                    ? LedgerEntryDirection.DEBIT
                    : LedgerEntryDirection.CREDIT,
                amountMinor: line.amountMinor,
              })),
            }),
            command.principal, // Preserve original principal for audit trail
          );
          journal.state = 'POSTED';
          journal.a5JournalId = a5.id;
          journal.a5PostedAt = a5.postedAt;
          journal.postingFailureCode = null;
          journal.postingFailureMessage = null;
          journal.decisionHash = sha({
            requestHash: journal.requestHash,
            state: 'POSTED',
            a5JournalId: a5.id,
            a5PostedAt: a5.postedAt.toISOString(),
          });
          const saved = await manager.getRepository(B2FFinanceJournalGovernance).save(journal);
          await this.audit(
            manager,
            saved,
            'FINANCE_JOURNAL_POSTED',
            command.principal.principalId,
            null,
            { state: 'POSTED', a5JournalId: a5.id },
          );
          await this.outboxService.enqueue(manager, {
            eventType: 'B2FFinanceJournalPosted',
            aggregateType: 'B2F_FINANCE_JOURNAL_GOVERNANCE',
            aggregateId: saved.id,
            eventKey: `b2f.finance-journal.posted:${saved.id}:v1`,
            schemaVersion: 1,
            classification: 'INTERNAL',
            retentionClass: 'FINANCE_AUDIT_EVIDENCE',
            correlationId: saved.correlationId,
            payload: {
              financeJournalReference: saved.financeJournalReference,
              a5JournalId: a5.id,
              periodKey: saved.periodKey,
              requestHash: saved.requestHash,
            },
          });
          const result = {
            outcome: 'POSTED',
            journal: this.view(saved),
            replayed: false,
            failure: null,
          } as const;
          await this.idempotencyService.complete(manager, reservation.record.id, {
            statusCode: 200,
            responseBody: result as unknown as Record<string, unknown>,
            resourceType: 'B2F_FINANCE_JOURNAL_GOVERNANCE',
            resourceId: saved.id,
          });
          return result;
        } catch (error) {
          const rejection = error instanceof HttpException;
          journal.state = rejection ? 'FAILED' : 'POSTING_UNKNOWN';
          journal.postingFailureCode = rejection ? 'A5_REJECTED' : 'A5_RESULT_UNKNOWN';
          journal.postingFailureMessage =
            error instanceof Error ? error.message : 'A5 posting result unknown';
          const saved = await manager.getRepository(B2FFinanceJournalGovernance).save(journal);
          await this.audit(
            manager,
            saved,
            rejection ? 'FINANCE_JOURNAL_POSTING_FAILED' : 'FINANCE_JOURNAL_POSTING_UNKNOWN',
            command.principal.principalId,
            null,
            { state: saved.state, failureCode: saved.postingFailureCode },
          );
          const result = {
            outcome: rejection ? 'REJECTED' : 'UNKNOWN',
            journal: this.view(saved),
            replayed: false,
            failure: { code: saved.postingFailureCode!, message: saved.postingFailureMessage! },
          } as B2FFinanceJournalResultV1;
          await this.idempotencyService.fail(manager, reservation.record.id, {
            statusCode: rejection ? 422 : 503,
            responseBody: result as unknown as Record<string, unknown>,
            resourceType: 'B2F_FINANCE_JOURNAL_GOVERNANCE',
            resourceId: saved.id,
          });
          return result;
        }
      },
    );
  }

  async getJournal(reference: string): Promise<B2FFinanceJournalViewV1 | null> {
    const entity = await this.dataSource
      .getRepository(B2FFinanceJournalGovernance)
      .findOne({ where: { financeJournalReference: reference } });
    return entity ? this.view(entity) : null;
  }

  private async validate(command: B2FFinanceJournalCreateCommandV1) {
    if (
      !command.description.trim() ||
      !command.sourceDocument?.sourceReference ||
      !HASH.test(command.sourceDocument.sourceHash)
    )
      return {
        code: 'SOURCE_DOCUMENT_INVALID',
        message: 'valid source document and hash are required',
      };
    if (!command.lines || command.lines.length < 2)
      return { code: 'LINES_INVALID', message: 'at least two lines are required' };
    const totals = this.totals(command.lines);
    if (totals.debit <= 0n || totals.credit <= 0n || totals.debit !== totals.credit)
      return {
        code: 'JOURNAL_UNBALANCED',
        message: 'debits and credits must be positive and equal',
      };
    const numbers = new Set<number>();
    for (const line of command.lines) {
      if (
        numbers.has(line.lineNumber) ||
        !UUID.test(line.a5LedgerAccountId) ||
        !/^b2f-account-map-/.test(line.mappingReference) ||
        !/^finance\.(asset|liability|equity|revenue|expense)\./.test(
          line.financeClassificationKey,
        ) ||
        !/^\d+$/.test(line.amountMinor) ||
        BigInt(line.amountMinor) <= 0n
      )
        return {
          code: 'LINE_INVALID',
          message: 'line identity, amount, classification, or mapping is invalid',
        };
      numbers.add(line.lineNumber);
      const mapping = await this.accountMappingService.verify({
        mappingReference: line.mappingReference,
        mappingVersion: line.mappingVersion,
        bookKey: 'finance.book.ng.primary',
        classificationKey: line.financeClassificationKey,
        a5LedgerAccountId: line.a5LedgerAccountId,
        accountingDate: command.accountingDate,
      });
      if (!mapping.compatible)
        return {
          code: 'FINANCE_MAPPING_INVALID',
          message: mapping.reasons.join(',') || 'Finance mapping is invalid',
        };
      let account: Awaited<ReturnType<LedgerService['getAccount']>>;
      try {
        account = await this.ledgerService.getAccount(line.a5LedgerAccountId);
      } catch {
        return { code: 'A5_ACCOUNT_INVALID', message: 'A5 account was not found or readable' };
      }
      const expected = line.financeClassificationKey.startsWith('finance.asset.')
        ? LedgerAccountType.ASSET
        : line.financeClassificationKey.startsWith('finance.liability.')
          ? LedgerAccountType.LIABILITY
          : line.financeClassificationKey.startsWith('finance.equity.')
            ? LedgerAccountType.EQUITY
            : line.financeClassificationKey.startsWith('finance.revenue.')
              ? LedgerAccountType.REVENUE
              : LedgerAccountType.EXPENSE;
      const normal = [LedgerAccountType.ASSET, LedgerAccountType.EXPENSE].includes(expected)
        ? LedgerNormalBalance.DEBIT
        : LedgerNormalBalance.CREDIT;
      if (
        !account.isActive ||
        account.accountType !== expected ||
        account.normalBalance !== normal ||
        account.currency !== 'NGN' ||
        account.accountingUnit !== 'CUSTOMER_FUNDS'
      )
        return {
          code: 'A5_MAPPING_INVALID',
          message: 'A5 account is incompatible with Finance classification/mapping',
        };
    }
    const admission = await this.fiscalPeriodService.checkAdmission({
      periodKey: command.periodKey,
      accountingDate: command.accountingDate,
      admissionKind:
        command.classification === 'CLOSE_ADJUSTMENT'
          ? 'CLOSE_ADJUSTMENT'
          : command.classification === 'REOPEN_CORRECTION'
            ? 'REOPEN_CORRECTION'
            : 'ORDINARY',
      expectedBookKey: 'finance.book.ng.primary',
      expectedBookVersion: 1,
      expectedLegalEntityReference: 'finance.legal-entity.ng.primary',
      expectedCurrency: 'NGN',
      expectedAccountingUnit: 'CUSTOMER_FUNDS',
    });
    if (!admission.compatible) return { code: 'PERIOD_NOT_ADMISSIBLE', message: admission.reason };
    return null;
  }
  private totals(lines: readonly B2FFinanceJournalLineV1[]) {
    return lines.reduce(
      (total, line) => {
        const amount = BigInt(line.amountMinor);
        if (line.direction === 'DEBIT') total.debit += amount;
        else total.credit += amount;
        return total;
      },
      { debit: 0n, credit: 0n },
    );
  }
  private async changeState(
    command: B2FFinanceJournalLifecycleCommandV1,
    from: string,
    to: 'PENDING_APPROVAL' | 'REJECTED',
    action: string,
  ): Promise<B2FFinanceJournalResultV1> {
    const hash = sha({
      reference: command.financeJournalReference,
      from,
      to,
      expectedRecordVersion: command.expectedRecordVersion,
      reason: command.reason.trim(),
    });
    return runSerializableWithRetry(
      this.dataSource,
      'B2FJournalGovernanceService.changeState',
      async (manager) => {
        const reservation = await this.idempotencyService.reserve(manager, {
          scope: LIFECYCLE_SCOPE,
          key: command.idempotencyKey,
          requestHash: hash,
          retentionSeconds: RETENTION,
        });
        if (reservation.kind === 'REPLAY') return this.replay(reservation.record.responseBody);
        const journal = await this.lock(manager, command.financeJournalReference);
        if (
          !journal ||
          journal.state !== from ||
          journal.recordVersion !== command.expectedRecordVersion
        )
          return this.finishRejected(
            manager,
            reservation.record.id,
            { code: 'INVALID_STATE_OR_VERSION', message: 'journal state or version is invalid' },
            journal ?? undefined,
          );
        const previous = journal.state;
        journal.state = to;
        journal.postingFailureCode = to === 'REJECTED' ? 'FINANCE_REJECTED' : null;
        journal.postingFailureMessage = to === 'REJECTED' ? command.reason.trim() : null;
        const saved = await manager.getRepository(B2FFinanceJournalGovernance).save(journal);
        await this.audit(
          manager,
          saved,
          action,
          command.principal.principalId,
          { state: previous },
          { state: to, reason: command.reason },
        );
        const result = {
          outcome: 'UPDATED',
          journal: this.view(saved),
          replayed: false,
          failure: null,
        } as const;
        await this.idempotencyService.complete(manager, reservation.record.id, {
          statusCode: 200,
          responseBody: result as unknown as Record<string, unknown>,
          resourceType: 'B2F_FINANCE_JOURNAL_GOVERNANCE',
          resourceId: saved.id,
        });
        return result;
      },
    );
  }
  private async lock(manager: EntityManager, reference: string) {
    return manager
      .getRepository(B2FFinanceJournalGovernance)
      .createQueryBuilder('journal')
      .where('journal.finance_journal_reference = :reference', { reference })
      .setLock('pessimistic_write')
      .getOne();
  }
  private async finishRejected(
    manager: EntityManager,
    id: string,
    failure: { code: string; message: string },
    journal?: B2FFinanceJournalGovernance,
  ): Promise<B2FFinanceJournalResultV1> {
    const result = {
      outcome: 'REJECTED',
      journal: journal ? this.view(journal) : null,
      replayed: false,
      failure,
    } as const;
    await this.idempotencyService.fail(manager, id, {
      statusCode: 409,
      responseBody: result as unknown as Record<string, unknown>,
      ...(journal
        ? { resourceType: 'B2F_FINANCE_JOURNAL_GOVERNANCE', resourceId: journal.id }
        : {}),
    });
    return result;
  }
  private replay(body: Record<string, unknown> | null): B2FFinanceJournalResultV1 {
    if (!body) throw new ConflictException('journal replay body missing');
    return {
      ...(body as unknown as B2FFinanceJournalResultV1),
      outcome: 'REPLAYED',
      replayed: true,
    };
  }
  private async audit(
    manager: EntityManager,
    journal: B2FFinanceJournalGovernance,
    action: string,
    actor: string,
    previous: Record<string, unknown> | null,
    next: Record<string, unknown>,
  ) {
    await this.auditService.record(manager, {
      entityType: 'B2F_FINANCE_JOURNAL_GOVERNANCE',
      entityId: journal.id,
      action,
      actor,
      correlationId: journal.correlationId,
      previousValues: previous ?? undefined,
      newValues: next,
    });
  }
  private view(j: B2FFinanceJournalGovernance): B2FFinanceJournalViewV1 {
    return {
      financeJournalReference: j.financeJournalReference,
      financeJournalVersion: 1,
      state: j.state,
      classification: j.classification,
      bookKey: 'finance.book.ng.primary',
      bookVersion: 1,
      legalEntityReference: 'finance.legal-entity.ng.primary',
      accountingBasis: 'ACCRUAL',
      periodKey: j.periodKey,
      periodVersion: 1,
      accountingDate: j.accountingDate,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      description: j.description,
      sourceDocument: j.sourceDocument,
      lines: j.lines,
      totalDebitMinor: j.totalDebitMinor,
      totalCreditMinor: j.totalCreditMinor,
      requestHash: j.requestHash,
      decisionHash: j.decisionHash,
      replayHash: j.replayHash,
      approvalId: j.approvalId,
      a5IdempotencyKey: j.a5IdempotencyKey,
      a5JournalId: j.a5JournalId,
      a5PostedAt: j.a5PostedAt?.toISOString() ?? null,
      postingFailureCode: j.postingFailureCode,
      postingFailureMessage: j.postingFailureMessage,
      correlationId: j.correlationId,
      causationId: j.causationId,
      recordVersion: j.recordVersion,
      createdAt: j.createdAt.toISOString(),
      updatedAt: j.updatedAt.toISOString(),
    };
  }
}
