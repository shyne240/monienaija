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

export function parseCheckerHandoffInput(raw: string): { agentId: string; idempotencyKey?: string } | null {
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
        };
      }
    } catch {
      return null;
    }
    return null;
  }
  return { agentId: trimmed };
}

export function AgentFundingPanel({
  agentId: suppliedAgentId,
  initialIdempotencyKey,
}: {
  agentId?: string;
  initialIdempotencyKey?: string;
}) {
  const { principal } = useAuthStore();
  const [agentId, setAgentId] = useState(suppliedAgentId ?? '');
  const [direction, setDirection] = useState<'FUND' | 'DEFUND'>('FUND');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [rejectionReason, setRejectionReason] = useState('');
  const [handoffInput, setHandoffInput] = useState('');
  const [handoffCopied, setHandoffCopied] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [draft, setDraft] = useState<Instruction | null>(null);
  const [items, setItems] = useState<FundingRequest[]>([]);
  const [selected, setSelected] = useState<FundingRequest | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [message, setMessage] = useState('');
  const trimmedAgentId = agentId.trim();
  const key = `monienaija.agent-funding.v1:${principal?.principalId}:${trimmedAgentId}`;
  const isMaker = principal?.roles.includes('AGENT_NETWORK_MANAGER') === true;
  const isChecker = principal?.roles.includes('FINANCE_CONTROLLER') === true;
  const hasFunction = (value: 'FUND' | 'DEFUND') =>
    principal?.scopes.includes(value === 'FUND' ? 'agent.fund' : 'agent.defund') === true;
  const mfa = principal?.assuranceLevel === 'MFA';

  const pendingAutoLoadRef = useRef<{ agentId: string; idempotencyKey?: string } | null>(null);

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

  async function loadForAgent(targetAgentId: string, instructionKey?: string) {
    if (!targetAgentId) throw new Error('Agent ID is required');
    const query = instructionKey ? `?idempotencyKey=${encodeURIComponent(instructionKey)}` : '';
    const rows = await ApiClient.get<FundingRequest[]>(
      `/internal/agents/${encodeURIComponent(targetAgentId)}/funding-requests${query}`,
    );
    setItems(rows);
    const selectedRow = rows.find((row) => row.id === selected?.id) ?? rows[0] ?? null;
    setSelected(selectedRow);
    setReviewed(false);
    setRejectionReason('');
    setHandoffCopied(false);
    if (!rows.length) setMessage('No visible instruction found. Keep any recovery key until its outcome is resolved.');
  }

  async function guarded(task: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setMessage('');
    try {
      await task();
    } catch (error) {
      setMessage(
        `${error instanceof Error ? error.message : 'Request failed'}. Outcome may be uncertain. Refresh and recover the same instruction; do not submit a replacement.`,
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
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
      const candidate = stored ? (JSON.parse(stored) as Instruction) : null;
      setDraft(candidate?.agentId === trimmedAgentId ? candidate : null);
    } catch {
      setDraft(null);
      setMessage('Recovery storage is unreadable. Resolve previous instructions before creating another.');
    }
    const autoLoad = pendingAutoLoadRef.current;
    if (autoLoad && autoLoad.agentId === trimmedAgentId && mfa) {
      pendingAutoLoadRef.current = null;
      void guarded(() => loadForAgent(trimmedAgentId, autoLoad.idempotencyKey));
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
    setHandoffInput('');
    if (parsed.agentId === trimmedAgentId) {
      void guarded(() => loadForAgent(parsed.agentId, parsed.idempotencyKey));
      return;
    }
    pendingAutoLoadRef.current = parsed;
    setAgentId(parsed.agentId);
  }

  async function initiate() {
    if (!isMaker || !mfa || !hasFunction(direction)) return;
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
    const created = await ApiClient.post<FundingRequest>(
      `/internal/agents/${encodeURIComponent(target)}/${requestedDirection.toLowerCase()}-request`,
      body,
    );
    setSelected(created);
    setItems((old) => [created, ...old.filter((row) => row.id !== created.id)]);
    setMessage(`Instruction ${created.id}: ${created.approvalStatus}. Await an independent checker.`);
  }

  async function decide(action: 'approve' | 'reject') {
    if (
      !selected ||
      !reviewed ||
      !isChecker ||
      !mfa ||
      selected.requesterPrincipalId === principal?.principalId ||
      selected.approvalStatus !== 'REQUESTED'
    ) return;

    let decision: 'APPROVED' | 'REJECTED';
    if (action === 'reject') {
      const rejection = rejectionReason.trim();
      if (!rejection) throw new Error('A rejection reason is required');
      const result = await ApiClient.post<FundingRequest>(
        `/internal/agents/funding-requests/${selected.id}/reject`,
        { reason: rejection },
      );
      if (result.status !== 'REJECTED' || result.approvalStatus !== 'REJECTED') {
        throw new Error('Funding rejection is not confirmed');
      }
      decision = 'REJECTED';
      setRejectionReason('');
    } else {
      const result = await ApiClient.post<{ reason: string }>(
        `/internal/a2/workforce/approvals/${selected.approvalId}/approve`,
        { comment: 'Reviewed Agent, amount, direction and business reason in funding workflow' },
      );
      if (result.reason !== 'APPROVED') {
        throw new Error(result.reason || 'Decision not confirmed');
      }
      decision = 'APPROVED';
    }

    await load(selected.idempotencyKey);
    setMessage(`Decision confirmed: ${decision}`);
  }

  async function execute() {
    if (
      !selected ||
      !isChecker ||
      !mfa ||
      selected.approvalApprovedBy !== principal?.principalId ||
      !reviewed ||
      !hasFunction(selected.direction)
    ) return;
    if (selected.agentId !== trimmedAgentId) throw new Error('Agent does not match the approved instruction');

    // The server executes the immutable, persisted request by ID; the client cannot alter the
    // amount, target, metadata or ledger details at execution time.
    const result = await ApiClient.post<FundingResult>(
      `/internal/agents/funding-requests/${selected.id}/execute`,
      {},
    );
    if (!['COMPLETED', 'REPLAYED'].includes(result.status) || !result.journalId) {
      throw new Error('Posting is not confirmed');
    }
    await load(selected.idempotencyKey);
    setMessage(`${result.status}: journal ${result.journalId}. Posting confirmed.`);
  }

  const selectedTerminal =
    selected && ['REJECTED', 'CANCELLED', 'EXPIRED', 'CONSUMED'].includes(selected.approvalStatus);
  const canDecide =
    isChecker &&
    hasFunction(selected?.direction ?? direction) &&
    selected?.approvalStatus === 'REQUESTED' &&
    selected.requesterPrincipalId !== principal?.principalId;
  const canExecute =
    isChecker &&
    hasFunction(selected?.direction ?? direction) &&
    selected?.approvalStatus === 'APPROVED' &&
    selected.approvalApprovedBy === principal?.principalId;
  const canRecover =
    isChecker &&
    hasFunction(selected?.direction ?? direction) &&
    selected?.approvalStatus === 'CONSUMED' &&
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
    <section aria-label="Agent funding workflow" style={{ border: '1px solid #CBD5E1', padding: 16, marginTop: 16 }}>
      <h3>Agent funding and defunding</h3>
      {!mfa && <p role="alert">Sign in with MFA before initiating, reviewing or executing funding.</p>}
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
          <input aria-label="Funding Agent ID" value={agentId} onChange={(event) => setAgentId(event.target.value)} disabled={busy} />
        </label>
      )}
      <button disabled={busy || !trimmedAgentId || !mfa} onClick={() => void guarded(() => load())}>
        Load funding instructions
      </button>

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
          <button disabled={busy || !mfa || !hasFunction(direction) || !!draft} onClick={() => void guarded(initiate)}>
            Request independent approval
          </button>
          {draft && !selected && (
            <button disabled={busy || !mfa} onClick={() => void guarded(initiate)}>
              Retry original approval request
            </button>
          )}
          {draft && selected && selectedTerminal && (
            <button
              disabled={busy}
              onClick={() => {
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
            <div style={{ margin: '8px 0', padding: 8, background: '#F8FAFC', border: '1px solid #E2E8F0' }}>
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
          <label>
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
      {message && <p role="status">{message}</p>}
    </section>
  );
}
