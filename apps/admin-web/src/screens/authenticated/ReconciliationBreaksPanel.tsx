import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  FinanceOperationsApi,
  type FinanceBreak,
  type FinanceInstitutionSummary,
  type ReconciliationBreaksResponse,
} from '../../services/finance-operations-api';
import { BankingAdminApi } from '../../services/banking-admin-api';

export interface ReconciliationBreaksPanelProps {
  /** Open the ledger journal behind an internal break. */
  onOpenJournal?: (journalId: string) => void;
  /** Preselect an institution (deep link from Banking Operations). */
  initialInstitutionId?: string;
}

const STATE_OPTIONS = ['', 'OPEN', 'INVESTIGATING', 'RESOLVED', 'WARNING', 'ERROR', 'UNAVAILABLE'];
const SOURCE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: 'All sources' },
  { value: 'INTERNAL_LEDGER', label: 'Internal ledger' },
  { value: 'EXTERNAL_PROVIDER', label: 'External provider evidence' },
  { value: 'EXTERNAL_STATEMENT', label: 'External statement evidence' },
];

const severityStyle = (severity: string): React.CSSProperties => {
  if (severity === 'CRITICAL' || severity === 'ERROR')
    return { color: 'var(--mn-status-danger, #b3261e)', fontWeight: 700 };
  if (severity === 'REVIEW' || severity === 'WARNING')
    return { color: 'var(--mn-status-warning, #8c5600)', fontWeight: 700 };
  return { color: 'var(--mn-text-secondary, #52655f)', fontWeight: 600 };
};

/**
 * Reconciliation break triage.
 *
 * The single most important rule on this screen is that internal agreement is not external
 * agreement. The server reports `reconciliationEstablished` only when every source actually
 * established agreement; a provider or statement that could not be read is `NOT_PERFORMED`, never
 * a pass. The banner below repeats the server's statement verbatim rather than deriving one.
 */
export const ReconciliationBreaksPanel: React.FC<ReconciliationBreaksPanelProps> = ({
  onOpenJournal,
  initialInstitutionId,
}) => {
  const [institutions, setInstitutions] = useState<FinanceInstitutionSummary[]>([]);
  const [institutionId, setInstitutionId] = useState(initialInstitutionId ?? '');
  const [institutionsError, setInstitutionsError] = useState('');
  const [institutionsLoading, setInstitutionsLoading] = useState(true);

  const [source, setSource] = useState('');
  const [state, setState] = useState('');
  const [reference, setReference] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const [result, setResult] = useState<ReconciliationBreaksResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [resolvingId, setResolvingId] = useState('');
  const [resolveNote, setResolveNote] = useState('');
  const [resolveBusy, setResolveBusy] = useState(false);
  const [resolveError, setResolveError] = useState('');
  const [resolveSuccess, setResolveSuccess] = useState('');

  const generation = useRef(0);
  useEffect(
    () => () => {
      generation.current += 1;
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    setInstitutionsLoading(true);
    FinanceOperationsApi.reconciliationInstitutions()
      .then((response) => {
        if (cancelled) return;
        setInstitutions(response.items);
        setInstitutionsError('');
        setInstitutionId((current) => {
          if (current && response.items.some((item) => item.id === current)) return current;
          if (
            initialInstitutionId &&
            response.items.some((item) => item.id === initialInstitutionId)
          )
            return initialInstitutionId;
          return response.items[0]?.id ?? '';
        });
      })
      .catch((err: any) => {
        if (!cancelled)
          setInstitutionsError(
            err?.message ||
              'Institution scope is unavailable. Reconciliation requires reconciliation.view.',
          );
      })
      .finally(() => {
        if (!cancelled) setInstitutionsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [initialInstitutionId]);

  const load = useCallback(async () => {
    if (!institutionId) {
      setResult(null);
      return;
    }
    const request = ++generation.current;
    setLoading(true);
    setError('');
    setResolveSuccess('');
    try {
      const response = await FinanceOperationsApi.reconciliationBreaks({
        institutionId,
        source: source || undefined,
        state: state || undefined,
        reference: reference.trim() || undefined,
        from: from || undefined,
        to: to || undefined,
        limit: 200,
      });
      if (request !== generation.current) return;
      setResult(response);
    } catch (err: any) {
      if (request !== generation.current) return;
      setResult(null);
      setError(err?.message || 'Reconciliation breaks could not be loaded.');
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }, [institutionId, source, state, reference, from, to]);

  useEffect(() => {
    void load();
    // Reload when the institution changes; other filters are explicit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [institutionId]);

  const submitResolve = async (breaker: FinanceBreak) => {
    if (
      !breaker.nextAction.permitted ||
      breaker.nextAction.targetKind !== 'BANKING_EXCEPTION' ||
      !breaker.nextAction.targetId
    )
      return;
    if (resolveNote.trim().length < 3) {
      setResolveError('A resolution note of at least 3 characters is required.');
      return;
    }
    setResolveBusy(true);
    setResolveError('');
    try {
      await BankingAdminApi.resolveException(
        breaker.nextAction.targetId,
        'ESCALATED',
        resolveNote.trim(),
      );
      setResolveSuccess(
        `Recorded an escalation for ${breaker.checkName}. This records a decision; it does not move money or establish agreement.`,
      );
      setResolvingId('');
      setResolveNote('');
      await load();
    } catch (err: any) {
      setResolveError(err?.message || 'The escalation could not be recorded.');
    } finally {
      setResolveBusy(false);
    }
  };

  const selectedInstitution = institutions.find((item) => item.id === institutionId) ?? null;
  const filtersDisabled = loading || !institutionId;

  return (
    <section
      className="mn-reconciliation__workspace"
      aria-label="Reconciliation evidence and breaks"
      data-testid="reconciliation-breaks-panel"
    >
      <p className="mn-reconciliation__eyebrow">EVIDENCE &amp; BREAKS</p>
      <h2 style={styles.heading}>External evidence, internal checks and breaks</h2>
      <p style={styles.intro}>
        Internal checks prove the ledger agrees with itself. Provider and statement rows are
        evidence from outside this system; when they cannot be read the source is reported as not
        performed. Institution scope is applied by the server from your active assignments.
      </p>

      {institutionsLoading && <p style={styles.muted}>Loading institution scope…</p>}
      {institutionsError && (
        <div role="alert" style={styles.error} data-testid="reconciliation-scope-error">
          {institutionsError}
        </div>
      )}
      {!institutionsLoading && !institutionsError && institutions.length === 0 && (
        <div role="note" style={styles.note} data-testid="reconciliation-no-institutions">
          You hold no active institution assignment, so there is no reconciliation workspace to
          open. Ask a finance administrator to assign your principal to an institution.
        </div>
      )}

      {institutions.length > 0 && (
        <div style={styles.filterBar}>
          <label style={styles.field}>
            <span style={styles.label}>Institution</span>
            <select
              data-testid="reconciliation-institution"
              style={styles.input}
              value={institutionId}
              onChange={(e) => setInstitutionId(e.target.value)}
              disabled={loading}
            >
              {institutions.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} ({item.code}) · {item.status}
                </option>
              ))}
            </select>
          </label>
          <label style={styles.field}>
            <span style={styles.label}>Source</span>
            <select
              data-testid="reconciliation-source-filter"
              style={styles.input}
              value={source}
              onChange={(e) => setSource(e.target.value)}
              disabled={filtersDisabled}
            >
              {SOURCE_OPTIONS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label style={styles.field}>
            <span style={styles.label}>State</span>
            <select
              data-testid="reconciliation-state-filter"
              style={styles.input}
              value={state}
              onChange={(e) => setState(e.target.value)}
              disabled={filtersDisabled}
            >
              {STATE_OPTIONS.map((item) => (
                <option key={item} value={item}>
                  {item || 'Any state'}
                </option>
              ))}
            </select>
          </label>
          <label style={{ ...styles.field, gridColumn: 'span 2' }}>
            <span style={styles.label}>Reference</span>
            <input
              data-testid="reconciliation-reference"
              style={styles.input}
              type="text"
              placeholder="Transaction, journal, provider or exception reference"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              disabled={filtersDisabled}
            />
          </label>
          <label style={styles.field}>
            <span style={styles.label}>From</span>
            <input
              data-testid="reconciliation-from"
              style={styles.input}
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              disabled={filtersDisabled}
            />
          </label>
          <label style={styles.field}>
            <span style={styles.label}>To</span>
            <input
              data-testid="reconciliation-to"
              style={styles.input}
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              disabled={filtersDisabled}
            />
          </label>
          <div style={styles.filterActions}>
            <button
              type="button"
              data-testid="reconciliation-breaks-search"
              style={styles.primary}
              disabled={filtersDisabled}
              onClick={() => void load()}
            >
              {loading ? 'Refreshing…' : 'Apply filters'}
            </button>
          </div>
        </div>
      )}

      {error && (
        <div role="alert" style={styles.error} data-testid="reconciliation-breaks-error">
          {error}
        </div>
      )}
      {resolveError && (
        <div role="alert" style={styles.error}>
          {resolveError}
        </div>
      )}
      {resolveSuccess && (
        <div role="status" style={styles.success}>
          {resolveSuccess}
        </div>
      )}

      {result && selectedInstitution && (
        <>
          <div
            role="status"
            style={result.reconciliationEstablished ? styles.success : styles.warning}
            data-testid="reconciliation-established"
          >
            <strong>
              {result.reconciliationEstablished
                ? 'Reconciliation established for the checked period'
                : 'Reconciliation not established'}
            </strong>{' '}
            — {result.summary.checksPassed}/{result.summary.checksRun} internal checks passed,{' '}
            {result.summary.errors} error break(s), {result.summary.warnings} warning(s),{' '}
            {result.summary.unavailableSources} source(s) not performed,{' '}
            {result.summary.externalExceptionsOpen} open external exception(s).{' '}
            {result.reconciliationEstablished
              ? 'This statement covers the sources listed below.'
              : 'Internal agreement alone is not settlement; treat any unavailable source as an exception, not a pass.'}
          </div>

          <div style={styles.sourceGrid} data-testid="reconciliation-sources">
            {result.sources.map((item) => (
              <article
                key={item.source}
                style={styles.sourceCard}
                data-testid={`reconciliation-source-${item.source}`}
              >
                <p style={styles.sourceLabel}>{item.label}</p>
                <p style={styles.sourceValue}>
                  <span style={availabilityStyle(item.availability)}>{item.availability}</span>{' '}
                  · {item.result.replace(/_/g, ' ')}
                </p>
                <p style={styles.sourceDetail}>{item.detail}</p>
                <p style={styles.sourceMeta}>
                  {item.evidenceKind}
                  {item.checkedAt ? ` · checked ${new Date(item.checkedAt).toLocaleString()}` : ''}
                  {item.providerKeys.length > 0 ? ` · ${item.providerKeys.join(', ')}` : ''}
                </p>
              </article>
            ))}
          </div>

          {result.providerReadiness.length > 0 && (
            <div style={styles.block}>
              <h3 style={styles.subheading}>Provider readiness</h3>
              <p style={styles.muted}>
                Entitlement is never asserted. A provider is usable only in the operational state;
                readiness is an institution-scoped fact, not a global flag.
              </p>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Provider</th>
                    <th style={styles.th}>Environment</th>
                    <th style={styles.th}>Readiness</th>
                    <th style={styles.th}>Reconciliation capability</th>
                  </tr>
                </thead>
                <tbody>
                  {result.providerReadiness.map((provider) => (
                    <tr key={`${provider.providerKey}:${provider.environment}`}>
                      <td style={styles.td}>{provider.providerKey}</td>
                      <td style={styles.td}>{provider.environment}</td>
                      <td style={styles.td}>
                        {provider.state}
                        <div style={styles.rowSub}>{provider.summary}</div>
                      </td>
                      <td style={styles.td}>
                        {provider.reconciliationCapability
                          ? `${provider.reconciliationCapability.state} · ${
                              provider.reconciliationCapability.usable ? 'usable' : 'not usable'
                            }`
                          : 'Not reported'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div style={styles.block}>
            <h3 style={styles.subheading}>Internal ledger checks</h3>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Check</th>
                  <th style={styles.th}>Status</th>
                  <th style={styles.th}>Checked</th>
                  <th style={styles.th}>Detail</th>
                </tr>
              </thead>
              <tbody>
                {result.checks.map((check) => (
                  <tr key={check.name}>
                    <td style={styles.td}>
                      <code>{check.name}</code> · {check.label}
                    </td>
                    <td style={styles.td}>{check.status}</td>
                    <td style={styles.td}>{new Date(check.checkedAt).toLocaleString()}</td>
                    <td style={styles.td}>{check.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={styles.block}>
            <h3 style={styles.subheading}>
              Breaks and exceptions ({result.breaks.length})
            </h3>
            {result.breaks.length === 0 ? (
              <p style={styles.muted} data-testid="reconciliation-breaks-empty">
                No break matches these filters. An empty list with an unavailable source above is
                still not evidence of agreement.
              </p>
            ) : (
              <table style={styles.table} data-testid="reconciliation-breaks-table">
                <thead>
                  <tr>
                    <th style={styles.th}>Severity / state</th>
                    <th style={styles.th}>Check</th>
                    <th style={styles.th}>Subject</th>
                    <th style={styles.th}>Amounts</th>
                    <th style={styles.th}>Detail</th>
                    <th style={styles.th}>Next permitted action</th>
                  </tr>
                </thead>
                <tbody>
                  {result.breaks.map((breaker) => (
                    <React.Fragment key={breaker.id}>
                      <tr data-testid={`reconciliation-break-row-${breaker.id}`}>
                        <td style={styles.td}>
                          <span style={severityStyle(breaker.severity)}>{breaker.severity}</span>
                          <div style={styles.rowSub}>{breaker.state}</div>
                        </td>
                        <td style={styles.td}>
                          {breaker.title}
                          <div style={styles.rowSub}>
                            <code>{breaker.checkName}</code> · {breaker.source.replace(/_/g, ' ')}
                          </div>
                        </td>
                        <td style={styles.td}>
                          {breaker.subject
                            ? `${breaker.subject.type} · ${breaker.subject.reference}`
                            : 'Institution-wide'}
                          <div style={styles.rowSub}>
                            {breaker.institution.name} ({breaker.institution.code})
                          </div>
                        </td>
                        <td style={styles.td}>
                          {breaker.amounts
                            ? `${breaker.amounts.internalMinor ?? '—'} internal / ${
                                breaker.amounts.providerMinor ?? '—'
                              } provider ${breaker.amounts.currency}`
                            : '—'}
                        </td>
                        <td style={styles.td} data-testid={`reconciliation-break-detail-${breaker.id}`}>
                          {breaker.detail}
                          <div style={styles.rowSub}>
                            Checked {new Date(breaker.checkedAt).toLocaleString()}
                            {breaker.run
                              ? ` · ${breaker.run.providerKey}/${breaker.run.environment} run ${breaker.run.state}`
                              : ''}
                          </div>
                        </td>
                        <td style={styles.td}>
                          <div>{breaker.nextAction.label}</div>
                          <div style={styles.rowSub}>{breaker.nextAction.reason}</div>
                          {breaker.nextAction.targetKind === 'JOURNAL' &&
                            breaker.nextAction.targetId &&
                            onOpenJournal && (
                              <button
                                type="button"
                                style={styles.secondary}
                                data-testid={`open-break-journal-${breaker.id}`}
                                onClick={() =>
                                  onOpenJournal(breaker.nextAction.targetId as string)
                                }
                              >
                                Inspect journal record
                              </button>
                            )}
                          {breaker.nextAction.targetKind === 'BANKING_EXCEPTION' &&
                            breaker.nextAction.targetId && (
                              <>
                                {breaker.nextAction.permitted ? (
                                  resolvingId === breaker.id ? (
                                    <div style={styles.resolveForm}>
                                      <label style={styles.label} htmlFor={`note-${breaker.id}`}>
                                        Resolution note
                                      </label>
                                      <textarea
                                        id={`note-${breaker.id}`}
                                        style={styles.textarea}
                                        rows={2}
                                        value={resolveNote}
                                        onChange={(e) => setResolveNote(e.target.value)}
                                        disabled={resolveBusy}
                                      />
                                      <div style={styles.resolveActions}>
                                        <button
                                          type="button"
                                          style={styles.primary}
                                          data-testid={`reconciliation-resolve-${breaker.id}`}
                                          disabled={resolveBusy}
                                          onClick={() => void submitResolve(breaker)}
                                        >
                                          {resolveBusy ? 'Recording…' : 'Record escalation'}
                                        </button>{' '}
                                        <button
                                          type="button"
                                          style={styles.secondary}
                                          disabled={resolveBusy}
                                          onClick={() => {
                                            setResolvingId('');
                                            setResolveNote('');
                                            setResolveError('');
                                          }}
                                        >
                                          Cancel
                                        </button>
                                      </div>
                                    </div>
                                  ) : (
                                    <button
                                      type="button"
                                      style={styles.secondary}
                                      data-testid={`reconciliation-resolve-open-${breaker.id}`}
                                      onClick={() => {
                                        setResolvingId(breaker.id);
                                        setResolveNote('');
                                        setResolveError('');
                                      }}
                                    >
                                      Record escalation
                                    </button>
                                  )
                                ) : (
                                  <div style={styles.rowSub}>
                                    Not available to this principal: {breaker.nextAction.reason}
                                  </div>
                                )}
                              </>
                            )}
                        </td>
                      </tr>
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </section>
  );
};

const availabilityStyle = (availability: string): React.CSSProperties => {
  if (availability === 'AVAILABLE')
    return { color: 'var(--mn-action-primary, #0b624a)', fontWeight: 700 };
  if (availability === 'PARTIAL')
    return { color: 'var(--mn-status-warning, #8c5600)', fontWeight: 700 };
  return { color: 'var(--mn-status-danger, #b3261e)', fontWeight: 700 };
};

const styles = {
  heading: { fontSize: '17px', margin: '0 0 6px 0' },
  subheading: { fontSize: '14px', margin: '0 0 8px 0' },
  intro: { fontSize: '12px', color: 'var(--mn-text-secondary, #52655f)', margin: '0 0 14px 0' },
  muted: { fontSize: '12px', color: 'var(--mn-text-muted, #5b6b66)' },
  note: {
    fontSize: '13px',
    padding: '12px 14px',
    border: '1px solid var(--mn-border-subtle, #cfdad6)',
    borderRadius: '6px',
    backgroundColor: 'var(--mn-surface-raised, #f5f8f7)',
  },
  warning: {
    fontSize: '13px',
    padding: '12px 14px',
    marginBottom: '14px',
    border: '1px solid var(--mn-status-warning, #8c5600)',
    backgroundColor: 'var(--mn-status-warning-bg, #fff3d9)',
    borderRadius: '6px',
  },
  success: {
    fontSize: '13px',
    padding: '12px 14px',
    marginBottom: '14px',
    border: '1px solid var(--mn-action-primary, #0b624a)',
    backgroundColor: 'var(--mn-surface-raised, #f5f8f7)',
    borderRadius: '6px',
  },
  error: {
    fontSize: '13px',
    padding: '12px 14px',
    marginBottom: '14px',
    border: '1px solid var(--mn-status-danger, #b3261e)',
    color: 'var(--mn-status-danger, #b3261e)',
    borderRadius: '6px',
  },
  filterBar: {
    display: 'grid',
    gridTemplateColumns: 'repeat(6, minmax(120px, 1fr))',
    gap: '10px',
    alignItems: 'end',
    marginBottom: '16px',
  },
  field: { display: 'flex', flexDirection: 'column' as const, gap: '4px' },
  label: { fontSize: '11px', fontWeight: 600, color: 'var(--mn-text-secondary, #52655f)' },
  input: {
    fontSize: '12px',
    padding: '7px 8px',
    border: '1px solid var(--mn-border-subtle, #cfdad6)',
    borderRadius: '5px',
    minWidth: 0,
  },
  textarea: {
    fontSize: '12px',
    padding: '6px 8px',
    border: '1px solid var(--mn-border-subtle, #cfdad6)',
    borderRadius: '5px',
    width: '100%',
    boxSizing: 'border-box' as const,
  },
  filterActions: { display: 'flex', alignItems: 'end' },
  primary: {
    fontSize: '12px',
    fontWeight: 600,
    padding: '8px 12px',
    border: '1px solid var(--mn-action-primary, #0b624a)',
    backgroundColor: 'var(--mn-action-primary, #0b624a)',
    color: '#fff',
    borderRadius: '5px',
    cursor: 'pointer',
  },
  secondary: {
    fontSize: '11px',
    fontWeight: 600,
    padding: '5px 9px',
    marginTop: '6px',
    border: '1px solid var(--mn-border-strong, #a9bab5)',
    backgroundColor: 'transparent',
    borderRadius: '5px',
    cursor: 'pointer',
  },
  sourceGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
    gap: '12px',
    marginBottom: '18px',
  },
  sourceCard: {
    border: '1px solid var(--mn-border-subtle, #cfdad6)',
    borderRadius: '6px',
    padding: '12px',
    backgroundColor: 'var(--mn-surface, #fff)',
  },
  sourceLabel: { fontSize: '11px', letterSpacing: '0.06em', margin: '0 0 4px 0' },
  sourceValue: { fontSize: '13px', margin: '0 0 6px 0' },
  sourceDetail: { fontSize: '12px', margin: '0 0 6px 0' },
  sourceMeta: { fontSize: '11px', color: 'var(--mn-text-muted, #5b6b66)', margin: 0 },
  block: { marginBottom: '20px' },
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: '12px' },
  th: {
    textAlign: 'left' as const,
    padding: '6px 8px',
    borderBottom: '1px solid var(--mn-border-strong, #a9bab5)',
    fontSize: '10px',
    letterSpacing: '0.06em',
    textTransform: 'uppercase' as const,
  },
  td: {
    padding: '7px 8px',
    borderBottom: '1px solid var(--mn-border-subtle, #cfdad6)',
    verticalAlign: 'top' as const,
  },
  rowSub: { fontSize: '11px', color: 'var(--mn-text-muted, #5b6b66)', marginTop: '2px' },
  resolveForm: { marginTop: '8px', display: 'grid', gap: '6px', minWidth: '200px' },
  resolveActions: { display: 'flex', gap: '6px' },
};
