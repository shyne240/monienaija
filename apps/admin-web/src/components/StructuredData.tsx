import React from 'react';

export type DataRecord = Record<string, unknown>;

export interface StructuredColumn {
  key: string;
  label: string;
  render?: (value: unknown, row: DataRecord) => React.ReactNode;
}

const emptyValue = '—';

export function extractRecords(payload: unknown): DataRecord[] {
  if (Array.isArray(payload)) return payload.map(asRecord);
  if (!payload || typeof payload !== 'object') return [];

  const value = payload as DataRecord;
  for (const key of ['data', 'items', 'rows', 'records', 'results']) {
    if (Array.isArray(value[key])) return (value[key] as unknown[]).map(asRecord);
  }

  // A summary object such as metrics/diagnostics is not a list. Callers that need to show
  // summaries should use StructuredKeyValueList rather than turning the envelope into one row.
  return [];
}

function asRecord(value: unknown): DataRecord {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as DataRecord;
  return { value };
}

export function humanizeKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatScalar(key: string, value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined || value === '') return emptyValue;
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return Number.isFinite(value) ? value.toLocaleString() : String(value);

  if (/(?:At|Date|Timestamp)$/i.test(key)) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toLocaleString();
  }
  return value;
}

function StructuredValue({ field, value, depth = 0 }: { field: string; value: unknown; depth?: number }) {
  if (value === null || value === undefined || value === '') return <span>{emptyValue}</span>;
  if (typeof value !== 'object') return <span>{formatScalar(field, value as string | number | boolean)}</span>;
  if (depth >= 3) return <span>Structured value</span>;

  if (Array.isArray(value)) {
    if (value.length === 0) return <span>{emptyValue}</span>;
    return (
      <details>
        <summary>{value.length} item{value.length === 1 ? '' : 's'}</summary>
        <ul style={styles.valueList}>
          {value.map((item, index) => <li key={index}><StructuredValue field={field} value={item} depth={depth + 1} /></li>)}
        </ul>
      </details>
    );
  }

  const record = value as DataRecord;
  return (
    <details>
      <summary>{Object.keys(record).length} field{Object.keys(record).length === 1 ? '' : 's'}</summary>
      <StructuredKeyValueList data={record} depth={depth + 1} />
    </details>
  );
}

export function StructuredKeyValueList({
  data,
  depth = 0,
}: {
  data: DataRecord | null | undefined;
  depth?: number;
}) {
  const entries = Object.entries(data ?? {});
  if (entries.length === 0) return <p style={styles.empty}>No details available.</p>;
  return (
    <dl style={styles.definitionList}>
      {entries.map(([key, value]) => (
        <React.Fragment key={key}>
          <dt style={styles.term}>{humanizeKey(key)}</dt>
          <dd style={styles.description}><StructuredValue field={key} value={value} depth={depth} /></dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

export function StructuredRecordTable({
  rows,
  columns,
  emptyMessage = 'No records returned.',
  showDetails = true,
}: {
  rows: DataRecord[];
  columns: StructuredColumn[];
  emptyMessage?: string;
  showDetails?: boolean;
}) {
  if (rows.length === 0) return <p style={styles.empty}>{emptyMessage}</p>;

  return (
    <div style={styles.tableWrap}>
      <table style={styles.table}>
        <thead>
          <tr>
            {columns.map((column) => <th key={column.key} style={styles.headerCell}>{column.label}</th>)}
            {showDetails && <th style={styles.headerCell}>Details</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const rowId = row.id ?? row.code ?? row.reference ?? row.eventKey ?? index;
            return (
              <tr key={String(rowId)}>
                {columns.map((column) => (
                  <td key={column.key} style={styles.cell}>
                    {column.render
                      ? column.render(row[column.key], row)
                      : <StructuredValue field={column.key} value={row[column.key]} />}
                  </td>
                ))}
                {showDetails && (
                  <td style={styles.cell}>
                    <details>
                      <summary>View details</summary>
                      <StructuredKeyValueList data={row} />
                    </details>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  tableWrap: { width: '100%', overflowX: 'auto', background: '#fff', border: '1px solid #E2E8F0', borderRadius: 8 },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 12 },
  headerCell: { padding: '10px 12px', background: '#F8FAFC', borderBottom: '1px solid #E2E8F0', textAlign: 'left', color: '#475569', whiteSpace: 'nowrap' },
  cell: { padding: '10px 12px', borderBottom: '1px solid #F1F5F9', verticalAlign: 'top', color: '#1E293B' },
  definitionList: { display: 'grid', gridTemplateColumns: 'minmax(120px, max-content) minmax(0, 1fr)', gap: '6px 12px', margin: '10px 0 0', fontSize: 12 },
  term: { fontWeight: 600, color: '#475569' },
  description: { margin: 0, overflowWrap: 'anywhere', color: '#1E293B' },
  valueList: { margin: '6px 0 6px 18px', padding: 0 },
  empty: { padding: 16, margin: 0, color: '#64748B', fontSize: 13, background: '#F8FAFC', borderRadius: 6 },
};
