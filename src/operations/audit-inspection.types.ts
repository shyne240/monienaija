/**
 * ARENA 4 — Operational Audit inspection contract.
 *
 * Read-only. Every field is derived from the existing append-only `audit_events` table plus the
 * existing `privileged_action_approvals` records that governed a privileged action. No new audit
 * store, no mutation, and no relaxation of the established category restrictions in
 * `AuditService` (customer preferences and compliance-case records are excluded by default and
 * remain excluded here).
 */

export type AuditOutcome = 'ALLOWED' | 'DENIED' | 'RECORDED';

export interface AuditInspectionQuery {
  actor?: string;
  action?: string;
  entityType?: string;
  entityId?: string;
  correlationId?: string;
  /** Institution scope, derived from the audited payload's institutionId (see service notes). */
  institutionId?: string;
  outcome?: AuditOutcome;
  /** Inclusive lower bound on occurred_at. */
  from?: Date;
  /** Inclusive upper bound on occurred_at. */
  to?: Date;
  page: number;
  limit: number;
}

export interface AuditInspectionRow {
  id: string;
  actor: string;
  action: string;
  entityType: string;
  entityId: string;
  outcome: AuditOutcome;
  institutionId: string | null;
  correlationId: string | null;
  requestId: string | null;
  occurredAt: Date | string;
}

export interface AuditInspectionPage {
  data: AuditInspectionRow[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNextPage: boolean;
  accessMode: 'READ_ONLY';
  /**
   * Categories excluded from this projection by the established default policy. Their records
   * remain intact in PostgreSQL; this surface cannot opt in (the opt-in is internal-only).
   */
  excludedCategories: string[];
}

export interface AuditApprovalHistoryRow {
  id: string;
  actionType: string;
  resourceType: string;
  resourceId: string | null;
  status: string;
  requesterPrincipalId: string;
  approvedBy: string | null;
  reason: string | null;
  requestedAt: Date | string;
  expiresAt: Date | string;
  approvedAt: Date | string | null;
  rejectedAt: Date | string | null;
  consumedAt: Date | string | null;
  isEmergency: boolean;
}

export interface AuditInspectionDetail {
  event: AuditInspectionRow & {
    previousValues: Record<string, unknown> | null;
    newValues: Record<string, unknown> | null;
  };
  /** Maker/checker records that governed this action, when one is linked by ID or resource. */
  approvalHistory: AuditApprovalHistoryRow[];
  /** Other audit rows sharing the same correlation id, bounded. */
  relatedEvents: AuditInspectionRow[];
  accessMode: 'READ_ONLY';
  approvalHistoryComplete: boolean;
  excludedCategories: string[];
}

export const AUDIT_INSPECTION_EXCLUDED_CATEGORIES: readonly string[] = [
  'CUSTOMER_PREFERENCE',
  'PREFERENCE_HISTORY',
  'CUSTOMER_COMPLIANCE_CASE',
  'COMPLIANCE_CASE_COMMENT',
  'COMPLIANCE_CASE_EVIDENCE',
  'COMPLIANCE_CASE_ASSIGNMENT',
  'COMPLIANCE_CASE_HISTORY',
  'NOTIFICATION_PROVIDER_CONFIG',
  'NOTIFICATION_TEST_SEND',
  'NOTIFICATION_TEST_SEND_QUOTA',
];
