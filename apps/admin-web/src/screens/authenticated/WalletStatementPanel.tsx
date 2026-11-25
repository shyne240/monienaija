import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ApiClient } from '../../services/api-client';

/**
 * Wallet statement panel: pick a period, see exactly what the document will say, download the PDF.
 *
 * ## The preview is the same computation as the document
 *
 * The preview is not a mock-up. It is the server's own statement projection — the same ledger reads,
 * the same Lagos boundaries, the same masking — returned as JSON. If the preview and the PDF could
 * disagree, one of them would eventually be wrong in front of a customer, so they cannot: the PDF
 * route recomputes the identical projection, and both print an unsupported balance as
 * "Unavailable" rather than as zero.
 *
 * ## Kept deliberately separate from the CSV export in Transaction History
 *
 * Nothing here is shared with that feature: a different route, a different service and a different
 * failure mode. A reviewer can read this file and the export's independently.
 */

export interface StatementRow {
  postedAt: string;
  reference: string | null;
  description: string | null;
  amountMinor: string;
  direction: 'DEBIT' | 'CREDIT';
  runningMinor: string | null;
  runningLabel: string;
}

export interface StatementPreview {
  walletId: string;
  walletLabel: string;
  customerId: string;
  currency: string;
  walletStatus: string;
  periodFrom: string;
  periodTo: string;
  timeZone: string;
  balances: {
    openingMinor: string | null;
    closingMinor: string | null;
    creditsMinor: string | null;
    debitsMinor: string | null;
    currentMinor: string | null;
    openingLabel: string;
    closingLabel: string;
    creditsLabel: string;
    debitsLabel: string;
    currentLabel: string;
  };
  rows: StatementRow[];
}

/** Builds the two statement URLs from one place, so preview and download cannot diverge. */
export function statementUrls(
  customerId: string,
  walletId: string,
  from: string,
  to: string,
): { preview: string; pdf: string } {
  const customer = `/internal/customers/${encodeURIComponent(customerId)}/wallets/${encodeURIComponent(
    walletId,
  )}`;
  const params = new URLSearchParams({ from, to }).toString();
  return { preview: `${customer}/statement?${params}`, pdf: `${customer}/statement.pdf?${params}` };
}

/**
 * Lagos `YYYY-MM-DD` for a Date.
 *
 * The pickers are date-only and the server interprets them as Lagos days, so the default period is
 * computed in the same zone instead of the browser's. A default range that silently meant "the last
 * 30 days in whatever timezone this laptop is in" would produce a statement that omits or includes a
 * boundary day for reasons the operator cannot see.
 */
export function lagosDayOf(date: Date): string {
  return new Date(date.getTime() + 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** First and last day of the current Lagos month. */
export function defaultPeriod(now: Date): { from: string; to: string } {
  const today = lagosDayOf(now);
  return { from: `${today.slice(0, 7)}-01`, to: today };
}

/** Structural validation: a malformed payload renders as unavailable, never as a plausible document. */
export function validateStatementPreview(
  value: unknown,
  walletId: string,
  customerId: string,
): StatementPreview | null {
  if (!value || typeof value !== 'object') return null;
  const preview = value as StatementPreview;
  if (preview.walletId !== walletId || preview.customerId !== customerId) return null;
  if (
    typeof preview.walletLabel !== 'string' ||
    typeof preview.currency !== 'string' ||
    typeof preview.periodFrom !== 'string' ||
    typeof preview.periodTo !== 'string' ||
    !preview.balances ||
    typeof preview.balances.openingLabel !== 'string' ||
    !Array.isArray(preview.rows)
  ) {
    return null;
  }
  const balancesValid = [
    preview.balances.openingMinor,
    preview.balances.closingMinor,
    preview.balances.creditsMinor,
    preview.balances.debitsMinor,
    preview.balances.currentMinor,
  ].every((value) => value === null || typeof value === 'string');
  if (!balancesValid) return null;
  const rowsValid = preview.rows.every(
    (row) =>
      row &&
      typeof row.postedAt === 'string' &&
      typeof row.amountMinor === 'string' &&
      (row.direction === 'DEBIT' || row.direction === 'CREDIT') &&
      (row.runningMinor === null || typeof row.runningMinor === 'string'),
  );
  return rowsValid ? preview : null;
}

const formatter = new Intl.DateTimeFormat('en-NG', {
  timeZone: 'Africa/Lagos',
  dateStyle: 'medium',
  timeStyle: 'short',
});

function lagosLabel(instant: string): string {
  const at = new Date(instant);
  return Number.isFinite(at.getTime()) ? formatter.format(at) : '—';
}

export const WalletStatementPanel: React.FC<{
  customerId: string;
  walletId: string;
  currency: string;
  now?: Date;
}> = ({ customerId, walletId, currency, now }) => {
  const initial = useMemo(() => defaultPeriod(now ?? new Date()), [now]);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [preview, setPreview] = useState<StatementPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [downloadMessage, setDownloadMessage] = useState('');
  const [downloadError, setDownloadError] = useState('');
  const activeRequest = useRef(0);

  const load = useCallback(async () => {
    const request = activeRequest.current + 1;
    activeRequest.current = request;
    setLoading(true);
    setError('');
    setPreview(null);
    try {
      const urls = statementUrls(customerId, walletId, from, to);
      const value = await ApiClient.get<unknown>(urls.preview);
      if (activeRequest.current !== request) return;
      const validated = validateStatementPreview(value, walletId, customerId);
      if (!validated) {
        setError('The statement preview could not be read. No document will be produced from it.');
        return;
      }
      setPreview(validated);
    } catch (e) {
      if (activeRequest.current !== request) return;
      setError((e as Error).message || 'The statement preview is unavailable.');
    } finally {
      if (activeRequest.current === request) setLoading(false);
    }
  }, [customerId, walletId, from, to]);

  useEffect(() => {
    setPreview(null);
    setDownloadMessage('');
    setDownloadError('');
  }, [walletId, from, to]);

  const download = async () => {
    setDownloading(true);
    setDownloadError('');
    setDownloadMessage('');
    try {
      const { pdf } = statementUrls(customerId, walletId, from, to);
      const file = await ApiClient.getPdf(pdf);
      // The browser owns the save dialog; the server owns the file name.
      const url = URL.createObjectURL(file.blob);
      const anchor = window.document.createElement('a');
      anchor.href = url;
      anchor.download = file.fileName;
      anchor.rel = 'noopener noreferrer';
      anchor.style.display = 'none';
      window.document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      const pages = file.pageCount ?? null;
      setDownloadMessage(
        `Downloaded ${file.fileName}${
          pages ? ` (${pages} ${pages === 1 ? 'page' : 'pages'})` : ''
        }. The statement covers posted activity only.`,
      );
    } catch (e) {
      setDownloadError(
        (e as Error).message ||
          'The statement could not be generated. No document was produced. Try again or shorten the period.',
      );
    } finally {
      setDownloading(false);
    }
  };

  const rows = preview?.rows ?? [];
  const debitTotal = rows.filter((row) => row.direction === 'DEBIT').length;
  const creditTotal = rows.length - debitTotal;

  return (
    <section className="cm-statement" aria-labelledby="cm-statement-title">
      <div className="cm-statement__heading">
        <div>
          <p className="cm-eyebrow">STATEMENT</p>
          <h3 id="cm-statement-title">Printable wallet statement</h3>
          <p className="cm-statement__hint">
            A branded PDF of this wallet&rsquo;s posted activity for the selected period, with
            opening, closing and running balances from the ledger. Days are Africa/Lagos days.
          </p>
        </div>
      </div>

      <div className="cm-statement__controls">
        <label htmlFor="cm-statement-from">
          From (Lagos)
          <input
            id="cm-statement-from"
            type="date"
            value={from}
            max={to}
            onChange={(event) => setFrom(event.target.value)}
          />
        </label>
        <label htmlFor="cm-statement-to">
          To (Lagos)
          <input
            id="cm-statement-to"
            type="date"
            value={to}
            min={from}
            onChange={(event) => setTo(event.target.value)}
          />
        </label>
        <button
          type="button"
          className="cm-button cm-button-secondary cm-statement__preview"
          onClick={load}
          disabled={loading || !from || !to}
        >
          {loading ? 'Reading ledger…' : 'Preview statement'}
        </button>
        <button
          type="button"
          className="cm-button cm-statement__download"
          onClick={download}
          disabled={downloading || !from || !to}
        >
          {downloading ? 'Generating PDF…' : 'Download PDF'}
        </button>
      </div>

      {error && (
        <p className="cm-statement__error" role="alert">
          {error}
        </p>
      )}
      {downloadError && (
        <p className="cm-statement__error" role="alert">
          {downloadError}
        </p>
      )}
      {downloadMessage && (
        <p className="cm-statement__status" role="status">
          {downloadMessage}
        </p>
      )}

      {preview && (
        <div className="cm-statement__preview-body">
          <dl className="cm-statement__balances">
            <div>
              <dt>Opening balance</dt>
              <dd data-unavailable={preview.balances.openingMinor === null}>
                {preview.balances.openingLabel}
              </dd>
            </div>
            <div>
              <dt>Money in</dt>
              <dd data-unavailable={preview.balances.creditsMinor === null}>
                {preview.balances.creditsLabel}
              </dd>
            </div>
            <div>
              <dt>Money out</dt>
              <dd data-unavailable={preview.balances.debitsMinor === null}>
                {preview.balances.debitsLabel}
              </dd>
            </div>
            <div>
              <dt>Closing balance</dt>
              <dd data-unavailable={preview.balances.closingMinor === null}>
                {preview.balances.closingLabel}
              </dd>
            </div>
          </dl>
          <p className="cm-statement__note">
            Ledger-derived balance at generation: {preview.balances.currentLabel}. {rows.length}{' '}
            {rows.length === 1 ? 'entry' : 'entries'} in {preview.periodFrom} to {preview.periodTo}{' '}
            ({debitTotal} out, {creditTotal} in).
          </p>
          {rows.length === 0 ? (
            <p className="cm-empty-state">No posted wallet activity in this period.</p>
          ) : (
            <div className="cm-statement__table-wrap">
              <table className="cm-statement__table">
                <caption className="cm-visually-hidden">
                  Posted wallet activity for {preview.periodFrom} to {preview.periodTo}
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Date (Lagos)</th>
                    <th scope="col">Reference</th>
                    <th scope="col">Description</th>
                    <th scope="col" className="cm-statement__amount">
                      Debit
                    </th>
                    <th scope="col" className="cm-statement__amount">
                      Credit
                    </th>
                    <th scope="col" className="cm-statement__amount">
                      Balance
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, index) => (
                    <tr key={`${row.postedAt}-${row.reference ?? index}-${index}`}>
                      <td>{lagosLabel(row.postedAt)}</td>
                      <td>{row.reference ?? '—'}</td>
                      <td className="cm-statement__description">{row.description ?? '—'}</td>
                      <td className="cm-statement__amount">
                        {row.direction === 'DEBIT' ? formatCell(row.amountMinor, currency) : ''}
                      </td>
                      <td className="cm-statement__amount">
                        {row.direction === 'CREDIT' ? formatCell(row.amountMinor, currency) : ''}
                      </td>
                      <td
                        className="cm-statement__amount"
                        data-unavailable={row.runningMinor === null}
                      >
                        {row.runningLabel}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
};

/** Integer-string money rendering for the preview; never `Number(minor) / 100`. */
export function formatCell(minor: string, currency: string): string {
  if (!/^\d+$/.test(minor)) return '—';
  const digits = minor.padStart(3, '0');
  const whole = digits.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${currency} ${whole}.${digits.slice(-2)}`;
}
