import React, { useEffect, useRef, useState } from 'react';
import { PageHeader, ScrollRegion } from '../../design-system/primitives';
import { WorkspaceDrawer, WorkspaceFilterTabs } from '../../design-system/WorkspaceDrawer';
import './operational-surfaces.css';
import './support-redesign.css';
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
  description?: string;
  customerId?: string | null;
  agentId?: string | null;
  assignedTo?: string | null;
  fundingRequestId?: string | null;
  relatedTransferId?: string | null;
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
function validTicket(value: any): value is Ticket {
  return (
    value &&
    typeof value.id === 'string' &&
    !!value.id &&
    ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'].includes(value.status) &&
    Number.isInteger(value.version) &&
    value.version >= 1 &&
    typeof value.createdAt === 'string' &&
    typeof value.updatedAt === 'string' &&
    (value.assignedTo == null || typeof value.assignedTo === 'string')
  );
}
const ALLOWED_STATUS_TRANSITIONS: Record<string, string[]> = {
  OPEN: ['IN_PROGRESS', 'RESOLVED', 'CLOSED'],
  IN_PROGRESS: ['RESOLVED', 'CLOSED'],
  RESOLVED: ['CLOSED'],
  CLOSED: [],
};

interface SupportProps {
  initialCustomerId?: string;
  initialAgentId?: string;
  onBackToAgent?: () => void;
  onBackToCustomer?: () => void;
  onNavigateToCustomer?: (customerId: string) => void;
  onNavigateToAgent?: (agentId: string) => void;
  onSupportGuardChange?: (guarded: boolean, busy: boolean) => void;
}

export const SupportTicketsScreen: React.FC<SupportProps> = (props) => {
  const { principal, sessionId } = useAuthStore();
  const key = JSON.stringify([
    sessionId,
    principal?.principalId,
    principal?.sessionId,
    principal?.type,
    principal?.roles,
    principal?.scopes,
    principal?.assuranceLevel,
    principal?.customerAccess,
    principal?.readOnlyPrincipal,
    props.initialCustomerId,
    props.initialAgentId,
  ]);
  return <SupportWorkspace key={key} {...props} />;
};

const SupportWorkspace: React.FC<SupportProps> = ({
  initialCustomerId,
  initialAgentId,
  onBackToAgent,
  onBackToCustomer,
  onNavigateToCustomer,
  onNavigateToAgent,
  onSupportGuardChange,
}) => {
  const { principal } = useAuthStore();
  const canView = Boolean(
    principal &&
      ['SUPPORT', 'OPERATOR', 'SERVICE', 'PRIVILEGED'].includes(principal.type) &&
      principal.scopes.includes('customer.manage_support_case'),
  );
  const canChange = canView && !principal?.readOnlyPrincipal;
  const customerFilter = initialCustomerId || '';
  const [agentIdDraft, setAgentIdDraft] = useState(initialAgentId || '');
  const [appliedAgentFilter, setAppliedAgentFilter] = useState(initialAgentId || '');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [assignedFilter, setAssignedFilter] = useState('');
  const [sortBy, setSortBy] = useState('');
  const [searchDraft, setSearchDraft] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [summaryCounts, setSummaryCounts] = useState<{
    total: number;
    open: number;
    inProgress: number;
    resolved: number;
    closed: number;
    unassigned: number;
    criticalOrHigh: number;
  } | null>(null);

  // Create Ticket state
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newSubject, setNewSubject] = useState('');
  const [newCategory, setNewCategory] = useState('FUNDING');
  const [newPriority, setNewPriority] = useState('HIGH');
  const [newDescription, setNewDescription] = useState('');
  const [newTargetCustomerId, setNewTargetCustomerId] = useState(initialCustomerId || '');
  const [newTargetAgentId, setNewTargetAgentId] = useState(initialAgentId || '');
  const [creatingTicket, setCreatingTicket] = useState(false);
  const [createTicketErr, setCreateTicketErr] = useState('');
  const [createTicketMsg, setCreateTicketMsg] = useState('');

  useEffect(() => {
    const nextAgentId = initialAgentId || '';
    setAgentIdDraft(nextAgentId);
    setAppliedAgentFilter(nextAgentId);
    setPage(1);
  }, [initialAgentId]);
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
  const listRequestId = useRef(0);
  const detailRequestId = useRef(0);
  const activeTicketId = useRef<string | null>(null);
  const messageRequestId = useRef(0);
  const [detailLoading, setDetailLoading] = useState(false);
  const inFlight = useRef(false);
  const [saving, setSaving] = useState(false);
  const [needsReload, setNeedsReload] = useState(false);
  const [reviewReady, setReviewReady] = useState(false);
  const [messageAttempt, setMessageAttempt] = useState<{
    ticketId: string;
    body: string;
    isInternal: boolean;
    key: string;
    createdAt: number;
  } | null>(null);
  const [pendingExit, setPendingExit] = useState<Ticket | 'close' | 'back' | null>(null);
  const [confirmAbandonMessage, setConfirmAbandonMessage] = useState(false);
  const hasDraft =
    Boolean(msgBody.trim()) ||
    isInternalNote ||
    Boolean(messageAttempt) ||
    Boolean(selected && assignedToInput.trim() !== (selected.assignedTo ?? ''));
  const supportGuard = saving || needsReload || hasDraft;
  useEffect(() => {
    onSupportGuardChange?.(supportGuard, saving);
  }, [onSupportGuardChange, supportGuard, saving]);
  useEffect(() => () => onSupportGuardChange?.(false, false), [onSupportGuardChange]);
  useEffect(() => {
    if (!supportGuard) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [supportGuard]);

  const keepDraftRef = useRef<HTMLButtonElement>(null);
  const detailTitleRef = useRef<HTMLHeadingElement>(null);
  const detailTriggerRef = useRef<HTMLElement | null>(null);
  const focusDetailOnOpen = useRef(false);
  const focusTriggerOnClose = useRef(false);
  useEffect(() => {
    if (selected && focusDetailOnOpen.current) {
      focusDetailOnOpen.current = false;
      detailTitleRef.current?.focus();
    }
    if (!selected && focusTriggerOnClose.current) {
      focusTriggerOnClose.current = false;
      detailTriggerRef.current?.focus();
    }
  }, [selected]);
  const exitTriggerRef = useRef<HTMLElement | null>(null);
  const restoreExitFocus = useRef(false);
  useEffect(() => {
    if (pendingExit) keepDraftRef.current?.focus();
    else if (restoreExitFocus.current) {
      restoreExitFocus.current = false;
      exitTriggerRef.current?.focus();
    }
  }, [pendingExit]);
  useEffect(
    () => () => {
      detailRequestId.current += 1;
      messageRequestId.current += 1;
    },
    [],
  );
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const fetchList = async () => {
    const requestId = ++listRequestId.current;
    setLoading(true);
    setError('');
    try {
      const query = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
      if (status) query.set('status', status);
      if (priorityFilter) query.set('priority', priorityFilter);
      if (categoryFilter) query.set('category', categoryFilter);
      if (assignedFilter) {
        query.set(
          'assignedTo',
          assignedFilter === '__ME__' && principal?.principalId
            ? principal.principalId
            : assignedFilter,
        );
      }
      if (appliedSearch.trim()) query.set('search', appliedSearch.trim());
      if (sortBy) query.set('sortBy', sortBy);
      if (customerFilter) query.set('customerId', customerFilter);
      if (appliedAgentFilter.trim()) query.set('agentId', appliedAgentFilter.trim());
      const response: any = await ApiClient.get(`/internal/support/tickets?${query.toString()}`);
      const rows = Array.isArray(response) ? response : (response?.items ?? response?.data);
      const count = response?.pagination?.total ?? response?.total ?? rows?.length;
      if (
        !Array.isArray(rows) ||
        !rows.every(
          (row: any) =>
            row &&
            typeof row.id === 'string' &&
            !!row.id &&
            typeof row.status === 'string' &&
            typeof row.createdAt === 'string',
        ) ||
        !Number.isSafeInteger(count) ||
        count < rows.length
      )
        throw new Error('Ticket search returned an invalid response.');
      if (requestId !== listRequestId.current) return;
      setTickets(rows);
      setTotal(count);
      if (response?.counts && typeof response.counts === 'object') {
        setSummaryCounts(response.counts);
      }
    } catch (err: any) {
      if (requestId === listRequestId.current) setError(err?.message || 'Failed to load tickets');
    } finally {
      if (requestId === listRequestId.current) setLoading(false);
    }
  };

  const latestFetchList = useRef(fetchList);
  latestFetchList.current = fetchList;

  useEffect(() => {
    if (canView) void fetchList();
    else setLoading(false);
    return () => {
      listRequestId.current += 1;
    };
  }, [
    page,
    status,
    priorityFilter,
    categoryFilter,
    assignedFilter,
    appliedSearch,
    sortBy,
    customerFilter,
    appliedAgentFilter,
    canView,
  ]);

  const handleCreateSupportTicket = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canChange || creatingTicket) return;
    const subj = newSubject.trim();
    const desc = newDescription.trim();
    if (subj.length < 3 || desc.length < 3) {
      setCreateTicketErr('Subject and description must each be at least 3 characters.');
      return;
    }
    setCreatingTicket(true);
    setCreateTicketErr('');
    setCreateTicketMsg('');
    try {
      const idemKey = globalThis.crypto?.getRandomValues
        ? Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)), (v) =>
            v.toString(16).padStart(2, '0'),
          ).join('')
        : `sup-${Date.now()}`;
      const payload: Record<string, unknown> = {
        subject: subj,
        category: newCategory,
        priority: newPriority,
        description: desc,
      };
      if (newTargetCustomerId.trim()) payload.targetCustomerId = newTargetCustomerId.trim();
      if (newTargetAgentId.trim()) payload.targetAgentId = newTargetAgentId.trim();
      const created = await ApiClient.post<Ticket>('/internal/support/tickets', payload, {
        idempotencyKey: idemKey,
      });
      if (!validTicket(created)) {
        throw new Error('Ticket creation receipt was invalid.');
      }
      setCreateTicketMsg(`Created support ticket ${created.reference || created.id}.`);
      setNewSubject('');
      setNewDescription('');
      setShowCreateForm(false);
      void latestFetchList.current();
      void open(created);
    } catch (err: any) {
      setCreateTicketErr(err?.message || 'Failed to create support ticket.');
    } finally {
      setCreatingTicket(false);
    }
  };

  const fetchMessages = async (ticketId: string, detailId = detailRequestId.current) => {
    const requestId = ++messageRequestId.current;
    const current = () =>
      requestId === messageRequestId.current && detailId === detailRequestId.current;
    setMessagesLoading(true);
    setMessagesError('');
    try {
      const response: unknown = await ApiClient.get(
        `/internal/support/tickets/${ticketId}/messages`,
      );
      if (
        !Array.isArray(response) ||
        !response.every(
          (row: any) =>
            row &&
            typeof row.id === 'string' &&
            row.ticketId === ticketId &&
            typeof row.body === 'string' &&
            typeof row.authorType === 'string' &&
            typeof row.isInternal === 'boolean' &&
            typeof row.createdAt === 'string',
        )
      )
        throw new Error('Ticket messages returned an invalid response.');
      if (current()) {
        setMessages(response);
        return true;
      }
      return false;
    } catch (err: any) {
      if (current()) {
        setMessagesError(err?.message || 'Failed to load ticket messages');
        setMessages([]);
      }
      return false;
    } finally {
      if (current()) setMessagesLoading(false);
    }
  };

  const open = async (ticket: Ticket, preserveDraft = false) => {
    if (!canView || inFlight.current) return;
    if (!preserveDraft) setNeedsReload(false);
    setReviewReady(false);
    const requestId = ++detailRequestId.current;
    activeTicketId.current = null;
    messageRequestId.current += 1;
    if (!preserveDraft) {
      setSelected(null);
      setMessages([]);
    }
    setDetailErr('');
    setMessagesError('');
    setMsgRes('');
    if (!preserveDraft) {
      setMsgBody('');
      setIsInternalNote(false);
      setMessageAttempt(null);
    }
    if (!preserveDraft) setAssignedToInput('');
    setDetailLoading(true);
    setMessagesLoading(false);
    try {
      const detail = await ApiClient.get<Ticket>(`/internal/support/tickets/${ticket.id}`);
      if (!validTicket(detail) || detail.id !== ticket.id)
        throw new Error('Ticket detail returned an invalid response.');
      if (requestId !== detailRequestId.current) return;
      activeTicketId.current = detail.id;
      setSelected(detail);
      if (!preserveDraft) setAssignedToInput(detail.assignedTo ?? '');
      if (preserveDraft) {
        const historyLoaded = await fetchMessages(detail.id, requestId);
        if (requestId === detailRequestId.current && historyLoaded) setReviewReady(true);
      } else void fetchMessages(detail.id, requestId);
    } catch (err: any) {
      if (requestId === detailRequestId.current)
        setDetailErr(err?.message || 'Failed to load ticket');
    } finally {
      if (requestId === detailRequestId.current) setDetailLoading(false);
    }
  };

  const closeDetail = () => {
    detailRequestId.current += 1;
    messageRequestId.current += 1;
    activeTicketId.current = null;
    setSelected(null);
    setMessages([]);
    setMsgBody('');
    setIsInternalNote(false);
    setMsgRes('');
    setDetailErr('');
  };

  const requestDetailExit = (target: Ticket | 'close' | 'back') => {
    if (inFlight.current || pendingExit) return;
    const dirty = hasDraft || needsReload;
    if (typeof target !== 'string')
      detailTriggerRef.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (selected && dirty) {
      exitTriggerRef.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setPendingExit(target);
    } else if (target === 'close') {
      focusTriggerOnClose.current = true;
      closeDetail();
    } else if (target === 'back') onBackToAgent?.();
    else {
      focusDetailOnOpen.current = true;
      void open(target);
    }
  };

  const confirmDetailExit = () => {
    const target = pendingExit;
    setPendingExit(null);
    setMessageAttempt(null);
    setConfirmAbandonMessage(false);
    setNeedsReload(false);
    setReviewReady(false);
    if (target === 'close') {
      focusTriggerOnClose.current = true;
      closeDetail();
    } else if (target === 'back') onBackToAgent?.();
    else if (target) {
      focusDetailOnOpen.current = true;
      void open(target);
    }
  };

  const runMutation = async (work: (ticket: Ticket, current: () => boolean) => Promise<void>) => {
    if (
      !canChange ||
      !selected ||
      activeTicketId.current !== selected.id ||
      needsReload ||
      inFlight.current ||
      pendingExit ||
      detailLoading
    )
      return;
    const requestId = detailRequestId.current;
    const current = () => requestId === detailRequestId.current;
    inFlight.current = true;
    setSaving(true);
    setDetailErr('');
    setMsgRes('');
    try {
      await work(selected, current);
    } catch (err: any) {
      if (current()) {
        setNeedsReload(true);
        setReviewReady(false);
        setDetailErr(
          `${err?.message || 'Action failed'}. The outcome may be uncertain or the ticket may have changed; reload and inspect before retrying.`,
        );
      }
    } finally {
      inFlight.current = false;
      if (current()) setSaving(false);
    }
  };

  const doStatus = async (newStatus: string) => {
    if (
      !selected ||
      messageAttempt ||
      !ALLOWED_STATUS_TRANSITIONS[selected.status]?.includes(newStatus)
    )
      return;
    await runMutation(async (ticket, current) => {
      if (!Number.isInteger(ticket.version)) throw new Error('Ticket version is unavailable');
      const updated = await ApiClient.post<Ticket>(
        `/internal/support/tickets/${ticket.id}/status`,
        { status: newStatus, version: ticket.version },
      );
      if (
        !validTicket(updated) ||
        updated.id !== ticket.id ||
        updated.status !== newStatus ||
        updated.version! <= ticket.version!
      )
        throw new Error('Status receipt did not match the requested update');
      if (!current()) return;
      setSelected(updated);
      setMsgRes(`Status → ${newStatus}`);
      void latestFetchList.current();
    });
  };

  const assignTicket = async (event: React.FormEvent) => {
    event.preventDefault();
    if (
      !selected ||
      messageAttempt ||
      selected.status === 'RESOLVED' ||
      selected.status === 'CLOSED'
    )
      return;
    const assignedTo = assignedToInput.trim();
    if (!assignedTo) {
      setDetailErr('Assignee principal ID is required.');
      return;
    }
    await runMutation(async (ticket, current) => {
      if (!Number.isInteger(ticket.version)) throw new Error('Ticket version is unavailable');
      const updated = await ApiClient.post<Ticket>(
        `/internal/support/tickets/${ticket.id}/assign`,
        { assignedTo, version: ticket.version },
      );
      if (
        !validTicket(updated) ||
        updated.id !== ticket.id ||
        updated.assignedTo !== assignedTo ||
        updated.version! < ticket.version! ||
        (updated.version === ticket.version && ticket.assignedTo !== assignedTo)
      )
        throw new Error('Assignment receipt did not match the requested update');
      if (!current()) return;
      setSelected(updated);
      setAssignedToInput(updated.assignedTo ?? '');
      setMsgRes(`Ticket assigned to ${assignedTo}.`);
      void latestFetchList.current();
    });
  };

  const addMessage = async (event: React.FormEvent) => {
    event.preventDefault();
    if (
      !canChange ||
      !selected ||
      selected.status === 'CLOSED' ||
      !msgBody.trim() ||
      needsReload ||
      inFlight.current ||
      pendingExit ||
      confirmAbandonMessage ||
      detailLoading ||
      messagesLoading ||
      Boolean(messagesError)
    )
      return;
    const body = msgBody.trim();
    const isInternal = isInternalNote;
    let attempt = messageAttempt;
    if (
      attempt &&
      (attempt.ticketId !== selected.id ||
        attempt.body !== body ||
        attempt.isInternal !== isInternal ||
        Date.now() - attempt.createdAt >= 24 * 60 * 60 * 1000)
    ) {
      setDetailErr(
        'The previous message attempt cannot be safely retried. Inspect history before abandoning it.',
      );
      return;
    }
    if (!attempt) {
      if (!globalThis.crypto?.getRandomValues) {
        setDetailErr('Secure message request key generation is unavailable.');
        return;
      }
      let key: string;
      try {
        key = Array.from(globalThis.crypto.getRandomValues(new Uint8Array(24)), (value) =>
          value.toString(16).padStart(2, '0'),
        ).join('');
      } catch {
        setDetailErr('Secure message request key generation is unavailable.');
        return;
      }
      attempt = { ticketId: selected.id, body, isInternal, key, createdAt: Date.now() };
      setMessageAttempt(attempt);
    }
    const key = attempt.key;
    await runMutation(async (ticket, current) => {
      const receipt = await ApiClient.post<TicketMessage>(
        `/internal/support/tickets/${ticket.id}/messages`,
        { body, isInternal },
        { idempotencyKey: key },
      );
      if (
        !receipt ||
        typeof receipt.id !== 'string' ||
        !receipt.id ||
        receipt.ticketId !== ticket.id ||
        receipt.body !== body ||
        receipt.isInternal !== isInternal ||
        receipt.authorId !== principal?.principalId ||
        receipt.authorType !== principal?.type
      )
        throw new Error('Message receipt did not match the submitted message');
      if (!current()) return;
      setMessageAttempt(null);
      setMsgBody('');
      setMsgRes(isInternal ? 'Internal note added.' : 'Customer-visible message added.');
      setIsInternalNote(false);
      void fetchMessages(ticket.id);
    });
  };

  if (!canView) {
    return (
      <div style={wrap} role="alert">
        <div style={denied}>
          Requires <code>customer.manage_support_case</code>. Roles: {principal?.roles.join(', ')}
        </div>
      </div>
    );
  }

  return (
    <div className="mn-operational mn-support-redesign" style={wrap}>
      <PageHeader
        eyebrow="Support"
        title="Support Tickets"
        description="View customer and agent support tickets, assign an operator, update status and record messages."
      />
      {initialCustomerId && (
        <div style={contextNote}>
          <span>
            🔗 Customer context: <code>{initialCustomerId}</code> — results are filtered by the
            backend <code>customerId</code> query.
          </span>
          {onBackToCustomer && (
            <button
              type="button"
              onClick={onBackToCustomer}
              disabled={saving || Boolean(pendingExit)}
              style={smallBtn}
            >
              Back to Customer 360°
            </button>
          )}
        </div>
      )}
      {appliedAgentFilter && (
        <div style={contextNote} data-testid="support-agent-filter-banner">
          <span>
            🏪 Agent filter active: <code>{appliedAgentFilter}</code> — results are filtered by
            backend <code>agentId</code>.
          </span>
          {onBackToAgent && (
            <>
              {' '}
              <button
                type="button"
                onClick={() => requestDetailExit('back')}
                disabled={saving || Boolean(pendingExit)}
                style={smallBtn}
              >
                Back to Agent Network
              </button>
            </>
          )}
        </div>
      )}
      <section className="mn-support-redesign__queue" aria-label="Support ticket queue">
        <header
          className="mn-support-redesign__section-head"
          style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}
        >
          <div>
            <p>SUPPORT OPERATIONS</p>
            <h2>Ticket queue</h2>
            <span>Find a ticket, review its history and act within your permissions.</span>
          </div>
          {canChange && (
            <button
              type="button"
              style={btn}
              onClick={() => {
                setShowCreateForm((openState) => !openState);
                setCreateTicketErr('');
                setCreateTicketMsg('');
              }}
            >
              {showCreateForm ? 'Close new ticket form' : '+ New support ticket'}
            </button>
          )}
        </header>

        {createTicketMsg && (
          <div style={successBox} role="status">
            {createTicketMsg}
          </div>
        )}

        {showCreateForm && canChange && (
          <form
            onSubmit={handleCreateSupportTicket}
            aria-label="Create support ticket"
            style={{
              background: '#F8FAFC',
              border: '1px solid #DDE7E2',
              borderRadius: 8,
              padding: 14,
              marginBottom: 14,
              display: 'grid',
              gap: 10,
            }}
          >
            <strong style={{ fontSize: 14 }}>Open workforce support ticket</strong>
            {createTicketErr && (
              <div style={errBox} role="alert">
                {createTicketErr}
              </div>
            )}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                gap: 10,
              }}
            >
              <label style={fieldLabel}>
                Subject
                <input
                  aria-label="Ticket subject"
                  value={newSubject}
                  onChange={(e) => setNewSubject(e.target.value)}
                  placeholder="Concise issue summary"
                  style={input}
                />
              </label>
              <label style={fieldLabel}>
                Category
                <select
                  aria-label="Ticket category"
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value)}
                  style={statusSelect}
                >
                  <option value="FUNDING">FUNDING</option>
                  <option value="TRANSFER">TRANSFER</option>
                  <option value="WALLET">WALLET</option>
                  <option value="CASH_IN">CASH_IN</option>
                  <option value="CASH_OUT">CASH_OUT</option>
                  <option value="CASH_TO_CASH">CASH_TO_CASH</option>
                  <option value="PROFILE">PROFILE</option>
                  <option value="PIN">PIN</option>
                  <option value="AUTHENTICATION">AUTHENTICATION</option>
                  <option value="AGENT_FUNDING">AGENT_FUNDING</option>
                  <option value="OUTLET">OUTLET</option>
                  <option value="TERMINAL">TERMINAL</option>
                  <option value="OTHER">OTHER</option>
                </select>
              </label>
              <label style={fieldLabel}>
                Priority
                <select
                  aria-label="Ticket priority"
                  value={newPriority}
                  onChange={(e) => setNewPriority(e.target.value)}
                  style={statusSelect}
                >
                  <option value="CRITICAL">CRITICAL</option>
                  <option value="HIGH">HIGH</option>
                  <option value="MEDIUM">MEDIUM</option>
                  <option value="LOW">LOW</option>
                </select>
              </label>
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                gap: 10,
              }}
            >
              <label style={fieldLabel}>
                Customer UUID (optional)
                <input
                  aria-label="Target customer UUID"
                  value={newTargetCustomerId}
                  onChange={(e) => setNewTargetCustomerId(e.target.value)}
                  placeholder="Optional customer UUID"
                  style={input}
                />
              </label>
              <label style={fieldLabel}>
                Agent UUID (optional)
                <input
                  aria-label="Target agent UUID"
                  value={newTargetAgentId}
                  onChange={(e) => setNewTargetAgentId(e.target.value)}
                  placeholder="Optional agent UUID"
                  style={input}
                />
              </label>
            </div>
            <label style={fieldLabel}>
              Description
              <textarea
                aria-label="Ticket description"
                rows={3}
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                placeholder="Describe customer/agent report, references, and triage steps…"
                style={{ ...input, minHeight: 72 }}
              />
            </label>
            <div>
              <button type="submit" style={btn} disabled={creatingTicket}>
                {creatingTicket ? 'Creating…' : 'Create support ticket'}
              </button>
            </div>
          </form>
        )}

        {summaryCounts && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
              gap: 8,
              marginBottom: 12,
            }}
            data-testid="support-ticket-kpis"
          >
            <div style={contextNote}>
              <span>Total:</span> <strong>{summaryCounts.total}</strong>
            </div>
            <div style={contextNote}>
              <span>Open:</span> <strong>{summaryCounts.open}</strong>
            </div>
            <div style={contextNote}>
              <span>In Progress:</span> <strong>{summaryCounts.inProgress}</strong>
            </div>
            <div style={contextNote}>
              <span>Unassigned:</span> <strong>{summaryCounts.unassigned}</strong>
            </div>
            <div style={contextNote}>
              <span>Critical/High:</span> <strong>{summaryCounts.criticalOrHigh}</strong>
            </div>
            <div style={contextNote}>
              <span>Resolved:</span> <strong>{summaryCounts.resolved}</strong>
            </div>
          </div>
        )}

        <WorkspaceFilterTabs
          label="Ticket status filters"
          value={status}
          options={[
            { value: '', label: 'All Tickets' },
            { value: 'OPEN', label: 'Open' },
            { value: 'IN_PROGRESS', label: 'In Progress' },
            { value: 'RESOLVED', label: 'Resolved' },
            { value: 'CLOSED', label: 'Closed' },
          ]}
          onChange={(value) => {
            setStatus(value);
            setPage(1);
          }}
        />
        <div className="mn-support-redesign__filters" style={filters}>
          <label>
            Status{' '}
            <select
              style={statusSelect}
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setPage(1);
              }}
            >
              <option value="">All</option>
              <option value="OPEN">OPEN</option>
              <option value="IN_PROGRESS">IN_PROGRESS</option>
              <option value="RESOLVED">RESOLVED</option>
              <option value="CLOSED">CLOSED</option>
            </select>
          </label>
          <label>
            Priority{' '}
            <select
              aria-label="Filter by priority"
              style={statusSelect}
              value={priorityFilter}
              onChange={(event) => {
                setPriorityFilter(event.target.value);
                setPage(1);
              }}
            >
              <option value="">All</option>
              <option value="CRITICAL">CRITICAL</option>
              <option value="HIGH">HIGH</option>
              <option value="MEDIUM">MEDIUM</option>
              <option value="LOW">LOW</option>
            </select>
          </label>
          <label>
            Category{' '}
            <select
              aria-label="Filter by category"
              style={statusSelect}
              value={categoryFilter}
              onChange={(event) => {
                setCategoryFilter(event.target.value);
                setPage(1);
              }}
            >
              <option value="">All</option>
              <option value="FUNDING">FUNDING</option>
              <option value="TRANSFER">TRANSFER</option>
              <option value="WALLET">WALLET</option>
              <option value="CASH_IN">CASH_IN</option>
              <option value="CASH_OUT">CASH_OUT</option>
              <option value="CASH_TO_CASH">CASH_TO_CASH</option>
              <option value="PROFILE">PROFILE</option>
              <option value="PIN">PIN</option>
              <option value="AUTHENTICATION">AUTHENTICATION</option>
              <option value="AGENT_FUNDING">AGENT_FUNDING</option>
              <option value="OUTLET">OUTLET</option>
              <option value="TERMINAL">TERMINAL</option>
              <option value="OTHER">OTHER</option>
            </select>
          </label>
          <label>
            Queue{' '}
            <select
              aria-label="Filter by assignment"
              style={statusSelect}
              value={assignedFilter}
              onChange={(event) => {
                setAssignedFilter(event.target.value);
                setPage(1);
              }}
            >
              <option value="">All</option>
              <option value="__UNASSIGNED__">Unassigned</option>
              <option value="__ME__">Assigned to me</option>
            </select>
          </label>
          <label>
            Sort{' '}
            <select
              aria-label="Sort tickets"
              style={statusSelect}
              value={sortBy}
              onChange={(event) => {
                setSortBy(event.target.value);
                setPage(1);
              }}
            >
              <option value="">Newest first</option>
              <option value="priority">Priority &amp; urgency</option>
              <option value="updated_at">Recently updated</option>
            </select>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
            Search
            <input
              aria-label="Search tickets"
              placeholder="Reference, subject, or UUID"
              value={searchDraft}
              onChange={(event) => setSearchDraft(event.target.value)}
              style={{ ...input, minWidth: 160, padding: '6px 8px' }}
            />
          </label>
          <button
            type="button"
            style={smallBtn}
            disabled={loading}
            onClick={() => {
              setAppliedSearch(searchDraft.trim());
              setPage(1);
            }}
          >
            Search
          </button>
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
          <button type="button" onClick={() => void fetchList()} style={btn} disabled={loading}>
            Refresh
          </button>
        </div>
        {error && (
          <div style={errBox} role="alert">
            {error}
          </div>
        )}
        {loading ? (
          <div role="status" style={loadingBox}>
            Loading tickets…
          </div>
        ) : error ? null : tickets.length === 0 ? (
          <div style={empty}>
            No tickets for this filter. Tickets are created from customer/agent support flows.
          </div>
        ) : (
          <ScrollRegion
            label="Support tickets"
            hint="Scroll horizontally to see all ticket columns."
          >
            <table className="mn-data-table" style={table}>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Status</th>
                  <th>Category</th>
                  <th>Customer/Agent</th>
                  <th>Created</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {tickets.map((ticket) => (
                  <tr key={ticket.id}>
                    <td style={mono}>{ticket.reference || `${ticket.id.slice(0, 8)}…`}</td>
                    <td>
                      <span style={badge(ticket.status)}>{ticket.status}</span>
                    </td>
                    <td>{ticket.category ? <code>{ticket.category}</code> : '—'}</td>
                    <td>
                      {ticket.agentId ? (
                        <span>
                          <strong>AGENT</strong> · <code>{ticket.agentId.slice(0, 8)}</code>
                        </span>
                      ) : ticket.customerId ? (
                        <span>
                          CUSTOMER · <code>{ticket.customerId.slice(0, 8)}</code>
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>{ticket.createdAt ? new Date(ticket.createdAt).toLocaleString() : '—'}</td>
                    <td>
                      <button
                        type="button"
                        onClick={() => requestDetailExit(ticket)}
                        disabled={saving || Boolean(pendingExit)}
                        style={smallBtn}
                      >
                        View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollRegion>
        )}
        {!loading && !error && (
          <div style={pager}>
            <span>
              Total {total} — Page {page} of {totalPages}
            </span>
            <button
              type="button"
              disabled={page <= 1 || loading}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              style={smallBtn}
            >
              Prev
            </button>
            <button
              type="button"
              disabled={page >= totalPages || loading}
              onClick={() => setPage((current) => current + 1)}
              style={smallBtn}
            >
              Next
            </button>
          </div>
        )}
      </section>
      {detailLoading && (
        <div role="status" style={loadingBox}>
          Loading ticket…
        </div>
      )}
      {!selected && detailErr && (
        <div style={errBox} role="alert">
          {detailErr}
        </div>
      )}
      {selected && (
        <WorkspaceDrawer
          className="one-support-drawer"
          label="Support ticket detail"
          onDismiss={() => requestDetailExit('close')}
        >
          <div style={drawerHead}>
            <h2 ref={detailTitleRef} tabIndex={-1} className="mn-support-redesign__detail-title">
              Ticket {selected.reference || selected.id.slice(0, 8)}
            </h2>
            <button
              type="button"
              onClick={() => requestDetailExit('close')}
              disabled={saving || Boolean(pendingExit)}
              style={smallBtn}
            >
              Close
            </button>
          </div>
          <div style={drawerBody}>
            {pendingExit && (
              <div role="group" aria-label="Discard ticket changes" style={errBox}>
                <p>
                  Discard the local ticket draft, retry key and review lock? An unconfirmed action
                  may already have occurred. Independently inspect the ticket, message and audit
                  history before acting again.
                </p>
                <button
                  ref={keepDraftRef}
                  type="button"
                  style={smallBtn}
                  onClick={() => {
                    restoreExitFocus.current = true;
                    setPendingExit(null);
                  }}
                >
                  Keep editing
                </button>{' '}
                <button type="button" style={smallBtn} onClick={confirmDetailExit}>
                  Discard changes
                </button>
              </div>
            )}
            {!canChange && (
              <p role="note">
                This session is read-only. Ticket actions and messages are unavailable.
              </p>
            )}
            <div>
              <strong>Status:</strong> {selected.status}{' '}
              {selected.priority && <>· Priority {selected.priority}</>}{' '}
              {selected.category && (
                <>
                  · Category <code>{selected.category}</code>
                </>
              )}
            </div>
            <div>
              <strong>Subject:</strong> {selected.subject || '—'}
            </div>
            {selected.description && (
              <div>
                <strong>Description:</strong>{' '}
                <span style={{ whiteSpace: 'pre-wrap' }}>{selected.description}</span>
              </div>
            )}
            <div>
              <strong>Principal:</strong>{' '}
              {selected.agentId ? (
                <span>
                  Agent <code>{selected.agentId}</code>{' '}
                  {onNavigateToAgent && (
                    <button
                      type="button"
                      style={smallBtn}
                      disabled={saving || Boolean(pendingExit)}
                      onClick={() => onNavigateToAgent(selected.agentId!)}
                    >
                      Open Agent Network
                    </button>
                  )}
                </span>
              ) : selected.customerId ? (
                <span>
                  Customer <code>{selected.customerId}</code>{' '}
                  {onNavigateToCustomer && (
                    <button
                      type="button"
                      style={smallBtn}
                      disabled={saving || Boolean(pendingExit)}
                      onClick={() => onNavigateToCustomer(selected.customerId!)}
                    >
                      Open Customer 360°
                    </button>
                  )}
                </span>
              ) : (
                '—'
              )}
            </div>
            <div>
              <strong>Assigned:</strong> {selected.assignedTo || 'unassigned'}
            </div>
            {selected.agentId &&
              (selected.category === 'PIN' || /pin/i.test(selected.subject ?? '')) && (
                <AgentTransactionPinSupportPanel
                  agentId={selected.agentId}
                  canManageSupport={canView}
                />
              )}
            {detailErr && (
              <div style={errBox} role="alert">
                {detailErr}
              </div>
            )}
            {msgRes && (
              <div style={successBox} role="status">
                {msgRes}
              </div>
            )}
            {needsReload && (
              <div role="status" style={helpText}>
                The last action may have occurred. Independently inspect the ticket, messages and
                available audit history before acting again. A fresh read or missing message cannot
                exclude a late commit; this review lock and any retry key are local and lost on
                confirmed exit or session change.
                <button
                  type="button"
                  disabled={detailLoading || messagesLoading || Boolean(pendingExit)}
                  onClick={() => void open(selected, true)}
                  style={smallBtn}
                >
                  Reload ticket and inspect
                </button>
                {reviewReady && (
                  <button
                    type="button"
                    disabled={
                      detailLoading ||
                      messagesLoading ||
                      Boolean(messagesError) ||
                      Boolean(pendingExit)
                    }
                    onClick={() => {
                      setNeedsReload(false);
                      setReviewReady(false);
                    }}
                  >
                    I reviewed the ticket and audit history
                  </button>
                )}
              </div>
            )}

            <form onSubmit={assignTicket} style={formRow} aria-label="Assign support ticket">
              <label style={fieldLabel}>
                Assignee principal ID
                <input
                  disabled={!canChange || saving || needsReload || Boolean(pendingExit)}
                  value={assignedToInput}
                  onChange={(event) => setAssignedToInput(event.target.value)}
                  placeholder="Assignee principal ID"
                  style={input}
                />
              </label>
              {canChange && principal?.principalId && (
                <button
                  type="button"
                  style={smallBtn}
                  disabled={
                    saving ||
                    needsReload ||
                    Boolean(pendingExit) ||
                    Boolean(messageAttempt) ||
                    selected.status === 'RESOLVED' ||
                    selected.status === 'CLOSED'
                  }
                  onClick={() => setAssignedToInput(principal.principalId)}
                >
                  Assign to me
                </button>
              )}
              <button
                type="submit"
                style={btn}
                disabled={
                  !canChange ||
                  saving ||
                  needsReload ||
                  Boolean(pendingExit) ||
                  Boolean(messageAttempt) ||
                  !assignedToInput.trim() ||
                  selected.status === 'RESOLVED' ||
                  selected.status === 'CLOSED'
                }
              >
                Assign Ticket
              </button>
            </form>
            <div style={helpText}>
              Assignment uses an existing workforce principal ID; the API does not provide an
              assignee directory. Resolved and closed tickets cannot be reassigned.
            </div>

            <div style={actionRow}>
              <button
                type="button"
                onClick={() => void doStatus('IN_PROGRESS')}
                style={btn}
                disabled={
                  !canChange ||
                  saving ||
                  needsReload ||
                  Boolean(pendingExit) ||
                  Boolean(messageAttempt) ||
                  !ALLOWED_STATUS_TRANSITIONS[selected.status]?.includes('IN_PROGRESS')
                }
              >
                Mark In Progress
              </button>
              <button
                type="button"
                onClick={() => void doStatus('RESOLVED')}
                style={successBtn}
                disabled={
                  !canChange ||
                  saving ||
                  needsReload ||
                  Boolean(pendingExit) ||
                  Boolean(messageAttempt) ||
                  !ALLOWED_STATUS_TRANSITIONS[selected.status]?.includes('RESOLVED')
                }
              >
                Resolve
              </button>
              <button
                type="button"
                onClick={() => void doStatus('CLOSED')}
                style={dangerBtn}
                disabled={
                  !canChange ||
                  saving ||
                  needsReload ||
                  Boolean(pendingExit) ||
                  Boolean(messageAttempt) ||
                  !ALLOWED_STATUS_TRANSITIONS[selected.status]?.includes('CLOSED')
                }
              >
                Close
              </button>
            </div>

            <section style={messageSection} aria-label="Ticket messages">
              <div style={messagesHeader}>
                <strong>Message history</strong>
                <button
                  type="button"
                  onClick={() => void fetchMessages(selected.id)}
                  style={smallBtn}
                  disabled={messagesLoading}
                >
                  {messagesLoading ? 'Loading…' : 'Refresh messages'}
                </button>
              </div>
              {messagesError && (
                <div style={errBox} role="alert">
                  {messagesError}
                </div>
              )}
              {messagesLoading ? (
                <div role="status" style={loadingBox}>
                  Loading message history…
                </div>
              ) : messagesError ? null : messages.length === 0 ? (
                <div style={empty}>No messages on this ticket.</div>
              ) : (
                <div style={messageList}>
                  {messages.map((message) => (
                    <article key={message.id} style={messageItem}>
                      <div style={messageMeta}>
                        <strong>{message.authorType}</strong> ·{' '}
                        {message.createdAt ? new Date(message.createdAt).toLocaleString() : '—'}
                        <span style={messageVisibility(message.isInternal)}>
                          {message.isInternal ? 'Internal' : 'Customer-visible'}
                        </span>
                      </div>
                      <p style={messageBody}>{message.body}</p>
                    </article>
                  ))}
                </div>
              )}
            </section>

            {messageAttempt && !saving && (
              <div role="status" style={helpText}>
                Message outcome is not confirmed. Reload and inspect history. Retrying the same
                message uses the same request key for up to 24 hours; history alone cannot prove
                non-delivery, and leaving this workspace loses the key.
              </div>
            )}
            {messageAttempt && !saving && !needsReload && !detailLoading && !pendingExit && (
              <div>
                {!confirmAbandonMessage ? (
                  <button
                    type="button"
                    style={smallBtn}
                    onClick={() => setConfirmAbandonMessage(true)}
                  >
                    Abandon unconfirmed message
                  </button>
                ) : (
                  <div role="group" aria-label="Abandon unconfirmed message">
                    <p>
                      The message may already exist. Have you inspected the history? Abandoning
                      removes the retry key.
                    </p>
                    <button
                      type="button"
                      style={smallBtn}
                      onClick={() => setConfirmAbandonMessage(false)}
                    >
                      Keep retry key
                    </button>{' '}
                    <button
                      type="button"
                      style={smallBtn}
                      onClick={() => {
                        setMessageAttempt(null);
                        setMsgBody('');
                        setIsInternalNote(false);
                        setConfirmAbandonMessage(false);
                      }}
                    >
                      Abandon message
                    </button>
                  </div>
                )}
              </div>
            )}
            <form
              onSubmit={addMessage}
              style={formRow}
              aria-label={isInternalNote ? 'Add internal note' : 'Add customer-visible message'}
            >
              <input
                disabled={
                  !canChange ||
                  saving ||
                  needsReload ||
                  Boolean(pendingExit) ||
                  Boolean(messageAttempt)
                }
                aria-label="Message"
                maxLength={4000}
                value={msgBody}
                onChange={(event) => setMsgBody(event.target.value)}
                placeholder={
                  isInternalNote ? 'Add internal note…' : 'Add customer-visible message…'
                }
                style={input}
              />
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  fontSize: 12,
                  color: 'var(--mn-text-secondary, #52655f)',
                  whiteSpace: 'nowrap',
                }}
              >
                <input
                  type="checkbox"
                  disabled={
                    !canChange ||
                    saving ||
                    needsReload ||
                    Boolean(pendingExit) ||
                    Boolean(messageAttempt)
                  }
                  aria-label="Internal operator note"
                  checked={isInternalNote}
                  onChange={(event) => setIsInternalNote(event.target.checked)}
                />
                Internal note
              </label>
              <button
                type="submit"
                style={btn}
                disabled={
                  !canChange ||
                  saving ||
                  needsReload ||
                  Boolean(pendingExit) ||
                  !msgBody.trim() ||
                  selected.status === 'CLOSED' ||
                  confirmAbandonMessage ||
                  detailLoading ||
                  messagesLoading ||
                  Boolean(messagesError)
                }
              >
                Send
              </button>
            </form>
            {selected.status === 'CLOSED' && (
              <div style={helpText}>Closed tickets cannot receive new messages.</div>
            )}
          </div>
        </WorkspaceDrawer>
      )}
    </div>
  );
};

const wrap: React.CSSProperties = { padding: 'clamp(16px, 3vw, 32px)', maxWidth: 1200 };
const h2: React.CSSProperties = { margin: '0 0 8px', color: 'var(--mn-nav-surface-deep, #082f23)' };
const sub: React.CSSProperties = {
  color: 'var(--mn-text-secondary, #52655f)',
  fontSize: 13,
  marginBottom: 16,
};
const filters: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 12,
  marginBottom: 16,
  alignItems: 'center',
};
const statusSelect: React.CSSProperties = {
  minHeight: 40,
  padding: '7px 10px',
  border: '1px solid var(--mn-border-control, #6d817a)',
  borderRadius: 8,
  background: '#fff',
  color: 'var(--mn-text-primary, #132b25)',
};
const contextNote: React.CSSProperties = {
  ...filters,
  background: 'var(--mn-surface-canvas, #f5f8f6)',
  padding: 8,
  borderRadius: 6,
  border: '1px solid var(--mn-border-subtle, #dde7e2)',
  fontSize: 12,
};
const btn: React.CSSProperties = {
  minHeight: 40,
  padding: '8px 14px',
  borderRadius: 8,
  border: '1px solid var(--mn-border-control, #6d817a)',
  background: '#fff',
  color: 'var(--mn-action-primary, #0b624a)',
  font: 'inherit',
  fontWeight: 700,
  cursor: 'pointer',
};
const smallBtn: React.CSSProperties = {
  minHeight: 40,
  padding: '8px 12px',
  borderRadius: 8,
  border: '1px solid var(--mn-border-control, #6d817a)',
  background: '#fff',
  color: 'var(--mn-action-primary, #0b624a)',
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 700,
};
const dangerBtn: React.CSSProperties = {
  ...smallBtn,
  background: '#FEF2F2',
  borderColor: '#FCA5A5',
};
const successBtn: React.CSSProperties = {
  ...smallBtn,
  background: '#ECFDF5',
  borderColor: '#6EE7B7',
};
const table: React.CSSProperties = {
  width: '100%',
  minWidth: 680,
  borderCollapse: 'collapse',
  background: '#fff',
  borderRadius: 8,
  overflow: 'hidden',
};
const badge = (value: string): React.CSSProperties => ({
  padding: '2px 8px',
  borderRadius: 12,
  fontSize: 11,
  fontWeight: 700,
  background:
    value === 'OPEN'
      ? '#FFF7ED'
      : value === 'IN_PROGRESS'
        ? '#EFF6FF'
        : value === 'RESOLVED'
          ? '#ECFDF5'
          : 'var(--mn-surface-sunken, #eef3f0)',
  color: 'var(--mn-text-primary, #132b25)',
});
const errBox: React.CSSProperties = {
  background: '#FEF2F2',
  border: '1px solid #FCA5A5',
  color: '#991B1B',
  padding: 10,
  borderRadius: 6,
  marginBottom: 12,
  fontSize: 13,
};
const successBox: React.CSSProperties = {
  background: '#ECFDF5',
  border: '1px solid #6EE7B7',
  color: '#065F46',
  padding: 10,
  borderRadius: 6,
  marginBottom: 12,
  fontSize: 13,
};
const loadingBox: React.CSSProperties = {
  padding: 20,
  textAlign: 'center',
  color: 'var(--mn-text-secondary, #52655f)',
};
const empty: React.CSSProperties = {
  padding: 16,
  textAlign: 'center',
  color: 'var(--mn-text-secondary, #52655f)',
  background: 'var(--mn-surface-canvas, #f5f8f6)',
  borderRadius: 8,
  border: '1px dashed var(--mn-border-subtle, #dde7e2)',
  fontSize: 13,
};
const pager: React.CSSProperties = {
  marginTop: 12,
  display: 'flex',
  gap: 8,
  alignItems: 'center',
  fontSize: 13,
  color: 'var(--mn-text-secondary, #52655f)',
};
const denied: React.CSSProperties = {
  background: '#FFF7ED',
  border: '1px solid #FDBA74',
  color: '#92400E',
  padding: 12,
  borderRadius: 8,
  fontSize: 13,
};
const drawer: React.CSSProperties = {
  marginTop: 16,
  border: '1px solid var(--mn-border-subtle, #dde7e2)',
  borderRadius: 8,
  background: '#fff',
  overflow: 'hidden',
};
const drawerHead: React.CSSProperties = {
  padding: 12,
  background: 'var(--mn-surface-canvas, #f5f8f6)',
  borderBottom: '1px solid var(--mn-border-subtle, #dde7e2)',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
};
const drawerBody: React.CSSProperties = {
  padding: 16,
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  fontSize: 13,
};
const actionRow: React.CSSProperties = { display: 'flex', gap: 8, flexWrap: 'wrap' };
const mono: React.CSSProperties = { fontFamily: 'monospace', fontSize: 12 };
const input: React.CSSProperties = {
  flex: 1,
  minHeight: 40,
  boxSizing: 'border-box',
  padding: '8px 10px',
  borderRadius: 8,
  border: '1px solid var(--mn-border-control, #6d817a)',
  minWidth: 180,
  maxWidth: '100%',
};
const formRow: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 8,
  marginTop: 8,
  alignItems: 'end',
};
const fieldLabel: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 5,
  flex: 1,
  minWidth: 220,
  color: 'var(--mn-text-secondary, #52655f)',
  fontSize: 12,
};
const helpText: React.CSSProperties = {
  color: 'var(--mn-text-secondary, #52655f)',
  fontSize: 11,
  marginTop: -6,
};
const messageSection: React.CSSProperties = {
  border: '1px solid var(--mn-border-subtle, #dde7e2)',
  borderRadius: 6,
  padding: 12,
  background: '#FCFCFD',
};
const messagesHeader: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  marginBottom: 10,
};
const messageList: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  maxHeight: 360,
  overflowY: 'auto',
};
const messageItem: React.CSSProperties = {
  padding: 10,
  background: '#fff',
  border: '1px solid var(--mn-border-subtle, #dde7e2)',
  borderRadius: 6,
};
const messageMeta: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: 5,
  color: 'var(--mn-text-secondary, #52655f)',
  fontSize: 11,
};
const messageVisibility = (internal: boolean): React.CSSProperties => ({
  marginLeft: 'auto',
  padding: '2px 6px',
  borderRadius: 8,
  background: internal ? 'var(--mn-status-warning-bg, #fff3d9)' : '#ECFDF5',
  color: internal ? '#92400E' : '#065F46',
  fontWeight: 600,
});
const messageBody: React.CSSProperties = {
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
  margin: '8px 0 0',
  color: 'var(--mn-text-primary, #132b25)',
  lineHeight: 1.5,
};
