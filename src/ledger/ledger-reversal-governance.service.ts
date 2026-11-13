import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import { PrivilegedActionApproval } from '../authorization/privileged-action-approval.entity';
import { PrivilegedActionApprovalStatus } from '../authorization/privileged-action-approval.enums';

import {
  governedAction,
  governedChangeFingerprint,
  LEDGER_JOURNAL_REVERSAL_ACTION,
} from '../authorization/governed-action.registry';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import { PrivilegedActionApprovalService } from '../authorization/privileged-action-approval.service';
import { governedChangeConsumptionError } from '../authorization/commercial-rule-governance.service';
import type { GovernedChangeRequestView } from '../authorization/commercial-rule-governance.service';
import { LedgerJournal } from './ledger-journal.entity';
import type { LedgerJournalView } from './ledger.types';
import { LedgerService } from './ledger.service';

/**
 * Ledger journal reversal maker-request governance (P0-B).
 *
 * Repairs the ledger-reversal maker-request wiring against the registered governed action and
 * resource types from `V1-ADMIN-ROLE-AND-FUNCTION-MODEL-01` §8/§10:
 *
 *  - action type `LEDGER_JOURNAL_REVERSAL` (NOT `FINANCE_CONTROL_POLICY_ACTIVATE`), resource type
 *    `LEDGER_JOURNAL` bound to the journal being reversed (NOT `A2_FINANCE_ROLE_ASSIGNMENT`);
 *  - the action fingerprint is a deterministic hash derived from the ACTUAL reversal request
 *    (action + journal id + reason) via the existing canonicalization rules
 *    (`workforce-crypto.canonical` + `sha256`) — computed server-side here, never supplied by the
 *    caller (the previous UI sent a hardcoded placeholder fingerprint, which is now impossible);
 *  - a FINANCE_PREPARER initiates, a FINANCE_CONTROLLER independently approves through the
 *    existing `PrivilegedActionApprovalService` machinery ("reusing the existing
 *    PrivilegedActionApprovalService mechanism exactly as FINANCE_CONTROL_POLICY_ACTIVATE already
 *    does"), and execution consumes the approved request — rejecting tampered payloads
 *    (FINGERPRINT_MISMATCH) and unentitled executors under the established separation-of-duties
 *    controls; matching retries return the original committed result.
 *
 * Approval consumption, exact reversal posting and immutable execution binding commit together.
 * Unknown journals, reversals of reversals, mismatched requests and unbound replays are rejected.
 */
export interface RequestReversalCommand {
  principal: AuthorizationPrincipal;
  journalId: string;
  reason: string;
  expiresInSeconds?: number;
  now?: Date;
}

export interface ExecuteReversalCommand {
  principal: AuthorizationPrincipal;
  journalId: string;
  reason: string;
  approvalId: string;
  idempotencyKey?: string;
  correlationId?: string;
  now?: Date;
}

const REVERSAL_ACTION = LEDGER_JOURNAL_REVERSAL_ACTION.action;
const REVERSAL_RESOURCE_TYPE = LEDGER_JOURNAL_REVERSAL_ACTION.resourceType;

export function ledgerReversalRequestFingerprint(journalId: string, reason: string): string {
  return governedChangeFingerprint(REVERSAL_ACTION, REVERSAL_RESOURCE_TYPE, journalId, {
    reason,
  });
}

@Injectable()
export class LedgerReversalGovernanceService {
  constructor(
    @InjectRepository(LedgerJournal)
    private readonly journalRepository: Repository<LedgerJournal>,
    private readonly ledgerService: LedgerService,
    private readonly approvals: PrivilegedActionApprovalService,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Maker side: creates the pending maker-checker request for reversing `journalId`. Returns the
   * pending approval (status REQUESTED) carrying the registered action/resource types and the
   * server-computed deterministic fingerprint. No ledger posting of any kind happens here.
   */
  async requestReversal(command: RequestReversalCommand): Promise<GovernedChangeRequestView> {
    const reason = this.normalizeReason(command.reason);
    const journalId = this.normalizeJournalId(command.journalId);
    const definition = governedAction(REVERSAL_ACTION)!;
    await this.assertReversible(journalId);
    const actionFingerprint = ledgerReversalRequestFingerprint(journalId, reason);
    const decision = await this.approvals.request({
      principal: command.principal,
      policy: {
        resourceType: definition.resourceType,
        action: definition.action,
        allowedPrincipalTypes: ['OPERATOR', 'PRIVILEGED'],
        requiredRoles: definition.initiatingRoles,
        requiredFunctions: definition.initiatingFunctionCodes,
        minimumAssurance: definition.minimumAssurance,
        customerAccess: 'NONE',
      },
      resource: { type: definition.resourceType, id: journalId },
      actionFingerprint,
      reason,
      approvalScope: definition.approvalScope,
      expiresInSeconds: command.expiresInSeconds,
      now: command.now,
    });
    if (!decision.approval) {
      throw new ForbiddenException(
        `Reversal maker request denied: ${decision.reason ?? 'UNAUTHORIZED'}`,
      );
    }
    return {
      approvalId: decision.approval.id,
      status: decision.approval.status,
      actionType: decision.approval.actionType,
      resourceType: decision.approval.resourceType,
      resourceId: decision.approval.resourceId,
      actionFingerprint: decision.approval.actionFingerprint,
      requestedAt: decision.approval.requestedAt,
      expiresAt: decision.approval.expiresAt,
    };
  }

  /**
   * Checker-execution side: consumes the approved maker-checker request against the ACTUAL
   * reversal payload and posts the exact inverse in the same transaction. A request
   * approved for one (journal, reason) pair can never execute a different one (fingerprint
   * binding), and may only replay the original result with the same idempotency key.
   * Approval consumption, posting, audit and the execution record commit together.
   */
  async executeReversal(command: ExecuteReversalCommand): Promise<LedgerJournalView> {
    this.assertExecuteEntitled(command.principal);
    const reason = this.normalizeReason(command.reason);
    const journalId = this.normalizeJournalId(command.journalId);
    const approvalId = (command.approvalId ?? '').trim().toLowerCase();
    if (!approvalId) {
      throw new BadRequestException(
        'approvalId is required to execute a governed journal reversal',
      );
    }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(approvalId)) {
      throw new BadRequestException('approvalId must be a UUID');
    }
    const key = (command.idempotencyKey ?? `rev-${journalId}-${approvalId}`).trim();
    if (!key || key.length > 255) throw new BadRequestException('Invalid idempotency key');
    const fingerprint = ledgerReversalRequestFingerprint(journalId, reason);
    const reversalId = await this.dataSource
      .transaction(async (manager) => {
        // Serializes consumption and replays of the same approval. A separate journal lock
        // serializes distinct approvals for the same original, without touching its history.
        const approval = await manager.getRepository(PrivilegedActionApproval).findOne({
          where: { id: approvalId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!approval) throw new NotFoundException('Approval not found');
        if (
          approval.actionType !== REVERSAL_ACTION ||
          approval.resourceType !== REVERSAL_RESOURCE_TYPE
        )
          throw new ForbiddenException('Approval does not govern a journal reversal');
        if (approval.resourceId?.toLowerCase() !== journalId)
          throw new ForbiddenException('Approval does not govern this journal');
        if (approval.customerId !== null || approval.actionFingerprint !== fingerprint)
          throw governedChangeConsumptionError('FINGERPRINT_MISMATCH');
        if (
          approval.requesterPrincipalId === command.principal.principalId ||
          (approval.approvedBy !== command.principal.principalId &&
            !command.principal.scopes.includes('privileged:execute'))
        )
          throw governedChangeConsumptionError('APPROVAL_SCOPE_MISSING');

        if (approval.status === PrivilegedActionApprovalStatus.CONSUMED) {
          const executions = await manager.query<
            Array<{ reversal_journal_id: string; idempotency_key: string }>
          >(
            `SELECT reversal_journal_id, idempotency_key FROM governed_ledger_reversal_executions
           WHERE approval_id=$1 AND original_journal_id=$2`,
            [approvalId, journalId],
          );
          if (executions.length !== 1 || executions[0]!.idempotency_key !== key)
            throw new ConflictException('Approval has already been consumed');
          return executions[0]!.reversal_journal_id;
        }

        const original = await manager.getRepository(LedgerJournal).findOne({
          where: { id: journalId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!original) throw new NotFoundException(`Journal ${journalId} was not found`);
        if (original.reversalOfJournalId)
          throw new ConflictException('A reversal cannot itself be reversed');
        const consumed = await this.approvals.consumeInTransaction(manager, {
          principal: command.principal,
          approvalId,
          actionType: REVERSAL_ACTION,
          resource: { type: REVERSAL_RESOURCE_TYPE, id: journalId },
          actionFingerprint: fingerprint,
          now: command.now,
        });
        if (!consumed.approved)
          throw governedChangeConsumptionError(consumed.reason, consumed.approval?.status);
        const id = await this.ledgerService.reverseJournalInTransaction(
          manager,
          journalId,
          key,
          reason,
          approvalId,
        );
        await manager.query(
          `INSERT INTO governed_ledger_reversal_executions
         (approval_id,original_journal_id,reversal_journal_id,idempotency_key,executed_by)
         VALUES($1,$2,$3,$4,$5)`,
          [approvalId, journalId, id, key, command.principal.principalId],
        );
        return id;
      })
      .catch((error: unknown) => {
        if (error instanceof QueryFailedError) {
          const driver = error.driverError as { code?: string; constraint?: string };
          if (
            driver.code === '23505' &&
            ['uq_ledger_journals_reversal_of', 'uq_ledger_journals_idempotency_key'].includes(
              driver.constraint ?? '',
            )
          ) {
            throw new ConflictException('Journal or idempotency key has already been used');
          }
        }
        throw error;
      });
    return this.ledgerService.getJournal(reversalId);
  }

  /**
   * Mirrors the executor-entitlement rule `PrivilegedActionApprovalService.consume()` enforces
   * (executor must be the approver or hold `privileged:execute`) as an explicit early gate, so
   * the maker is rejected before any consumption attempt. Not a new policy — the same rule the
   * established consume() control applies, surfaced as a clear 403.
   */
  assertExecuteEntitled(principal: AuthorizationPrincipal): void {
    const entitled =
      principal.roles.includes('FINANCE_CONTROLLER') ||
      principal.scopes.includes('privileged:execute');
    if (
      !entitled ||
      !['OPERATOR', 'SERVICE', 'PRIVILEGED'].includes(principal.type) ||
      principal.assuranceLevel !== 'MFA' ||
      principal.readOnlyPrincipal
    ) {
      throw new ForbiddenException(
        'Only the approving FINANCE_CONTROLLER or a privileged:execute principal may execute an approved journal reversal',
      );
    }
  }

  private async assertReversible(journalId: string): Promise<LedgerJournal> {
    const journal = await this.journalRepository.findOne({ where: { id: journalId } });
    if (!journal) {
      throw new NotFoundException(`Journal ${journalId} was not found`);
    }
    if (journal.reversalOfJournalId) {
      throw new ConflictException('A reversal cannot itself be reversed');
    }
    const existingReversal = await this.journalRepository.findOne({
      where: { reversalOfJournalId: journalId },
    });
    if (existingReversal) {
      throw new ConflictException('This journal has already been reversed');
    }
    return journal;
  }

  private normalizeReason(reason: string): string {
    const normalized = (reason ?? '').trim();
    if (!normalized || normalized.length > 500) {
      throw new BadRequestException('reason must contain 1 to 500 characters');
    }
    return normalized;
  }

  private normalizeJournalId(journalId: string): string {
    const normalized = (journalId ?? '').trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(normalized)) {
      throw new BadRequestException('journalId must be a UUID');
    }
    return normalized.toLowerCase();
  }
}
