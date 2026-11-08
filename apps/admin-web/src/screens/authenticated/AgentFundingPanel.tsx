import './agent-funding.css';
import React, { useEffect, useRef, useState } from 'react';
import { ApiClient } from '../../services/api-client';
import { useAuthStore } from '../../store/auth-store';

interface Instruction {
  agentId: string;
  direction: 'FUND' | 'DEFUND';
  amountMinor: string;
  currency: 'NGN';
  idempotencyKey: string;
  reason: string;
  reference?: string;
  correlationId?: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

interface FundingRequest {
  id: string;
  approvalId: string;
  direction: 'FUND' | 'DEFUND';
  agentId: string;
  aggregatorId: string | null;
  amountMinor: string;
  currency: string;
  idempotencyKey: string;
  reference: string;
  requestHash: string;
  approvalFingerprint: string;
  status: 'PENDING' | 'REJECTED' | 'EXECUTED';
  approvalStatus: 'REQUESTED' | 'APPROVED' | 'REJECTED' | 'CANCELLED' | 'CONSUMED' | 'EXPIRED' | string;
  approvalExpiresAt: string;
  approvalApprovedBy: string | null;
  reason: string;
  actionType: string;
  requesterPrincipalId: string;
  checkerPrincipalId: string | null;
  journalId: string | null;
  policy: { requestDetails?: Partial<Instruction> };
}

interface FundingResult {
  status: 'COMPLETED' | 'REPLAYED';
  journalId: string;
  agentId: string;
  amountMinor: string;
  currency: string;
  idempotencyKey: string;
  requestHash: string;
}

function validInstruction(value: unknown, agentId: string): value is Instruction {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const draft = value as Instruction;
  return draft.agentId === agentId && (draft.direction === 'FUND' || draft.direction === 'DEFUND')
    && typeof draft.amountMinor === 'string' && /^[1-9]\d*$/.test(draft.amountMinor) && draft.currency === 'NGN'
    && typeof draft.idempotencyKey === 'string' && !!draft.idempotencyKey.trim()
    && typeof draft.reason === 'string' && !!draft.reason.trim();
}

function validFundingRequest(value: unknown, agentId: string): value is FundingRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as FundingRequest;
  return row.agentId === agentId && typeof row.id === 'string' && !!row.id.trim()
    && typeof row.approvalId === 'string' && !!row.approvalId.trim()
    && (row.direction === 'FUND' || row.direction === 'DEFUND')
    && typeof row.amountMinor === 'string' && /^[1-9]\d*$/.test(row.amountMinor) && row.currency === 'NGN'
    && typeof row.idempotencyKey === 'string' && !!row.idempotencyKey.trim()
    && typeof row.requestHash === 'string' && !!row.requestHash.trim()
    && ['PENDING', 'REJECTED', 'EXECUTED'].includes(row.status)
    && typeof row.approvalStatus === 'string' && !!row.approvalStatus.trim()
    && typeof row.reason === 'string' && !!row.reason.trim()
    && typeof row.requesterPrincipalId === 'string' && !!row.requesterPrincipalId.trim();
}

interface CheckerHandoffToken {
  agentId: string;
  requestId?: string;
  approvalId?: string;
  idempotencyKey?: string;
  direction?: 'FUND' | 'DEFUND';
  amountMinor?: string;
  currency?: string;
}

export interface SelectedFundingInboxTarget {
  agentId: string;
  idempotencyKey?: string;
  requestId?: string;
  revision: number;
}

export interface AgentFundingCheckerOutcome {
  action: 'APPROVED' | 'REJECTED' | 'EXECUTED';
  requestId: string;
  agentId: string;
}

export function parseCheckerHandoffInput(raw: string): {
  agentId: string;
  idempotencyKey?: string;
  requestId?: string;
} | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as Partial<CheckerHandoffToken>;
      if (typeof parsed.agentId === 'string' && parsed.agentId.trim()) {
        return {
          agentId: parsed.agentId.trim(),
          idempotencyKey:
            typeof parsed.idempotencyKey === 'string' && parsed.idempotencyKey.trim()
              ? parsed.idempotencyKey.trim()
              : undefined,
          requestId:
            typeof parsed.requestId === 'string' && parsed.requestId.trim()
              ? parsed.requestId.trim()
              : undefined,
        };
      }
    } catch {
      return null;
    }
    return null;
  }
  if (trimmed.toUpperCase().startsWith('MN-FUND:')) {
    const rest = trimmed.slice('MN-FUND:'.length);
    const sep = rest.indexOf(':');
    if (sep > 0) {
      const parsedAgentId = rest.slice(0, sep).trim();
      const parsedIdem = rest.slice(sep + 1).trim();
      if (parsedAgentId) {
        return {
          agentId: parsedAgentId,
          idempotencyKey: parsedIdem || undefined,
        };
      }
    }
    return null;
  }
  return { agentId: trimmed };
}

interface AgentFundingPanelProps {
  agentId?: string;
  initialIdempotencyKey?: string;
  selectedInboxTarget?: SelectedFundingInboxTarget | null;
  onCheckerOutcome?: (outcome: AgentFundingCheckerOutcome) => void;
  onFundingGuardChange?: (guarded: boolean, busy: boolean, reviewRequired: boolean) => void;
  externalMutationBlocked?: boolean;
}

export function AgentFundingPanel(props: AgentFundingPanelProps) {
  const { principal, sessionId } = useAuthStore();
  const key = JSON.stringify([sessionId, principal?.principalId, principal?.sessionId, principal?.type, principal?.assuranceLevel, principal?.roles, principal?.scopes, principal?.readOnlyPrincipal, props.agentId, props.initialIdempotencyKey, props.selectedInboxTarget?.revision]);
  return <AgentFundingWorkspace key={key} {...props} />;
}

function AgentFundingWorkspace({ agentId: suppliedAgentId, initialIdempotencyKey, selectedInboxTarget = null, onCheckerOutcome, onFundingGuardChange, externalMutationBlocked = false }: AgentFundingPanelProps) {
  const { principal } = useAuthStore();
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [agentId, setAgentId] = useState(suppliedAgentId ?? '');
  const [direction, setDirection] = useState<'FUND' | 'DEFUND'>('FUND');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [rejectionReason, setRejectionReason] = useState('');
  const [handoffInput, setHandoffInput] = useState('');
  const [handoffCopied, setHandoffCopied] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [draft, setDraft] = useState<Instruction | null>(null);
  const [storageError, setStorageError] = useState(false);
  const [items, setItems] = useState<FundingRequest[]>([]);
  const [selected, setSelected] = useState<FundingRequest | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [reviewLock, setReviewLock] = useState<{ agentId: string; idempotencyKey: string; requestId?: string; requestHash?: string; direction: 'FUND' | 'DEFUND'; amountMinor: string; reason: string; action: string } | null>(null);
  const reviewLockRef = useRef(reviewLock); reviewLockRef.current = reviewLock;
  const [reviewReady, setReviewReady] = useState(false);
  const attemptedWrite = useRef<typeof reviewLock>(null);
  const fundingGuard = Boolean(amount.trim() || reason.trim() || rejectionReason.trim() || handoffInput.trim() || reviewed || draft || reviewLock || busy);
  useEffect(() => { onFundingGuardChange?.(fundingGuard, busy, Boolean(reviewLock)); }, [onFundingGuardChange, fundingGuard, busy, reviewLock]);
  useEffect(() => () => onFundingGuardChange?.(false, false, false), [onFundingGuardChange]);
  useEffect(() => {
    if (!fundingGuard) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [fundingGuard]);

  const [message, setMessage] = useState('');
  const trimmedAgentId = agentId.trim();
  const key = `monienaija.agent-funding.v1:${principal?.principalId}:${trimmedAgentId}`;
  const isMaker = principal?.roles.includes('AGENT_NETWORK_MANAGER') === true;
  const isChecker = principal?.roles.includes('FINANCE_CONTROLLER') === true;
  const hasFunction = (value: 'FUND' | 'DEFUND') =>
    principal?.scopes.includes(value === 'FUND' ? 'agent.fund' : 'agent.defund') === true;
  const mfa = principal?.assuranceLevel === 'MFA';
  const canWrite = !principal?.readOnlyPrincipal;

  const pendingAutoLoadRef = useRef<{
    agentId: string;
    idempotencyKey?: string;
    requestId?: string;
  } | null>(null);

  useEffect(() => {
    if (suppliedAgentId !== undefined) {
      if (initialIdempotencyKey && suppliedAgentId.trim()) {
        pendingAutoLoadRef.current = {
          agentId: suppliedAgentId.trim(),
          idempotencyKey: initialIdempotencyKey,
        };
      }
      setAgentId(suppliedAgentId);
    }
  }, [suppliedAgentId, initialIdempotencyKey]);

  useEffect(() => {
    if (!selectedInboxTarget?.agentId) return;
    const targetAgent = selectedInboxTarget.agentId.trim();
    if (!targetAgent) return;
    if (targetAgent === trimmedAgentId) {
      if (mfa) {
        void guarded(() =>
          loadForAgent(
            targetAgent,
            selectedInboxTarget.idempotencyKey,
            selectedInboxTarget.requestId,
          ),
        );
      }
      return;
    }
    pendingAutoLoadRef.current = {
      agentId: targetAgent,
      idempotencyKey: selectedInboxTarget.idempotencyKey,
      requestId: selectedInboxTarget.requestId,
    };
    setAgentId(targetAgent);
  }, [selectedInboxTarget?.revision]);

  async function loadForAgent(
    targetAgentId: string,
    instructionKey?: string,
    preferredRequestId?: string,
  ) {
    if (!targetAgentId) throw new Error('Agent ID is required');
    const query = instructionKey ? `?idempotencyKey=${encodeURIComponent(instructionKey)}` : '';
    setItems([]);
    setSelected(null);
    setReviewed(false);
    const rows = await ApiClient.get<FundingRequest[]>(
      `/internal/agents/${encodeURIComponent(targetAgentId)}/funding-requests${query}`,
    );
    if (!mounted.current) return;
    if (!Array.isArray(rows) || rows.some(row => !validFundingRequest(row, targetAgentId) || (instructionKey && row.idempotencyKey !== instructionKey))) throw new Error('Invalid funding instruction response');
    setItems(rows);
    const lock = reviewLockRef.current;
    if (lock && lock.agentId === targetAgentId) setReviewReady(rows.some(row => row.idempotencyKey === lock.idempotencyKey && (!lock.requestId || row.id === lock.requestId) && (!lock.requestHash || row.requestHash === lock.requestHash) && row.direction === lock.direction && row.amountMinor === lock.amountMinor && row.reason === lock.reason));
    const selectedRow = preferredRequestId
      ? rows.find((row) => row.id === preferredRequestId) ?? null
      : rows.find((row) => row.id === selected?.id) ?? rows[0] ?? null;
    setSelected(selectedRow);
    setReviewed(false);
    setRejectionReason('');
    setHandoffCopied(false);
    if (preferredRequestId && !selectedRow) setMessage('The selected instruction was not returned. Refresh the inbox before reviewing another request.');
    else if (!rows.length) setMessage('No visible instruction found. Keep any recovery key until its outcome is resolved.');
  }

  async function guarded(task: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true;
    attemptedWrite.current = null;
    setBusy(true);
    setMessage('');
    try {
      await task();
    } catch (error) {
      if (!mounted.current) return;
      setItems([]); setSelected(null); setReviewed(false);
      if (attemptedWrite.current) { setReviewLock(attemptedWrite.current); setReviewReady(false); }
      setMessage(attemptedWrite.current
        ? `${error instanceof Error ? error.message : 'Request failed'}. Outcome may be uncertain. Refresh and recover the same instruction; do not submit a replacement.`
        : `${error instanceof Error ? error.message : 'Request failed'}. No funding write was attempted by this action.`);

    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  useEffect(() => {
    setItems([]);
    setSelected(null);
    setReviewed(false);
    setHandoffCopied(false);
    setMessage('');
    try {
      const stored = localStorage.getItem(key);
      const candidate: unknown = stored ? JSON.parse(stored) : null;
      if (candidate !== null && !validInstruction(candidate, trimmedAgentId)) throw new Error('Invalid retained instruction');
      setStorageError(false);
      setDraft(candidate as Instruction | null);
      if (candidate) {
        const retained = candidate as Instruction;
        setDirection(retained.direction); setAmount(retained.amountMinor); setReason(retained.reason);
      } else { setAmount(''); setReason(''); }
    } catch {
      setDraft(null);
      setStorageError(true);
      setMessage('');
    }
    const autoLoad = pendingAutoLoadRef.current;
    if (autoLoad && autoLoad.agentId === trimmedAgentId && mfa) {
      pendingAutoLoadRef.current = null;
      void guarded(() =>
        loadForAgent(trimmedAgentId, autoLoad.idempotencyKey, autoLoad.requestId),
      );
    }
  }, [key, trimmedAgentId]);

  if ((!isMaker && !isChecker) || (!hasFunction('FUND') && !hasFunction('DEFUND'))) return null;

  async function load(instructionKey?: string) {
    return loadForAgent(trimmedAgentId, instructionKey);
  }

  function applyCheckerHandoff() {
    const parsed = parseCheckerHandoffInput(handoffInput);
    if (!parsed) {
      setMessage('Enter a valid Maker handoff JSON package or Agent ID.');
      return;
    }
    if (parsed.agentId !== trimmedAgentId && (amount.trim() || reason.trim() || rejectionReason.trim() || reviewed || draft || reviewLock) && !window.confirm('Change Agent and replace the current funding entries? Any earlier action may have occurred; inspect funding, approval, ledger and audit records.')) return;
    setHandoffInput('');
    if (parsed.agentId === trimmedAgentId) {
      void guarded(() =>
        loadForAgent(parsed.agentId, parsed.idempotencyKey, parsed.requestId),
      );
      return;
    }
    pendingAutoLoadRef.current = parsed;
    setAgentId(parsed.agentId);
  }

  async function initiate() {
    if (!canWrite || !isMaker || !mfa || !hasFunction(direction) || storageError || reviewLock || externalMutationBlocked) return;
    if (!trimmedAgentId || !/^[1-9]\d*$/.test(amount.trim()) || !reason.trim()) {
      throw new Error('Agent ID, positive integer kobo amount and reason are required');
    }
    const instruction = draft ?? {
      agentId: trimmedAgentId,
      direction,
      amountMinor: amount.trim(),
      currency: 'NGN' as const,
      idempotencyKey: crypto.randomUUID(),
      reason: reason.trim(),
    };
    if (instruction.agentId !== trimmedAgentId || instruction.direction !== direction) {
      throw new Error('Retained instruction does not match the selected Agent and direction');
    }
    // Persist before sending; storage failure must stop the request rather than lose recovery data.
    localStorage.setItem(key, JSON.stringify(instruction));
    setDraft(instruction);
    const { direction: requestedDirection, agentId: target, ...body } = instruction;
    attemptedWrite.current = {agentId: target, idempotencyKey: instruction.idempotencyKey, direction: instruction.direction, amountMinor: instruction.amountMinor, reason: instruction.reason, action: 'request'};
    const created = await ApiClient.post<FundingRequest>(
      `/internal/agents/${encodeURIComponent(target)}/${requestedDirection.toLowerCase()}-request`,
      body,
    );
    if (!mounted.current) return;
    if (!validFundingRequest(created, target) || created.direction !== requestedDirection || created.idempotencyKey !== instruction.idempotencyKey || created.amountMinor !== instruction.amountMinor || created.currency !== instruction.currency || created.reason !== instruction.reason || created.requesterPrincipalId !== principal?.principalId) throw new Error('Funding request receipt is not confirmed');
    setSelected(created);
    setItems((old) => [created, ...old.filter((row) => row.id !== created.id)]);
    setMessage(`Instruction ${created.id}: ${created.approvalStatus}. ${created.approvalStatus === 'REQUESTED' ? 'Await an independent checker.' : 'Review the current instruction state before any further action.'}`);
  }

  async function decide(action: 'approve' | 'reject') {
    if (
      !selected ||
      reviewLock || externalMutationBlocked ||
      !canWrite ||
      !reviewed ||
      !isChecker ||
      !mfa ||
      !hasFunction(selected.direction) ||
      selected.agentId !== trimmedAgentId ||
      selected.requesterPrincipalId === principal?.principalId ||
      selected.approvalStatus !== 'REQUESTED' || selected.status !== 'PENDING'
    ) return;

    let decision: 'APPROVED' | 'REJECTED';
    if (action === 'reject') {
      const rejection = rejectionReason.trim();
      if (!rejection) throw new Error('A rejection reason is required');
      attemptedWrite.current = {agentId: selected.agentId, idempotencyKey: selected.idempotencyKey, requestId: selected.id, requestHash: selected.requestHash, direction: selected.direction, amountMinor: selected.amountMinor, reason: selected.reason, action: 'rejection'};
      const result = await ApiClient.post<FundingRequest>(
        `/internal/agents/funding-requests/${selected.id}/reject`,
        { reason: rejection },
      );
      if (!mounted.current) return;
      if (!validFundingRequest(result, selected.agentId) || result.id !== selected.id || result.approvalId !== selected.approvalId || result.idempotencyKey !== selected.idempotencyKey || result.requestHash !== selected.requestHash || result.status !== 'REJECTED' || result.approvalStatus !== 'REJECTED') {
        throw new Error('Funding rejection is not confirmed');
      }
      decision = 'REJECTED';
      setRejectionReason('');
    } else {
      attemptedWrite.current = {agentId: selected.agentId, idempotencyKey: selected.idempotencyKey, requestId: selected.id, requestHash: selected.requestHash, direction: selected.direction, amountMinor: selected.amountMinor, reason: selected.reason, action: 'approval'};
      const result = await ApiClient.post<{ approved: boolean; reason: string; approval?: {id: string; status: string} }>(
        `/internal/a2/workforce/approvals/${selected.approvalId}/approve`,
        { comment: 'Reviewed Agent, amount, direction and business reason in funding workflow' },
      );
      if (!mounted.current) return;
      if (!result || result.approved !== true || result.reason !== 'APPROVED' || result.approval?.id !== selected.approvalId || result.approval?.status !== 'APPROVED') {
        throw new Error(result?.reason && result.reason !== 'APPROVED' ? result.reason : 'Decision not confirmed');
      }
      decision = 'APPROVED';
    }

    let refreshFailed = false;
    try { await load(selected.idempotencyKey); } catch { refreshFailed = true; }
    if (!mounted.current) return;
    setMessage(`Decision confirmed: ${decision}${refreshFailed ? '. Refresh failed; reload the instruction before another action' : ''}`);
    onCheckerOutcome?.({
      action: decision,
      requestId: selected.id,
      agentId: selected.agentId,
    });
  }

  async function execute() {
    if (
      !selected ||
      reviewLock || externalMutationBlocked ||
      !canWrite ||
      !isChecker ||
      !mfa ||
      selected.approvalApprovedBy !== principal?.principalId ||
      !((selected.approvalStatus === 'APPROVED' && selected.status === 'PENDING') || (selected.approvalStatus === 'CONSUMED' && selected.status === 'EXECUTED' && selected.checkerPrincipalId === principal?.principalId)) ||
      !reviewed ||
      !hasFunction(selected.direction)
    ) return;
    if (selected.agentId !== trimmedAgentId) throw new Error('Agent does not match the approved instruction');

    // The server executes the immutable, persisted request by ID; the client cannot alter the
    // amount, target, metadata or ledger details at execution time.
    attemptedWrite.current = {agentId: selected.agentId, idempotencyKey: selected.idempotencyKey, requestId: selected.id, requestHash: selected.requestHash, direction: selected.direction, amountMinor: selected.amountMinor, reason: selected.reason, action: 'posting'};
    const result = await ApiClient.post<FundingResult>(
      `/internal/agents/funding-requests/${selected.id}/execute`,
      {},
    );
    if (!mounted.current) return;
    if (!result || !['COMPLETED', 'REPLAYED'].includes(result.status) || typeof result.journalId !== 'string' || !result.journalId.trim() || result.agentId !== selected.agentId || result.amountMinor !== selected.amountMinor || result.currency !== selected.currency || result.idempotencyKey !== selected.idempotencyKey || result.requestHash !== selected.requestHash) {
      throw new Error('Posting is not confirmed');
    }
    let refreshFailed = false;
    try { await load(selected.idempotencyKey); } catch { refreshFailed = true; }
    if (!mounted.current) return;
    setMessage(`${result.status}: journal ${result.journalId}. Posting confirmed.${refreshFailed ? ' Refresh failed; reload the instruction before another action.' : ''}`);
    onCheckerOutcome?.({
      action: 'EXECUTED',
      requestId: selected.id,
      agentId: selected.agentId,
    });
  }

  const selectedTerminal = selected && (
    ['CANCELLED', 'EXPIRED'].includes(selected.approvalStatus) ||
    (selected.status === 'REJECTED' && selected.approvalStatus === 'REJECTED') ||
    (selected.status === 'EXECUTED' && selected.approvalStatus === 'CONSUMED')
  );
  const canDecide =
    canWrite && !reviewLock && !externalMutationBlocked && isChecker &&
    hasFunction(selected?.direction ?? direction) &&
    selected?.approvalStatus === 'REQUESTED' && selected.status === 'PENDING' &&
    selected.requesterPrincipalId !== principal?.principalId;
  const canExecute =
    canWrite && !reviewLock && !externalMutationBlocked && isChecker &&
    hasFunction(selected?.direction ?? direction) &&
    selected?.approvalStatus === 'APPROVED' && selected.status === 'PENDING' &&
    selected.approvalApprovedBy === principal?.principalId;
  const canRecover =
    canWrite && !reviewLock && !externalMutationBlocked && isChecker &&
    hasFunction(selected?.direction ?? direction) &&
    selected?.approvalStatus === 'CONSUMED' && selected.status === 'EXECUTED' &&
    selected.checkerPrincipalId === principal?.principalId;

  const visibleItems = items.filter((row) =>
    statusFilter === 'ALL' ? true : row.approvalStatus === statusFilter,
  );
  const handoffToken = selected
    ? JSON.stringify({
        agentId: selected.agentId,
        requestId: selected.id,
        approvalId: selected.approvalId,
        idempotencyKey: selected.idempotencyKey,
        direction: selected.direction,
        amountMinor: selected.amountMinor,
        currency: selected.currency,
      })
    : null;

  return (
    <section className="mn-funding" aria-label="Agent funding workflow">
      <h3>Agent funding and defunding</h3>
      {!mfa && <p role="alert">Sign in with MFA before initiating, reviewing or executing funding.</p>}
      {storageError && <p role="alert">Recovery storage is unreadable. Resolve previous instructions before creating another.</p>}
      {isChecker && !suppliedAgentId && (
        <div style={{ marginBottom: 10 }}>
          <label>
            Maker handoff token or Agent ID
            <input
              aria-label="Checker handoff token"
              placeholder='Paste {"agentId":...,"idempotencyKey":...} or Agent UUID'
              value={handoffInput}
              onChange={(event) => setHandoffInput(event.target.value)}
              disabled={busy}
            />
          </label>
          <button
            type="button"
            disabled={busy || !handoffInput.trim() || !mfa}
            onClick={applyCheckerHandoff}
          >
            Apply handoff &amp; load
          </button>
        </div>
      )}
      {!suppliedAgentId && (
        <label>
          Agent ID
          <input aria-label="Funding Agent ID" value={agentId} onChange={(event) => { if ((amount.trim() || reason.trim() || rejectionReason.trim() || reviewLock) && !window.confirm('Change Agent? Unsaved fields will be replaced. Any earlier funding action may have occurred; retain its key and review funding, approval, ledger and audit records.')) return; setAgentId(event.target.value); }} disabled={busy} />
        </label>
      )}
      <button disabled={busy || !trimmedAgentId || !mfa} onClick={() => void guarded(() => load())}>
        Load funding instructions
      </button>

      {reviewLock && <div role="alert" data-testid="funding-review-lock"><strong>Funding {reviewLock.action} outcome requires independent review.</strong> Agent <code>{reviewLock.agentId}</code>, instruction key <code>{reviewLock.idempotencyKey}</code>{reviewLock.requestId && <> · request <code>{reviewLock.requestId}</code></>}. Review the matching instruction, approval, ledger and audit records before further writes. A fresh read or missing record cannot exclude a late commit. This local lock is lost on exit or session change; the retained maker key remains in browser storage.
        <button type="button" disabled={busy} onClick={() => void guarded(() => loadForAgent(reviewLock.agentId, reviewLock.idempotencyKey, reviewLock.requestId))}>Refresh affected funding instruction</button>
        <button type="button" disabled={busy || !reviewReady} onClick={() => { if (window.confirm('Have you independently reviewed the matching funding instruction, approval, ledger and audit records, including the possibility of a late commit?')) { setReviewLock(null); setReviewReady(false); setReviewed(false); } }}>Acknowledge independent funding review</button>
        <button type="button" disabled={busy} onClick={() => { if (window.confirm('If the matching instruction cannot be read here, have you independently reviewed funding, approval, ledger and audit records through an authorized source, including a possible late commit?')) { setReviewLock(null); setReviewReady(false); setReviewed(false); } }}>Acknowledge authorized external funding review</button>
      </div>}
      {draft && (
        <div>
          <p>Retained instruction key: {draft.idempotencyKey}</p>
          <button disabled={busy || !mfa} onClick={() => void guarded(() => load(draft.idempotencyKey))}>
            Recover retained instruction
          </button>
        </div>
      )}

      {isMaker && (
        <div>
          <label>
            Direction
            <select value={direction} onChange={(event) => setDirection(event.target.value as 'FUND' | 'DEFUND')} disabled={busy || !!draft}>
              <option value="FUND">FUND</option>
              <option value="DEFUND">DEFUND</option>
            </select>
          </label>
          <label>
            Amount (kobo)
            <input aria-label="Funding amount in kobo" value={amount} onChange={(event) => setAmount(event.target.value)} disabled={busy || !!draft} inputMode="numeric" />
          </label>
          <label>
            Reason
            <input aria-label="Funding reason" value={reason} onChange={(event) => setReason(event.target.value)} disabled={busy || !!draft} maxLength={500} />
          </label>
          <button className="mn-funding__primary" disabled={busy || Boolean(reviewLock) || externalMutationBlocked || !canWrite || !mfa || !hasFunction(direction) || !!draft || storageError} onClick={() => void guarded(initiate)}>
            Request independent approval
          </button>
          {draft && !selected && (
            <button disabled={busy || Boolean(reviewLock) || externalMutationBlocked || !canWrite || !mfa || !hasFunction(draft.direction)} onClick={() => void guarded(initiate)}>
              Retry original approval request
            </button>
          )}
          {draft && selected && selectedTerminal && (
            <button
              disabled={busy || Boolean(reviewLock)}
              onClick={() => {
                if (!window.confirm('Clear this retained instruction key and start another? Verify its final funding and audit state first.')) return;
                localStorage.removeItem(key);
                setDraft(null);
                setSelected(null);
                setAmount('');
                setReason('');
              }}
            >
              Start another instruction
            </button>
          )}
        </div>
      )}

      {items.length > 0 && (
        <label>
          Filter approval state
          <select
            aria-label="Filter funding approval status"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            disabled={busy}
          >
            <option value="ALL">All instructions</option>
            <option value="REQUESTED">REQUESTED</option>
            <option value="APPROVED">APPROVED</option>
            <option value="CONSUMED">CONSUMED</option>
            <option value="REJECTED">REJECTED</option>
            <option value="EXPIRED">EXPIRED</option>
          </select>
        </label>
      )}

      <ul>
        {visibleItems.map((row) => (
          <li key={row.id}>
            <button disabled={busy} onClick={() => { setSelected(row); setReviewed(false); setRejectionReason(''); setHandoffCopied(false); }}>
              {row.id} — {row.direction} — {row.status} / {row.approvalStatus}
            </button>
          </li>
        ))}
      </ul>

      {selected && (
        <div>
          <p>Status: {selected.status} / {selected.approvalStatus}; expires: {new Date(selected.approvalExpiresAt).toLocaleString()}</p>
          <p>
            {selected.direction} {selected.amountMinor} minor units {selected.currency} for Agent {selected.agentId}.
            Maker: {selected.requesterPrincipalId}
          </p>
          <p>Business reason: {selected.reason}</p>
          {handoffToken && ['REQUESTED', 'APPROVED'].includes(selected.approvalStatus) && (
            <div style={{ margin: '8px 0', padding: 8, background: 'var(--mn-surface-canvas, #f5f8f6)', border: '1px solid var(--mn-border-subtle, #dde7e2)' }}>
              <strong>Checker handoff package:</strong>{' '}
              <code data-testid="funding-checker-handoff-token">{handoffToken}</code>{' '}
              {typeof navigator !== 'undefined' && navigator.clipboard && (
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard.writeText(handoffToken).then(() => setHandoffCopied(true)).catch(() => setHandoffCopied(false));
                  }}
                >
                  {handoffCopied ? 'Copied handoff' : 'Copy checker handoff'}
                </button>
              )}
            </div>
          )}
          {selected.approvalStatus === 'EXPIRED' && (
            <p role="note">Approval window expired — this instruction cannot be approved or executed.</p>
          )}
          {isChecker && selected.approvalStatus === 'REQUESTED' && selected.requesterPrincipalId === principal?.principalId && (
            <p role="note">Self-approval blocked: an independent FINANCE_CONTROLLER checker must review this instruction.</p>
          )}
          <label className="mn-funding__review">
            <input type="checkbox" checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} disabled={busy} />
            I reviewed this Agent, amount, direction and business reason
          </label>
          {canDecide && (
            <>
              <button disabled={busy || !mfa || !reviewed} onClick={() => void guarded(() => decide('approve'))}>
                Approve funding instruction
              </button>
              <label>
                Rejection reason
                <input
                  aria-label="Funding rejection reason"
                  value={rejectionReason}
                  onChange={(event) => setRejectionReason(event.target.value)}
                  disabled={busy}
                  maxLength={500}
                />
              </label>
              <button
                disabled={busy || !mfa || !reviewed || !rejectionReason.trim()}
                onClick={() => void guarded(() => decide('reject'))}
              >
                Reject funding instruction
              </button>
            </>
          )}
          {canExecute && (
            <button disabled={busy || !mfa || !reviewed} onClick={() => void guarded(execute)}>
              Execute approved instruction
            </button>
          )}
          {canRecover && (
            <button disabled={busy || !mfa || !reviewed} onClick={() => void guarded(execute)}>
              Recover posted result
            </button>
          )}
          {selected.journalId && <p>Journal reference: {selected.journalId}</p>}
        </div>
      )}
      {!canWrite && <p role="note">This session is read-only; funding requests and decisions are unavailable.</p>}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
