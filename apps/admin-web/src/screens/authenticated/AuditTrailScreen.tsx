import React, { useEffect, useRef, useState } from 'react';
import { Alert, Button, Field, PageHeader, ScrollRegion } from '../../design-system/primitives';
import { ApiClient } from '../../services/api-client';
import { useAuthStore } from '../../store/auth-store';
import './audit-trail.css';

type AuditFilter = { entityId: string; entityType: string; correlationId: string };
const SEARCH_LIMIT = 100;
const emptyFilter = (): AuditFilter => ({entityId:'', entityType:'', correlationId:''});
function display(value: unknown): string { return typeof value === 'string' && value.trim() ? value : '—'; }
function formatTime(value: unknown): string {
  if (typeof value !== 'string') return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unavailable' : date.toLocaleString();
}

export const AuditTrailScreen: React.FC<{ initialCustomerId?: string }> = (props) => {
  const principal = useAuthStore((state) => state.principal);
  const contextKey = JSON.stringify([principal?.principalId, principal?.sessionId, principal?.type, principal?.roles, principal?.scopes, principal?.assuranceLevel, principal?.customerAccess, principal?.readOnlyPrincipal]);
  return <AuditTrailWorkspace key={contextKey} {...props} />;
};
const AuditTrailWorkspace: React.FC<{ initialCustomerId?: string }> = ({ initialCustomerId }) => {
  const { principal } = useAuthStore();
  const canView = principal?.scopes.includes('audit.search') ?? false;
  const [filter, setFilter] = useState<AuditFilter>({ ...emptyFilter(), entityId: initialCustomerId || '' });
  const [applied, setApplied] = useState<AuditFilter | null>(null);
  const [events, setEvents] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const requestId = useRef(0);

  const fetchEvents = async (criteria = filter) => {
    if (!canView) return;
    const currentRequest = ++requestId.current;
    const submitted = { entityId:criteria.entityId.trim(), entityType:criteria.entityType.trim(), correlationId:criteria.correlationId.trim() };
    setLoading(true); setError(''); setEvents([]); setApplied(null);
    if (submitted.correlationId.length > 255) { setLoading(false); setError('Correlation ID must be 255 characters or fewer.'); return; }
    try {
      const query = new URLSearchParams({ limit: String(SEARCH_LIMIT) });
      if (submitted.entityId) query.set('entityId', submitted.entityId);
      if (submitted.entityType) query.set('entityType', submitted.entityType);
      if (submitted.correlationId) query.set('correlationId', submitted.correlationId);
      const res: any = await ApiClient.get(`/internal/audit?${query.toString()}`);
      if (currentRequest !== requestId.current) return;
      const rows = Array.isArray(res) ? res : res?.data ?? res?.items;
      if (!Array.isArray(rows) || rows.some((row: unknown) => !row || typeof row !== 'object' || Array.isArray(row))) throw new Error('Audit search returned an invalid response.');
      setEvents(rows); setApplied(submitted);
    } catch (e: any) { if (currentRequest === requestId.current) setError(e?.message || 'Failed to load audit trail'); }
    finally { if (currentRequest === requestId.current) setLoading(false); }
  };
  const invalidate = () => { requestId.current += 1; setEvents([]); setApplied(null); setError(''); setLoading(false); };
  const updateFilter = (key: keyof AuditFilter, value: string) => { invalidate(); setFilter(prev => ({ ...prev, [key]: value })); };
  useEffect(() => {
    const next = { ...emptyFilter(), entityId: initialCustomerId || '' };
    setFilter(next);
    if (initialCustomerId && canView) void fetchEvents(next);
    else { setEvents([]); setApplied(null); setError(''); setLoading(false); }
    return () => { requestId.current += 1; };
  }, [initialCustomerId, canView]);

  if (!canView) return <div className="mn-audit"><Alert>Audit search requires the <code>audit.search</code> function.</Alert></div>;
  const activeFilters = applied ? [applied.entityId && `Entity: ${applied.entityId}`, applied.entityType && `Type: ${applied.entityType}`, applied.correlationId && `Correlation: ${applied.correlationId}`].filter(Boolean) : [];
  return (
    <div className="mn-audit">
      <PageHeader eyebrow="System administration" title="Audit & Security Events" description="Search read-only audit records by entity, type or correlation identifier." />
      <div className="mn-audit__boundary" role="note"><strong>Read-only oversight</strong><span>Results are subject to server-side access restrictions and show up to the {SEARCH_LIMIT} most recent matching events. This is not a complete event count or a paginated history.</span></div>
      <section className="mn-audit__panel" aria-labelledby="audit-search-heading">
        <div className="mn-audit__heading"><div><p className="mn-audit__eyebrow">SEARCH CRITERIA</p><h2 id="audit-search-heading">Find audit events</h2><p>Leave fields empty to search across available events. Filters are exact matches; correlation identifiers are sanitized by the server.</p></div></div>
        <form className="mn-audit__form" onSubmit={e => { e.preventDefault(); void fetchEvents(); }}>
          <Field label="Entity ID (optional)" htmlFor="audit-entity" className="mn-audit__field"><input id="audit-entity" className="mn-audit__input" value={filter.entityId} onChange={e => updateFilter('entityId', e.target.value)} placeholder="e.g. customer or resource ID" /></Field>
          <Field label="Entity type (optional)" htmlFor="audit-type" className="mn-audit__field"><input id="audit-type" className="mn-audit__input" value={filter.entityType} onChange={e => updateFilter('entityType', e.target.value)} placeholder="e.g. CUSTOMER" /></Field>
          <Field label="Correlation ID (optional)" htmlFor="audit-correlation" className="mn-audit__field"><input id="audit-correlation" className="mn-audit__input" value={filter.correlationId} onChange={e => updateFilter('correlationId', e.target.value)} maxLength={255} placeholder="Correlation identifier" /></Field>
          <div className="mn-audit__actions"><Button type="submit" variant="primary" disabled={loading}>{loading ? 'Searching…' : 'Search'}</Button><Button onClick={() => { invalidate(); setFilter(emptyFilter()); }}>Clear filters</Button></div>
        </form>
        {initialCustomerId && <p className="mn-audit__hint">Initially pre-filled from Customer 360°.</p>}
      </section>
      <section className="mn-audit__panel mn-audit__results" aria-labelledby="audit-results-heading">
        <div className="mn-audit__heading"><div><p className="mn-audit__eyebrow">AUDIT RECORDS</p><h2 id="audit-results-heading">Search results</h2></div>{applied && <span className="mn-audit__count">{events.length} returned</span>}</div>
        {applied && <div className="mn-audit__summary"><span>{activeFilters.length ? 'Submitted filters:' : 'All available events'}</span>{activeFilters.map(value => <span className="mn-audit__chip" key={value as string}>{value}</span>)}</div>}
        {error && <Alert title="Audit search failed">{error}</Alert>}
        {loading && <p className="mn-audit__state" role="status">Searching audit events…</p>}
        {!loading && !error && !applied && <p className="mn-audit__state">Enter an entity ID or search all events.</p>}
        {!loading && !error && applied && events.length === 0 && <p className="mn-audit__state">No audit events — try different filters or a global search.</p>}
        {!loading && !error && applied && events.length >= SEARCH_LIMIT && <p className="mn-audit__limit" role="note">The result limit was reached. More matching events may exist; refine the filters.</p>}
        {!loading && !error && applied && events.length > 0 && <ScrollRegion label="Audit events" hint="Scroll horizontally to see all columns.">
          <table className="mn-audit__table"><thead><tr><th scope="col">Time</th><th scope="col">Actor</th><th scope="col">Action</th><th scope="col">Entity</th><th scope="col">Entity ID</th></tr></thead><tbody>{events.map((ev, i) => <tr key={`${display(ev.id)}-${i}`}><td>{formatTime(ev.occurredAt)}</td><td>{display(ev.actor)}</td><td>{display(ev.action)}</td><td>{display(ev.entityType)}</td><td>{display(ev.entityId)}</td></tr>)}</tbody></table>
        </ScrollRegion>}
      </section>
    </div>
  );
};
