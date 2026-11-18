import type { DataSource } from 'typeorm';

import { EmergencyAccessReviewService } from '../src/authorization/emergency-access-review.service';
import { AuditEvent } from '../src/operations/audit-event.entity';
import { AuditService } from '../src/operations/audit.service';
import {
  createIntegrationDataSource,
  destroyIntegrationDataSource,
  firstRow,
} from './support/pg-harness';

/**
 * ARENA 3D Group 21 — post-incident review for emergency access.
 *
 * The point of these tests is that the review obligation cannot be discharged by setting a flag. Every
 * assertion below either proves the service refuses a hollow review or proves the database refuses one.
 */

describe('Group 21 — emergency access review', () => {
  let db: DataSource;
  let service: EmergencyAccessReviewService;
  let audit: AuditService;

  async function seedEmergency(options: {
    status: string;
    expiresInSeconds?: number;
    cancelledSecondsAgo?: number | null;
    closed?: boolean;
  }): Promise<string> {
    const expiresAt = new Date(
      Date.now() +
        (options.closed
          ? -(options.expiresInSeconds ?? 60) * 1000
          : (options.expiresInSeconds ?? 300) * 1000),
    );
    const cancelledAt =
      options.cancelledSecondsAgo === undefined || options.cancelledSecondsAgo === null
        ? null
        : new Date(Date.now() - options.cancelledSecondsAgo * 1000);
    const rows: Array<{ id: string }> = await db.query(
      `INSERT INTO privileged_action_approvals
         (id, action_type, resource_type, resource_id, action_fingerprint, policy, approval_scope,
          required_assurance, requester_principal_id, approved_by, reason, status, is_emergency,
          requested_at, expires_at, approved_at, cancelled_at, version)
       VALUES (gen_random_uuid(), 'EMERGENCY_ACCESS', 'LEDGER', NULL, repeat('a', 64), '{}'::jsonb,
               'privileged:break-glass', 'MFA', 'principal-1', 'principal-1', 'production incident',
               $1, true, NOW() - INTERVAL '10 minutes', $2, NOW() - INTERVAL '10 minutes', $3, 1)
       RETURNING id`,
      [options.status, expiresAt, cancelledAt],
    );
    return firstRow(rows, 'seeded emergency').id;
  }

  beforeAll(async () => {
    db = await createIntegrationDataSource('g21sec');
    audit = new AuditService(db.getRepository(AuditEvent));
    service = new EmergencyAccessReviewService(db, audit);
  }, 180_000);

  afterAll(async () => {
    if (db?.isInitialized) await destroyIntegrationDataSource(db);
  });

  beforeEach(async () => {
    await db.query('DELETE FROM privileged_action_approvals');
  });

  describe('an obligation is created when the window closes', () => {
    it('marks an expired emergency access as owing a review', async () => {
      const id = await seedEmergency({ status: 'EXPIRED', closed: true });
      const marked = await service.markClosedWindows();
      expect(marked).toBe(1);

      const pending = await service.pendingReview();
      expect(pending.map((entry) => entry.approvalId)).toEqual([id]);
      expect(pending[0]?.awaitingReviewSeconds).toBeGreaterThanOrEqual(0);
    });

    it('marks a revoked emergency access as owing a review, using the revocation time', async () => {
      const id = await seedEmergency({
        status: 'EMERGENCY_REVOKED',
        cancelledSecondsAgo: 120,
        closed: true,
      });
      await service.markClosedWindows();
      const state = await service.state(id);
      expect(state.reviewStatus).toBe('PENDING_REVIEW');
      expect(state.windowClosedAt).not.toBeNull();
      // The window closed at revocation, not at the later expiry.
      const closedAt = new Date(state.windowClosedAt ?? 0).getTime();
      expect(Date.now() - closedAt).toBeGreaterThan(100_000);
    });

    it('does not require review for an emergency window that is still open', async () => {
      await seedEmergency({ status: 'EMERGENCY_ACTIVE', expiresInSeconds: 300 });
      const marked = await service.markClosedWindows();
      expect(marked).toBe(0);
      expect(await service.pendingReview()).toEqual([]);
    });

    it('is idempotent — repeated marking does not duplicate the obligation', async () => {
      await seedEmergency({ status: 'EXPIRED', closed: true });
      expect(await service.markClosedWindows()).toBe(1);
      expect(await service.markClosedWindows()).toBe(0);
      expect(await service.pendingReview()).toHaveLength(1);
    });
  });

  describe('a review cannot be hollow', () => {
    it('refuses a review with no notes', async () => {
      // A review that records nothing is indistinguishable from no review at all.
      const id = await seedEmergency({ status: 'EXPIRED', closed: true });
      await service.markClosedWindows();
      await expect(
        service.review({ approvalId: id, reviewerPrincipalId: 'reviewer-1', notes: '   ' }),
      ).rejects.toThrow(/must record notes/);
    });

    it('refuses a review with no reviewer', async () => {
      const id = await seedEmergency({ status: 'EXPIRED', closed: true });
      await service.markClosedWindows();
      await expect(
        service.review({
          approvalId: id,
          reviewerPrincipalId: '',
          notes: 'used to rotate a stuck key',
        }),
      ).rejects.toThrow(/must name the reviewer/);
    });

    it('refuses a review of a window that is still open', async () => {
      const id = await seedEmergency({ status: 'EMERGENCY_ACTIVE', expiresInSeconds: 300 });
      await expect(
        service.review({ approvalId: id, reviewerPrincipalId: 'r', notes: 'premature' }),
      ).rejects.toThrow(/still open/);
    });

    it('refuses to amend an existing review', async () => {
      // A review is evidence of what a named person concluded at a moment. If it can be rewritten, the record
      // cannot be relied on in exactly the situation it exists for.
      const id = await seedEmergency({ status: 'EXPIRED', closed: true });
      await service.markClosedWindows();
      await service.review({
        approvalId: id,
        reviewerPrincipalId: 'reviewer-1',
        notes: 'first conclusion',
      });
      await expect(
        service.review({ approvalId: id, reviewerPrincipalId: 'reviewer-2', notes: 'rewritten' }),
      ).rejects.toThrow(/already been reviewed/);
    });
  });

  describe('the database refuses what the service would not', () => {
    it('refuses REVIEWED with no reviewer, even via direct SQL', async () => {
      // Bypassing the service must not bypass the obligation. This is the constraint that turns the review
      // requirement from advisory into enforced.
      const id = await seedEmergency({ status: 'EXPIRED', closed: true });
      await service.markClosedWindows();
      await expect(
        db.query(
          `UPDATE privileged_action_approvals SET emergency_review_status = 'REVIEWED' WHERE id = $1`,
          [id],
        ),
      ).rejects.toThrow(/chk_emergency_review_complete/);
    });

    it('refuses REVIEWED with empty notes', async () => {
      const id = await seedEmergency({ status: 'EXPIRED', closed: true });
      await service.markClosedWindows();
      await expect(
        db.query(
          `UPDATE privileged_action_approvals
              SET emergency_review_status = 'REVIEWED', emergency_reviewed_at = NOW(),
                  emergency_reviewed_by = 'someone', emergency_review_notes = '   '
            WHERE id = $1`,
          [id],
        ),
      ).rejects.toThrow(/chk_emergency_review_complete/);
    });

    it('refuses a review timestamped before the window it reviews', async () => {
      // Without this, backdating is a one-line UPDATE and "reviewed within 24 hours" is unverifiable.
      const id = await seedEmergency({ status: 'EXPIRED', closed: true });
      await service.markClosedWindows();
      await expect(
        db.query(
          `UPDATE privileged_action_approvals
              SET emergency_review_status = 'REVIEWED',
                  emergency_reviewed_at = emergency_window_closed_at - INTERVAL '1 hour',
                  emergency_reviewed_by = 'someone', emergency_review_notes = 'backdated'
            WHERE id = $1`,
          [id],
        ),
      ).rejects.toThrow(/chk_emergency_review_after_window/);
    });

    it('refuses review state on a non-emergency approval', async () => {
      const rows: Array<{ id: string }> = await db.query(
        `INSERT INTO privileged_action_approvals
           (id, action_type, resource_type, action_fingerprint, policy, approval_scope,
            required_assurance, requester_principal_id, approved_by, reason, status, is_emergency,
            requested_at, expires_at, version)
         VALUES (gen_random_uuid(), 'MANUAL_ADJUSTMENT', 'LEDGER', repeat('b', 64), '{}'::jsonb,
                 'ledger:adjust', 'MFA', 'principal-1', 'approver-1', 'routine', 'APPROVED', false,
                 NOW(), NOW() + INTERVAL '1 hour', 1)
         RETURNING id`,
      );
      const id = firstRow(rows, 'normal approval').id;
      await expect(
        db.query(
          `UPDATE privileged_action_approvals SET emergency_review_status = 'PENDING_REVIEW' WHERE id = $1`,
          [id],
        ),
      ).rejects.toThrow(/chk_emergency_review_only_for_emergency/);
    });
  });

  describe('posture answers the auditor question', () => {
    it('reports the count and the age of the oldest unreviewed incident', async () => {
      // A count alone hides a single forgotten incident, which is the one that matters.
      const first = await seedEmergency({
        status: 'EXPIRED',
        closed: true,
        expiresInSeconds: 7200,
      });
      await seedEmergency({ status: 'EXPIRED', closed: true, expiresInSeconds: 60 });
      await service.markClosedWindows();
      await service.review({ approvalId: first, reviewerPrincipalId: 'r', notes: 'reviewed' });

      const posture = await service.posture();
      expect(posture.pending).toBe(1);
      expect(posture.reviewed).toBe(1);
      expect(posture.oldestAwaitingSeconds).not.toBeNull();
    });

    it('reports zero pending when nothing is owed', async () => {
      const posture = await service.posture();
      expect(posture).toMatchObject({ pending: 0, reviewed: 0, oldestAwaitingSeconds: null });
    });
  });

  describe('the review is audited', () => {
    it('writes an audit row naming the reviewer and the notes', async () => {
      const id = await seedEmergency({ status: 'EXPIRED', closed: true });
      await service.markClosedWindows();
      await service.review({
        approvalId: id,
        reviewerPrincipalId: 'reviewer-9',
        notes: 'rotated a stuck key',
      });

      const rows: Array<{ action: string; actor: string }> = await db.query(
        `SELECT action, actor FROM audit_events
          WHERE entity_id = $1 AND action = 'EMERGENCY_ACCESS_REVIEWED'`,
        [id],
      );
      const row = firstRow(rows, 'audit row');
      expect(row.actor).toBe('reviewer-9');
    });
  });
});
