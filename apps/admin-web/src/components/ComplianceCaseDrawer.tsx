import React, { useEffect, useRef, useState } from 'react';
import { WorkspaceDrawer } from '../design-system/WorkspaceDrawer';
import { ApiClient } from '../services/api-client';
import { CustomerComplianceCaseRow } from '../utils/compliance-case';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CASE_STATUSES = [
  'OPEN',
  'UNDER_REVIEW',
  'PENDING_CUSTOMER',
  'ESCALATED',
  'RESOLVED',
  'CLOSED',
] as const;

interface CaseCommentItem {
  id: string;
  caseId: string;
  actor: string;
  comment: string;
  createdAt: string;
}

interface CaseEvidenceItem {
  id: string;
  caseId: string;
  documentName: string;
  documentType: string;
  reference: string;
  uploadedBy: string;
  createdAt: string;
}

interface CaseAssignmentItem {
  id: string;
  caseId: string;
  assignedTo: string;
  assignedBy: string;
  createdAt: string;
}

interface CaseHistoryItem {
  id: string;
  caseId: string;
  action: string;
  actor: string;
  fromStatus: string | null;
  toStatus: string | null;
  details: Record<string, unknown> | null;
  createdAt: string;
}

function fmtDate(val?: string | null): string {
  if (typeof val === 'string' && Number.isFinite(Date.parse(val))) {
    return new Date(val).toLocaleString();
  }
  return 'Not recorded';
}

export function ComplianceCaseDrawer({
  record,
  onClose,
  canMutate = false,
  principalId,
  onCaseUpdated,
  onNavigateToCustomer,
  onNavigateToKycReview,
  onNavigateToSupport,
}: {
  record: CustomerComplianceCaseRow;
  onClose: () => void;
  canMutate?: boolean;
  principalId?: string;
  onCaseUpdated?: (updated: CustomerComplianceCaseRow) => void;
  onNavigateToCustomer?: (customerId: string) => void;
  onNavigateToKycReview?: (customerId: string) => void;
  onNavigateToSupport?: (customerId: string) => void;
}) {
  const [activeRecord, setActiveRecord] = useState<CustomerComplianceCaseRow>(record);
  const [comments, setComments] = useState<CaseCommentItem[]>([]);
  const [evidence, setEvidence] = useState<CaseEvidenceItem[]>([]);
  const [assignments, setAssignments] = useState<CaseAssignmentItem[]>([]);
  const [history, setHistory] = useState<CaseHistoryItem[]>([]);
  const [subresourceLoading, setSubresourceLoading] = useState(false);

  const [nextStatus, setNextStatus] = useState(record.status);
  const [resolution, setResolution] = useState(record.resolution ?? '');
  const [assigneeInput, setAssigneeInput] = useState(record.assignedTo ?? '');
  const [commentText, setCommentText] = useState('');
  const [docName, setDocName] = useState('');
  const [docType, setDocType] = useState('SCREENING_REPORT');
  const [docRef, setDocRef] = useState('');

  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState('');
  const [actionErr, setActionErr] = useState('');
  const reqGen = useRef(0);

  const isPersistedUuidCase = UUID_RE.test(record.customerId) && UUID_RE.test(record.id);

  const loadSubresources = async (
    customerId: string,
    caseId: string,
    options?: { syncDraftFields?: boolean },
  ) => {
    if (!UUID_RE.test(customerId) || !UUID_RE.test(caseId)) return;
    const syncDraftFields = options?.syncDraftFields ?? true;
    const gen = ++reqGen.current;
    setSubresourceLoading(true);
    const base = `/customers/${encodeURIComponent(customerId)}/compliance-cases/${encodeURIComponent(caseId)}`;
    try {
      const [detailRes, commentsRes, evidenceRes, assignmentsRes, historyRes] = await Promise.all([
        Promise.resolve(ApiClient.get(base)).catch(() => null),
        Promise.resolve(ApiClient.get(`${base}/comments`)).catch(() => null),
        Promise.resolve(ApiClient.get(`${base}/evidence`)).catch(() => null),
        Promise.resolve(ApiClient.get(`${base}/assignments`)).catch(() => null),
        Promise.resolve(ApiClient.get(`${base}/history`)).catch(() => null),
      ]);
      if (gen !== reqGen.current) return;
      if (
        detailRes &&
        typeof detailRes === 'object' &&
        !Array.isArray(detailRes) &&
        (detailRes as any).id === caseId
      ) {
        const detail = detailRes as CustomerComplianceCaseRow;
        const mergedRecord: CustomerComplianceCaseRow = {
          ...record,
          ...detail,
          customerReference: detail.customerReference ?? record.customerReference,
          customerDisplayName: detail.customerDisplayName ?? record.customerDisplayName,
        };
        setActiveRecord((prev) => ({
          ...prev,
          ...detail,
          customerReference: prev.customerReference ?? record.customerReference,
          customerDisplayName: prev.customerDisplayName ?? record.customerDisplayName,
        }));
        onCaseUpdated?.(mergedRecord);
        if (syncDraftFields) {
          setNextStatus((prev) => (prev === record.status ? detail.status : prev));
          setResolution((prev) => prev || detail.resolution || '');
          setAssigneeInput((prev) => prev || detail.assignedTo || '');
        }
      }
      if (Array.isArray(commentsRes)) setComments(commentsRes as CaseCommentItem[]);
      if (Array.isArray(evidenceRes)) setEvidence(evidenceRes as CaseEvidenceItem[]);
      if (Array.isArray(assignmentsRes)) setAssignments(assignmentsRes as CaseAssignmentItem[]);
      if (Array.isArray(historyRes)) setHistory(historyRes as CaseHistoryItem[]);
    } finally {
      if (gen === reqGen.current) setSubresourceLoading(false);
    }
  };

  useEffect(() => {
    setActiveRecord(record);
    setNextStatus(record.status);
    setResolution(record.resolution ?? '');
    setAssigneeInput(record.assignedTo ?? '');
    setActionMsg('');
    setActionErr('');
    if (isPersistedUuidCase) {
      void loadSubresources(record.customerId, record.id);
    }
    return () => {
      reqGen.current += 1;
    };
  }, [record.customerId, record.id]);

  const isClosed = activeRecord.status === 'CLOSED';
  const allowCaseEdits = Boolean(canMutate && !isClosed);
  const basePath = `/customers/${encodeURIComponent(activeRecord.customerId)}/compliance-cases/${encodeURIComponent(activeRecord.id)}`;

  const handleStatusUpdate = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!allowCaseEdits || busyAction) return;
    setBusyAction('status');
    setActionErr('');
    setActionMsg('');
    try {
      const payload: Record<string, unknown> = { status: nextStatus };
      if (resolution.trim()) payload.resolution = resolution.trim();
      if (typeof activeRecord.version === 'number') payload.version = activeRecord.version;
      const updated = await ApiClient.patch<CustomerComplianceCaseRow>(basePath, payload);
      if (!updated || typeof updated !== 'object' || updated.id !== activeRecord.id) {
        throw new Error('Case update response did not match the requested record.');
      }
      const next = {
        ...activeRecord,
        ...updated,
      };
      setActiveRecord(next);
      setNextStatus(next.status);
      setResolution(next.resolution ?? '');
      onCaseUpdated?.(next);
      setActionMsg(`Case updated to ${next.status}.`);
      if (isPersistedUuidCase)
        await loadSubresources(next.customerId, next.id, { syncDraftFields: false });
    } catch (err: any) {
      setActionErr(err?.message || 'Failed to update compliance case.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleAssign = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!allowCaseEdits || busyAction || !assigneeInput.trim()) return;
    setBusyAction('assign');
    setActionErr('');
    setActionMsg('');
    try {
      await ApiClient.post(`${basePath}/assignment`, {
        assignedTo: assigneeInput.trim(),
      });
      const next = {
        ...activeRecord,
        assignedTo: assigneeInput.trim(),
        version:
          typeof activeRecord.version === 'number' ? activeRecord.version + 1 : activeRecord.version,
      };
      setActiveRecord(next);
      onCaseUpdated?.(next);
      setActionMsg(`Assigned case to ${assigneeInput.trim()}.`);
      if (isPersistedUuidCase)
        await loadSubresources(activeRecord.customerId, activeRecord.id, {
          syncDraftFields: false,
        });
    } catch (err: any) {
      setActionErr(err?.message || 'Failed to assign compliance case.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleAddComment = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!allowCaseEdits || busyAction || !commentText.trim()) return;
    setBusyAction('comment');
    setActionErr('');
    setActionMsg('');
    try {
      await ApiClient.post(`${basePath}/comment`, {
        comment: commentText.trim(),
      });
      setCommentText('');
      setActionMsg('Investigation comment recorded.');
      if (isPersistedUuidCase)
        await loadSubresources(activeRecord.customerId, activeRecord.id, {
          syncDraftFields: false,
        });
    } catch (err: any) {
      setActionErr(err?.message || 'Failed to record case comment.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleAddEvidence = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!allowCaseEdits || busyAction || !docName.trim() || !docRef.trim()) return;
    setBusyAction('evidence');
    setActionErr('');
    setActionMsg('');
    try {
      await ApiClient.post(`${basePath}/evidence`, {
        documentName: docName.trim(),
        documentType: docType.trim(),
        reference: docRef.trim(),
      });
      setDocName('');
      setDocRef('');
      setActionMsg('Case evidence attached.');
      if (isPersistedUuidCase)
        await loadSubresources(activeRecord.customerId, activeRecord.id, {
          syncDraftFields: false,
        });
    } catch (err: any) {
      setActionErr(err?.message || 'Failed to attach case evidence.');
    } finally {
      setBusyAction(null);
    }
  };

  const opened = fmtDate(activeRecord.openedAt);

  return (
    <WorkspaceDrawer label="Case details" className="compliance-case-drawer" onDismiss={onClose}>
      <header className="compliance-case-drawer__header">
        <div>
          <p className="compliance-workspace__eyebrow">AUTHORIZED CASE RECORD</p>
          <h2>{activeRecord.caseNumber}</h2>
        </div>
        <button type="button" className="compliance-case-detail" onClick={onClose}>
          Close
        </button>
      </header>
      <div className="compliance-case-drawer__body">
        <p>
          {canMutate
            ? isClosed
              ? 'Closed compliance case — record is immutable and preserved for audit inspection.'
              : 'Authorized compliance case workspace — status transitions, assignment, evidence, comments, and history.'
            : 'Read-only case details returned for this customer.'}
        </p>

        {(onNavigateToCustomer || onNavigateToKycReview || onNavigateToSupport) && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
            {onNavigateToCustomer && (
              <button
                type="button"
                className="compliance-case-detail"
                onClick={() => onNavigateToCustomer(activeRecord.customerId)}
              >
                Open Customer 360°
              </button>
            )}
            {onNavigateToKycReview && (
              <button
                type="button"
                className="compliance-case-detail"
                onClick={() => onNavigateToKycReview(activeRecord.customerId)}
              >
                Open KYC Review
              </button>
            )}
            {onNavigateToSupport && (
              <button
                type="button"
                className="compliance-case-detail"
                onClick={() => onNavigateToSupport(activeRecord.customerId)}
              >
                Open Support Tickets
              </button>
            )}
          </div>
        )}

        <dl>
          <dt>Case ID</dt>
          <dd>{activeRecord.id}</dd>
          <dt>Customer ID</dt>
          <dd>
            {activeRecord.customerId}
            {activeRecord.customerDisplayName ? ` (${activeRecord.customerDisplayName})` : ''}
            {activeRecord.customerReference ? ` · ${activeRecord.customerReference}` : ''}
          </dd>
          <dt>Category</dt>
          <dd>{activeRecord.category}</dd>
          <dt>Status</dt>
          <dd>{activeRecord.status}</dd>
          <dt>Severity</dt>
          <dd>{activeRecord.severity}</dd>
          <dt>Assigned To</dt>
          <dd>{activeRecord.assignedTo || 'Unassigned'}</dd>
          <dt>Resolution</dt>
          <dd>{activeRecord.resolution || 'Not recorded'}</dd>
          <dt>Opened</dt>
          <dd>{opened}</dd>
          {activeRecord.closedAt && (
            <>
              <dt>Closed</dt>
              <dd>{fmtDate(activeRecord.closedAt)}</dd>
            </>
          )}
        </dl>

        {actionMsg && (
          <div
            className="compliance-workspace__state compliance-workspace__state--success"
            role="status"
            style={{ marginTop: 12 }}
          >
            {actionMsg}
          </div>
        )}
        {actionErr && (
          <div
            className="compliance-workspace__state compliance-workspace__state--error"
            role="alert"
            style={{ marginTop: 12 }}
          >
            {actionErr}
          </div>
        )}

        {allowCaseEdits && (
          <div style={{ display: 'grid', gap: 16, marginTop: 16 }}>
            <form
              onSubmit={handleStatusUpdate}
              style={cardStyle}
              aria-label="Update case status and resolution"
            >
              <h3 style={subheadStyle}>Status &amp; resolution</h3>
              <div style={{ display: 'grid', gap: 8 }}>
                <label style={labelStyle}>
                  Case status
                  <select
                    aria-label="Case status"
                    value={nextStatus}
                    onChange={(e) => setNextStatus(e.target.value)}
                    disabled={Boolean(busyAction)}
                    style={fieldStyle}
                  >
                    {CASE_STATUSES.map((st) => (
                      <option key={st} value={st}>
                        {st}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={labelStyle}>
                  Resolution / disposition summary
                  <input
                    aria-label="Case resolution"
                    value={resolution}
                    onChange={(e) => setResolution(e.target.value)}
                    placeholder="Summarize disposition or escalation basis"
                    disabled={Boolean(busyAction)}
                    style={fieldStyle}
                  />
                </label>
                <div>
                  <button
                    type="submit"
                    className="compliance-case-detail"
                    disabled={Boolean(busyAction)}
                  >
                    {busyAction === 'status' ? 'Updating…' : 'Save case status'}
                  </button>
                </div>
              </div>
            </form>

            <form onSubmit={handleAssign} style={cardStyle} aria-label="Assign compliance case">
              <h3 style={subheadStyle}>Investigator assignment</h3>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'flex-end' }}>
                <label style={{ ...labelStyle, flex: '1 1 220px' }}>
                  Assignee principal ID
                  <input
                    aria-label="Case assignee principal ID"
                    value={assigneeInput}
                    onChange={(e) => setAssigneeInput(e.target.value)}
                    placeholder="Principal ID"
                    disabled={Boolean(busyAction)}
                    style={fieldStyle}
                  />
                </label>
                {principalId && (
                  <button
                    type="button"
                    className="compliance-case-detail"
                    disabled={Boolean(busyAction)}
                    onClick={() => setAssigneeInput(principalId)}
                  >
                    Assign to me
                  </button>
                )}
                <button
                  type="submit"
                  className="compliance-case-detail"
                  disabled={Boolean(busyAction) || !assigneeInput.trim()}
                >
                  {busyAction === 'assign' ? 'Assigning…' : 'Save assignment'}
                </button>
              </div>
            </form>

            <form onSubmit={handleAddEvidence} style={cardStyle} aria-label="Attach case evidence">
              <h3 style={subheadStyle}>Attach structured evidence</h3>
              <div style={{ display: 'grid', gap: 8 }}>
                <label style={labelStyle}>
                  Document name
                  <input
                    aria-label="Evidence document name"
                    value={docName}
                    onChange={(e) => setDocName(e.target.value)}
                    placeholder="e.g. Sanctions screening hit packet"
                    disabled={Boolean(busyAction)}
                    style={fieldStyle}
                  />
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <label style={labelStyle}>
                    Document type
                    <select
                      aria-label="Evidence document type"
                      value={docType}
                      onChange={(e) => setDocType(e.target.value)}
                      disabled={Boolean(busyAction)}
                      style={fieldStyle}
                    >
                      <option value="SCREENING_REPORT">SCREENING_REPORT</option>
                      <option value="TRANSACTION_EXTRACT">TRANSACTION_EXTRACT</option>
                      <option value="IDENTITY_ATTESTATION">IDENTITY_ATTESTATION</option>
                      <option value="ADDRESS_VERIFICATION">ADDRESS_VERIFICATION</option>
                      <option value="CUSTOMER_STATEMENT">CUSTOMER_STATEMENT</option>
                      <option value="REGULATORY_FILING">REGULATORY_FILING</option>
                    </select>
                  </label>
                  <label style={labelStyle}>
                    Evidence reference
                    <input
                      aria-label="Evidence reference"
                      value={docRef}
                      onChange={(e) => setDocRef(e.target.value)}
                      placeholder="EVD-2026-001"
                      disabled={Boolean(busyAction)}
                      style={fieldStyle}
                    />
                  </label>
                </div>
                <div>
                  <button
                    type="submit"
                    className="compliance-case-detail"
                    disabled={Boolean(busyAction) || !docName.trim() || !docRef.trim()}
                  >
                    {busyAction === 'evidence' ? 'Attaching…' : 'Attach evidence'}
                  </button>
                </div>
              </div>
            </form>

            <form
              onSubmit={handleAddComment}
              style={cardStyle}
              aria-label="Add investigation comment"
            >
              <h3 style={subheadStyle}>Add investigation comment</h3>
              <div style={{ display: 'grid', gap: 8 }}>
                <label style={labelStyle}>
                  Investigation comment
                  <textarea
                    aria-label="Investigation comment"
                    rows={3}
                    value={commentText}
                    onChange={(e) => setCommentText(e.target.value)}
                    placeholder="Record factual review findings, screening analysis, or escalation context…"
                    disabled={Boolean(busyAction)}
                    style={fieldStyle}
                  />
                </label>
                <div>
                  <button
                    type="submit"
                    className="compliance-case-detail"
                    disabled={Boolean(busyAction) || !commentText.trim()}
                  >
                    {busyAction === 'comment' ? 'Posting…' : 'Post comment'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        )}

        {isPersistedUuidCase && (
          <div style={{ display: 'grid', gap: 14, marginTop: 18 }}>
            {subresourceLoading && (
              <p style={{ fontSize: 12, color: '#64748B' }}>Loading case activity &amp; trail…</p>
            )}

            <section style={cardStyle} aria-label="Case evidence records">
              <h3 style={subheadStyle}>Attached evidence ({evidence.length})</h3>
              {evidence.length === 0 ? (
                <p style={mutedStyle}>No evidence references attached yet.</p>
              ) : (
                <ul style={listStyle}>
                  {evidence.map((ev) => (
                    <li key={ev.id} style={itemStyle}>
                      <strong>{ev.documentName}</strong> · <code>{ev.documentType}</code> · Ref:{' '}
                      <code>{ev.reference}</code>
                      <div style={metaStyle}>
                        Uploaded by {ev.uploadedBy} · {fmtDate(ev.createdAt)}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section style={cardStyle} aria-label="Case investigation comments">
              <h3 style={subheadStyle}>Investigation comments ({comments.length})</h3>
              {comments.length === 0 ? (
                <p style={mutedStyle}>No investigation comments recorded yet.</p>
              ) : (
                <ul style={listStyle}>
                  {comments.map((cm) => (
                    <li key={cm.id} style={itemStyle}>
                      <div>{cm.comment}</div>
                      <div style={metaStyle}>
                        {cm.actor} · {fmtDate(cm.createdAt)}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section style={cardStyle} aria-label="Case assignment log">
              <h3 style={subheadStyle}>Assignment history ({assignments.length})</h3>
              {assignments.length === 0 ? (
                <p style={mutedStyle}>No investigator assignments recorded yet.</p>
              ) : (
                <ul style={listStyle}>
                  {assignments.map((asgn) => (
                    <li key={asgn.id} style={itemStyle}>
                      Assigned to <code>{asgn.assignedTo}</code> by <code>{asgn.assignedBy}</code>
                      <div style={metaStyle}>{fmtDate(asgn.createdAt)}</div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section style={cardStyle} aria-label="Case audit timeline">
              <h3 style={subheadStyle}>Immutable case history ({history.length})</h3>
              {history.length === 0 ? (
                <p style={mutedStyle}>No history events returned.</p>
              ) : (
                <ul style={listStyle}>
                  {history.map((h) => (
                    <li key={h.id} style={itemStyle}>
                      <strong>{h.action}</strong>
                      {h.fromStatus || h.toStatus
                        ? ` (${h.fromStatus ?? '—'} → ${h.toStatus ?? '—'})`
                        : ''}
                      <div style={metaStyle}>
                        Actor: <code>{h.actor}</code> · {fmtDate(h.createdAt)}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </div>
    </WorkspaceDrawer>
  );
}

const cardStyle: React.CSSProperties = {
  border: '1px solid #E2E8F0',
  borderRadius: 8,
  padding: 12,
  background: '#F8FAFC',
};

const subheadStyle: React.CSSProperties = {
  margin: '0 0 8px',
  fontSize: 13,
  fontWeight: 600,
  color: '#0F172A',
};

const labelStyle: React.CSSProperties = {
  display: 'grid',
  gap: 4,
  fontSize: 12,
  fontWeight: 500,
  color: '#334155',
};

const fieldStyle: React.CSSProperties = {
  padding: '6px 8px',
  borderRadius: 6,
  border: '1px solid #CBD5E1',
  fontSize: 13,
  background: '#FFFFFF',
};

const listStyle: React.CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
  display: 'grid',
  gap: 8,
};

const itemStyle: React.CSSProperties = {
  padding: '8px 10px',
  borderRadius: 6,
  background: '#FFFFFF',
  border: '1px solid #E2E8F0',
  fontSize: 13,
};

const metaStyle: React.CSSProperties = {
  fontSize: 11,
  color: '#64748B',
  marginTop: 4,
};

const mutedStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 12,
  color: '#64748B',
};
