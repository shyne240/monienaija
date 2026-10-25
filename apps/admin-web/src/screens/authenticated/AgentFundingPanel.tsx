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
interface FundingApproval {
  id: string;
  actionType: string;
  resourceId: string;
  requesterPrincipalId: string;
  approvedBy: string | null;
  status: string;
  expiresAt: string;
  policy: { requestDetails?: Partial<Instruction> };
}
function postingBody(a: FundingApproval): Omit<Instruction, 'direction' | 'reason'> & { approvalId: string } {
  const d = a.policy.requestDetails;
  if (!d || !d.agentId || !d.amountMinor || !d.idempotencyKey || d.currency !== 'NGN')
    throw new Error('The approved instruction is incomplete. Do not execute.');
  return { agentId: d.agentId, approvalId: a.id, amountMinor: d.amountMinor,
    currency: 'NGN', idempotencyKey: d.idempotencyKey,
    reference: d.reference ?? undefined, correlationId: d.correlationId ?? undefined,
    description: d.description ?? undefined, metadata: d.metadata ?? {} };
}

export function AgentFundingPanel({ agentId: suppliedAgentId }: { agentId?: string }) {
  const { principal } = useAuthStore();
  const [agentId, setAgentId] = useState(suppliedAgentId ?? '');
  const [direction, setDirection] = useState<'FUND' | 'DEFUND'>('FUND');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [draft, setDraft] = useState<Instruction | null>(null);
  const [items, setItems] = useState<FundingApproval[]>([]);
  const [selected, setSelected] = useState<FundingApproval | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [message, setMessage] = useState('');
  const key = `monienaija.agent-funding.v1:${principal?.principalId}:${agentId}`;
  const isMaker = principal?.roles.includes('AGENT_NETWORK_MANAGER') === true;
  const isChecker = principal?.roles.includes('FINANCE_CONTROLLER') === true;
  const hasFunction = (d: 'FUND' | 'DEFUND') => principal?.scopes.includes(d === 'FUND' ? 'agent.fund' : 'agent.defund') === true;
  const mfa = principal?.assuranceLevel === 'MFA';

  useEffect(() => {
    setItems([]); setSelected(null); setReviewed(false); setMessage('');
    try {
      const stored = localStorage.getItem(key);
      const candidate = stored ? JSON.parse(stored) as Instruction : null;
      setDraft(candidate?.agentId === agentId ? candidate : null);
    } catch { setDraft(null); setMessage('Recovery storage is unreadable. Resolve previous instructions before creating another.'); }
  }, [key, agentId]);

  if ((!isMaker && !isChecker) || (!hasFunction('FUND') && !hasFunction('DEFUND'))) return null;

  async function guarded(task: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setMessage('');
    try { await task(); } catch (error) {
      setMessage(`${error instanceof Error ? error.message : 'Request failed'}. Outcome may be uncertain. Refresh and recover the same instruction; do not submit a replacement.`);
    } finally { inFlight.current = false; setBusy(false); }
  }
  async function load(instructionKey?: string) {
    const query = instructionKey ? `?idempotencyKey=${encodeURIComponent(instructionKey)}` : '';
    const rows = await ApiClient.get<FundingApproval[]>(`/internal/agents/${agentId}/funding-requests${query}`);
    setItems(rows);
    setSelected(old => rows.find(row => row.id === old?.id) ?? (instructionKey ? rows[0] ?? null : null));
    setReviewed(false);
    if (!rows.length) setMessage('No visible instruction found. Keep any recovery key until its outcome is resolved.');
  }
  async function initiate() {
    if (!isMaker || !mfa || !hasFunction(direction)) return;
    if (!agentId || !/^[1-9]\d*$/.test(amount) || !reason.trim()) throw new Error('Agent ID, positive integer kobo amount and reason are required');
    const instruction = draft ?? { agentId, direction, amountMinor: amount, currency: 'NGN' as const,
      idempotencyKey: crypto.randomUUID(), reason: reason.trim() };
    // Persist first. A storage failure must prevent submission, not lose its recovery key.
    localStorage.setItem(key, JSON.stringify(instruction)); setDraft(instruction);
    const { direction: d, agentId: target, ...body } = instruction;
    const approval = await ApiClient.post<FundingApproval>(`/internal/agents/${target}/${d.toLowerCase()}-request`, body);
    setSelected(approval); setItems([approval]); setMessage(`Instruction ${approval.id}: ${approval.status}. Await an independent checker.`);
  }
  async function decide(action: 'approve' | 'reject') {
    if (!selected || !reviewed || !isChecker || !mfa || selected.requesterPrincipalId === principal?.principalId) return;
    const result = await ApiClient.post<{ reason: string }>(`/internal/a2/workforce/approvals/${selected.id}/${action}`, { comment: 'Reviewed Agent, amount and direction in funding workflow' });
    if (result.reason !== (action === 'approve' ? 'APPROVED' : 'REJECTED')) throw new Error(result.reason || 'Decision not confirmed');
    await load(); setMessage(`Decision confirmed: ${result.reason}`);
  }
  async function execute() {
    if (!selected || !isChecker || !mfa || selected.approvedBy !== principal?.principalId || !reviewed) return;
    const instruction = postingBody(selected);
    if (instruction.agentId !== agentId) throw new Error('Agent does not match the approved instruction');
    const d = selected.actionType === 'AGENT_FUND' ? 'FUND' : 'DEFUND';
    // Retain the exact instruction before sending any financial operation.
    localStorage.setItem(key, JSON.stringify({ ...instruction, direction: d, reason: '' }));
    const { agentId: target, ...body } = instruction;
    const result = await ApiClient.post<{ status: string; journalId: string }>(`/internal/agents/${target}/${d.toLowerCase()}`, body);
    if (!['COMPLETED', 'REPLAYED'].includes(result.status) || !result.journalId) throw new Error('Posting is not confirmed');
    await load(); setMessage(`${result.status}: journal ${result.journalId}. Posting confirmed.`);
  }
  const selectedDirection = selected?.actionType === 'AGENT_DEFUND' ? 'DEFUND' : 'FUND';
  return <section aria-label="Agent funding workflow" style={{ border: '1px solid #CBD5E1', padding: 16, marginTop: 16 }}>
    <h3>Agent funding and defunding</h3>
    {!mfa && <p role="alert">Sign in with MFA before initiating, reviewing or executing funding.</p>}
    {!suppliedAgentId && <label>Agent ID<input aria-label="Funding Agent ID" value={agentId} onChange={e => setAgentId(e.target.value)} disabled={busy} /></label>}
    <button disabled={busy || !agentId || !mfa} onClick={() => void guarded(() => load())}>Load funding instructions</button>
    {draft && <div><p>Retained instruction key: {draft.idempotencyKey}</p><button disabled={busy || !mfa} onClick={() => void guarded(() => load(draft.idempotencyKey))}>Recover retained instruction</button></div>}
    {isMaker && <div>
      <label>Direction<select aria-label="Funding direction" value={direction} onChange={e => setDirection(e.target.value as 'FUND' | 'DEFUND')} disabled={busy || !!draft}><option>FUND</option><option>DEFUND</option></select></label>
      <label>Amount (kobo)<input aria-label="Funding amount in kobo" value={amount} onChange={e => setAmount(e.target.value)} disabled={busy || !!draft} inputMode="numeric" /></label>
      <label>Reason<input aria-label="Funding reason" value={reason} onChange={e => setReason(e.target.value)} disabled={busy || !!draft} maxLength={500} /></label>
      <button disabled={busy || !mfa || !hasFunction(direction) || !!draft} onClick={() => void guarded(initiate)}>Request independent approval</button>
      {draft && !selected && <button disabled={busy || !mfa} onClick={() => void guarded(initiate)}>Retry original approval request</button>}
      {draft && selected && ['CONSUMED', 'REJECTED', 'EXPIRED', 'CANCELLED'].includes(selected.status) && <button disabled={busy} onClick={() => { localStorage.removeItem(key); setDraft(null); setSelected(null); setAmount(''); setReason(''); }}>Start another instruction</button>}
    </div>}
    <ul>{items.map(row => <li key={row.id}><button disabled={busy} onClick={() => { setSelected(row); setReviewed(false); }}>{row.id} — {row.actionType} — {row.status}</button></li>)}</ul>
    {selected && <div>
      <p>Status: {selected.status}; expires: {selected.expiresAt}</p>
      <p>{selectedDirection} {selected.policy.requestDetails?.amountMinor} kobo NGN for Agent {selected.resourceId}. Maker: {selected.requesterPrincipalId}</p>
      <label><input type="checkbox" checked={reviewed} onChange={e => setReviewed(e.target.checked)} disabled={busy} />I reviewed this Agent, amount and direction</label>
      {isChecker && hasFunction(selectedDirection) && selected.status === 'REQUESTED' && selected.requesterPrincipalId !== principal?.principalId && <>
        <button disabled={busy || !mfa || !reviewed} onClick={() => void guarded(() => decide('approve'))}>Approve funding instruction</button>
        <button disabled={busy || !mfa || !reviewed} onClick={() => void guarded(() => decide('reject'))}>Reject funding instruction</button>
      </>}
      {isChecker && hasFunction(selectedDirection) && selected.approvedBy === principal?.principalId && ['APPROVED', 'CONSUMED'].includes(selected.status) && <button disabled={busy || !mfa || !reviewed} onClick={() => void guarded(execute)}>{selected.status === 'CONSUMED' ? 'Recover posted result' : 'Execute approved instruction'}</button>}
    </div>}
    {message && <p role="status">{message}</p>}
  </section>;
}
