import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { AuthorizationService } from './authorization.service';
import type { AuthorizationPrincipal } from './authorization.types';
import { governedAction } from './governed-action.registry';
import { PrivilegedActionApprovalStatus } from './privileged-action-approval.enums';
import { PrivilegedActionApproval } from './privileged-action-approval.entity';

/**
 * READ-ONLY projection of the governed-change approval ledger (Arena 3 Phase 4).
 *
 * WHY THIS EXISTS
 *   The commercial configuration screens must distinguish PROPOSED (REQUESTED) / APPROVED (not yet
 *   applied) / EXECUTED (CONSUMED) from EFFECTIVE (in force by window), and must show a rule's
 *   change history. The writer path (`PrivilegedActionApprovalService`) deliberately exposes only
 *   `getApproval(id)` — a decision endpoint keyed by an id the caller already holds — because the
 *   approval lifecycle must not be enumerable by an arbitrary caller.
 *
 *   This adds the ONE read the screens need without widening the write path or duplicating the
 *   approval engine:
 *     - READ ONLY. Two SELECTs. No transaction, no state transition, no audit mutation.
 *     - `resourceId` is the pivot: a caller must already know the rule it is asking about. There is
 *       no "list every approval" capability here.
 *     - The action names the caller may ask about come from the governed-action registry, so an
 *       unregistered action is refused rather than becoming a blind database probe.
 *     - Authorization is evaluated by `AuthorizationService` against the RESOURCE TYPE OF THE
 *       ACTION, requiring the same read function the corresponding registry already requires.
 *       No new function code, role or principal type is introduced.
 *
 * WHAT IT DELIBERATELY DOES NOT RETURN
 *   `policy`, the `actionFingerprint`, and requester/approver session ids are omitted: they are
 *   security-operational evidence an operator reading a configuration history does not need.
 */

export interface GovernedChangeHistoryEntry {
  approvalId: string;
  actionType: string;
  resourceType: string;
  resourceId: string | null;
  status: PrivilegedActionApprovalStatus;
  reason: string;
  requestedAt: string;
  expiresAt: string;
  approvedAt: string | null;
  rejectedAt: string | null;
  consumedAt: string | null;
  /** True only when the request has been consumed — i.e. the change was executed. */
  executed: boolean;
  /** Milliseconds until expiry while still REQUESTED/APPROVED; null otherwise. */
  expiresInMs: number | null;
}

export interface GovernedChangeHistory {
  actionType: string;
  resourceType: string;
  resourceId: string;
  entries: GovernedChangeHistoryEntry[];
}

const READ_FUNCTIONS: Readonly<Record<string, string>> = {
  // Resource type of the governed action → the read function its registry already requires.
  FEE_RULE: 'fee_rule.view',
  COMMISSION_RULE: 'commission_rule.view',
  REWARD_RULE: 'reward_rule.view',
  LIMIT_RULE: 'limit.view',
  PRODUCT: 'product.view',
};

/** Actions whose change history this surface is allowed to explain. */
const COMMERCIAL_ACTIONS = new Set([
  'FEE_RULE_CREATE',
  'FEE_RULE_MODIFY',
  'COMMISSION_RULE_CREATE',
  'COMMISSION_RULE_MODIFY',
  'REWARD_RULE_CREATE',
  'REWARD_RULE_MODIFY',
  'LIMIT_RULE_CREATE',
  'LIMIT_RULE_UPDATE',
  'PRODUCT_MODIFY',
]);

const MAX_LIMIT = 50;

@Injectable()
export class PrivilegedActionApprovalReadService {
  constructor(
    @InjectRepository(PrivilegedActionApproval)
    private readonly approvals: Repository<PrivilegedActionApproval>,
    private readonly auth: AuthorizationService,
  ) {}

  async history(
    principal: AuthorizationPrincipal | undefined,
    query: { actionType?: string; resourceId?: string; limit?: number },
  ): Promise<GovernedChangeHistory> {
    if (!principal) throw new ForbiddenException('Authentication required');

    const actionType = String(query.actionType ?? '')
      .trim()
      .toUpperCase();
    const resourceId = String(query.resourceId ?? '').trim();
    if (!actionType || !COMMERCIAL_ACTIONS.has(actionType))
      throw new ForbiddenException('actionType must be a registered commercial governed action');
    if (!resourceId) throw new ForbiddenException('resourceId is required');

    const definition = governedAction(actionType);
    if (!definition)
      throw new ForbiddenException('The requested action is not registered in this deployment');
    const readFunction = READ_FUNCTIONS[definition.resourceType];
    if (!readFunction)
      throw new ForbiddenException('This resource type has no commercial change history');

    // Same read function the owning registry already requires — no new grant is created.
    await this.auth.requireFunction(principal, readFunction, 'commercial_change_history', [
      'OPERATOR',
      'SERVICE',
      'PRIVILEGED',
    ]);

    const take = Math.min(Math.max(query.limit ?? 20, 1), MAX_LIMIT);
    const rows = await this.approvals.find({
      where: { actionType, resourceType: definition.resourceType, resourceId },
      order: { requestedAt: 'DESC' },
      take,
    });

    return {
      actionType,
      resourceType: definition.resourceType,
      resourceId,
      entries: rows.map((row) => this.toEntry(row)),
    };
  }

  private toEntry(row: PrivilegedActionApproval): GovernedChangeHistoryEntry {
    const executed = row.status === PrivilegedActionApprovalStatus.CONSUMED;
    const pending =
      row.status === PrivilegedActionApprovalStatus.REQUESTED ||
      row.status === PrivilegedActionApprovalStatus.APPROVED;
    return {
      approvalId: row.id,
      actionType: row.actionType,
      resourceType: row.resourceType,
      resourceId: row.resourceId,
      status: row.status,
      reason: row.reason ?? '',
      requestedAt: row.requestedAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
      approvedAt: row.approvedAt?.toISOString() ?? null,
      rejectedAt: row.rejectedAt?.toISOString() ?? null,
      consumedAt: row.consumedAt?.toISOString() ?? null,
      executed,
      expiresInMs: pending ? Math.max(0, row.expiresAt.getTime() - Date.now()) : null,
    };
  }
}
