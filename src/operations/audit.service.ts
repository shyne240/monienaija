import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import type { SelectQueryBuilder } from 'typeorm';

import { redactRecord, sanitizeDiagnosticIdentifier } from '../common/sensitive-data-redaction';
import {
  normalizeProviderErrorCode,
  sanitizeProviderRefForBoundary,
} from '../notification/provider-security';
import { AuditEvent } from './audit-event.entity';
import type { AuditEventCommand, AuditQuery, AuditView } from './operations.types';
import {
  AUDIT_INSPECTION_EXCLUDED_CATEGORIES,
  type AuditInspectionDetail,
  type AuditInspectionPage,
  type AuditInspectionQuery,
  type AuditInspectionRow,
  type AuditOutcome,
} from './audit-inspection.types';

// Older authorization decisions used the generic `customer` resource type and stored the raw
// request path. Fastify accepts percent-encoded static segments, so match either spelling when
// hiding those legacy preference decisions; an encoded slash is not a router path separator.
const encodedSegmentPattern = (segment: string): string =>
  [...segment]
    .map((character) => `(?:${character}|%${character.charCodeAt(0).toString(16)})`)
    .join('');
const PREFERENCE_AUDIT_ACTION_PATTERN = `/${encodedSegmentPattern('customers')}/[^/]+/${encodedSegmentPattern('preferences')}(?:/|$)`;

@Injectable()
export class AuditService {
  constructor(
    @InjectRepository(AuditEvent)
    private readonly repository: Repository<AuditEvent>,
  ) {}

  async record(manager: EntityManager, command: AuditEventCommand): Promise<AuditEvent> {
    const sanitizedPrevious = command.previousValues
      ? sanitizeNotificationProviderAuditPayload(command.entityType, command.previousValues)
      : null;
    const sanitizedNew = command.newValues
      ? sanitizeNotificationProviderAuditPayload(command.entityType, command.newValues)
      : null;
    const event = manager.getRepository(AuditEvent).create({
      id: randomUUID(),
      entityType: command.entityType,
      entityId: command.entityId,
      action: command.action,
      actor: command.actor,
      // Report 26 (N-02): caller-supplied business correlation ids reach this choke
      // point from DTOs/commands that never pass through the request-context
      // sanitizer; they are bounded and redacted deterministically before
      // persistence (legitimate ids are preserved byte-for-byte).
      correlationId: sanitizeDiagnosticIdentifier(command.correlationId) ?? null,
      requestId: command.requestId ?? null,
      previousValues: sanitizedPrevious ? redactRecord(sanitizedPrevious) : null,
      newValues: sanitizedNew ? redactRecord(sanitizedNew) : null,
      occurredAt: command.occurredAt ?? new Date(),
    });
    return manager.getRepository(AuditEvent).save(event);
  }

  async list(
    query: AuditQuery = {},
    options: {
      includeComplianceCaseRecords?: boolean;
      includePreferenceRecords?: boolean;
      includeNotificationProviderRecords?: boolean;
    } = {},
  ): Promise<AuditView[]> {
    const take = Math.min(Math.max(query.limit ?? 100, 1), 1000);
    const builder = this.restrictedQuery(options);
    if (query.entityType) {
      builder.andWhere('audit.entity_type = :entityType', { entityType: query.entityType });
    }
    if (query.entityId) {
      builder.andWhere('audit.entity_id = :entityId', { entityId: query.entityId });
    }
    if (query.correlationId) {
      // Report 26 (N-02): the query side applies the SAME deterministic
      // sanitization as the write side, so legitimate-id lookups are unchanged
      // and credential-shaped lookups match the sanitized stored values.
      const correlationFilter = sanitizeDiagnosticIdentifier(query.correlationId);
      if (correlationFilter) {
        builder.andWhere('audit.correlation_id = :correlationId', {
          correlationId: correlationFilter,
        });
      }
    }
    const events = await builder.orderBy('audit.occurred_at', 'DESC').take(take).getMany();
    return events.map((event) => this.toView(event));
  }

  /**
   * ARENA 4 — authorized operational audit inspection.
   *
   * The SAME default category restrictions as `list()` are applied by `restrictedQuery()`; no
   * caller of this method can opt in to customer-preference, compliance-case or provider-secret
   * audit metadata. Only the reporting shape (server-side filtering, outcome, institution scope,
   * pagination) is new.
   */
  async inspect(
    input: AuditInspectionQuery,
    options: { includeComplianceCaseRecords?: boolean; includePreferenceRecords?: boolean } = {},
  ): Promise<AuditInspectionPage> {
    const limit = Math.min(Math.max(Math.trunc(input.limit) || 25, 1), 100);
    const page = Math.max(Math.trunc(input.page) || 1, 1);
    const builder = this.restrictedQuery(options);
    this.applyInspectionFilters(builder, input);
    const total = await builder.clone().getCount();
    const events = await builder
      .orderBy('audit.occurred_at', 'DESC')
      .addOrderBy('audit.id', 'DESC')
      .offset((page - 1) * limit)
      .take(limit)
      .getMany();
    const totalPages = total === 0 ? 0 : Math.ceil(total / limit);
    return {
      data: events.map((event) => this.toInspectionRow(event)),
      total,
      page,
      limit,
      totalPages,
      hasNextPage: page < totalPages,
      accessMode: 'READ_ONLY',
      excludedCategories: [...AUDIT_INSPECTION_EXCLUDED_CATEGORIES],
    };
  }

  /**
   * Single-record inspection with the approval history that governed the action. Returns null for
   * a row excluded by the default category policy, so a caller cannot use detail lookup to bypass
   * a list-level restriction.
   */
  async inspectOne(id: string): Promise<AuditInspectionDetail | null> {
    const builder = this.restrictedQuery({});
    builder.andWhere('audit.id = :id', { id });
    const event = await builder.getOne();
    if (!event) return null;

    const approvalIds = Array.isArray(event.newValues?.['approvalIds'])
      ? (event.newValues['approvalIds'] as unknown[])
          .filter((value): value is string => typeof value === 'string')
          .slice(0, 10)
      : [];
    const approvals = await this.repository.query<
      Array<{
        id: string;
        action_type: string;
        resource_type: string;
        resource_id: string | null;
        status: string;
        requester_principal_id: string;
        approved_by: string | null;
        reason: string | null;
        requested_at: Date;
        expires_at: Date;
        approved_at: Date | null;
        rejected_at: Date | null;
        consumed_at: Date | null;
        is_emergency: boolean;
      }>
    >(
      `SELECT id, action_type, resource_type, resource_id, status, requester_principal_id,
              approved_by, reason, requested_at, expires_at, approved_at, rejected_at,
              consumed_at, is_emergency
         FROM privileged_action_approvals
        WHERE id::text = $1
           OR (resource_type = $2 AND resource_id = $3)
           OR id::text = ANY($4::text[])
        ORDER BY requested_at DESC
        LIMIT 10`,
      [event.entityId, event.entityType, event.entityId, approvalIds],
    );

    const related = event.correlationId
      ? await this.restrictedQuery({})
          .andWhere('audit.correlation_id = :correlationId', {
            correlationId: event.correlationId,
          })
          .andWhere('audit.id <> :id', { id })
          .orderBy('audit.occurred_at', 'DESC')
          .take(20)
          .getMany()
      : [];

    return {
      event: {
        ...this.toInspectionRow(event),
        previousValues: sanitizeNotificationProviderAuditPayload(
          event.entityType,
          event.previousValues,
        ),
        newValues: sanitizeNotificationProviderAuditPayload(event.entityType, event.newValues),
      },
      approvalHistory: approvals.map((approval) => ({
        id: approval.id,
        actionType: approval.action_type,
        resourceType: approval.resource_type,
        resourceId: approval.resource_id,
        status: approval.status,
        requesterPrincipalId: approval.requester_principal_id,
        approvedBy: approval.approved_by,
        reason: approval.reason,
        requestedAt: approval.requested_at,
        expiresAt: approval.expires_at,
        approvedAt: approval.approved_at,
        rejectedAt: approval.rejected_at,
        consumedAt: approval.consumed_at,
        isEmergency: approval.is_emergency,
      })),
      relatedEvents: related.map((row) => this.toInspectionRow(row)),
      accessMode: 'READ_ONLY',
      // Stated explicitly: linkage is by id/resource/approvalIds, not a guarantee that every
      // historically governed action recorded one of those references.
      approvalHistoryComplete: approvals.length > 0 || approvalIds.length === 0,
      excludedCategories: [...AUDIT_INSPECTION_EXCLUDED_CATEGORIES],
    };
  }

  /**
   * Every default restriction the generic audit surface enforces. Extracted verbatim so `list()`
   * and `inspect()` can never diverge: a category hidden from one is hidden from the other.
   */
  private restrictedQuery(options: {
    includeComplianceCaseRecords?: boolean;
    includePreferenceRecords?: boolean;
    includeNotificationProviderRecords?: boolean;
  }): SelectQueryBuilder<AuditEvent> {
    const builder = this.repository.createQueryBuilder('audit');
    // Mission 25G: generic audit access (including SUPPORT and `audit.view`) is not an approved
    // grant to customer preference values or history. Hide preference business/history events
    // and both current and legacy route decisions from generic projections, including dashboard
    // widgets and filtered queries. The original audit and preference-history rows remain intact
    // in PostgreSQL; a future oversight path needs its own explicit policy decision. As with the
    // compliance option below, this opt-in is for trusted internal aggregation only, never HTTP.
    if (!options.includePreferenceRecords) {
      builder.andWhere('audit.entity_type NOT IN (:...preferenceAuditTypes)', {
        preferenceAuditTypes: ['CUSTOMER_PREFERENCE', 'PREFERENCE_HISTORY'],
      });
      builder.andWhere(
        `NOT (audit.entity_type = :preferenceDecisionType AND (
          COALESCE(audit.new_values->>'resourceType', '') = :preferenceResource OR
          COALESCE(audit.new_values->>'action', '') ~* :preferenceActionPattern
        ))`,
        {
          preferenceDecisionType: 'AUTHORIZATION_DECISION',
          preferenceResource: 'customer-preference',
          preferenceActionPattern: PREFERENCE_AUDIT_ACTION_PATTERN,
        },
      );
    }
    if (!options.includeComplianceCaseRecords) {
      // Generic audit views are not category- or subject-scoped. Hide case events and both
      // current and legacy case-route authorization decisions by default until a dedicated,
      // approved audit-access policy exists. Records remain intact in the database. Only
      // explicitly trusted internal consumers may opt in; never derive this option from a request.
      builder.andWhere('audit.entity_type NOT IN (:...caseTypes)', {
        caseTypes: [
          'CUSTOMER_COMPLIANCE_CASE',
          'COMPLIANCE_CASE_COMMENT',
          'COMPLIANCE_CASE_EVIDENCE',
          'COMPLIANCE_CASE_ASSIGNMENT',
          'COMPLIANCE_CASE_HISTORY',
        ],
      });
      builder.andWhere(
        `NOT (audit.entity_type = :decisionType AND (
          COALESCE(audit.new_values->>'resourceType', '') = :caseResource OR
          COALESCE(audit.new_values->>'action', '') ILIKE :legacyCasePath
        ))`,
        {
          decisionType: 'AUTHORIZATION_DECISION',
          caseResource: 'customer-compliance-case',
          legacyCasePath: '%/compliance-cases%',
        },
      );
      // A4 and A7 policy audit facts can include customerId and reason codes such as
      // COMPLIANCE_CASE_OPEN or COMPLIANCE_REVIEW_OPEN. Those reveal a case's existence even
      // without its ID. Fail closed for compliance-prefixed reasons, including future codes;
      // other policy audit facts remain visible. Malformed reason-code values are hidden
      // rather than accidentally disclosing a restricted reason in an unexpected shape.
      builder.andWhere(
        `NOT (audit.entity_type = :policyDecisionType AND (
          (audit.new_values #> '{metadata,reasonCodes}' IS NOT NULL AND
           jsonb_typeof(audit.new_values #> '{metadata,reasonCodes}') <> 'array') OR
          EXISTS (
            SELECT 1 FROM jsonb_array_elements(
              CASE WHEN jsonb_typeof(audit.new_values #> '{metadata,reasonCodes}') = 'array'
                THEN audit.new_values #> '{metadata,reasonCodes}' ELSE '[]'::jsonb END
            ) AS reasons(code)
            WHERE jsonb_typeof(reasons.code) <> 'string'
               OR left(reasons.code #>> '{}', 11) = 'COMPLIANCE_'
          )
        ))`,
        { policyDecisionType: 'A4_POLICY_DECISION' },
      );
    }
    if (!options.includeNotificationProviderRecords) {
      // Restrict operational provider configuration & test-send audit metadata (key fingerprints,
      // sender configuration, base URLs, verification/test error codes, masked test destinations,
      // and maker-checker approval records/comments tied to NOTIFICATION_PROVIDER_CONFIG_PROPOSAL)
      // unless the caller holds `notification.provider.view`.
      // Records remain intact in `audit_events` for authorized oversight.
      builder.andWhere('audit.entity_type NOT IN (:...providerAuditTypes)', {
        providerAuditTypes: [
          'NOTIFICATION_PROVIDER_CONFIG',
          'NOTIFICATION_TEST_SEND',
          'NOTIFICATION_TEST_SEND_QUOTA',
        ],
      });
      builder.andWhere(
        `NOT (
          audit.entity_type = :providerApprovalEntityType
          AND (
            COALESCE(audit.new_values ->> 'resourceType', '') = :providerProposalResourceType
            OR EXISTS (
              SELECT 1
                FROM privileged_action_approvals paa
               WHERE paa.id = audit.entity_id
                 AND paa.resource_type = :providerProposalResourceType
            )
          )
        )`,
        {
          providerApprovalEntityType: 'PRIVILEGED_ACTION_APPROVAL',
          providerProposalResourceType: 'NOTIFICATION_PROVIDER_CONFIG_PROPOSAL',
        },
      );
    }
    return builder;
  }

  private applyInspectionFilters(
    builder: SelectQueryBuilder<AuditEvent>,
    input: AuditInspectionQuery,
  ): void {
    if (input.actor) builder.andWhere('audit.actor = :actor', { actor: input.actor });
    if (input.action) builder.andWhere('audit.action = :action', { action: input.action });
    if (input.entityType) {
      builder.andWhere('audit.entity_type = :entityType', { entityType: input.entityType });
    }
    if (input.entityId) {
      builder.andWhere('audit.entity_id = :entityId', { entityId: input.entityId });
    }
    if (input.correlationId) {
      const correlationFilter = sanitizeDiagnosticIdentifier(input.correlationId);
      if (correlationFilter) {
        builder.andWhere('audit.correlation_id = :correlationId', {
          correlationId: correlationFilter,
        });
      }
    }
    if (input.institutionId) {
      // audit_events has no dedicated institution column. Institution scope is derived from the
      // audited payload only; rows that never recorded an institution id are not matched (they are
      // shown as institutionId: null in projections, never assumed platform-wide).
      builder.andWhere(
        `COALESCE(
          audit.new_values->>'institutionId',
          audit.previous_values->>'institutionId',
          audit.new_values->>'institution_id',
          audit.previous_values->>'institution_id',
          audit.new_values->>'financialInstitutionId'
        ) = :institutionId`,
        { institutionId: input.institutionId },
      );
    }
    if (input.outcome === 'ALLOWED') {
      builder.andWhere(
        `audit.entity_type = 'AUTHORIZATION_DECISION' AND audit.new_values->>'allowed' = 'true'`,
      );
    } else if (input.outcome === 'DENIED') {
      builder.andWhere(
        `audit.entity_type = 'AUTHORIZATION_DECISION' AND audit.new_values->>'allowed' = 'false'`,
      );
    } else if (input.outcome === 'RECORDED') {
      builder.andWhere(
        `NOT (audit.entity_type = 'AUTHORIZATION_DECISION' AND audit.new_values->>'allowed' IN ('true','false'))`,
      );
    }
    if (input.from) builder.andWhere('audit.occurred_at >= :from', { from: input.from });
    if (input.to) builder.andWhere('audit.occurred_at <= :to', { to: input.to });
  }

  private toView(event: AuditEvent): AuditView {
    return {
      id: event.id,
      entityType: event.entityType,
      entityId: event.entityId,
      action: event.action,
      actor: event.actor,
      // Report 26 (row 15): read-boundary protection — persisted rows written
      // before this remediation are masked when projected to consumers.
      correlationId: sanitizeDiagnosticIdentifier(event.correlationId) ?? null,
      requestId: event.requestId,
      previousValues: sanitizeNotificationProviderAuditPayload(
        event.entityType,
        event.previousValues,
      ),
      newValues: sanitizeNotificationProviderAuditPayload(event.entityType, event.newValues),
      occurredAt: event.occurredAt,
    };
  }

  private toInspectionRow(event: AuditEvent): AuditInspectionRow {
    const rawAllowed = event.newValues?.['allowed'];
    const outcome: AuditOutcome =
      event.entityType === 'AUTHORIZATION_DECISION' && typeof rawAllowed === 'boolean'
        ? rawAllowed
          ? 'ALLOWED'
          : 'DENIED'
        : 'RECORDED';
    const institutionRaw =
      event.newValues?.['institutionId'] ??
      event.previousValues?.['institutionId'] ??
      event.newValues?.['institution_id'] ??
      event.previousValues?.['institution_id'] ??
      event.newValues?.['financialInstitutionId'];
    return {
      id: event.id,
      actor: event.actor,
      action: event.action,
      entityType: event.entityType,
      entityId: event.entityId,
      outcome,
      institutionId: sanitizeDiagnosticIdentifier(institutionRaw) ?? null,
      correlationId: sanitizeDiagnosticIdentifier(event.correlationId) ?? null,
      requestId: event.requestId,
      occurredAt: event.occurredAt,
    };
  }

  /**
   * Internal oversight read path used only after server-side `notification.provider.view`
   * authorization has succeeded. Delegates through `list(...)` so all other category filters
   * (such as compliance-case restrictions) remain enforced.
   */
  async listWithNotificationProviderOversight(query: AuditQuery = {}): Promise<AuditView[]> {
    return this.list(query, { includeNotificationProviderRecords: true });
  }
}

const PROVIDER_REF_AUDIT_KEYS: ReadonlySet<string> = new Set([
  'providerRef',
  'provider_ref',
  'lastTestProviderRef',
  'last_tested_provider_ref',
  'last_test_provider_ref',
]);

const PROVIDER_ERROR_AUDIT_KEYS: ReadonlySet<string> = new Set([
  'errorCode',
  'lastTestErrorCode',
  'lastVerificationError',
]);

const KNOWN_NOTIFICATION_PROVIDER_LABELS: ReadonlySet<string> = new Set([
  'robase',
  'brevo',
  'resend',
  'console',
  'console-email',
  'none',
  'test',
  'test-email',
  'managed',
]);

function sanitizeAuditValueTree(
  value: unknown,
  normalizeProviderErrors: boolean,
  inheritedProviderHint: unknown,
  seen: WeakSet<object>,
): unknown {
  if (Array.isArray(value)) {
    let changed = false;
    const mapped = value.map((item) => {
      const next = sanitizeAuditValueTree(
        item,
        normalizeProviderErrors,
        inheritedProviderHint,
        seen,
      );
      if (next !== item) changed = true;
      return next;
    });
    return changed ? mapped : value;
  }
  if (!value || typeof value !== 'object' || value instanceof Date) {
    return value;
  }
  if (seen.has(value)) {
    return value;
  }
  seen.add(value);

  const record = value as Record<string, unknown>;
  const localProviderHint = 'provider' in record ? record['provider'] : inheritedProviderHint;
  const hasProviderRefSibling = Object.keys(record).some((k) => PROVIDER_REF_AUDIT_KEYS.has(k));
  let cloned: Record<string, unknown> | null = null;

  for (const [key, entryValue] of Object.entries(record)) {
    let nextValue: unknown = entryValue;
    if (PROVIDER_REF_AUDIT_KEYS.has(key)) {
      nextValue = sanitizeProviderRefForBoundary(entryValue, localProviderHint);
    } else if (
      key === 'provider' &&
      (normalizeProviderErrors || hasProviderRefSibling) &&
      typeof entryValue === 'string' &&
      !KNOWN_NOTIFICATION_PROVIDER_LABELS.has(entryValue.trim().toLowerCase())
    ) {
      nextValue = 'external';
    } else if (
      normalizeProviderErrors &&
      PROVIDER_ERROR_AUDIT_KEYS.has(key) &&
      entryValue !== null &&
      entryValue !== undefined
    ) {
      nextValue = normalizeProviderErrorCode(entryValue);
    } else if (entryValue && typeof entryValue === 'object') {
      nextValue = sanitizeAuditValueTree(
        entryValue,
        normalizeProviderErrors,
        localProviderHint,
        seen,
      );
    }

    if (nextValue !== entryValue) {
      if (!cloned) cloned = { ...record };
      cloned[key] = nextValue;
    }
  }

  return cloned ?? record;
}

function sanitizeNotificationProviderAuditPayload(
  entityType: string,
  payload: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return payload;
  }
  const normalizeProviderErrors =
    entityType === 'NOTIFICATION_TEST_SEND' || entityType === 'NOTIFICATION_PROVIDER_CONFIG';
  return sanitizeAuditValueTree(
    payload,
    normalizeProviderErrors,
    payload['provider'],
    new WeakSet<object>(),
  ) as Record<string, unknown>;
}
