/**
 * ARENA 3D Group 21 — post-incident review for emergency (break-glass) access.
 *
 * ## The gap this closes
 *
 * `PrivilegedActionApprovalService` already gates break-glass properly: `PRIVILEGED` principal, `MFA`
 * assurance, `privileged:break-glass` scope, bounded TTL, lazy expiry enforcement, revocation, and an audit
 * row plus a security event on every transition.
 *
 * What it did not have was the step after. Once an emergency window closed, **nothing required anyone to look
 * at what happened during it**. That is the most common way a temporary emergency grant becomes permanent: not
 * by failing to expire, but by nobody ever asking what it was used for.
 *
 * ## What this service does, and does not do
 *
 * It **records** an obligation and its discharge. It does not grant, extend, widen or approve anything, and it
 * introduces no new permission — review is a record-keeping duty attached to an existing privileged action.
 * Inventing a `break-glass:review` scope would be a security decision that belongs to the product owner.
 *
 * ## Why the obligation is enforced at the database
 *
 * A review requirement that lives only in a dashboard is advisory. The CHECK constraints in migration
 * `1785753600608` make an invalid review *unrepresentable*: `REVIEWED` requires a timestamp, a reviewer and
 * non-empty notes, and the review cannot be timestamped before the window it reviews. Without that, a
 * review requirement is satisfied by flipping a flag.
 */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { AuditService } from '../operations/audit.service';
import { SecurityEventType } from '../customer-authentication/customer-authentication.enums';

/** An emergency access whose window has closed and which still owes a review. */
export interface PendingEmergencyReview {
  approvalId: string;
  resourceType: string;
  resourceId: string | null;
  requesterPrincipalId: string;
  reason: string;
  windowClosedAt: string;
  /** How long the review has been owed. The number that matters in an audit. */
  awaitingReviewSeconds: number;
}

export interface EmergencyReviewRecord {
  approvalId: string;
  reviewStatus: 'PENDING_REVIEW' | 'REVIEWED' | null;
  reviewedAt: string | null;
  reviewedBy: string | null;
  notes: string | null;
  windowClosedAt: string | null;
}

export interface ReviewCommand {
  approvalId: string;
  reviewerPrincipalId: string;
  notes: string;
  now?: Date;
}

@Injectable()
export class EmergencyAccessReviewService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Marks the closed emergency windows that owe a review.
   *
   * Idempotent, and safe to call repeatedly: it only ever transitions `NULL → PENDING_REVIEW` for windows
   * that have already closed. It never touches `REVIEWED` rows, because re-flagging a reviewed incident would
   * make the obligation meaningless.
   */
  async markClosedWindows(now = new Date()): Promise<number> {
    return this.dataSource.transaction(async (manager) => {
      /*
       * The window closes at expiry, or earlier at revocation. `LEAST` of the two, ignoring nulls, is what
       * "closed at" means; `cancelled_at` is set on revocation.
       */
      // `query()` returns `[rows, affectedCount]` for a data-modifying statement with RETURNING; treating the
      // tuple as a row array yields rows whose fields are all undefined, and the audit call then fails on a
      // null entity id rather than anywhere near the cause.
      const result: unknown = await manager.query(
        `UPDATE privileged_action_approvals
            SET emergency_review_status = 'PENDING_REVIEW',
                emergency_window_closed_at = COALESCE(cancelled_at, expires_at)
          WHERE is_emergency = true
            AND emergency_review_status IS NULL
            AND status IN ('EMERGENCY_REVOKED', 'EXPIRED')
            AND COALESCE(cancelled_at, expires_at) <= $1
          RETURNING id`,
        [now],
      );
      const rows = rowsOf<{ id: string }>(result);
      for (const row of rows) {
        await this.auditService.record(manager, {
          entityType: 'PRIVILEGED_ACTION_APPROVAL',
          entityId: row.id,
          action: SecurityEventType.EMERGENCY_ACCESS_REVIEW_REQUIRED,
          actor: 'emergency-review',
          newValues: { requirement: 'post-incident review owed' },
        });
      }
      return rows.length;
    });
  }

  /** Emergency accesses currently owing a review, longest-waiting first. */
  async pendingReview(limit = 100): Promise<PendingEmergencyReview[]> {
    const rows: Array<{
      id: string;
      resource_type: string;
      resource_id: string | null;
      requester_principal_id: string;
      reason: string;
      emergency_window_closed_at: Date | string;
      awaiting_seconds: string;
    }> = await this.dataSource.query(
      `SELECT id, resource_type, resource_id, requester_principal_id, reason,
              emergency_window_closed_at,
              EXTRACT(EPOCH FROM (NOW() - emergency_window_closed_at))::text AS awaiting_seconds
         FROM privileged_action_approvals
        WHERE is_emergency = true
          AND emergency_review_status = 'PENDING_REVIEW'
        ORDER BY emergency_window_closed_at ASC
        LIMIT $1`,
      [Math.min(Math.max(limit, 1), 500)],
    );
    return rows.map((row) => ({
      approvalId: row.id,
      resourceType: row.resource_type,
      resourceId: row.resource_id,
      requesterPrincipalId: row.requester_principal_id,
      reason: row.reason,
      windowClosedAt: toIso(row.emergency_window_closed_at),
      awaitingReviewSeconds: Math.floor(Number(row.awaiting_seconds)),
    }));
  }

  /**
   * Records a review.
   *
   * Requires notes. A review that records nothing is indistinguishable from no review, and the database
   * refuses it — so this rejects it with a clear message rather than letting the constraint produce an opaque
   * error.
   */
  async review(command: ReviewCommand): Promise<EmergencyReviewRecord> {
    const notes = typeof command.notes === 'string' ? command.notes.trim() : '';
    if (notes.length === 0) {
      throw new BadRequestException(
        'A review must record notes describing what the emergency access was used for',
      );
    }
    if (notes.length > 1000) {
      throw new BadRequestException('Review notes must be 1000 characters or fewer');
    }
    if (!command.reviewerPrincipalId) {
      throw new BadRequestException('A review must name the reviewer');
    }
    const now = command.now ?? new Date();

    return this.dataSource.transaction(async (manager) => {
      const rows: Array<{
        id: string;
        emergency_review_status: string | null;
        emergency_window_closed_at: Date | string | null;
      }> = await manager.query(
        `SELECT id, emergency_review_status, emergency_window_closed_at
           FROM privileged_action_approvals
          WHERE id = $1 AND is_emergency = true
          FOR UPDATE`,
        [command.approvalId],
      );
      const row = rows[0];
      if (!row) throw new NotFoundException('Emergency access not found');
      if (row.emergency_review_status === 'REVIEWED') {
        /*
         * Reviews are not amendable through this path.
         *
         * A review is evidence of what a named person concluded at a moment. Letting it be rewritten would
         * mean the record cannot be relied on in exactly the situation it exists for. A correction is a new,
         * separately auditable action — not an edit.
         */
        throw new BadRequestException('This emergency access has already been reviewed');
      }
      if (row.emergency_review_status === null) {
        // The window has not closed yet — there is nothing to review.
        throw new BadRequestException(
          'The emergency access window is still open; nothing to review yet',
        );
      }

      await manager.query(
        `UPDATE privileged_action_approvals
            SET emergency_review_status = 'REVIEWED',
                emergency_reviewed_at = $2,
                emergency_reviewed_by = $3,
                emergency_review_notes = $4
          WHERE id = $1`,
        [command.approvalId, now, command.reviewerPrincipalId.slice(0, 160), notes],
      );

      await this.auditService.record(manager, {
        entityType: 'PRIVILEGED_ACTION_APPROVAL',
        entityId: command.approvalId,
        action: SecurityEventType.EMERGENCY_ACCESS_REVIEWED,
        actor: command.reviewerPrincipalId,
        newValues: { reviewedAt: now, notes },
      });

      return {
        approvalId: command.approvalId,
        reviewStatus: 'REVIEWED',
        reviewedAt: now.toISOString(),
        reviewedBy: command.reviewerPrincipalId,
        notes,
        windowClosedAt:
          row.emergency_window_closed_at === null ? null : toIso(row.emergency_window_closed_at),
      };
    });
  }

  /**
   * Review state for one emergency access.
   *
   * Exposed because "was this reviewed?" is the first question asked after an incident, and it should not
   * require a database console.
   */
  async state(approvalId: string): Promise<EmergencyReviewRecord> {
    const rows: Array<{
      id: string;
      emergency_review_status: string | null;
      emergency_reviewed_at: Date | string | null;
      emergency_reviewed_by: string | null;
      emergency_review_notes: string | null;
      emergency_window_closed_at: Date | string | null;
    }> = await this.dataSource.query(
      `SELECT id, emergency_review_status, emergency_reviewed_at, emergency_reviewed_by,
              emergency_review_notes, emergency_window_closed_at
         FROM privileged_action_approvals
        WHERE id = $1 AND is_emergency = true`,
      [approvalId],
    );
    const row = rows[0];
    if (!row) throw new NotFoundException('Emergency access not found');
    return {
      approvalId: row.id,
      reviewStatus: (row.emergency_review_status as EmergencyReviewRecord['reviewStatus']) ?? null,
      reviewedAt: row.emergency_reviewed_at === null ? null : toIso(row.emergency_reviewed_at),
      reviewedBy: row.emergency_reviewed_by,
      notes: row.emergency_review_notes,
      windowClosedAt:
        row.emergency_window_closed_at === null ? null : toIso(row.emergency_window_closed_at),
    };
  }

  /**
   * Aggregate review posture.
   *
   * `oldestAwaitingSeconds` is the number an auditor asks for: "how long has the oldest unreviewed emergency
   * access been waiting?" A count alone hides a single forgotten incident.
   */
  async posture(): Promise<{
    pending: number;
    reviewed: number;
    oldestAwaitingSeconds: number | null;
  }> {
    const rows: Array<{ pending: string; reviewed: string; oldest: string | null }> =
      await this.dataSource.query(
        `SELECT count(*) FILTER (WHERE emergency_review_status = 'PENDING_REVIEW')::text AS pending,
                count(*) FILTER (WHERE emergency_review_status = 'REVIEWED')::text AS reviewed,
                EXTRACT(EPOCH FROM (
                  NOW() - min(emergency_window_closed_at)
                    FILTER (WHERE emergency_review_status = 'PENDING_REVIEW')
                ))::text AS oldest
           FROM privileged_action_approvals
          WHERE is_emergency = true`,
      );
    const row = rows[0];
    return {
      pending: Number(row?.pending ?? 0),
      reviewed: Number(row?.reviewed ?? 0),
      oldestAwaitingSeconds:
        row?.oldest === null || row?.oldest === undefined ? null : Math.floor(Number(row.oldest)),
    };
  }
}

/** Unwraps a TypeORM `query()` result into plain rows (see `worker-lease.service.ts` for the same helper). */
function rowsOf<T>(result: unknown): T[] {
  if (!Array.isArray(result)) return [];
  const first: unknown = result[0];
  const second: unknown = result[1];
  if (result.length === 2 && Array.isArray(first) && !Array.isArray(second)) return first as T[];
  return result as T[];
}

function toIso(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}
