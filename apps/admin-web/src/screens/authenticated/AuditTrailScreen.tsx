import React, { useEffect, useRef, useState } from 'react';
import { Alert, Button, Field, PageHeader, ScrollRegion } from '../../design-system/primitives';
import { ApiClient } from '../../services/api-client';
import { useAuthStore } from '../../store/auth-store';
import './audit-trail.css';

export const AuditTrailScreen: React.FC<{ initialCustomerId?: string }> = (props) => {
  const principal = useAuthStore((state) => state.principal);
  const contextKey = JSON.stringify([principal?.principalId, principal?.sessionId, principal?.type, principal?.roles, principal?.scopes, principal?.assuranceLevel, principal?.customerAccess, principal?.readOnlyPrincipal]);
  return <AuditTrailWorkspace key={contextKey} {...props} />;
};
const AuditTrailWorkspace: React.FC<{ initialCustomerId?: string }> = ({ initialCustomerId }) => {
  const { principal } = useAuthStore();
  const canView = principal?.scopes.includes('audit.search') ?? false;
  const [customerId, setCustomerId] = useState(initialCustomerId || '');
  const [events, setEvents] = useState<any[]>([]);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const requestId = useRef(0);

  const fetchEvents = async (entityId = customerId) => {
    if (!canView) return;
    const currentRequest = ++requestId.current;
    setLoading(true); setError(''); setEvents([]); setSearched(false);
    try {
      const query = new URLSearchParams({ limit: '100' });
      if (entityId.trim()) query.set('entityId', entityId.trim());
      const res: any = await ApiClient.get(`/internal/audit?${query.toString()}`);
      if (currentRequest !== requestId.current) return;
      const rows = Array.isArray(res) ? res : res?.data ?? res?.items;
      if (!Array.isArray(rows) || rows.some((row: unknown) => !row || typeof row !== 'object' || Array.isArray(row))) throw new Error('Audit search returned an invalid response.');
      setEvents(rows);
      setSearched(true);
    } catch (e: any) { if (currentRequest === requestId.current) setError(e?.message || 'Failed to load audit trail'); }
    finally { if (currentRequest === requestId.current) setLoading(false); }
  };

  useEffect(() => {
    setCustomerId(initialCustomerId || '');
    if (initialCustomerId && canView) void fetchEvents(initialCustomerId);
    else { setEvents([]); setSearched(false); setError(''); setLoading(false); }
    return () => { requestId.current += 1; };
  }, [initialCustomerId, canView]);

  if (!canView) return <div className="mn-audit"><Alert>Audit search requires the <code>audit.search</code> function.</Alert></div>;

  return (
    <div className="mn-audit">
      <PageHeader eyebrow="System administration" title="Audit & Security Events" description="Search read-only audit records by entity or across the system." />
      <section className="mn-audit__panel" aria-label="Audit search">
        <form className="mn-audit__form" onSubmit={e => { e.preventDefault(); void fetchEvents(); }}>
          <Field label="Entity UUID (optional)" htmlFor="audit-entity" className="mn-audit__field">
            <input id="audit-entity" className="mn-audit__input" value={customerId} onChange={e => { requestId.current += 1; setCustomerId(e.target.value); setEvents([]); setSearched(false); setError(''); setLoading(false); }} placeholder="Leave empty for a global search" />
          </Field>
          <Button type="submit" variant="primary" disabled={loading}>{loading ? 'Searching…' : 'Search'}</Button>
        </form>
        {initialCustomerId && <p className="mn-audit__hint">Pre-filled from Customer 360°.</p>}
        {error && <Alert title="Audit search failed">{error}</Alert>}
        {loading && <p className="mn-audit__state" role="status">Searching audit events…</p>}
        {!loading && !error && !searched && <p className="mn-audit__state">Enter an entity UUID or search all events.</p>}
        {!loading && !error && searched && events.length === 0 && <p className="mn-audit__state">No audit events — try a different customer or global search.</p>}
        {!loading && !error && events.length > 0 && <ScrollRegion label="Audit events" hint="Scroll horizontally to see all columns.">
          <table className="mn-audit__table"><thead><tr><th scope="col">Time</th><th scope="col">Actor</th><th scope="col">Action</th><th scope="col">Entity</th><th scope="col">Entity ID</th></tr></thead><tbody>{events.map((ev: any, i) => <tr key={ev.id || i}><td>{ev.occurredAt ? new Date(ev.occurredAt).toLocaleString() : '—'}</td><td>{ev.actor || '—'}</td><td>{ev.action || '—'}</td><td>{ev.entityType || '—'}</td><td>{ev.entityId || '—'}</td></tr>)}</tbody></table>
        </ScrollRegion>}
      </section>
    </div>
  );
};
