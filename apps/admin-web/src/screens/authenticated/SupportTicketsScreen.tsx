import React, { useEffect, useState } from 'react';
import { ApiClient } from '../../services/api-client';
import { useAuthStore } from '../../store/auth-store';
import { AgentTransactionPinSupportPanel } from '../../components/AgentTransactionPinSupportPanel';

interface Ticket {
  id: string;
  reference?: string;
  category?: string;
  status: string;
  priority?: string;
  subject?: string;
  customerId?: string | null;
  agentId?: string | null;
  assignedTo?: string | null;
  createdAt: string;
  updatedAt: string;
  version?: number;
}

interface TicketMessage {
  id: string;
  ticketId: string;
  authorType: string;
  authorId: string;
  body: string;
  isInternal: boolean;
  createdAt: string;
}

const PAGE_SIZE = 20;
const ALLOWED_STATUS_TRANSITIONS: Record<string, string[]> = {
  OPEN: ['IN_PROGRESS', 'RESOLVED', 'CLOSED'],
  IN_PROGRESS: ['RESOLVED', 'CLOSED'],
  RESOLVED: ['CLOSED'],
  CLOSED: [],
};

export const SupportTicketsScreen: React.FC<{ initialCustomerId?: string; initialAgentId?: string }> = ({
  initialCustomerId,
  initialAgentId,
}) => {
  const { principal } = useAuthStore();
  const canView = principal?.scopes.includes('customer.manage_support_case') ?? false;
  const customerFilter = initialCustomerId || '';
  const [agentIdDraft, setAgentIdDraft] = useState(initialAgentId || '');
  const [appliedAgentFilter, setAppliedAgentFilter] = useState(initialAgentId || '');
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<Ticket | null>(null);
  const [detailErr, setDetailErr] = useState('');
  const [msgBody, setMsgBody] = useState('');
  const [isInternalNote, setIsInternalNote] = useState(false);
  const [msgRes, setMsgRes] = useState('');
  const [assignedToInput, setAssignedToInput] = useState('');
  const [messages, setMessages] = useState<TicketMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messagesError, setMessagesError] = useState('');
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const fetchList = async () => {
    setLoading(true);
    setError('');
    try {
      const query = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
      if (status) query.set('status', status);
      if (customerFilter) query.set('customerId', customerFilter);
      if (appliedAgentFilter.trim()) query.set('agentId', appliedAgentFilter.trim());
      const response: any = await ApiClient.get(`/internal/support/tickets?${query.toString()}`);
      const rows = Array.isArray(response) ? response : Array.isArray(response?.items) ? response.items : Array.isArray(response?.data) ? response.data : [];
      setTickets(rows);
      setTotal(Number(response?.pagination?.total ?? response?.total ?? rows.length));
    } catch (err: any) {
      setError(err?.message || 'Failed to load tickets');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (canView) void fetchList();
    else setLoading(false);
  }, [page, status, customerFilter, appliedAgentFilter, canView]);

  const fetchMessages = async (ticketId: string) => {
    setMessagesLoading(true);
    setMessagesError('');
    try {
      const response: any = await ApiClient.get(`/internal/support/tickets/${ticketId}/messages`);
      setMessages(Array.isArray(response) ? response : Array.isArray(response?.data) ? response.data : Array.isArray(response?.items) ? response.items : []);
    } catch (err: any) {
      setMessagesError(err?.message || 'Failed to load ticket messages');
      setMessages([]);
    } finally {
      setMessagesLoading(false);
    }
  };

  const open = async (ticket: Ticket) => {
    if (!canView) return;
    setSelected(null);
    setMessages([]);
    setDetailErr('');
    setMessagesError('');
    setMsgRes('');
    setAssignedToInput(ticket.assignedTo ?? '');
    try {
      const detail = await ApiClient.get<Ticket>(`/internal/support/tickets/${ticket.id}`);
      setSelected(detail);
      setAssignedToInput(detail.assignedTo ?? '');
      void fetchMessages(detail.id);
    } catch (err: any) {
      setDetailErr(err?.message || 'Failed to load ticket');
      setSelected(ticket);
      void fetchMessages(ticket.id);
    }
  };

  const doStatus = async (newStatus: string) => {
    if (!canView || !selected || !ALLOWED_STATUS_TRANSITIONS[selected.status]?.includes(newStatus)) return;
    setDetailErr('');
    setMsgRes('');
    try {
      const updated = await ApiClient.post<Ticket>(`/internal/support/tickets/${selected.id}/status`, { status: newStatus, version: selected.version });
      setSelected(updated);
      setMsgRes(`Status → ${newStatus}`);
      void fetchList();
    } catch (err: any) {
      setDetailErr(err?.message || 'Status update failed');
    }
  };

  const assignTicket = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canView || !selected) return;
    if (selected.status === 'RESOLVED' || selected.status === 'CLOSED') {
      setDetailErr(`Cannot assign a ticket in ${selected.status} status.`);
      return;
    }
    const assignedTo = assignedToInput.trim();
    if (!assignedTo) {
      setDetailErr('Assignee principal ID is required.');
      return;
    }
    setDetailErr('');
    setMsgRes('');
    try {
      const updated = await ApiClient.post<Ticket>(`/internal/support/tickets/${selected.id}/assign`, {
        assignedTo,
        version: selected.version,
      });
      setSelected(updated);
      setAssignedToInput(updated.assignedTo ?? assignedTo);
      setMsgRes(`Ticket assigned to ${updated.assignedTo ?? assignedTo}.`);
      void fetchList();
    } catch (err: any) {
      setDetailErr(err?.message || 'Ticket assignment failed');
    }
  };

  const addMessage = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canView || !msgBody.trim() || !selected) return;
    if (selected.status === 'CLOSED') {
      setDetailErr('Cannot add a message to a closed ticket.');
      return;
    }
    setDetailErr('');
    setMsgRes('');
    try {
      await ApiClient.post(`/internal/support/tickets/${selected.id}/messages`, {
        body: msgBody.trim(),
        isInternal: isInternalNote,
      });
      setMsgBody('');
      setMsgRes(isInternalNote ? 'Internal note added.' : 'Customer-visible message added.');
      setIsInternalNote(false);
      await fetchMessages(selected.id);
    } catch (err: any) {
      setDetailErr(err?.message || 'Message failed');
    }
  };

  if (!canView) {
    return <div style={wrap} role="alert"><div style={denied}>Requires <code>customer.manage_support_case</code>. Roles: {principal?.roles.join(', ')}</div></div>;
  }

  return (
    <div style={wrap}>
      <h2 style={h2}>🎧 Support Tickets</h2>
      <p style={sub}>Workforce ticket queue. View customer and agent support tickets, filter by Agent ID, assign an operator, update status, and record messages using existing internal support endpoints.</p>
      {initialCustomerId && <div style={contextNote}>🔗 Customer context: <code>{initialCustomerId}</code> — results are filtered by the backend <code>customerId</code> query.</div>}
      {appliedAgentFilter && (
        <div style={contextNote} data-testid="support-agent-filter-banner">
          🏪 Agent filter active: <code>{appliedAgentFilter}</code> — results are filtered by backend <code>agentId</code>.
        </div>
      )}
      <div style={filters}>
        <label>Status <select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}><option value="">All</option><option value="OPEN">OPEN</option><option value="IN_PROGRESS">IN_PROGRESS</option><option value="RESOLVED">RESOLVED</option><option value="CLOSED">CLOSED</option></select></label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
          Agent ID
          <input
            aria-label="Filter by Agent ID"
            placeholder="Agent UUID"
            value={agentIdDraft}
            onChange={(event) => setAgentIdDraft(event.target.value)}
            style={{ ...input, minWidth: 160, padding: '6px 8px' }}
          />
        </label>
        <button
          type="button"
          style={smallBtn}
          disabled={loading}
          onClick={() => {
            setAppliedAgentFilter(agentIdDraft.trim());
            setPage(1);
          }}
        >
          Filter Agent
        </button>
        {appliedAgentFilter && (
          <button
            type="button"
            style={smallBtn}
            disabled={loading}
            onClick={() => {
              setAgentIdDraft('');
              setAppliedAgentFilter('');
              setPage(1);
            }}
          >
            Clear Agent
          </button>
        )}
        <button type="button" onClick={() => void fetchList()} style={btn} disabled={loading}>Refresh</button>
      </div>
      {error && <div style={errBox} role="alert">{error}</div>}
      {loading ? <div style={loadingBox}>Loading tickets…</div> : tickets.length === 0 ? (
        <div style={empty}>No tickets for this filter. Tickets are created from customer/agent support flows.</div>
      ) : (
        <table style={table}>
          <thead><tr><th>ID</th><th>Status</th><th>Category</th><th>Customer/Agent</th><th>Created</th><th></th></tr></thead>
          <tbody>{tickets.map((ticket) => (
            <tr key={ticket.id}>
              <td style={mono}>{ticket.reference || `${ticket.id.slice(0, 8)}…`}</td>
              <td><span style={badge(ticket.status)}>{ticket.status}</span></td>
              <td>{ticket.category ? <code>{ticket.category}</code> : '—'}</td>
              <td>
                {ticket.agentId ? (
                  <span><strong>AGENT</strong> · <code>{ticket.agentId.slice(0, 8)}</code></span>
                ) : ticket.customerId ? (
                  <span>CUSTOMER · <code>{ticket.customerId.slice(0, 8)}</code></span>
                ) : '—'}
              </td>
              <td>{ticket.createdAt ? new Date(ticket.createdAt).toLocaleString() : '—'}</td>
              <td><button type="button" onClick={() => void open(ticket)} style={smallBtn}>View</button></td>
            </tr>
          ))}</tbody>
        </table>
      )}
      <div style={pager}>
        <span>Total {total} — Page {page} of {totalPages}</span>
        <button type="button" disabled={page <= 1 || loading} onClick={() => setPage((current) => Math.max(1, current - 1))} style={smallBtn}>Prev</button>
        <button type="button" disabled={page >= totalPages || loading} onClick={() => setPage((current) => current + 1)} style={smallBtn}>Next</button>
      </div>

      {selected && (
        <section style={drawer} aria-label="Support ticket detail">
          <div style={drawerHead}><strong>Ticket {selected.reference || selected.id.slice(0, 8)}</strong><button type="button" onClick={() => setSelected(null)} style={smallBtn}>Close</button></div>
          <div style={drawerBody}>
            <div><strong>Status:</strong> {selected.status} {selected.priority && <>· Priority {selected.priority}</>} {selected.category && <>· Category <code>{selected.category}</code></>}</div>
            <div><strong>Subject:</strong> {selected.subject || '—'}</div>
            <div>
              <strong>Principal:</strong>{' '}
              {selected.agentId ? (
                <span>Agent <code>{selected.agentId}</code></span>
              ) : selected.customerId ? (
                <span>Customer <code>{selected.customerId}</code></span>
              ) : '—'}
            </div>
            <div><strong>Assigned:</strong> {selected.assignedTo || 'unassigned'}</div>
            {selected.agentId && (selected.category === 'PIN' || /pin/i.test(selected.subject ?? '')) && (
              <AgentTransactionPinSupportPanel
                agentId={selected.agentId}
                canManageSupport={canView}
              />
            )}
            {detailErr && <div style={errBox} role="alert">{detailErr}</div>}
            {msgRes && <div style={successBox} role="status">{msgRes}</div>}

            <form onSubmit={assignTicket} style={formRow} aria-label="Assign support ticket">
              <label style={fieldLabel}>Assignee principal ID
                <input value={assignedToInput} onChange={(event) => setAssignedToInput(event.target.value)} placeholder="Assignee principal ID" style={input} />
              </label>
              <button type="submit" style={btn} disabled={!assignedToInput.trim() || selected.status === 'RESOLVED' || selected.status === 'CLOSED'}>Assign Ticket</button>
            </form>
            <div style={helpText}>Assignment uses an existing workforce principal ID; the API does not provide an assignee directory. Resolved and closed tickets cannot be reassigned.</div>

            <div style={actionRow}>
              <button type="button" onClick={() => void doStatus('IN_PROGRESS')} style={btn} disabled={!ALLOWED_STATUS_TRANSITIONS[selected.status]?.includes('IN_PROGRESS')}>Mark In Progress</button>
              <button type="button" onClick={() => void doStatus('RESOLVED')} style={successBtn} disabled={!ALLOWED_STATUS_TRANSITIONS[selected.status]?.includes('RESOLVED')}>Resolve</button>
              <button type="button" onClick={() => void doStatus('CLOSED')} style={dangerBtn} disabled={!ALLOWED_STATUS_TRANSITIONS[selected.status]?.includes('CLOSED')}>Close</button>
            </div>

            <section style={messageSection} aria-label="Ticket messages">
              <div style={messagesHeader}><strong>Message history</strong><button type="button" onClick={() => void fetchMessages(selected.id)} style={smallBtn} disabled={messagesLoading}>{messagesLoading ? 'Loading…' : 'Refresh messages'}</button></div>
              {messagesError && <div style={errBox} role="alert">{messagesError}</div>}
              {messagesLoading ? <div style={loadingBox}>Loading message history…</div> : messages.length === 0 ? (
                <div style={empty}>No messages on this ticket.</div>
              ) : (
                <div style={messageList}>
                  {messages.map((message) => (
                    <article key={message.id} style={messageItem}>
                      <div style={messageMeta}>
                        <strong>{message.authorType}</strong> · {message.createdAt ? new Date(message.createdAt).toLocaleString() : '—'}
                        <span style={messageVisibility(message.isInternal)}>{message.isInternal ? 'Internal' : 'Customer-visible'}</span>
                      </div>
                      <p style={messageBody}>{message.body}</p>
                    </article>
                  ))}
                </div>
              )}
            </section>

            <form onSubmit={addMessage} style={formRow} aria-label="Add customer-visible message">
              <input value={msgBody} onChange={(event) => setMsgBody(event.target.value)} placeholder="Add customer-visible message…" style={input} />
              <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: '#475569', whiteSpace: 'nowrap' }}>
                <input
                  type="checkbox"
                  aria-label="Internal operator note"
                  checked={isInternalNote}
                  onChange={(event) => setIsInternalNote(event.target.checked)}
                />
                Internal note
              </label>
              <button type="submit" style={btn} disabled={!msgBody.trim() || selected.status === 'CLOSED'}>Send</button>
            </form>
            {selected.status === 'CLOSED' && <div style={helpText}>Closed tickets cannot receive new messages.</div>}
          </div>
        </section>
      )}
    </div>
  );
};

const wrap: React.CSSProperties = { padding: '24px', maxWidth: 1100 };
const h2: React.CSSProperties = { margin: '0 0 8px', color: '#032B14' };
const sub: React.CSSProperties = { color: '#64748B', fontSize: 13, marginBottom: 16 };
const filters: React.CSSProperties = { display: 'flex', gap: 12, marginBottom: 16, alignItems: 'center' };
const contextNote: React.CSSProperties = { ...filters, background: '#F8FAFC', padding: 8, borderRadius: 6, border: '1px solid #E2E8F0', fontSize: 12 };
const btn: React.CSSProperties = { padding: '8px 14px', borderRadius: 6, border: '1px solid #E2E8F0', background: '#fff', cursor: 'pointer' };
const smallBtn: React.CSSProperties = { padding: '6px 10px', borderRadius: 6, border: '1px solid #E2E8F0', background: '#fff', cursor: 'pointer', fontSize: 12 };
const dangerBtn: React.CSSProperties = { ...smallBtn, background: '#FEF2F2', borderColor: '#FCA5A5' };
const successBtn: React.CSSProperties = { ...smallBtn, background: '#ECFDF5', borderColor: '#6EE7B7' };
const table: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', background: '#fff', borderRadius: 8, overflow: 'hidden' };
const badge = (value: string): React.CSSProperties => ({ padding: '2px 8px', borderRadius: 12, fontSize: 11, fontWeight: 700, background: value === 'OPEN' ? '#FFF7ED' : value === 'IN_PROGRESS' ? '#EFF6FF' : value === 'RESOLVED' ? '#ECFDF5' : '#F1F5F9', color: '#334155' });
const errBox: React.CSSProperties = { background: '#FEF2F2', border: '1px solid #FCA5A5', color: '#991B1B', padding: 10, borderRadius: 6, marginBottom: 12, fontSize: 13 };
const successBox: React.CSSProperties = { background: '#ECFDF5', border: '1px solid #6EE7B7', color: '#065F46', padding: 10, borderRadius: 6, marginBottom: 12, fontSize: 13 };
const loadingBox: React.CSSProperties = { padding: 20, textAlign: 'center', color: '#64748B' };
const empty: React.CSSProperties = { padding: 16, textAlign: 'center', color: '#64748B', background: '#F8FAFC', borderRadius: 8, border: '1px dashed #E2E8F0', fontSize: 13 };
const pager: React.CSSProperties = { marginTop: 12, display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, color: '#64748B' };
const denied: React.CSSProperties = { background: '#FFF7ED', border: '1px solid #FDBA74', color: '#92400E', padding: 12, borderRadius: 8, fontSize: 13 };
const drawer: React.CSSProperties = { marginTop: 16, border: '1px solid #E2E8F0', borderRadius: 8, background: '#fff', overflow: 'hidden' };
const drawerHead: React.CSSProperties = { padding: 12, background: '#F8FAFC', borderBottom: '1px solid #E2E8F0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' };
const drawerBody: React.CSSProperties = { padding: 16, display: 'flex', flexDirection: 'column', gap: 12, fontSize: 13 };
const actionRow: React.CSSProperties = { display: 'flex', gap: 8, flexWrap: 'wrap' };
const mono: React.CSSProperties = { fontFamily: 'monospace', fontSize: 12 };
const input: React.CSSProperties = { flex: 1, padding: '8px 10px', borderRadius: 6, border: '1px solid #E2E8F0', minWidth: 180 };
const formRow: React.CSSProperties = { display: 'flex', gap: 8, marginTop: 8, alignItems: 'end' };
const fieldLabel: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 5, flex: 1, minWidth: 220, color: '#475569', fontSize: 12 };
const helpText: React.CSSProperties = { color: '#64748B', fontSize: 11, marginTop: -6 };
const messageSection: React.CSSProperties = { border: '1px solid #E2E8F0', borderRadius: 6, padding: 12, background: '#FCFCFD' };
const messagesHeader: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 };
const messageList: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 360, overflowY: 'auto' };
const messageItem: React.CSSProperties = { padding: 10, background: '#fff', border: '1px solid #E2E8F0', borderRadius: 6 };
const messageMeta: React.CSSProperties = { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 5, color: '#64748B', fontSize: 11 };
const messageVisibility = (internal: boolean): React.CSSProperties => ({ marginLeft: 'auto', padding: '2px 6px', borderRadius: 8, background: internal ? '#FEF3C7' : '#ECFDF5', color: internal ? '#92400E' : '#065F46', fontWeight: 600 });
const messageBody: React.CSSProperties = { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', margin: '8px 0 0', color: '#1E293B', lineHeight: 1.5 };
