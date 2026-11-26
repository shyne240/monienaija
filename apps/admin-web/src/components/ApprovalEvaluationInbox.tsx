import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Arena4OperationsApi, describeHttpError } from '../services/arena4-operations-api';
import {
  ApprovalRecord,
  describeAffectedRecords,
  describeDecisionHistory,
  describeExpiry,
  describeProposedChange,
  describeRequiredAuthority,
  evaluateApproval,
  formatInstant,
} from '../utils/approval-evaluation';

/**
 * Approval evaluation inbox (Arena B9).
 *
 * The checker workspace used to require an approval UUID pasted from somewhere else. This panel
 * lists the approvals the signed-in checker is actually allowed to see — the server scopes the
 * read to approval scope, MFA assurance and the action's approving roles — and presents each one as
 * a decidable unit: the proposed change, the affected records, the required authority, the recorded
 * decision history, and whether the decision has been applied.
 *
 * It never decides anything itself. Selecting a row loads that approval into the existing
 * single-decision form, which keeps the established confirmation, single-flight and unconfirmed
 * outcome controls intact.
 */

type Group = 'pending' | 'approved' | 'decided' | 'all';

const GROUP_LABEL: Record<Group, string> = {
  pending: 'Awaiting decision',
  approved: 'Approved — not applied',
  decided: 'Decided or closed',
  all: 'All visible',
};

const groupOf = (record: ApprovalRecord): Group | null => {
  const status = String(record.status).toUpperCase();
  if (status === 'REQUESTED') return 'pending';
  if (status === 'APPROVED') return 'approved';
  if (['REJECTED', 'CONSUMED', 'CANCELLED', 'EXPIRED'].includes(status)) return 'decided';
  return null;
};

const toneColor: Record<string, string> = {
  pending: '#8C5600',
  success: '#146348',
  danger: '#B3261E',
  warning: '#8C5600',
  neutral: '#52655F',
};

const toneBackground: Record<string, string> = {
  pending: '#FFF3D9',
  success: '#E4F4EC',
  danger: '#FDEBE9',
  warning: '#FFF3D9',
  neutral: '#EEF3F0',
};

/** Inline "code" chips so ids are copyable and visually distinct from prose. */
const Id: React.FC<{ value: string | null }> = ({ value }) =>
  value ? <code>{value}</code> : <span className="a4-ops__muted">—</span>;

export interface ApprovalEvaluationInboxProps {
  currentPrincipalId?: string;
  selectedId?: string;
  canDecide: boolean;
  /** Bumped by the parent after a decision so the list re-reads authoritative state. */
  refreshToken?: number;
  onSelect: (record: ApprovalRecord) => void;
}

export const ApprovalEvaluationInbox: React.FC<ApprovalEvaluationInboxProps> = ({
  currentPrincipalId,
  selectedId,
  canDecide,
  refreshToken = 0,
  onSelect,
}) => {
  const [records, setRecords] = useState<ApprovalRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [group, setGroup] = useState<Group>('pending');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const generation = useRef(0);
  useEffect(
    () => () => {
      generation.current += 1;
    },
    [],
  );

  const load = useCallback(async () => {
    const request = ++generation.current;
    setLoading(true);
    setError('');
    try {
      const page = await Arena4OperationsApi.approvals({ limit: 50, offset: 0 });
      if (request !== generation.current) return;
      if (!page || !Array.isArray(page.items)) {
        setRecords([]);
        setTotal(0);
        setError(
          'The approval list response could not be read. No decisions are possible from this view until it loads.',
        );
        return;
      }
      setRecords(page.items);
      setTotal(typeof page.total === 'number' ? page.total : page.items.length);
      setLoadedAt(new Date());
    } catch (loadFailure) {
      if (request !== generation.current) return;
      setRecords([]);
      setTotal(0);
      setError(
        describeHttpError(
          loadFailure,
          'The approval inbox could not be loaded. Existing decisions are unaffected.',
        ),
      );
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshToken]);

  const visible = useMemo(
    () => (group === 'all' ? records : records.filter((record) => groupOf(record) === group)),
    [group, records],
  );

  const counts = useMemo(() => {
    const result: Record<Group, number> = {
      pending: 0,
      approved: 0,
      decided: 0,
      all: records.length,
    };
    for (const record of records) {
      const bucket = groupOf(record);
      if (bucket) result[bucket] += 1;
    }
    return result;
  }, [records]);

  const now = new Date();

  return (
    <section
      id="approval-evaluation-inbox"
      className="approvals-redesign__panel"
      aria-label="Approval evaluation inbox"
      data-testid="approval-evaluation-inbox"
    >
      <p className="approvals-redesign__eyebrow">EVALUATE A REQUEST</p>
      <h2>Approval evaluation inbox</h2>
      <p className="approvals-redesign__intro">
        Requests your session is authorized to see. Each entry shows the proposed change, the
        records it affects, the authority a decision requires, what has already happened, and
        whether the change has been applied. Approved is not applied: the owning workflow performs
        the execution.
      </p>

      <div style={styles.toolbar} role="group" aria-label="Approval status filter">
        {(['pending', 'approved', 'decided', 'all'] as Group[]).map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={group === option}
            onClick={() => setGroup(option)}
            style={group === option ? styles.filterActive : styles.filter}
          >
            {GROUP_LABEL[option]} ({counts[option]})
          </button>
        ))}
        <button type="button" style={styles.refresh} onClick={() => void load()} disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh from server'}
        </button>
      </div>

      {error ? (
        <div style={styles.errorBox} role="alert">
          {error}
        </div>
      ) : null}

      {loading && records.length === 0 ? (
        <p data-testid="approval-inbox-loading" aria-live="polite" style={styles.muted}>
          Loading approvals visible to this session…
        </p>
      ) : null}

      {!loading && !error && visible.length === 0 ? (
        <p data-testid="approval-inbox-empty" style={styles.emptyBox}>
          {records.length === 0
            ? 'No approvals are visible to this session. Requests appear here only when your approval scope, role and assurance level permit you to see them.'
            : `No approvals in "${GROUP_LABEL[group]}". ${counts.all} approval${
                counts.all === 1 ? '' : 's'
              } visible in total.`}
        </p>
      ) : null}

      {visible.length > 0 ? (
        <ul style={styles.list} aria-label="Visible approvals">
          {visible.map((record) => {
            const evaluation = evaluateApproval(record, now, currentPrincipalId);
            const expanded = expandedId === record.id;
            const authority = describeRequiredAuthority(record);
            const selected = selectedId === record.id;
            return (
              <li
                key={record.id}
                style={{
                  ...styles.card,
                  borderColor: selected ? '#0B624A' : '#DDE7E2',
                }}
                data-testid={`approval-row-${record.id}`}
              >
                <div style={styles.cardHeader}>
                  <div>
                    <p style={styles.actionType}>{record.actionType}</p>
                    <p style={styles.muted}>
                      <Id value={record.id} /> · requested by{' '}
                      <Id value={record.requesterPrincipalId} /> ·{' '}
                      {formatInstant(record.requestedAt)}
                    </p>
                  </div>
                  <span
                    style={{
                      ...styles.badge,
                      color: toneColor[evaluation.tone],
                      background: toneBackground[evaluation.tone],
                    }}
                  >
                    {evaluation.label}
                  </span>
                </div>

                <p style={styles.explanation}>{evaluation.explanation}</p>

                <dl style={styles.summaryGrid}>
                  <div>
                    <dt style={styles.dt}>Affected record</dt>
                    <dd style={styles.dd}>
                      <code>{record.resourceType}</code> <Id value={record.resourceId} />
                    </dd>
                  </div>
                  <div>
                    <dt style={styles.dt}>Required authority</dt>
                    <dd style={styles.dd}>
                      {authority.resolved
                        ? `${authority.roles.join(', ') || 'role rule unresolved'}${
                            authority.functions.length ? ` + ${authority.functions.join(', ')}` : ''
                          } · ${authority.assurance}`
                        : 'Authority could not be resolved for this action — confirm policy before acting.'}
                    </dd>
                  </div>
                  <div>
                    <dt style={styles.dt}>Expiry</dt>
                    <dd style={styles.dd}>
                      {formatInstant(record.expiresAt)} ({describeExpiry(record, now)})
                    </dd>
                  </div>
                  <div>
                    <dt style={styles.dt}>Applied?</dt>
                    <dd style={styles.dd}>
                      {evaluation.appliedAt
                        ? `Yes — applied ${formatInstant(evaluation.appliedAt)}`
                        : 'No application recorded'}
                    </dd>
                  </div>
                </dl>

                <div style={styles.cardActions}>
                  <button
                    type="button"
                    style={styles.secondaryButton}
                    aria-expanded={expanded}
                    onClick={() => setExpandedId(expanded ? null : record.id)}
                  >
                    {expanded ? 'Hide full evaluation' : 'Full evaluation'}
                  </button>
                  <button
                    type="button"
                    style={styles.primaryButton}
                    disabled={!canDecide || !evaluation.canDecide}
                    onClick={() => onSelect(record)}
                  >
                    {evaluation.canDecide
                      ? 'Load into checker decision'
                      : evaluation.blockedReason
                        ? 'Decision blocked'
                        : 'No decision possible'}
                  </button>
                </div>
                {!evaluation.canDecide && evaluation.blockedReason ? (
                  <p style={styles.muted}>{evaluation.blockedReason}</p>
                ) : null}
                {evaluation.canDecide && !canDecide ? (
                  <p style={styles.muted}>
                    This is a read-only or non-MFA session: you can evaluate the request but cannot
                    submit a decision.
                  </p>
                ) : null}

                {expanded ? (
                  <div style={styles.detail} data-testid={`approval-detail-${record.id}`}>
                    <h3 style={styles.detailTitle}>Proposed change</h3>
                    {describeProposedChange(record).length === 0 ? (
                      <p style={styles.muted}>
                        This request carries no business payload. Confirm the affected record before
                        deciding.
                      </p>
                    ) : (
                      <dl style={styles.detailList}>
                        {describeProposedChange(record).map((row) => (
                          <div key={row.label} style={styles.detailRow}>
                            <dt style={styles.dt}>{row.label}</dt>
                            <dd style={styles.dd}>{row.value}</dd>
                          </div>
                        ))}
                      </dl>
                    )}

                    <h3 style={styles.detailTitle}>Affected records</h3>
                    <dl style={styles.detailList}>
                      {describeAffectedRecords(record).map((row) => (
                        <div key={row.label} style={styles.detailRow}>
                          <dt style={styles.dt}>{row.label}</dt>
                          <dd style={styles.dd}>{row.value}</dd>
                        </div>
                      ))}
                    </dl>

                    <h3 style={styles.detailTitle}>Required authority</h3>
                    <dl style={styles.detailList}>
                      <div style={styles.detailRow}>
                        <dt style={styles.dt}>Approving roles</dt>
                        <dd style={styles.dd}>
                          {authority.roles.length ? authority.roles.join(', ') : 'Unresolved'}
                        </dd>
                      </div>
                      <div style={styles.detailRow}>
                        <dt style={styles.dt}>Approving functions</dt>
                        <dd style={styles.dd}>
                          {authority.functions.length
                            ? authority.functions.join(', ')
                            : 'Role and scope rule only (no catalogue function)'}
                        </dd>
                      </div>
                      <div style={styles.detailRow}>
                        <dt style={styles.dt}>Minimum assurance</dt>
                        <dd style={styles.dd}>{authority.assurance}</dd>
                      </div>
                      <div style={styles.detailRow}>
                        <dt style={styles.dt}>Approval scope</dt>
                        <dd style={styles.dd}>
                          <code>{authority.approvalScope}</code>
                        </dd>
                      </div>
                      <div style={styles.detailRow}>
                        <dt style={styles.dt}>Minimum approvals</dt>
                        <dd style={styles.dd}>{authority.minimumApprovals}</dd>
                      </div>
                      <div style={styles.detailRow}>
                        <dt style={styles.dt}>Separation of duties</dt>
                        <dd style={styles.dd}>{authority.separation}</dd>
                      </div>
                    </dl>

                    <h3 style={styles.detailTitle}>Recorded decision history</h3>
                    <ol style={styles.history}>
                      {describeDecisionHistory(record).map((entry) => (
                        <li key={`${entry.label}-${entry.at}`}>
                          <strong>{entry.label}</strong> · {formatInstant(entry.at)} ·{' '}
                          {entry.actor ? <Id value={entry.actor} /> : 'actor not recorded'} —{' '}
                          {entry.detail}
                        </li>
                      ))}
                    </ol>
                    <p style={styles.muted}>
                      The decision recorded here is authoritative; the applied state reflects the
                      owning workflow&apos;s execution record.
                    </p>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      {loadedAt && !error ? (
        <p style={styles.muted} data-testid="approval-inbox-caption">
          Showing {visible.length} of {total} approval{total === 1 ? '' : 's'} visible to this
          session · read at {formatInstant(loadedAt.toISOString())} · server-scoped by approval
          scope, role and assurance.
        </p>
      ) : null}
    </section>
  );
};

const styles: Record<string, React.CSSProperties> = {
  toolbar: { display: 'flex', gap: 8, flexWrap: 'wrap', margin: '12px 0 16px' },
  filter: {
    border: '1px solid #DDE7E2',
    background: '#FFFFFF',
    color: '#132B25',
    borderRadius: 999,
    padding: '6px 12px',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
  },
  filterActive: {
    border: '1px solid #0B624A',
    background: '#0B624A',
    color: '#FFFFFF',
    borderRadius: 999,
    padding: '6px 12px',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
  },
  refresh: {
    marginLeft: 'auto',
    border: '1px solid #BFDBFE',
    background: '#EFF6FF',
    color: '#1E3A8A',
    borderRadius: 6,
    padding: '6px 12px',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
  },
  list: { listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 12 },
  card: {
    border: '1px solid #DDE7E2',
    borderRadius: 10,
    padding: 16,
    background: '#FFFFFF',
  },
  cardHeader: { display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'start' },
  actionType: { margin: 0, fontSize: 15, fontWeight: 700, color: '#132B25' },
  badge: {
    borderRadius: 999,
    padding: '4px 10px',
    fontSize: 11,
    fontWeight: 700,
    whiteSpace: 'nowrap',
  },
  explanation: { margin: '10px 0', fontSize: 13, lineHeight: '19px', color: '#132B25' },
  summaryGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
    gap: 10,
    margin: 0,
  },
  dt: { fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4, color: '#52655F' },
  dd: { margin: '2px 0 0', fontSize: 13, color: '#132B25', overflowWrap: 'anywhere' },
  cardActions: { display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 },
  primaryButton: {
    border: 'none',
    borderRadius: 6,
    background: '#0B624A',
    color: '#FFFFFF',
    padding: '8px 14px',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  },
  secondaryButton: {
    border: '1px solid #DDE7E2',
    borderRadius: 6,
    background: '#FFFFFF',
    color: '#132B25',
    padding: '8px 14px',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  },
  detail: {
    marginTop: 16,
    paddingTop: 12,
    borderTop: '1px solid #EEF3E8',
  },
  detailTitle: { fontSize: 13, fontWeight: 700, color: '#132B25', margin: '12px 0 6px' },
  detailList: { margin: 0, display: 'grid', gap: 8 },
  detailRow: { display: 'grid', gridTemplateColumns: 'minmax(150px, 220px) 1fr', gap: 8 },
  history: { margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: '20px', color: '#132B25' },
  muted: { fontSize: 12, color: '#52655F', margin: '8px 0 0' },
  emptyBox: {
    border: '1px dashed #DDE7E2',
    borderRadius: 8,
    padding: 16,
    fontSize: 13,
    color: '#52655F',
    margin: '8px 0',
  },
  errorBox: {
    backgroundColor: '#FDEBE9',
    color: '#B3261E',
    fontSize: 13,
    fontWeight: 500,
    padding: 12,
    borderRadius: 6,
    margin: '8px 0',
    border: '1px solid #B3261E',
  },
};
