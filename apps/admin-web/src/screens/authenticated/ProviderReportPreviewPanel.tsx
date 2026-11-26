import React, { useMemo, useRef, useState } from 'react';
import { adapterFor, allExactExports, registeredAdapters } from '../../services/settlement-preview/monnify-adapter';
import { parseInternalSnapshot, parseStatementSnapshot } from '../../services/settlement-preview/internal-snapshot';
import { reconcilePreview } from '../../services/settlement-preview/matching';
import {
  SYNTHETIC_COLLECTIONS,
  SYNTHETIC_INTERNAL_SNAPSHOT,
  SYNTHETIC_PAYOUTS,
  SYNTHETIC_SETTLEMENTS,
  SYNTHETIC_STATEMENT,
} from '../../services/settlement-preview/synthetic-fixtures';
import type {
  InternalRecord,
  ProviderRow,
  StatementEntry,
} from '../../services/settlement-preview/types';

interface UploadedReport {
  id: string;
  fileName: string;
  kind: string;
  format: string;
  fingerprint: string;
  observedColumns: string[];
  rows: ProviderRow[];
  embeddedCollections: ProviderRow[];
}

const readText = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error('The file could not be read.'));
    reader.readAsText(file);
  });

const styles: Record<string, React.CSSProperties> = {
  heading: { fontSize: 22, margin: '4px 0 8px' },
  intro: { maxWidth: 960, lineHeight: 1.6, color: 'var(--mn-text-secondary, #52655f)' },
  safety: {
    borderLeft: '4px solid var(--mn-status-success, #2e7d32)',
    background: 'var(--mn-surface-subtle, #f3f7f5)',
    padding: '10px 14px',
    margin: '14px 0',
    lineHeight: 1.5,
  },
  uploadGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14 },
  card: {
    border: '1px solid var(--mn-border, #d5ded9)',
    borderRadius: 10,
    padding: 14,
    background: 'var(--mn-surface, #fff)',
  },
  label: { display: 'block', fontWeight: 700, marginBottom: 6, fontSize: 13 },
  input: { width: '100%', padding: 8, border: '1px solid var(--mn-border, #ccd6d0)', borderRadius: 6 },
  button: {
    border: '1px solid var(--mn-border, #b9c7c0)',
    borderRadius: 6,
    padding: '7px 12px',
    background: 'var(--mn-surface, #fff)',
    cursor: 'pointer',
    marginRight: 8,
    marginTop: 8,
  },
  error: { color: 'var(--mn-status-danger, #b3261e)', lineHeight: 1.5, marginTop: 10 },
  note: { color: 'var(--mn-text-secondary, #52655f)', lineHeight: 1.5 },
  summaryGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, margin: '16px 0' },
  metric: { border: '1px solid var(--mn-border, #d5ded9)', borderRadius: 8, padding: 10 },
  metricValue: { fontSize: 20, fontWeight: 700, display: 'block' },
  tableWrap: { overflowX: 'auto', margin: '12px 0 20px' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: { textAlign: 'left', borderBottom: '2px solid var(--mn-border, #d5ded9)', padding: '8px 6px', whiteSpace: 'nowrap' },
  td: { borderBottom: '1px solid var(--mn-border, #e5ebe7)', padding: '8px 6px', verticalAlign: 'top' },
  badge: { borderRadius: 12, padding: '2px 8px', fontSize: 11, fontWeight: 700, background: '#eef2f0' },
  review: { color: '#8c5600', fontWeight: 700 },
  critical: { color: '#b3261e', fontWeight: 700 },
  section: { marginTop: 24 },
  code: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12, wordBreak: 'break-word' },
};

const outcomeStyle = (outcome: string): React.CSSProperties =>
  outcome === 'MATCHED'
    ? { ...styles.badge, color: '#2e7d32' }
    : outcome === 'MISMATCH' || outcome === 'UNVERIFIED_DESTINATION'
      ? { ...styles.badge, color: '#b3261e' }
      : { ...styles.badge, color: '#8c5600' };

const money = (minor: string): string => {
  const value = Number(minor) / 100;
  return Number.isFinite(value) ? value.toLocaleString('en-NG', { minimumFractionDigits: 2 }) : minor;
};

/**
 * Read-only provider report preview embedded in the Finance Reconciliation workspace.
 *
 * This component never calls a mutating endpoint. Its only inputs are local files; its only output
 * is an in-memory comparison. Ambiguous and mismatched rows are presented for Finance review, never
 * auto-resolved.
 */
export const ProviderReportPreviewPanel: React.FC<{
  canView: boolean;
  institutionId?: string;
}> = ({ canView, institutionId }) => {
  const [reports, setReports] = useState<UploadedReport[]>([]);
  const [internalRecords, setInternalRecords] = useState<InternalRecord[]>([]);
  const [statementEntries, setStatementEntries] = useState<StatementEntry[]>([]);
  const [error, setError] = useState('');
  const [snapshotNote, setSnapshotNote] = useState('');
  const sequence = useRef(0);
  const rows = reports.flatMap((report) => report.rows);
  const embeddedCollections = reports.flatMap((report) => report.embeddedCollections);
  const result = useMemo(
    () =>
      reconcilePreview({
        rows: [...rows, ...embeddedCollections],
        embeddedCollections,
        internalRecords,
        statementEntries,
        generatedAt: new Date().toISOString(),
      }),
    [reports, internalRecords, statementEntries],
  );

  if (!canView) {
    return (
      <section
        className="mn-reconciliation__workspace"
        aria-label="Provider report preview"
        data-testid="provider-report-preview"
      >
        <p style={styles.error} role="alert">
          Reconciliation view permission is required before a provider report can be previewed. No
          file was read and no comparison was performed.
        </p>
      </section>
    );
  }

  const loadProviderFile = async (file: File) => {
    setError('');
    const adapter = adapterFor('MONNIFY');
    if (!adapter) {
      setError('No provider adapter is registered.');
      return;
    }
    const content = await readText(file);
    const parsed = adapter.parse(file.name, content);
    if (!parsed.ok) {
      setError(`${parsed.message}${parsed.exactExportNeeded ? ` Exact export needed: ${parsed.exactExportNeeded}` : ''}`);
      return;
    }
    sequence.current += 1;
    setReports((current) => [
      ...current,
      {
        id: `report-${sequence.current}`,
        fileName: file.name,
        kind: parsed.kind,
        format: parsed.format,
        fingerprint: parsed.documentFingerprint,
        observedColumns: parsed.observedColumns,
        rows: parsed.rows,
        embeddedCollections: parsed.embeddedCollections,
      },
    ]);
  };

  const loadInternalFile = async (file: File) => {
    setError('');
    const parsed = parseInternalSnapshot(await readText(file));
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    setInternalRecords(parsed.records);
    setSnapshotNote(`Internal snapshot: ${file.name} (${parsed.records.length} records).`);
  };

  const loadStatementFile = async (file: File) => {
    setError('');
    const parsed = parseStatementSnapshot(await readText(file));
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    setStatementEntries(parsed.entries);
    setSnapshotNote(`${snapshotNote} Statement: ${file.name} (${parsed.entries.length} lines).`);
  };

  const loadSyntheticExample = () => {
    const adapter = adapterFor('MONNIFY');
    if (!adapter) return;
    const files = [
      { name: 'synthetic-collections.json', content: SYNTHETIC_COLLECTIONS },
      { name: 'synthetic-payouts.json', content: SYNTHETIC_PAYOUTS },
      { name: 'synthetic-settlements.json', content: SYNTHETIC_SETTLEMENTS },
    ];
    const loaded: UploadedReport[] = [];
    files.forEach((file, index) => {
      const parsed = adapter.parse(file.name, file.content);
      if (parsed.ok) {
        sequence.current += 1;
        loaded.push({
          id: `synthetic-${sequence.current}`,
          fileName: `SYNTHETIC · ${file.name}`,
          kind: parsed.kind,
          format: parsed.format,
          fingerprint: `${parsed.documentFingerprint}-${index}`,
          observedColumns: parsed.observedColumns,
          rows: parsed.rows,
          embeddedCollections: parsed.embeddedCollections,
        });
      }
    });
    const internal = parseInternalSnapshot(SYNTHETIC_INTERNAL_SNAPSHOT);
    const statement = parseStatementSnapshot(SYNTHETIC_STATEMENT);
    setReports((current) => [...current, ...loaded]);
    if (internal.ok) setInternalRecords(internal.records);
    if (statement.ok) setStatementEntries(statement.entries);
    setSnapshotNote('Synthetic example loaded. No real customer, account, transaction or journal is represented.');
    setError('');
  };

  const withSession = rows.filter((row) => Boolean(row.nipSessionId));
  const withSettlement = rows.filter((row) => Boolean(row.settlementReference));
  const withProviderReference = rows.filter((row) => Boolean(row.providerTransactionReference));

  return (
    <section
      className="mn-reconciliation__workspace"
      aria-label="Monnify report upload and preview"
      data-testid="provider-report-preview"
    >
      <p className="mn-reconciliation__eyebrow">PROVIDER REPORT PREVIEW</p>
      <h2 style={styles.heading}>Monnify report upload and preview</h2>
      <p style={styles.intro}>
        Upload a redacted or synthetic Monnify document in a confirmed documented JSON envelope.
        Transaction matching and net settlement-to-statement matching are shown separately. Rows
        that cannot be resolved unambiguously stay in the Finance review queue.
      </p>
      <div style={styles.safety} data-testid="preview-read-only-notice">
        <strong>Read-only preview.</strong> Uploading a file here does not change a balance, post a
        journal, retry a transfer, initiate a refund, resolve a break or call a provider. Scope is
        {institutionId ? ` shown for ${institutionId}` : ' displayed by the surrounding workspace'}
        ; this panel does not send the file anywhere.
      </div>

      <div style={styles.uploadGrid}>
        <div style={styles.card}>
          <label style={styles.label} htmlFor="provider-report-file">
            Provider report (documented JSON)
          </label>
          <input
            id="provider-report-file"
            data-testid="provider-report-file"
            style={styles.input}
            type="file"
            accept=".json,.txt,.csv"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void loadProviderFile(file);
            }}
          />
          <p style={styles.note}>
            Registered adapters: {registeredAdapters().map((adapter) => adapter.label).join('; ')}.{' '}
            NIBSS is not registered yet; its adapter will use the same shared matcher.
          </p>
        </div>
        <div style={styles.card}>
          <label style={styles.label} htmlFor="internal-snapshot-file">
            Internal snapshot (redacted or synthetic JSON)
          </label>
          <input
            id="internal-snapshot-file"
            data-testid="internal-snapshot-file"
            style={styles.input}
            type="file"
            accept=".json,.txt"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void loadInternalFile(file);
            }}
          />
          <p style={styles.note}>References include provider transaction reference, NIP session ID and business reference.</p>
        </div>
        <div style={styles.card}>
          <label style={styles.label} htmlFor="statement-snapshot-file">
            Settlement destination statement (redacted JSON)
          </label>
          <input
            id="statement-snapshot-file"
            data-testid="statement-snapshot-file"
            style={styles.input}
            type="file"
            accept=".json,.txt"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void loadStatementFile(file);
            }}
          />
          <p style={styles.note}>Used only for the net settlement layer; never to overwrite transaction matches.</p>
        </div>
      </div>

      <div>
        <button type="button" style={styles.button} onClick={loadSyntheticExample} data-testid="load-synthetic-preview">
          Load synthetic example
        </button>
        <button
          type="button"
          style={styles.button}
          onClick={() => {
            setReports([]);
            setInternalRecords([]);
            setStatementEntries([]);
            setSnapshotNote('');
            setError('');
          }}
          data-testid="clear-preview"
        >
          Clear local preview
        </button>
      </div>
      {snapshotNote && <p style={styles.note}>{snapshotNote}</p>}
      {error && (
        <div role="alert" style={styles.error} data-testid="preview-error">
          {error}
        </div>
      )}

      <div style={styles.section} data-testid="uploaded-reports">
        <h3>Uploaded documents and observed fields</h3>
        {reports.length === 0 ? (
          <p style={styles.note}>No provider document has been read yet.</p>
        ) : (
          <div style={styles.tableWrap}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Document</th>
                  <th style={styles.th}>Report kind</th>
                  <th style={styles.th}>Confirmed format</th>
                  <th style={styles.th}>Rows</th>
                  <th style={styles.th}>Content fingerprint</th>
                  <th style={styles.th}>Fields observed in this file</th>
                </tr>
              </thead>
              <tbody>
                {reports.map((report) => (
                  <tr key={report.id}>
                    <td style={styles.td}>{report.fileName}</td>
                    <td style={styles.td}>{report.kind}</td>
                    <td style={styles.td}>{report.format}</td>
                    <td style={styles.td}>
                      {report.rows.length}
                      {report.embeddedCollections.length > 0
                        ? ` + ${report.embeddedCollections.length} embedded collection row(s)`
                        : ''}
                    </td>
                    <td style={{ ...styles.td, ...styles.code }}>{report.fingerprint}</td>
                    <td style={{ ...styles.td, ...styles.code }}>{report.observedColumns.join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div style={styles.summaryGrid} data-testid="preview-summary">
        {[
          ['Provider rows', result.summary.providerRows],
          ['Matched transactions', result.summary.matched],
          ['Unmatched', result.summary.unmatched],
          ['Amount / status mismatches', result.summary.mismatches],
          ['Ambiguous', result.summary.ambiguous],
          ['Duplicate uploads', result.summary.duplicateUploads],
          ['Net settlements matched', result.summary.netSettlementMatches],
          ['Net settlement problems', result.summary.netSettlementProblems],
        ].map(([label, value]) => (
          <div key={String(label)} style={styles.metric}>
            <span style={styles.metricValue}>{value}</span>
            <span style={styles.note}>{label}</span>
          </div>
        ))}
      </div>

      <div style={styles.card} data-testid="reference-availability">
        <h3>References available in uploaded rows</h3>
        <p style={styles.note}>
          Provider transaction reference is the primary transaction key. Settlement reference is a
          batch key, not a transaction identifier. A NIP session ID is used only when the source
          actually supplies <span style={styles.code}>sessionId</span>; it is never invented.
        </p>
        <p style={styles.note} data-testid="reference-counts">
          Provider transaction reference: {withProviderReference.length} · Settlement reference:{' '}
          {withSettlement.length} · NIP session ID: {withSession.length} (
          {Array.from(new Set(withSession.map((row) => row.nipSessionIdSource).filter(Boolean))).join(', ') || 'none'}
          )
        </p>
      </div>

      <div style={styles.section} data-testid="transaction-matches">
        <h3>Transaction-level matches</h3>
        {result.transactions.length === 0 ? (
          <p style={styles.note}>No transaction rows have been previewed.</p>
        ) : (
          <div style={styles.tableWrap}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Outcome</th>
                  <th style={styles.th}>Provider reference</th>
                  <th style={styles.th}>Key used</th>
                  <th style={styles.th}>Amount</th>
                  <th style={styles.th}>Status</th>
                  <th style={styles.th}>Internal record / journal</th>
                  <th style={styles.th}>Detail</th>
                </tr>
              </thead>
              <tbody>
                {result.transactions.map((match) => (
                  <tr key={`${match.row.fileName}-${match.row.rowNumber}`}>
                    <td style={styles.td}>
                      <span style={outcomeStyle(match.outcome)}>{match.outcome}</span>
                    </td>
                    <td style={{ ...styles.td, ...styles.code }}>
                      {match.row.providerTransactionReference ?? match.row.merchantReference ?? match.row.nipSessionId}
                    </td>
                    <td style={styles.td}>{match.keyUsed ?? '—'}</td>
                    <td style={styles.td}>
                      {money(match.row.amountMinor)} {match.row.currency}
                    </td>
                    <td style={styles.td}>{match.row.status}</td>
                    <td style={{ ...styles.td, ...styles.code }}>
                      {match.internalRecord
                        ? `${match.internalRecord.id}${match.internalRecord.journalId ? ` / ${match.internalRecord.journalId}` : ''}`
                        : match.candidates.length > 0
                          ? `${match.candidates.length} candidates`
                          : '—'}
                    </td>
                    <td style={styles.td}>{match.reasons.join(' ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p style={styles.note}>
          Every row above is a transaction observation only. A matched transaction does not establish
          that a net settlement reached the settlement destination.
        </p>
      </div>

      <div style={styles.section} data-testid="settlement-matches">
        <h3>Net settlement to statement (separate layer)</h3>
        {result.settlements.map((match, index) => (
          <div key={match.settlement?.settlementReference ?? index} style={{ ...styles.card, marginBottom: 10 }}>
            <p>
              <span style={outcomeStyle(match.outcome)}>{match.outcome}</span> ·{' '}
              <span style={styles.code}>{match.settlement?.settlementReference ?? 'no settlement row'}</span>
            </p>
            <p style={styles.note}>
              Provider net: {match.settlement ? `${money(match.settlement.amountMinor)} ${match.settlement.currency}` : '—'} ·{' '}
              Destination: {match.settlement?.settlementDestination?.accountNumber ?? 'not present'} ·{' '}
              Expected net from included PAID rows:{' '}
              {match.expectedNetMinor !== null ? money(match.expectedNetMinor) : 'not available'} · Statement:{' '}
              {match.statementEntry ? `${money(match.statementEntry.amountMinor)} / ${match.statementEntry.destinationAccountNumber ?? 'no account'}` : '—'}
            </p>
            <p style={styles.note}>{match.reasons.join(' ')}</p>
          </div>
        ))}
      </div>

      <div style={styles.section} data-testid="finance-review-queue">
        <h3>Finance review queue</h3>
        {result.reviewQueue.length === 0 ? (
          <p style={styles.note}>Nothing requires review in this local preview.</p>
        ) : (
          <div style={styles.tableWrap}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Category</th>
                  <th style={styles.th}>Reference</th>
                  <th style={styles.th}>Why</th>
                  <th style={styles.th}>Action</th>
                </tr>
              </thead>
              <tbody>
                {result.reviewQueue.map((item) => (
                  <tr key={item.id}>
                    <td style={styles.td}>
                      <span style={item.severity === 'CRITICAL' ? styles.critical : styles.review}>
                        {item.category}
                      </span>
                    </td>
                    <td style={{ ...styles.td, ...styles.code }}>{item.reference}</td>
                    <td style={styles.td}>{item.detail}</td>
                    <td style={styles.td}>Finance review required; this preview offers no write action.</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div style={styles.section} data-testid="unverified-formats">
        <h3>Unverified formats — exact exports needed</h3>
        <p style={styles.note}>
          No redacted Monnify dashboard CSV sample was supplied. CSV headers, column order and
          settlement reference placement are therefore unverified; this preview refuses CSV rather
          than guessing a header. Request and redact these exports before enabling CSV:
        </p>
        <p style={{ ...styles.note, ...styles.code }}>{allExactExports()}</p>
      </div>
    </section>
  );
};

export default ProviderReportPreviewPanel;
