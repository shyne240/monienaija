import React, { useCallback, useEffect, useState } from 'react';

import { Alert, Button, Field, PageHeader } from '../../design-system/primitives';
import {
  StructuredColumn,
  StructuredKeyValueList,
  StructuredRecordTable,
} from '../../components/StructuredData';
import {
  Arena4OperationsApi,
  describeHttpError,
  type AuditInspectionDetail,
  type AuditInspectionPage,
} from '../../services/arena4-operations-api';
import { useAuthStore } from '../../store/auth-store';
import './arena4-operations.css';

/**
 * ARENA 4 — Operational Audit inspection (read-only).
 *
 * Actor, action, resource, timestamp, outcome, institution scope and approval history over the
 * authoritative append-only audit store. The server already excludes customer-preference and
 * compliance-case records and provider-secret metadata by default, and masks credential-shaped
 * values; this screen displays that projection and cannot opt out of it.
 */

const AUDIT_COLUMNS: StructuredColumn[] = [
  { key: 'occurredAt', label: 'Timestamp' },
  { key: 'actor', label: 'Actor' },
  { key: 'action', label: 'Action' },
  { key: 'entityType', label: 'Resource type' },
  { key: 'entityId', label: 'Resource ID' },
  { key: 'outcome', label: 'Outcome' },
  { key: 'institutionId', label: 'Institution' },
];

const OUTCOME_OPTIONS = [
  { value: '', label: 'All outcomes' },
  { value: 'ALLOWED', label: 'Allowed (authorization decision)' },
  { value: 'DENIED', label: 'Denied (authorization decision)' },
  { value: 'RECORDED', label: 'Recorded (business/security event)' },
];

interface Filters {
  actor: string;
  action: string;
  entityType: string;
  outcome: string;
  institutionId: string;
  from: string;
  to: string;
}

const emptyFilters = (): Filters => ({
  actor: '',
  action: '',
  entityType: '',
  outcome: '',
  institutionId: '',
  from: '',
  to: '',
});

export const AuditInspectionScreen: React.FC = () => {
  const scopes = useAuthStore((state) => state.principal?.scopes);
  const canView = (scopes?.includes('audit.view') && scopes?.includes('audit.search')) ?? false;
  return canView ? (
    <AuditInspectionWorkspace />
  ) : (
    <Alert tone="danger" title="Audit inspection unavailable">
      This workspace requires both the <code>audit.view</code> and <code>audit.search</code>{' '}
      authorization functions.
    </Alert>
  );
};

const AuditInspectionWorkspace: React.FC = () => {
  const [page, setPage] = useState<AuditInspectionPage | null>(null);
  const [detail, setDetail] = useState<AuditInspectionDetail | null>(null);
  const [filters, setFilters] = useState<Filters>(emptyFilters());
  const [applied, setApplied] = useState<Filters>(emptyFilters());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [detailError, setDetailError] = useState('');

  const load = useCallback(async (criteria: Filters) => {
    setLoading(true);
    setError('');
    try {
      setPage(
        await Arena4OperationsApi.auditInspection({
          actor: criteria.actor,
          action: criteria.action,
          entityType: criteria.entityType,
          outcome: criteria.outcome,
          institutionId: criteria.institutionId,
          from: criteria.from ? new Date(criteria.from).toISOString() : undefined,
          to: criteria.to ? new Date(criteria.to).toISOString() : undefined,
          page: 1,
          limit: 25,
        }),
      );
    } catch (loadError) {
      setError(describeHttpError(loadError, 'Audit records could not be loaded.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(applied);
  }, [applied, load]);

  const openDetail = async (row: Record<string, unknown>) => {
    const id = typeof row.id === 'string' ? row.id : '';
    if (!id) return;
    setDetailError('');
    try {
      setDetail(await Arena4OperationsApi.auditInspectionDetail(id));
    } catch (detailFailure) {
      setDetail(null);
      setDetailError(describeHttpError(detailFailure, 'This audit record could not be inspected.'));
    }
  };

  return (
    <section className="a4-ops" aria-label="Operational audit inspection">
      <PageHeader
        title="Audit inspection"
        description="Authorized inspection of actor, action, resource, timestamp, outcome, institution scope and approval history."
      />

      <p className="a4-ops__notice" data-testid="a4-audit-privacy-notice">
        Privacy is enforced server-side: customer-preference and compliance-case records and
        provider-secret audit metadata are excluded by default, and credential-shaped identifiers
        are masked. This workspace cannot request those categories.
      </p>

      {error ? (
        <Alert tone="danger" title="Unable to load audit records">
          {error}
        </Alert>
      ) : null}

      <form
        className="a4-ops__filters"
        onSubmit={(event) => {
          event.preventDefault();
          setApplied({ ...filters });
        }}
      >
        <Field label="Actor" htmlFor="a4-audit-actor">
          <input
            id="a4-audit-actor"
            value={filters.actor}
            onChange={(event) => setFilters({ ...filters, actor: event.target.value })}
          />
        </Field>
        <Field label="Action" htmlFor="a4-audit-action">
          <input
            id="a4-audit-action"
            value={filters.action}
            onChange={(event) => setFilters({ ...filters, action: event.target.value })}
          />
        </Field>
        <Field label="Resource type" htmlFor="a4-audit-entity-type">
          <input
            id="a4-audit-entity-type"
            value={filters.entityType}
            placeholder="e.g. AUTHORIZATION_DECISION"
            onChange={(event) =>
              setFilters({ ...filters, entityType: event.target.value.toUpperCase() })
            }
          />
        </Field>
        <Field label="Outcome" htmlFor="a4-audit-outcome">
          <select
            id="a4-audit-outcome"
            value={filters.outcome}
            onChange={(event) => setFilters({ ...filters, outcome: event.target.value })}
          >
            {OUTCOME_OPTIONS.map((option) => (
              <option key={option.value || 'ALL'} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Institution ID" htmlFor="a4-audit-institution">
          <input
            id="a4-audit-institution"
            value={filters.institutionId}
            onChange={(event) => setFilters({ ...filters, institutionId: event.target.value })}
          />
        </Field>
        <Field label="From" htmlFor="a4-audit-from">
          <input
            id="a4-audit-from"
            type="datetime-local"
            value={filters.from}
            onChange={(event) => setFilters({ ...filters, from: event.target.value })}
          />
        </Field>
        <Field label="To" htmlFor="a4-audit-to">
          <input
            id="a4-audit-to"
            type="datetime-local"
            value={filters.to}
            onChange={(event) => setFilters({ ...filters, to: event.target.value })}
          />
        </Field>
        <Button type="submit" variant="primary" disabled={loading}>
          Search audit records
        </Button>
      </form>

      {loading ? (
        <p role="status">Loading audit records…</p>
      ) : page ? (
        <>
          <StructuredRecordTable
            rows={page?.data ?? []}
            columns={AUDIT_COLUMNS}
            emptyMessage="No audit records match these filters."
            onViewDetails={(row) => {
              void openDetail(row);
            }}
          />
          <p className="a4-ops__muted">
            {page.total} record{page.total === 1 ? '' : 's'} · page {page.page} of{' '}
            {page.totalPages || 1} · access mode {page.accessMode}
          </p>
          <p className="a4-ops__muted">Excluded by default: {page.excludedCategories.join(', ')}</p>
        </>
      ) : null}

      {detailError ? (
        <Alert tone="danger" title="Audit detail unavailable">
          {detailError}
        </Alert>
      ) : null}

      {detail ? (
        <section className="a4-ops__detail" aria-label="Audit record detail">
          <h3>
            {detail.event.entityType} · {detail.event.action}{' '}
            <span className="a4-ops__pill">{String(detail.event['outcome'] ?? 'RECORDED')}</span>
          </h3>
          <StructuredKeyValueList data={detail.event} />

          <div>
            <h4>Approval history</h4>
            {detail.approvalHistory.length === 0 ? (
              <p className="a4-ops__muted">
                No maker/checker record is linked to this event by id, resource or approval
                reference.
              </p>
            ) : (
              <table className="a4-ops__table">
                <thead>
                  <tr>
                    <th scope="col">Approval</th>
                    <th scope="col">Action</th>
                    <th scope="col">Status</th>
                    <th scope="col">Requester</th>
                    <th scope="col">Approved by</th>
                    <th scope="col">Requested</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.approvalHistory.map((approval) => (
                    <tr key={approval.id}>
                      <td>{approval.id}</td>
                      <td>{approval.actionType}</td>
                      <td>{approval.status}</td>
                      <td>{approval.requesterPrincipalId}</td>
                      <td>{approval.approvedBy ?? '—'}</td>
                      <td>{new Date(approval.requestedAt).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div>
            <h4>Related events (same correlation)</h4>
            {detail.relatedEvents.length === 0 ? (
              <p className="a4-ops__muted">No related events.</p>
            ) : (
              <ul>
                {detail.relatedEvents.map((event) => (
                  <li key={event.id}>
                    {new Date(event.occurredAt).toLocaleString()} · {event.actor} · {event.action} ·{' '}
                    {event.outcome}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      ) : null}
    </section>
  );
};
