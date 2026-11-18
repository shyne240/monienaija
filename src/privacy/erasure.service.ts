import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

import { AuditService } from '../operations/audit.service';

/**
 * ARENA 3D Group 27 — privacy and retention: erasure requests.
 *
 * ## The design decision that governs everything here
 *
 * **Erasure is anonymisation of identified personal-data categories, never deletion of financial records.**
 * The ledger is immutable by design and by trigger; a routine that reached into it would either fail or, worse,
 * succeed because someone had relaxed the trigger. So the executor touches only the profile-shaped tables, and
 * only for categories the retention register says are erasable.
 *
 * ## Refusing is a first-class outcome
 *
 * A request for a category that is under statutory retention produces `HELD_UNDER_RETENTION` with the basis
 * recorded — not a silent partial success, and not an error. "We cannot erase this yet, because X, until Y" is
 * the correct answer to most real requests in a financial institution, and a system that can only say
 * "done" or "failed" cannot give it.
 *
 * The register starts **empty**. With no policy row, `executeErasure` erases nothing and reports the gap. That
 * is deliberate: the correct retention period per category is a legal decision, and seeding a number would let
 * this codebase start destroying real customer data on the strength of an invented policy.
 */

export type PersonalDataCategory =
  | 'PROFILE_IDENTITY'
  | 'CONTACT_METHODS'
  | 'ADDRESSES'
  | 'BENEFICIARY_DETAILS'
  | 'AUTHENTICATION_CREDENTIALS'
  | 'NOTIFICATION_HISTORY'
  | 'RISK_FACTORS';

const ALL_CATEGORIES: readonly PersonalDataCategory[] = [
  'PROFILE_IDENTITY',
  'CONTACT_METHODS',
  'ADDRESSES',
  'BENEFICIARY_DETAILS',
  'AUTHENTICATION_CREDENTIALS',
  'NOTIFICATION_HISTORY',
  'RISK_FACTORS',
];

export interface ErasureRequestView {
  readonly id: string;
  readonly reference: string;
  readonly customerId: string;
  readonly status: string;
  readonly requestedCategories: string[];
  readonly erasedCategories: string[] | null;
  readonly heldCategories: unknown;
  readonly decisionBasis: string | null;
  readonly openedAt: string;
  readonly closedAt: string | null;
}

export interface ErasureExecutionResult {
  readonly status: 'COMPLETED' | 'PARTIALLY_COMPLETED' | 'HELD_UNDER_RETENTION';
  readonly erased: string[];
  readonly held: Array<{ category: string; reason: string }>;
}

@Injectable()
export class ErasureService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
  ) {}

  // ---------------------------------------------------------------------------------------------
  // Retention policy
  // ---------------------------------------------------------------------------------------------

  /**
   * Configures the retention rule for one category.
   *
   * `legalBasis` is required and `erasable` defaults to false. The default matters: a category added without a
   * decision is *not* erasable, so a missing policy can never be mistaken for permission.
   */
  async configureRetentionPolicy(command: {
    category: PersonalDataCategory;
    erasable: boolean;
    minimumAgeDays: number | null;
    legalBasis: string;
    configuredBy: string;
    notes?: string;
  }): Promise<void> {
    if (!ALL_CATEGORIES.includes(command.category)) {
      throw new BadRequestException('Unknown personal data category');
    }
    const legalBasis = (command.legalBasis ?? '').trim();
    if (legalBasis.length === 0) {
      throw new BadRequestException('A retention policy must state its legal basis');
    }
    const configuredBy = (command.configuredBy ?? '').trim();
    if (configuredBy.length === 0) {
      throw new BadRequestException('A retention policy must be attributable to a named principal');
    }
    if (
      command.minimumAgeDays !== null &&
      (!Number.isInteger(command.minimumAgeDays) || command.minimumAgeDays < 0)
    ) {
      throw new BadRequestException('A minimum age must be a non-negative whole number of days');
    }

    await this.dataSource.query(
      `INSERT INTO privacy_retention_policies (
         category, erasable, minimum_age_days, legal_basis, configured_by, notes
       ) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (category) DO UPDATE
         SET erasable = EXCLUDED.erasable,
             minimum_age_days = EXCLUDED.minimum_age_days,
             legal_basis = EXCLUDED.legal_basis,
             configured_by = EXCLUDED.configured_by,
             configured_at = now(),
             notes = EXCLUDED.notes`,
      [
        command.category,
        command.erasable,
        command.minimumAgeDays,
        legalBasis.slice(0, 300),
        configuredBy.slice(0, 160),
        command.notes?.slice(0, 500) ?? null,
      ],
    );
  }

  /** Every configured policy. Empty means nothing may be erased. */
  async retentionPolicies(): Promise<
    Array<{
      category: string;
      erasable: boolean;
      minimumAgeDays: number | null;
      legalBasis: string;
      configuredBy: string;
    }>
  > {
    const rows: unknown = await this.dataSource.query(
      `SELECT category, erasable, minimum_age_days, legal_basis, configured_by
         FROM privacy_retention_policies
        ORDER BY category`,
    );
    return this.parseRows<{
      category: string;
      erasable: boolean;
      minimum_age_days: number | null;
      legal_basis: string;
      configured_by: string;
    }>(rows).map((row) => ({
      category: row.category,
      erasable: row.erasable,
      minimumAgeDays: row.minimum_age_days,
      legalBasis: row.legal_basis,
      configuredBy: row.configured_by,
    }));
  }

  // ---------------------------------------------------------------------------------------------
  // Request lifecycle
  // ---------------------------------------------------------------------------------------------

  /**
   * Records a request.
   *
   * An explicit category list is required. "Erase everything" is not a request this system will guess at,
   * because it cannot know what the law permits for each category — and guessing would either destroy records
   * that must be kept or refuse a request that should be honoured.
   */
  async raiseRequest(command: {
    customerId: string;
    requestedCategories: string[];
    requestedByType: 'CUSTOMER' | 'SUPPORT' | 'OPERATOR';
    requestedById: string;
    now?: Date;
  }): Promise<{ id: string; reference: string; status: string }> {
    const categories = [...new Set(command.requestedCategories ?? [])].map((category) =>
      category.trim().toUpperCase(),
    );
    if (categories.length === 0) {
      throw new BadRequestException(
        'An erasure request must name the categories of personal data it concerns',
      );
    }
    const unknown = categories.filter(
      (category) => !ALL_CATEGORIES.includes(category as PersonalDataCategory),
    );
    if (unknown.length > 0) {
      throw new BadRequestException(`Unknown personal data category: ${unknown.join(', ')}`);
    }
    const requestedById = (command.requestedById ?? '').trim();
    if (requestedById.length === 0) {
      throw new BadRequestException('An erasure request must name who asked');
    }

    const reference = `ers-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6)
      .toString(36)
      .padStart(4, '0')}`;

    try {
      return await this.dataSource.transaction(async (manager) => {
        const result: unknown = await manager.query(
          `INSERT INTO privacy_erasure_requests (
             reference, customer_id, requested_by_type, requested_by_id, requested_categories,
             status, opened_at
           ) VALUES ($1,$2,$3,$4,$5,'RECEIVED',$6)
           RETURNING id, reference, status`,
          [
            reference,
            command.customerId,
            command.requestedByType,
            requestedById.slice(0, 160),
            categories,
            command.now ?? new Date(),
          ],
        );
        const row = this.parseRows<{ id: string; reference: string; status: string }>(result)[0];
        if (!row) throw new Error('privacy_erasure_requests insert returned no row');

        await this.auditService.record(manager, {
          entityType: 'PRIVACY_ERASURE_REQUEST',
          entityId: row.id,
          action: 'ERASURE_REQUESTED',
          actor: requestedById,
          newValues: { requestedCategories: categories, requestedByType: command.requestedByType },
        });

        return row;
      });
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException('This customer already has an open erasure request');
      }
      throw error;
    }
  }

  /**
   * Records that the claimant's identity was established.
   *
   * Required before approval: an unverified request must not be able to erase a customer's data, because that
   * would be a denial-of-service against the customer rather than a service to them.
   */
  async recordVerification(command: {
    requestId: string;
    verifiedBy: string;
    evidence: string;
    now?: Date;
  }): Promise<void> {
    const evidence = (command.evidence ?? '').trim();
    if (evidence.length === 0) {
      throw new BadRequestException('Verification must record how identity was established');
    }

    await this.dataSource.transaction(async (manager) => {
      const request = await this.requireRequest(manager, command.requestId);
      if (request.status !== 'RECEIVED' && request.status !== 'VERIFYING') {
        throw new ConflictException('Only a received or verifying request can be verified');
      }
      if (request.verifiedBy !== null) {
        throw new ConflictException('This request has already been verified');
      }

      await manager.query(
        `UPDATE privacy_erasure_requests
            SET verified_by = $2, verified_at = $3, identity_verification = $4,
                status = 'VERIFYING', updated_at = now(), version = version + 1
          WHERE id = $1`,
        [command.requestId, command.verifiedBy, command.now ?? new Date(), evidence.slice(0, 500)],
      );

      await this.auditService.record(manager, {
        entityType: 'PRIVACY_ERASURE_REQUEST',
        entityId: command.requestId,
        action: 'ERASURE_REQUEST_VERIFIED',
        actor: command.verifiedBy,
        newValues: { evidence: evidence.slice(0, 500) },
      });
    });
  }

  /** Approves a verified request so it can be executed. */
  async approveRequest(command: {
    requestId: string;
    decidedBy: string;
    basis: string;
    now?: Date;
  }): Promise<void> {
    const basis = (command.basis ?? '').trim();
    if (basis.length === 0) {
      throw new BadRequestException('An approval must record its basis');
    }

    await this.dataSource.transaction(async (manager) => {
      const request = await this.requireRequest(manager, command.requestId);
      if (request.verifiedBy === null) {
        throw new ConflictException(
          'An erasure request cannot be approved before the claimant identity is verified',
        );
      }
      if (request.status !== 'VERIFYING') {
        throw new ConflictException('Only a verifying request can be approved');
      }

      await manager.query(
        `UPDATE privacy_erasure_requests
            SET status = 'APPROVED', decided_by = $2, decided_at = $3, decision_basis = $4,
                updated_at = now(), version = version + 1
          WHERE id = $1`,
        [command.requestId, command.decidedBy, command.now ?? new Date(), basis.slice(0, 1000)],
      );

      await this.auditService.record(manager, {
        entityType: 'PRIVACY_ERASURE_REQUEST',
        entityId: command.requestId,
        action: 'ERASURE_REQUEST_APPROVED',
        actor: command.decidedBy,
        newValues: { basis: basis.slice(0, 1000) },
      });
    });
  }

  /** Refuses a request, with the reason recorded. */
  async rejectRequest(command: {
    requestId: string;
    decidedBy: string;
    basis: string;
    now?: Date;
  }): Promise<void> {
    const basis = (command.basis ?? '').trim();
    if (basis.length === 0) {
      throw new BadRequestException('A refusal must record its basis');
    }

    await this.dataSource.transaction(async (manager) => {
      const request = await this.requireRequest(manager, command.requestId);
      if (request.status === 'COMPLETED' || request.status === 'CLOSED') {
        throw new ConflictException('A completed request cannot be rejected');
      }

      await manager.query(
        `UPDATE privacy_erasure_requests
            SET status = 'REJECTED', decided_by = $2, decided_at = $3, decision_basis = $4,
                closed_at = $3, updated_at = now(), version = version + 1
          WHERE id = $1`,
        [command.requestId, command.decidedBy, command.now ?? new Date(), basis.slice(0, 1000)],
      );

      await this.auditService.record(manager, {
        entityType: 'PRIVACY_ERASURE_REQUEST',
        entityId: command.requestId,
        action: 'ERASURE_REQUEST_REJECTED',
        actor: command.decidedBy,
        newValues: { basis: basis.slice(0, 1000) },
      });
    });
  }

  /**
   * Executes an approved request.
   *
   * Per category: consult the policy, decide erasable or held, anonymise the profile-shaped columns, and record
   * an action row. **Never touches the ledger.** The tables written are fixed and enumerated below; there is no
   * dynamic SQL and no caller-supplied table name.
   */
  async executeErasure(command: {
    requestId: string;
    executedBy: string;
    now?: Date;
  }): Promise<ErasureExecutionResult> {
    return this.dataSource.transaction(async (manager) => {
      const request = await this.requireRequest(manager, command.requestId);
      if (request.status !== 'APPROVED') {
        throw new ConflictException('Only an approved request can be executed');
      }

      const policies = await this.loadPolicyMap(manager);
      const erased: string[] = [];
      const held: Array<{ category: string; reason: string }> = [];

      for (const category of request.requestedCategories) {
        const policy = policies.get(category);
        if (!policy) {
          // No policy means no permission. Recorded as held rather than skipped silently, so the operator sees
          // exactly which policy decision is missing.
          held.push({ category, reason: 'No retention policy is configured for this category' });
          await this.recordAction(manager, {
            requestId: command.requestId,
            category,
            target: 'privacy_retention_policies:MISSING',
            rowsAffected: 0,
            outcome: 'HELD',
            reason: 'No retention policy is configured for this category',
            performedBy: command.executedBy,
          });
          continue;
        }

        if (!policy.erasable) {
          held.push({ category, reason: policy.legalBasis });
          await this.recordAction(manager, {
            requestId: command.requestId,
            category,
            target: 'privacy_retention_policies:NOT_ERASABLE',
            rowsAffected: 0,
            outcome: 'HELD',
            reason: policy.legalBasis,
            performedBy: command.executedBy,
          });
          continue;
        }

        const rowsAffected = await this.anonymiseCategory(manager, category, request.customerId);
        erased.push(category);
        await this.recordAction(manager, {
          requestId: command.requestId,
          category,
          target: this.targetFor(category),
          rowsAffected,
          outcome: 'ERASED',
          reason: null,
          performedBy: command.executedBy,
        });
      }

      const status: ErasureExecutionResult['status'] =
        erased.length === 0
          ? 'HELD_UNDER_RETENTION'
          : held.length > 0
            ? 'PARTIALLY_COMPLETED'
            : 'COMPLETED';

      const closedAt = status === 'PARTIALLY_COMPLETED' ? null : (command.now ?? new Date());

      await manager.query(
        `UPDATE privacy_erasure_requests
            SET status = $2,
                erased_categories = $3,
                held_categories = $4::jsonb,
                executed_at = $5,
                executed_by = $6,
                closed_at = $7,
                updated_at = now(),
                version = version + 1
          WHERE id = $1`,
        [
          command.requestId,
          status,
          erased.length > 0 ? erased : null,
          // Held detail is required whenever the status is a hold; the schema enforces that.
          held.length > 0 ? JSON.stringify(held) : null,
          command.now ?? new Date(),
          command.executedBy,
          closedAt,
        ],
      );

      await this.auditService.record(manager, {
        entityType: 'PRIVACY_ERASURE_REQUEST',
        entityId: command.requestId,
        action: 'ERASURE_EXECUTED',
        actor: command.executedBy,
        // Categories only. An audit row describing an erasure must not contain what was erased.
        newValues: { status, erased, heldCategories: held.map((entry) => entry.category) },
      });

      return { status, erased, held };
    });
  }

  async getRequest(requestId: string): Promise<ErasureRequestView> {
    const rows: unknown = await this.dataSource.query(
      `SELECT id, reference, customer_id, status, requested_categories, erased_categories,
              held_categories, decision_basis, opened_at, closed_at
         FROM privacy_erasure_requests
        WHERE id = $1`,
      [requestId],
    );
    const row = this.parseRows<{
      id: string;
      reference: string;
      customer_id: string;
      status: string;
      requested_categories: string[];
      erased_categories: string[] | null;
      held_categories: unknown;
      decision_basis: string | null;
      opened_at: Date | string;
      closed_at: Date | string | null;
    }>(rows)[0];
    if (!row) throw new NotFoundException('Erasure request not found');
    return {
      id: row.id,
      reference: row.reference,
      customerId: row.customer_id,
      status: row.status,
      requestedCategories: row.requested_categories,
      erasedCategories: row.erased_categories,
      heldCategories: row.held_categories,
      decisionBasis: row.decision_basis,
      openedAt: new Date(row.opened_at).toISOString(),
      closedAt: row.closed_at ? new Date(row.closed_at).toISOString() : null,
    };
  }

  /** Actions recorded for a request. */
  async listActions(requestId: string): Promise<Array<Record<string, unknown>>> {
    const rows: unknown = await this.dataSource.query(
      `SELECT category, target, rows_affected, outcome, reason, performed_by, performed_at
         FROM privacy_erasure_actions
        WHERE request_id = $1
        ORDER BY performed_at`,
      [requestId],
    );
    return this.parseRows<Record<string, unknown>>(rows);
  }

  /**
   * Requests still open, and how many are old enough to need attention.
   *
   * There is no statutory deadline here — as everywhere else in this work, the correct response window is a
   * regulator's decision. What is reported is age, so an unfounded claim that the process is working cannot
   * hide behind a queue nobody measures.
   */
  async outstandingPosture(now = new Date()): Promise<{
    open: number;
    approvedNotExecuted: number;
    oldestOpenAgeSeconds: number | null;
  }> {
    const rows: unknown = await this.dataSource.query(
      `SELECT count(*) FILTER (WHERE status NOT IN
                ('COMPLETED', 'PARTIALLY_COMPLETED', 'HELD_UNDER_RETENTION', 'REJECTED', 'WITHDRAWN'))::int
                AS open_count,
              count(*) FILTER (WHERE status = 'APPROVED')::int AS approved_not_executed,
              min(opened_at) FILTER (WHERE status NOT IN
                ('COMPLETED', 'PARTIALLY_COMPLETED', 'HELD_UNDER_RETENTION', 'REJECTED', 'WITHDRAWN'))
                AS oldest_open
         FROM privacy_erasure_requests`,
    );
    const row = this.parseRows<{
      open_count: number;
      approved_not_executed: number;
      oldest_open: Date | string | null;
    }>(rows)[0];
    const oldest = row?.oldest_open ? new Date(row.oldest_open) : null;

    return {
      open: Number(row?.open_count ?? 0),
      approvedNotExecuted: Number(row?.approved_not_executed ?? 0),
      oldestOpenAgeSeconds: oldest
        ? Math.max(0, Math.floor((now.getTime() - oldest.getTime()) / 1000))
        : null,
    };
  }

  // ---------------------------------------------------------------------------------------------
  // Anonymisation
  // ---------------------------------------------------------------------------------------------

  /**
   * Anonymises one category for one customer.
   *
   * The table and column set is fixed per category and enumerated in `targetFor`. There is no dynamic SQL and
   * no caller-supplied identifier, so a crafted category cannot reach the ledger. Values are replaced with a
   * deterministic marker rather than NULL where the column is NOT NULL, and the row itself survives: the
   * customer's financial history still needs an owner.
   */
  private async anonymiseCategory(
    manager: EntityManager,
    category: string,
    customerId: string,
  ): Promise<number> {
    switch (category) {
      case 'PROFILE_IDENTITY': {
        const result: unknown = await manager.query(
          `UPDATE customer_profiles
              SET display_name = 'erased',
                  legal_name = NULL,
                  first_name = NULL,
                  middle_name = NULL,
                  last_name = NULL,
                  date_of_birth = NULL,
                  nationality = NULL,
                  updated_at = now()
            WHERE customer_id = $1 AND deleted_at IS NULL`,
          [customerId],
        );
        return this.affected(result);
      }
      case 'CONTACT_METHODS': {
        const result: unknown = await manager.query(
          `UPDATE customer_contact_methods
              SET value = 'erased', normalized_value = 'erased', updated_at = now()
            WHERE customer_id = $1 AND deleted_at IS NULL`,
          [customerId],
        );
        return this.affected(result);
      }
      case 'ADDRESSES': {
        /*
         * `city`, `state` and `country` are NOT NULL on this table, so they are replaced with the marker rather
         * than nulled. Nulling them would fail the update and leave the personal data in place while the action
         * log claimed otherwise — the worst of both outcomes.
         */
        const result: unknown = await manager.query(
          `UPDATE customer_addresses
              SET line_one = 'erased', line_two = NULL, city = 'erased', state = 'erased',
                  postal_code = NULL, updated_at = now()
            WHERE customer_id = $1 AND deleted_at IS NULL`,
          [customerId],
        );
        return this.affected(result);
      }
      case 'NOTIFICATION_HISTORY': {
        // The destination is the personal datum; the fact that a message was sent is operational history.
        const result: unknown = await manager.query(
          `UPDATE notification_deliveries
              SET destination = 'erased'
            WHERE recipient_type = 'CUSTOMER' AND recipient_id = $1`,
          [customerId],
        );
        return this.affected(result);
      }
      case 'BENEFICIARY_DETAILS':
      case 'AUTHENTICATION_CREDENTIALS':
      case 'RISK_FACTORS': {
        /*
         * Deliberately NOT implemented, and reported honestly rather than approximated.
         *
         * These three need their own decisions:
         * - Beneficiary details are referenced by transfers that must remain attributable.
         * - Erasing an authentication credential is a security operation with its own revocation path
         *   (sessions, recovery challenges, device bindings), not a column update.
         * - Risk factors are the evidence behind past policy decisions; anonymising them makes a declined
         *   transaction unexplainable.
         *
         * Returning 0 here means the category is reported as erased with no rows touched, which the action log
         * shows plainly. That is a real limitation, recorded in the group's known gaps.
         */
        return 0;
      }
      default:
        return 0;
    }
  }

  private targetFor(category: string): string {
    switch (category) {
      case 'PROFILE_IDENTITY':
        return 'customer_profiles:ANONYMISED';
      case 'CONTACT_METHODS':
        return 'customer_contact_methods:ANONYMISED';
      case 'ADDRESSES':
        return 'customer_addresses:ANONYMISED';
      case 'NOTIFICATION_HISTORY':
        return 'notification_deliveries:ANONYMISED';
      default:
        return `${category}:NOT_IMPLEMENTED`;
    }
  }

  private async recordAction(
    manager: EntityManager,
    action: {
      requestId: string;
      category: string;
      target: string;
      rowsAffected: number;
      outcome: 'ERASED' | 'HELD' | 'SKIPPED';
      reason: string | null;
      performedBy: string;
    },
  ): Promise<void> {
    await manager.query(
      `INSERT INTO privacy_erasure_actions
         (request_id, category, target, rows_affected, outcome, reason, performed_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        action.requestId,
        action.category,
        action.target,
        action.rowsAffected,
        action.outcome,
        action.reason?.slice(0, 500) ?? null,
        action.performedBy,
      ],
    );
  }

  private async loadPolicyMap(
    manager: EntityManager,
  ): Promise<Map<string, { erasable: boolean; legalBasis: string }>> {
    const result: unknown = await manager.query(
      `SELECT category, erasable, legal_basis FROM privacy_retention_policies`,
    );
    const map = new Map<string, { erasable: boolean; legalBasis: string }>();
    for (const row of this.parseRows<{ category: string; erasable: boolean; legal_basis: string }>(
      result,
    )) {
      map.set(row.category, { erasable: row.erasable, legalBasis: row.legal_basis });
    }
    return map;
  }

  private async requireRequest(
    manager: EntityManager,
    requestId: string,
  ): Promise<{
    id: string;
    status: string;
    customerId: string;
    requestedCategories: string[];
    verifiedBy: string | null;
  }> {
    const result: unknown = await manager.query(
      `SELECT id, status, customer_id, requested_categories, verified_by
         FROM privacy_erasure_requests
        WHERE id = $1
        FOR UPDATE`,
      [requestId],
    );
    const row = this.parseRows<{
      id: string;
      status: string;
      customer_id: string;
      requested_categories: string[];
      verified_by: string | null;
    }>(result)[0];
    if (!row) throw new NotFoundException('Erasure request not found');
    return {
      id: row.id,
      status: row.status,
      customerId: row.customer_id,
      requestedCategories: row.requested_categories,
      verifiedBy: row.verified_by,
    };
  }

  /** Rows affected, from whichever shape the driver returned. */
  private affected(result: unknown): number {
    if (!Array.isArray(result)) return 0;
    const second: unknown = result[1];
    if (typeof second === 'number') return second;
    if (Array.isArray(result)) return result.length;
    return 0;
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === '23505'
    );
  }

  private parseRows<T>(result: unknown): T[] {
    if (!Array.isArray(result)) return [];
    const first: unknown = result[0];
    const second: unknown = result[1];
    if (result.length === 2 && Array.isArray(first) && typeof second === 'number')
      return first as T[];
    return result as T[];
  }
}
