import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import {
  governedAction,
  governedChangeFingerprint,
  LEDGER_JOURNAL_REVERSAL_ACTION,
} from '../authorization/governed-action.registry';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import { PrivilegedActionApprovalService } from '../authorization/privileged-action-approval.service';
import {
  governedChangeConsumptionError,
} from '../authorization/commercial-rule-governance.service';
import type {
  GovernedChangeRequestView,
} from '../authorization/commercial-rule-governance.service';
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
 *    (FINGERPRINT_MISMATCH), replays (CONSUMED) and unentitled executors under the established
 *    separation-of-duties controls.
 *
 * The reversal primitive itself (`LedgerService.reverseJournal`) is untouched; this service only
 * adds the governance layer in front of it. Unknown journals, missing reasons, reversals of
 * reversals and already-reversed journals are rejected using the reversal domain's existing
 * rules.
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
   * reversal payload and only then delegates to `LedgerService.reverseJournal`. A request
   * approved for one (journal, reason) pair can never execute a different one (fingerprint
   * binding), can never be replayed (CONSUMED), and can never be executed by the maker
   * (established consume() separation-of-duties rule).
   */
  async executeReversal(command: ExecuteReversalCommand): Promise<LedgerJournalView> {
    this.assertExecuteEntitled(command.principal);
    const reason = this.normalizeReason(command.reason);
    const journalId = this.normalizeJournalId(command.journalId);
    const approvalId = (command.approvalId ?? '').trim();
    if (!approvalId) {
      throw new BadRequestException('approvalId is required to execute a governed journal reversal');
    }
    const approval = await this.approvals.getApproval(approvalId);
    if (!approval) {
      throw new NotFoundException('Approval not found');
    }
    if (approval.actionType !== REVERSAL_ACTION || approval.resourceType !== REVERSAL_RESOURCE_TYPE) {
      throw new ForbiddenException('Approval does not govern a journal reversal');
    }
    if (approval.resourceId !== journalId) {
      throw new ForbiddenException('Approval does not govern this journal');
    }
    // Domain pre-checks BEFORE consumption so a known-bad reversal (already reversed, reversal of
    // a reversal) never burns the approval — the reversal domain's existing rules.
    await this.assertReversible(journalId);

    const actionFingerprint = ledgerReversalRequestFingerprint(journalId, reason);
    const consumed = await this.approvals.consume({
      principal: command.principal,
      approvalId,
      actionType: REVERSAL_ACTION,
      resource: { type: REVERSAL_RESOURCE_TYPE, id: journalId },
      actionFingerprint,
      now: command.now,
    });
    if (!consumed.approved) {
      throw governedChangeConsumptionError(consumed.reason, consumed.approval?.status);
    }
    return this.ledgerService.reverseJournal(
      journalId,
      command.idempotencyKey ?? `rev-${journalId}-${approvalId}`,
      reason,
    );
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
    if (!entitled) {
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
    return normalized;
  }
}
