import './operational-surfaces.css';
import './reconciliation-workspace.css';
import './platform-funds.css';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PageHeader } from '../../design-system/primitives';
import { useAuthStore } from '../../store/auth-store';
import { formatFinancialAmount, formatMinorUnits } from '../../utils/financial-display';
import {
  PlatformFundsApi,
  type PlatformFundsBlocker,
  type PlatformFundsBreakdown,
  type PlatformFundsComparisonDetail,
  type PlatformFundsComparisonSummary,
  type PlatformFundsScope,
  type PlatformFundsScopeView,
  type PlatformFundsStatus,
  type PlatformFundsSettlementAccountOption,
  type PlatformFundsSnapshotItem,
} from '../../services/platform-funds-api';

const MINOR_UNITS = /^-?\d{1,19}$/;

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** Deterministic, locale-independent rendering of a server ISO timestamp (UTC). */
const fmtUtc = (iso: string): string => {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(iso);
  return match ? `${match[1]} ${match[2]}:${match[3]} UTC` : iso;
};

const toLocalInput = (date: Date): string => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const signedFinancialAmount = (value: string, currency: string): string => {
  if (!MINOR_UNITS.test(value)) return value;
  const formatted = formatFinancialAmount(value.replace(/^\+/, ''), currency);
  return value.startsWith('-') || value === '0' ? formatted : `+${formatted}`;
};

const StatusChip: React.FC<{ status: PlatformFundsStatus }> = ({ status }) => (
  <span className={`mn-platform-funds__chip mn-platform-funds__chip--${status.toLowerCase()}`}>
    {status}
  </span>
);

const ScopeChip: React.FC<{ scope: PlatformFundsScope }> = ({ scope }) => (
  <span className="mn-platform-funds__chip mn-platform-funds__chip--draft">
    {scope === 'PLATFORM' ? 'PLATFORM BANK' : 'INSTITUTION'}
  </span>
);

const BlockerList: React.FC<{ blockers: PlatformFundsBlocker[] }> = ({ blockers }) => (
  <div className="mn-platform-funds__blockers" role="alert">
    <strong>Sign-off is blocked — the mapping must be resolved first.</strong>
    {blockers.map((blocker, index) => (
      <div className="mn-platform-funds__blocker-item" key={`${blocker.code}-${index}`}>
        <div>
          <code>{blocker.code}</code>
          {blocker.accountCode ? (
            <>
              {' '}
              · account <code>{blocker.accountCode}</code>
            </>
          ) : null}
        </div>
        <div>{blocker.message}</div>
        <div>
          <strong>What Finance must do:</strong> {blocker.needed}
        </div>
      </div>
    ))}
  </div>
);

const BreakdownTable: React.FC<{ breakdown: PlatformFundsBreakdown }> = ({ breakdown }) => {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const ccy = breakdown.currency;
  const gap = breakdown.reconciliationGapMinor;
  const gapOk = gap === '0';

  // Sub-line grouping inside OTHER_HELD (and any other bucket) for readability.
  const renderAccounts = (lineKey: string, accounts: PlatformFundsBreakdown['lines'][number]['accounts']) => {
    const bySubLine = new Map<string, typeof accounts>();
    for (const account of accounts) {
      const group = bySubLine.get(account.subLine) ?? [];
      group.push(account);
      bySubLine.set(account.subLine, group);
    }
    return (
      <div style={{ padding: '4px 8px 12px' }}>
        {[...bySubLine.entries()].map(([subLine, rows]) => (
          <div key={`${lineKey}-${subLine}`}>
            <div className="mn-platform-funds__tile-label" style={{ margin: '8px 0 4px' }}>
              {subLine.replace(/_/g, ' ')}
            </div>
            <table className="mn-platform-funds__table">
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Ledger balance</th>
                  <th className="num">Contribution</th>
                  <th className="num">Lines</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((account) => (
                  <tr key={account.accountId}>
                    <td>
                      <div>
                        <code>{account.code}</code>
                      </div>
                      <div style={{ fontSize: 11, opacity: 0.8 }}>{account.name}</div>
                    </td>
                    <td>
                      {formatFinancialAmount(account.balanceMinor, ccy)}
                      <div style={{ fontSize: 11, opacity: 0.7 }}>
                        D {account.debitMinor} / C {account.creditMinor} · {account.lineCount}{' '}
                        {account.lineCount === 1 ? 'line' : 'lines'}
                      </div>
                    </td>
                    <td className="num">{formatFinancialAmount(account.contributionMinor, ccy)}</td>
                    <td className="num">{account.lineCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div>
      <table className="mn-platform-funds__table">
        <thead>
          <tr>
            <th>Ledger bucket</th>
            <th className="num">Accounts</th>
            <th className="num">Contribution to expected bank</th>
          </tr>
        </thead>
        <tbody>
          {breakdown.lines.map((line) => (
            <React.Fragment key={line.key}>
              <tr>
                <td>
                  <button
                    type="button"
                    onClick={() => toggle(line.key)}
                    aria-expanded={open.has(line.key)}
                    style={{
                      background: 'none',
                      border: 'none',
                      padding: 0,
                      font: 'inherit',
                      fontWeight: 600,
                      color: 'var(--mn-accent, #0b6e4f)',
                      cursor: 'pointer',
                      textAlign: 'left',
                    }}
                  >
                    {open.has(line.key) ? '▾ ' : '▸ '}
                    {line.label}
                  </button>
                  <div style={{ fontSize: 11, opacity: 0.75, marginTop: 2 }}>{line.note}</div>
                </td>
                <td className="num">{line.accounts.length}</td>
                <td className="num">{formatFinancialAmount(line.contributionMinor, ccy)}</td>
              </tr>
              {open.has(line.key) ? (
                <tr>
                  <td colSpan={3}>{renderAccounts(line.key, line.accounts)}</td>
                </tr>
              ) : null}
            </React.Fragment>
          ))}
          <tr>
            <td>
              <strong>{breakdown.controlLine.label}</strong>
              <div style={{ fontSize: 11, opacity: 0.75 }}>
                {breakdown.controlLine.accountCount} account(s) ·{' '}
                {breakdown.controlLine.ok ? 'nets to zero — books conserved' : 'NON-ZERO — books broken'}
              </div>
            </td>
            <td className="num">{breakdown.controlLine.accountCount}</td>
            <td className="num">{formatFinancialAmount(breakdown.controlLine.netMinor, ccy)}</td>
          </tr>
          <tr>
            <td>
              <strong>Breakdown total (Σ every bucket)</strong>
            </td>
            <td className="num" />
            <td className="num">
              <strong>{formatFinancialAmount(breakdown.breakdownTotalMinor, ccy)}</strong>
            </td>
          </tr>
          <tr>
            <td>
              <strong>Ledger expected balance (settlement account)</strong>
              <div style={{ fontSize: 11, opacity: 0.75 }}>
                {breakdown.settlementAccount.code} · debits {breakdown.settlementAccount.debitMinor} −
                credits {breakdown.settlementAccount.creditMinor}
              </div>
            </td>
            <td className="num" />
            <td className="num">
              <strong>{formatFinancialAmount(breakdown.settlementAccount.expectedMinor, ccy)}</strong>
            </td>
          </tr>
          <tr>
            <td>
              <strong>Conservation gap (breakdown − expected)</strong>
            </td>
            <td className="num" />
            <td className="num" style={{ color: gapOk ? undefined : '#b3261e', fontWeight: 700 }}>
              {formatFinancialAmount(gap, ccy)}
            </td>
          </tr>
        </tbody>
      </table>
      <div style={{ fontSize: 11, marginTop: 10, opacity: 0.85, lineHeight: 1.5 }}>
        <div>
          Journals considered (posted ≤ cutoff): {breakdown.journalEvidence.journalsConsidered} · lines:{' '}
          {breakdown.journalEvidence.linesConsidered} · latest posted:{' '}
          {breakdown.journalEvidence.maxPostedAt ? fmtUtc(breakdown.journalEvidence.maxPostedAt) : '—'}
        </div>
        <div>
          Ledger conservation (Σ debits = Σ credits):{' '}
          <strong>
            {breakdown.journalEvidence.conserved
              ? `YES (${breakdown.journalEvidence.totalDebitsMinor} in)`
              : 'NO — the books do not balance; escalate before sign-off'}
          </strong>
        </div>
        <div>
          Evidence hash (sha256):{' '}
          <span className="mn-platform-funds__mono">{breakdown.evidenceHash}</span>
        </div>
        {breakdown.notes.length > 0 ? (
          <ul style={{ margin: '6px 0 0 18px', padding: 0 }}>
            {breakdown.notes.map((note, index) => (
              <li key={index}>{note}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
};

const MoneyTile: React.FC<{
  label: string;
  value: string;
  currency: string;
  sub: React.ReactNode;
  alert?: boolean;
  signed?: boolean;
}> = ({ label, value, currency, sub, alert, signed }) => (
  <div
    className={`mn-platform-funds__tile${alert ? ' mn-platform-funds__tile--alert' : ''}`}
  >
    <div className="mn-platform-funds__tile-label">{label}</div>
    <div className="mn-platform-funds__tile-value">
      {signed ? signedFinancialAmount(value, currency) : formatFinancialAmount(value, currency)}
    </div>
    <div className="mn-platform-funds__tile-sub">{sub}</div>
  </div>
);

interface CreateFormState {
  settlementAccountId: string;
  ledgerCutoff: string;
  bankCutoff: string;
  statementReference: string;
  bankBalanceMinor: string;
}

const emptyCreateForm = (): CreateFormState => ({
  settlementAccountId: '',
  ledgerCutoff: toLocalInput(new Date()),
  bankCutoff: toLocalInput(new Date()),
  statementReference: '',
  bankBalanceMinor: '',
});

export const PlatformFundsScreen: React.FC = () => {
  const { principal } = useAuthStore();
  const roles = useMemo(() => principal?.roles ?? [], [principal]);
  const canRecord = roles.includes('FINANCE_PREPARER');
  const canReviewRole = roles.includes('FINANCE_CONTROLLER');

  const [scopeView, setScopeView] = useState<PlatformFundsScopeView | null>(null);
  const [scopeError, setScopeError] = useState('');
  const [accounts, setAccounts] = useState<PlatformFundsSettlementAccountOption[] | null>(null);
  const [accountsError, setAccountsError] = useState('');

  const [listScope, setListScope] = useState<'' | PlatformFundsScope>('');
  const [listStatus, setListStatus] = useState<'' | PlatformFundsStatus>('');
  const [items, setItems] = useState<PlatformFundsComparisonSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState('');

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<PlatformFundsComparisonDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');

  const [mode, setMode] = useState<'detail' | 'create'>('detail');
  const [createForm, setCreateForm] = useState<CreateFormState>(emptyCreateForm);
  const [createError, setCreateError] = useState('');
  const [createBusy, setCreateBusy] = useState(false);
  const [preview, setPreview] = useState<PlatformFundsBreakdown | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewError, setPreviewError] = useState('');

  const refreshList = useCallback(async () => {
    setListLoading(true);
    setListError('');
    try {
      const response = await PlatformFundsApi.list({
        scope: listScope || undefined,
        status: listStatus || undefined,
        limit: 25,
        offset: 0,
      });
      setItems(Array.isArray(response?.items) ? response.items : []);
      setTotal(typeof response?.total === 'number' ? response.total : 0);
    } catch (error) {
      setListError(errorMessage(error));
    } finally {
      setListLoading(false);
    }
  }, [listScope, listStatus]);

  useEffect(() => {
    let cancelled = false;
    PlatformFundsApi.scope()
      .then((scope) => {
        if (!cancelled)
          setScopeView(
            scope && typeof scope === 'object' && 'mode' in scope
              ? scope
              : { mode: 'NONE', institutionIds: [], platformFunctionGranted: false },
          );
      })
      .catch((error) => {
        if (!cancelled) setScopeError(errorMessage(error));
      });
    PlatformFundsApi.settlementAccounts()
      .then((response) => {
        if (!cancelled) setAccounts(Array.isArray(response?.items) ? response.items : []);
      })
      .catch((error) => {
        if (!cancelled) setAccountsError(errorMessage(error));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    void refreshList();
  }, [refreshList]);

  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    setDetailError('');
    try {
      const response = await PlatformFundsApi.detail(id);
      setDetail(response);
    } catch (error) {
      setDetailError(errorMessage(error));
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const select = useCallback(
    (id: string) => {
      setSelectedId(id);
      setMode('detail');
      void loadDetail(id);
    },
    [loadDetail],
  );

  const applyDetail = useCallback((next: PlatformFundsComparisonDetail) => {
    setDetail(next);
    setSelectedId(next.id);
    void refreshList();
  }, [refreshList]);

  const selectedAccount = useMemo(
    () => accounts?.find((account) => account.id === createForm.settlementAccountId) ?? null,
    [accounts, createForm.settlementAccountId],
  );

  const platformAccounts = useMemo(
    () => (accounts ?? []).filter((a) => a.scope !== 'INSTITUTION'),
    [accounts],
  );
  const institutionAccounts = useMemo(
    () => (accounts ?? []).filter((a) => a.scope === 'INSTITUTION'),
    [accounts],
  );

  const bankBalanceValid = MINOR_UNITS.test(createForm.bankBalanceMinor.trim());

  const runPreview = async () => {
    setPreviewBusy(true);
    setPreviewError('');
    setPreview(null);
    try {
      const ledgerCutoff = new Date(createForm.ledgerCutoff);
      if (Number.isNaN(ledgerCutoff.getTime())) throw new Error('Ledger cutoff is not a valid date');
      const response = await PlatformFundsApi.preview({
        settlementAccountId: createForm.settlementAccountId,
        ledgerCutoff: ledgerCutoff.toISOString(),
      });
      setPreview(response);
    } catch (error) {
      setPreviewError(errorMessage(error));
    } finally {
      setPreviewBusy(false);
    }
  };

  const createComparison = async () => {
    setCreateBusy(true);
    setCreateError('');
    try {
      const ledgerCutoff = new Date(createForm.ledgerCutoff);
      const bankCutoff = new Date(createForm.bankCutoff);
      if (Number.isNaN(ledgerCutoff.getTime())) throw new Error('Ledger cutoff is not a valid date');
      if (Number.isNaN(bankCutoff.getTime())) throw new Error('Bank cutoff is not a valid date');
      const response = await PlatformFundsApi.create({
        settlementAccountId: createForm.settlementAccountId,
        ledgerCutoff: ledgerCutoff.toISOString(),
        bankCutoff: bankCutoff.toISOString(),
        statementReference: createForm.statementReference.trim(),
        bankBalanceMinor: createForm.bankBalanceMinor.trim(),
      });
      applyDetail(response);
      setMode('detail');
      setCreateForm(emptyCreateForm());
      setPreview(null);
    } catch (error) {
      setCreateError(errorMessage(error));
    } finally {
      setCreateBusy(false);
    }
  };

  // ---------------------------------------------------------- detail state
  const [editLedgerCutoff, setEditLedgerCutoff] = useState('');
  const [editBankCutoff, setEditBankCutoff] = useState('');
  const [editStatementReference, setEditStatementReference] = useState('');
  const [editBankBalance, setEditBankBalance] = useState('');
  const [actionError, setActionError] = useState('');
  const [actionNote, setActionNote] = useState('');
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const [timingTitle, setTimingTitle] = useState('');
  const [timingReference, setTimingReference] = useState('');
  const [timingExplanation, setTimingExplanation] = useState('');
  const [timingAmount, setTimingAmount] = useState('');

  const [submitReason, setSubmitReason] = useState('');
  const [reviewReason, setReviewReason] = useState('');
  const [showSnapshots, setShowSnapshots] = useState(false);
  const [snapshots, setSnapshots] = useState<PlatformFundsSnapshotItem[] | null>(null);
  const [snapshotsError, setSnapshotsError] = useState('');
  const [snapshotsLoading, setSnapshotsLoading] = useState(false);

  const detailId = detail?.id ?? null;
  useEffect(() => {
    setActionError('');
    setActionNote('');
    setSubmitReason('');
    setReviewReason('');
    setShowSnapshots(false);
    setSnapshots(null);
    setSnapshotsError('');
    setTimingTitle('');
    setTimingReference('');
    setTimingExplanation('');
    setTimingAmount('');
    if (detail) {
      setEditLedgerCutoff(toLocalInput(new Date(detail.ledgerCutoff)));
      setEditBankCutoff(toLocalInput(new Date(detail.bankCutoff)));
      setEditStatementReference(detail.statementReference);
      setEditBankBalance(detail.bankBalanceMinor);
    }
    // Re-seed only when another comparison is opened, not on every server refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailId]);

  const runAction = useCallback(
    async (name: string, action: () => Promise<PlatformFundsComparisonDetail>, successNote: string) => {
      setBusyAction(name);
      setActionError('');
      setActionNote('');
      try {
        const next = await action();
        applyDetail(next);
        if (name === 'submit') setSubmitReason('');
        if (name === 'approve' || name === 'reject') setReviewReason('');
        if (name === 'add-timing') {
          setTimingTitle('');
          setTimingReference('');
          setTimingExplanation('');
          setTimingAmount('');
        }
        setActionNote(successNote);
      } catch (error) {
        setActionError(errorMessage(error));
      } finally {
        setBusyAction(null);
      }
    },
    [applyDetail],
  );

  const saveEdits = () =>
    detail &&
    runAction(
      'save',
      () => {
        const ledgerCutoff = new Date(editLedgerCutoff);
        const bankCutoff = new Date(editBankCutoff);
        if (Number.isNaN(ledgerCutoff.getTime())) throw new Error('Ledger cutoff is not a valid date');
        if (Number.isNaN(bankCutoff.getTime())) throw new Error('Bank cutoff is not a valid date');
        return PlatformFundsApi.update(detail.id, {
          ledgerCutoff: ledgerCutoff.toISOString(),
          bankCutoff: bankCutoff.toISOString(),
          statementReference: editStatementReference.trim(),
          bankBalanceMinor: editBankBalance.trim(),
        });
      },
      'Comparison updated. Evidence re-generated.',
    );

  const addTiming = () =>
    detail &&
    runAction(
      'add-timing',
      () =>
        PlatformFundsApi.addTimingItem(detail.id, {
          title: timingTitle.trim(),
          reference: timingReference.trim(),
          explanation: timingExplanation.trim(),
          amountMinor: timingAmount.trim(),
        }),
      'Timing item recorded.',
    );

  const removeTiming = (itemId: string) =>
    detail &&
    runAction(
      `remove-timing-${itemId}`,
      () => PlatformFundsApi.removeTimingItem(detail.id, itemId),
      'Timing item removed.',
    );

  const submitForReview = () =>
    detail &&
    runAction(
      'submit',
      () => PlatformFundsApi.submit(detail.id, { reason: submitReason.trim() }),
      'Submitted for independent review.',
    );

  const decide = (decision: 'APPROVE' | 'REJECT') =>
    detail &&
    runAction(
      decision === 'APPROVE' ? 'approve' : 'reject',
      () => PlatformFundsApi.review(detail.id, { decision, reason: reviewReason.trim() }),
      decision === 'APPROVE' ? 'Comparison signed off.' : 'Comparison rejected.',
    );

  const loadSnapshots = async () => {
    if (!detail) return;
    setSnapshotsLoading(true);
    setSnapshotsError('');
    try {
      const response = await PlatformFundsApi.snapshots(detail.id);
      setSnapshots(response.items);
    } catch (error) {
      setSnapshotsError(errorMessage(error));
    } finally {
      setSnapshotsLoading(false);
    }
  };

  const toggleSnapshots = () => {
    const next = !showSnapshots;
    setShowSnapshots(next);
    if (next && snapshots === null) void loadSnapshots();
  };

  // ---------------------------------------------------------------- render
  const listPane = (
    <section className="mn-platform-funds__panel" aria-label="Comparisons">
      <div
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}
      >
        <h2 style={{ margin: 0, fontSize: 16 }}>Comparisons</h2>
        {canRecord ? (
          <button
            type="button"
            className="mn-platform-funds__btn"
            onClick={() => {
              setMode('create');
              setCreateError('');
              setPreviewError('');
            }}
          >
            New comparison
          </button>
        ) : null}
      </div>

      <div style={{ display: 'flex', gap: 8, margin: '10px 0' }}>
        <select
          className="mn-platform-funds__select"
          value={listScope}
          aria-label="Filter by scope"
          onChange={(event) => setListScope(event.target.value as '' | PlatformFundsScope)}
        >
          <option value="">All scopes</option>
          <option value="PLATFORM">Platform bank</option>
          <option value="INSTITUTION">Institution</option>
        </select>
        <select
          className="mn-platform-funds__select"
          value={listStatus}
          aria-label="Filter by status"
          onChange={(event) => setListStatus(event.target.value as '' | PlatformFundsStatus)}
        >
          <option value="">All statuses</option>
          <option value="DRAFT">Draft</option>
          <option value="SUBMITTED">Submitted</option>
          <option value="APPROVED">Approved</option>
          <option value="REJECTED">Rejected</option>
        </select>
      </div>

      {scopeError ? <div className="mn-platform-funds__error">{scopeError}</div> : null}
      {listError ? <div className="mn-platform-funds__error">{listError}</div> : null}
      {scopeView?.mode === 'NONE' ? (
        <p style={{ fontSize: 13 }}>
          No platform-funds authority is assigned to your workforce session. Platform comparisons
          require the platform function; institution comparisons require an active assignment to the
          institution.
        </p>
      ) : null}
      {listLoading ? <p style={{ fontSize: 13 }}>Loading comparisons…</p> : null}
      {!listLoading && items.length === 0 ? (
        <p style={{ fontSize: 13, opacity: 0.8 }}>
          No comparisons yet. {canRecord ? 'Record one to get started.' : ''}
        </p>
      ) : null}
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          className="mn-platform-funds__list-item"
          data-selected={selectedId === item.id}
          onClick={() => select(item.id)}
        >
          <div
            style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}
          >
            <strong>
              <code>{item.settlementAccountCode}</code>
            </strong>
            <StatusChip status={item.status} />
          </div>
          <div style={{ fontSize: 12, marginTop: 4 }}>{item.statementReference}</div>
          <div
            style={{
              fontSize: 11,
              marginTop: 4,
              display: 'flex',
              justifyContent: 'space-between',
              gap: 8,
              opacity: 0.85,
            }}
          >
            <span>
              Difference{' '}
              <strong>{signedFinancialAmount(item.differenceMinor, item.currency)}</strong>
            </span>
            <span>{fmtUtc(item.createdAt)}</span>
          </div>
        </button>
      ))}
      <div style={{ fontSize: 11, opacity: 0.7, marginTop: 8 }}>{total} total</div>
    </section>
  );

  const bankBalancePreview = MINOR_UNITS.test(createForm.bankBalanceMinor.trim())
    ? formatFinancialAmount(createForm.bankBalanceMinor.trim(), selectedAccount?.currency ?? 'NGN')
    : null;

  const createPane = (
    <section className="mn-platform-funds__panel" aria-label="New comparison">
      <h2 style={{ marginTop: 0, fontSize: 16 }}>New comparison</h2>
      <p style={{ fontSize: 13, marginTop: 0 }}>
        Select the bank or settlement account to compare. The ledger computes the expected holding
        from posted journals as of your cutoff; the bank balance is the one you verified
        independently — it is entered here, never fetched from a third-party bank API.
      </p>

      {accountsError ? <div className="mn-platform-funds__error">{accountsError}</div> : null}
      {createError ? <div className="mn-platform-funds__error">{createError}</div> : null}

      <div className="mn-platform-funds__form-row">
        <label htmlFor="pf-account">Bank / settlement account</label>
        <select
          id="pf-account"
          className="mn-platform-funds__select"
          value={createForm.settlementAccountId}
          onChange={(event) => {
            setCreateForm((form) => ({ ...form, settlementAccountId: event.target.value }));
            setPreview(null);
          }}
        >
          <option value="">Select an account…</option>
          {platformAccounts.length > 0 ? (
            <optgroup label="Platform bank accounts">
              {platformAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.code} — {account.name} ({account.currency})
                </option>
              ))}
            </optgroup>
          ) : null}
          {institutionAccounts.length > 0 ? (
            <optgroup label="Institution settlement accounts">
              {institutionAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.code} — {account.name}
                  {account.institutionCode ? ` (${account.institutionCode})` : ''} ({account.currency})
                </option>
              ))}
            </optgroup>
          ) : null}
        </select>
        {selectedAccount ? (
          <small>
            Currency: <strong>{selectedAccount.currency}</strong> · accounting unit CUSTOMER_FUNDS ·{' '}
            {selectedAccount.scope === 'INSTITUTION'
              ? `institution ${selectedAccount.institutionCode ?? selectedAccount.institutionId}`
              : 'platform bank'}
          </small>
        ) : null}
      </div>

      <div className="mn-platform-funds__form-row">
        <label htmlFor="pf-ledger-cutoff">Ledger reporting cutoff</label>
        <input
          id="pf-ledger-cutoff"
          type="datetime-local"
          className="mn-platform-funds__input"
          value={createForm.ledgerCutoff}
          onChange={(event) => {
            setCreateForm((form) => ({ ...form, ledgerCutoff: event.target.value }));
            setPreview(null);
          }}
        />
        <small>Posted journals at or before this instant are in scope for the ledger side.</small>
      </div>

      <div className="mn-platform-funds__form-row">
        <label htmlFor="pf-bank-cutoff">Bank statement cutoff</label>
        <input
          id="pf-bank-cutoff"
          type="datetime-local"
          className="mn-platform-funds__input"
          value={createForm.bankCutoff}
          onChange={(event) => setCreateForm((form) => ({ ...form, bankCutoff: event.target.value }))}
        />
        <small>The cutoff the independently verified bank statement is made up to.</small>
      </div>

      <div className="mn-platform-funds__form-row">
        <label htmlFor="pf-statement-ref">Statement reference</label>
        <input
          id="pf-statement-ref"
          className="mn-platform-funds__input"
          placeholder="e.g. ZENITH-STMT-2026-11-24-0842"
          value={createForm.statementReference}
          onChange={(event) => setCreateForm((form) => ({ ...form, statementReference: event.target.value }))}
        />
      </div>

      <div className="mn-platform-funds__form-row">
        <label htmlFor="pf-bank-balance">Verified bank balance (minor units)</label>
        <input
          id="pf-bank-balance"
          className="mn-platform-funds__input"
          inputMode="numeric"
          placeholder="e.g. 245000000 (kobo)"
          value={createForm.bankBalanceMinor}
          onChange={(event) => setCreateForm((form) => ({ ...form, bankBalanceMinor: event.target.value }))}
        />
        <small>
          {bankBalancePreview
            ? `${bankBalancePreview} · `
            : MINOR_UNITS.test(createForm.bankBalanceMinor.trim())
              ? ''
              : 'Enter a signed integer in minor units. '}
          {bankBalanceValid ? 'Integer accepted.' : 'Signed integer string, e.g. 245000000 or -5000.'}
        </small>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          type="button"
          className="mn-platform-funds__btn mn-platform-funds__btn--secondary"
          disabled={!createForm.settlementAccountId || previewBusy}
          onClick={() => void runPreview()}
        >
          {previewBusy ? 'Computing ledger evidence…' : 'Preview ledger evidence'}
        </button>
        <button
          type="button"
          className="mn-platform-funds__btn"
          disabled={
            !createForm.settlementAccountId ||
            !bankBalanceValid ||
            createForm.statementReference.trim().length < 3 ||
            createBusy
          }
          onClick={() => void createComparison()}
        >
          {createBusy ? 'Creating…' : 'Create comparison'}
        </button>
        <button
          type="button"
          className="mn-platform-funds__btn mn-platform-funds__btn--secondary"
          onClick={() => setMode('detail')}
        >
          Cancel
        </button>
      </div>

      {previewError ? <div className="mn-platform-funds__error">{previewError}</div> : null}
      {preview ? (
        <div style={{ marginTop: 12 }}>
          <div className="mn-platform-funds__tile-label">Preview — nothing has been saved</div>
          <div className="mn-platform-funds__tiles" style={{ marginTop: 8 }}>
            <MoneyTile
              label="Expected (ledger)"
              value={preview.settlementAccount.expectedMinor}
              currency={preview.currency}
              sub={`As of ${fmtUtc(preview.ledgerCutoff)} · ${preview.accountingUnit}`}
            />
            <MoneyTile
              label="Breakdown total"
              value={preview.breakdownTotalMinor}
              currency={preview.currency}
              sub="Σ every bucket (conservation-must-hold)"
            />
            <MoneyTile
              label="Gap"
              value={preview.reconciliationGapMinor}
              currency={preview.currency}
              signed
              alert={preview.reconciliationGapMinor !== '0'}
              sub="Must be exactly zero to complete the mapping"
            />
          </div>
          {preview.mappingComplete ? (
            <div className="mn-platform-funds__success">Mapping complete — sign-off is possible.</div>
          ) : (
            <BlockerList blockers={preview.blockers} />
          )}
        </div>
      ) : null}
    </section>
  );

  const isDraft = detail?.status === 'DRAFT';
  const editBankBalanceValid = detail ? MINOR_UNITS.test(editBankBalance.trim()) : false;

  const detailPane = detail ? (
    <section className="mn-platform-funds__panel" aria-label="Comparison detail">
      <div
        style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}
      >
        <div>
          <h2 style={{ margin: 0, fontSize: 16 }}>
            <code>{detail.settlementAccountCode}</code> — {detail.settlementAccountName}
          </h2>
          <div style={{ fontSize: 12, opacity: 0.8, marginTop: 4 }}>
            Statement <strong>{detail.statementReference}</strong> · recorded by {detail.createdBy} ·{' '}
            {fmtUtc(detail.createdAt)}
          </div>
          <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <StatusChip status={detail.status} />
            <ScopeChip scope={detail.scope} />
            {detail.mappingComplete ? (
              <span className="mn-platform-funds__chip mn-platform-funds__chip--approved">
                MAPPING COMPLETE
              </span>
            ) : (
              <span className="mn-platform-funds__chip mn-platform-funds__chip--rejected">
                MAPPING BLOCKED
              </span>
            )}
          </div>
        </div>
      </div>

      {actionError ? <div className="mn-platform-funds__error">{actionError}</div> : null}
      {actionNote ? <div className="mn-platform-funds__success">{actionNote}</div> : null}

      <div className="mn-platform-funds__tiles">
        <MoneyTile
          label="Expected (ledger)"
          value={detail.expectedMinor}
          currency={detail.currency}
          sub={
            <>
              As of cutoff {fmtUtc(detail.ledgerCutoff)} · {detail.currency} ·{' '}
              {detail.accountingUnit}
            </>
          }
        />
        <MoneyTile
          label="Bank (staff-entered)"
          value={detail.bankBalanceMinor}
          currency={detail.currency}
          sub={
            <>
              Statement {detail.statementReference} · cutoff {fmtUtc(detail.bankCutoff)} · verified
              independently (no bank API)
            </>
          }
        />
        <MoneyTile
          label="Difference"
          value={detail.differenceMinor}
          currency={detail.currency}
          signed
          sub="Bank − expected. Positive: bank holds more than the ledger expects."
        />
        <MoneyTile
          label="Unexplained difference"
          value={detail.unexplainedMinor}
          currency={detail.currency}
          signed
          alert={detail.unexplainedMinor !== '0'}
          sub={`After ${detail.timingTotalMinor === '0' ? 'no' : formatFinancialAmount(detail.timingTotalMinor, detail.currency)} of recorded timing items.`}
        />
      </div>

      {!detail.breakdown.mappingComplete ? <BlockerList blockers={detail.blockers} /> : null}

      <h3 style={{ fontSize: 14, marginBottom: 4 }}>Where the expected balance comes from</h3>
      <BreakdownTable breakdown={detail.breakdown} />

      <h3 style={{ fontSize: 14, margin: '16px 0 4px' }}>Timing items (recorded by Finance)</h3>
      <p style={{ fontSize: 12, marginTop: 0, opacity: 0.85 }}>
        Positive amounts explain why the bank holds MORE than the ledger expects (deposits in
        transit). Negative amounts explain why it holds LESS (charges not yet posted). The
        remaining unexplained difference stays visible above and is never netted away silently.
      </p>
      {detail.timingItems.length === 0 ? (
        <p style={{ fontSize: 13, opacity: 0.8 }}>No timing items recorded.</p>
      ) : (
        <table className="mn-platform-funds__table">
          <thead>
            <tr>
              <th>Item</th>
              <th>Reference</th>
              <th className="num">Amount</th>
              <th>Explanation</th>
              {isDraft ? <th /> : null}
            </tr>
          </thead>
          <tbody>
            {detail.timingItems.map((item) => (
              <tr key={item.id}>
                <td>{item.title}</td>
                <td>
                  <code>{item.reference}</code>
                </td>
                <td className="num">{signedFinancialAmount(item.amountMinor, detail.currency)}</td>
                <td style={{ maxWidth: 320 }}>{item.explanation}</td>
                {isDraft ? (
                  <td className="num">
                    <button
                      type="button"
                      className="mn-platform-funds__btn mn-platform-funds__btn--secondary"
                      style={{ padding: '4px 8px', fontSize: 11 }}
                      disabled={busyAction === `remove-timing-${item.id}`}
                      onClick={() => void removeTiming(item.id)}
                    >
                      Remove
                    </button>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {isDraft ? (
        <div style={{ marginTop: 10 }}>
          <div className="mn-platform-funds__tile-label" style={{ marginBottom: 6 }}>
            Record a timing item
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
              gap: 8,
            }}
          >
            <input
              className="mn-platform-funds__input"
              placeholder="Title (e.g. Deposit in transit)"
              value={timingTitle}
              aria-label="Timing item title"
              onChange={(event) => setTimingTitle(event.target.value)}
            />
            <input
              className="mn-platform-funds__input"
              placeholder="Reference (statement line / entry)"
              value={timingReference}
              aria-label="Timing item reference"
              onChange={(event) => setTimingReference(event.target.value)}
            />
            <input
              className="mn-platform-funds__input"
              placeholder="Amount (minor units, signed)"
              value={timingAmount}
              aria-label="Timing item amount in minor units"
              inputMode="numeric"
              onChange={(event) => setTimingAmount(event.target.value)}
            />
          </div>
          <textarea
            className="mn-platform-funds__textarea"
            style={{ width: '100%', marginTop: 8, minHeight: 44 }}
            placeholder="Why this explains part of the difference (required)"
            value={timingExplanation}
            aria-label="Timing item explanation"
            onChange={(event) => setTimingExplanation(event.target.value)}
          />
          <button
            type="button"
            className="mn-platform-funds__btn mn-platform-funds__btn--secondary"
            style={{ marginTop: 6 }}
            disabled={
              busyAction === 'add-timing' ||
              timingTitle.trim().length < 3 ||
              timingReference.trim().length < 3 ||
              timingExplanation.trim().length < 3 ||
              !MINOR_UNITS.test(timingAmount.trim())
            }
            onClick={() => void addTiming()}
          >
            {busyAction === 'add-timing' ? 'Recording…' : 'Record timing item'}
          </button>
        </div>
      ) : null}

      <h3 style={{ fontSize: 14, margin: '16px 0 4px' }}>Verified bank evidence</h3>
      {isDraft ? (
        <div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: 8,
            }}
          >
            <div className="mn-platform-funds__form-row" style={{ marginBottom: 0 }}>
              <label htmlFor="pf-edit-ledger">Ledger reporting cutoff</label>
              <input
                id="pf-edit-ledger"
                type="datetime-local"
                className="mn-platform-funds__input"
                value={editLedgerCutoff}
                onChange={(event) => setEditLedgerCutoff(event.target.value)}
              />
            </div>
            <div className="mn-platform-funds__form-row" style={{ marginBottom: 0 }}>
              <label htmlFor="pf-edit-bank">Bank statement cutoff</label>
              <input
                id="pf-edit-bank"
                type="datetime-local"
                className="mn-platform-funds__input"
                value={editBankCutoff}
                onChange={(event) => setEditBankCutoff(event.target.value)}
              />
            </div>
            <div className="mn-platform-funds__form-row" style={{ marginBottom: 0 }}>
              <label htmlFor="pf-edit-ref">Statement reference</label>
              <input
                id="pf-edit-ref"
                className="mn-platform-funds__input"
                value={editStatementReference}
                onChange={(event) => setEditStatementReference(event.target.value)}
              />
            </div>
            <div className="mn-platform-funds__form-row" style={{ marginBottom: 0 }}>
              <label htmlFor="pf-edit-balance">Verified bank balance (minor units)</label>
              <input
                id="pf-edit-balance"
                className="mn-platform-funds__input"
                inputMode="numeric"
                value={editBankBalance}
                onChange={(event) => setEditBankBalance(event.target.value)}
              />
            </div>
          </div>
          <button
            type="button"
            className="mn-platform-funds__btn mn-platform-funds__btn--secondary"
            style={{ marginTop: 8 }}
            disabled={
              busyAction === 'save' ||
              !editBankBalanceValid ||
              editStatementReference.trim().length < 3
            }
            onClick={() => void saveEdits()}
          >
            {busyAction === 'save' ? 'Recomputing evidence…' : 'Save changes (recomputes evidence)'}
          </button>
        </div>
      ) : (
        <dl
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: 12,
            fontSize: 13,
          }}
        >
          <div>
            <dt className="mn-platform-funds__tile-label">Statement reference</dt>
            <dd style={{ margin: 0 }}>{detail.statementReference}</dd>
          </div>
          <div>
            <dt className="mn-platform-funds__tile-label">Bank cutoff</dt>
            <dd style={{ margin: 0 }}>{fmtUtc(detail.bankCutoff)}</dd>
          </div>
          <div>
            <dt className="mn-platform-funds__tile-label">Ledger cutoff</dt>
            <dd style={{ margin: 0 }}>{fmtUtc(detail.ledgerCutoff)}</dd>
          </div>
          <div>
            <dt className="mn-platform-funds__tile-label">Verified balance</dt>
            <dd style={{ margin: 0 }}>
              {formatFinancialAmount(detail.bankBalanceMinor, detail.currency)}{' '}
              <span style={{ opacity: 0.7 }}>({formatMinorUnits(detail.bankBalanceMinor, detail.currency)})</span>
            </dd>
          </div>
        </dl>
      )}

      <h3 style={{ fontSize: 14, margin: '16px 0 4px' }}>Maker / checker sign-off</h3>
      {detail.status === 'DRAFT' ? (
        <div>
          <p style={{ fontSize: 12, marginTop: 0 }}>
            A <strong>FINANCE_PREPARER</strong> submits; an independent{' '}
            <strong>FINANCE_CONTROLLER</strong> decides. The submitter can never review their own
            comparison, and both sessions require MFA. Nothing here moves money or posts a ledger
            adjustment.
          </p>
          {detail.blockingReasons.length > 0 ? (
            <ul style={{ fontSize: 12, color: '#b3261e' }}>
              {detail.blockingReasons.map((reason, index) => (
                <li key={index}>{reason}</li>
              ))}
            </ul>
          ) : null}
          <div className="mn-platform-funds__form-row">
            <label htmlFor="pf-submit-reason">Submission note (recorded on the governed approval)</label>
            <input
              id="pf-submit-reason"
              className="mn-platform-funds__input"
              placeholder="e.g. Statement verified against branch zero-balance certificate"
              value={submitReason}
              onChange={(event) => setSubmitReason(event.target.value)}
            />
          </div>
          <button
            type="button"
            className="mn-platform-funds__btn"
            disabled={
              !detail.canSubmit || busyAction === 'submit' || submitReason.trim().length < 3
            }
            onClick={() => void submitForReview()}
          >
            {busyAction === 'submit' ? 'Submitting…' : 'Submit for independent review'}
          </button>
        </div>
      ) : null}

      {detail.status === 'SUBMITTED' ? (
        <div>
          <p style={{ fontSize: 12, marginTop: 0 }}>
            Submitted by {detail.submittedBy} · {detail.submittedAt ? fmtUtc(detail.submittedAt) : ''}
            {detail.approval ? (
              <>
                {' '}
                · approval <code>{detail.approval.status}</code> (expires{' '}
                {fmtUtc(detail.approval.expiresAt)})
              </>
            ) : null}
          </p>
          {detail.selfApprovalDenied ? (
            <div className="mn-platform-funds__error" role="alert">
              You submitted this comparison. Self-approval is prohibited — an independent
              FINANCE_CONTROLLER must review it.
            </div>
          ) : canReviewRole ? (
            <div>
              <div className="mn-platform-funds__form-row">
                <label htmlFor="pf-review-reason">Decision note (recorded verbatim)</label>
                <textarea
                  id="pf-review-reason"
                  className="mn-platform-funds__textarea"
                  style={{ minHeight: 60 }}
                  placeholder="What you verified: statement reference, cutoff, mapping, unexplained difference…"
                  value={reviewReason}
                  onChange={(event) => setReviewReason(event.target.value)}
                />
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="mn-platform-funds__btn"
                  disabled={!detail.canReview || busyAction === 'approve' || reviewReason.trim().length < 3}
                  onClick={() => void decide('APPROVE')}
                >
                  {busyAction === 'approve' ? 'Recording decision…' : 'Approve — sign off'}
                </button>
                <button
                  type="button"
                  className="mn-platform-funds__btn mn-platform-funds__btn--danger"
                  disabled={!detail.canReview || busyAction === 'reject' || reviewReason.trim().length < 3}
                  onClick={() => void decide('REJECT')}
                >
                  {busyAction === 'reject' ? 'Recording decision…' : 'Reject'}
                </button>
              </div>
            </div>
          ) : (
            <p style={{ fontSize: 13 }}>
              Awaiting an independent FINANCE_CONTROLLER. Your session roles do not include the
              checker capability.
            </p>
          )}
        </div>
      ) : null}

      {detail.status === 'APPROVED' || detail.status === 'REJECTED' ? (
        <div
          className={`mn-platform-funds__decision mn-platform-funds__decision--${detail.status.toLowerCase()}`}
          role="status"
        >
          <strong>{detail.status === 'APPROVED' ? 'Signed off' : 'Rejected'}</strong> by{' '}
          {detail.reviewedBy} · {detail.reviewedAt ? fmtUtc(detail.reviewedAt) : ''}
          {detail.decisionReason ? (
            <div style={{ marginTop: 6 }}>
              Decision note: {detail.decisionReason}
            </div>
          ) : null}
          <div style={{ fontSize: 11, opacity: 0.8, marginTop: 6 }}>
            The decided comparison and its evidence snapshots are immutable.
          </div>
        </div>
      ) : null}

      <div style={{ marginTop: 16 }}>
        <button
          type="button"
          className="mn-platform-funds__btn mn-platform-funds__btn--secondary"
          onClick={toggleSnapshots}
          aria-expanded={showSnapshots}
        >
          {showSnapshots ? 'Hide' : 'Show'} evidence snapshots ({detail.snapshotCount})
        </button>
        {showSnapshots ? (
          <div style={{ marginTop: 8 }}>
            {snapshotsLoading ? <p style={{ fontSize: 13 }}>Loading snapshots…</p> : null}
            {snapshotsError ? <div className="mn-platform-funds__error">{snapshotsError}</div> : null}
            {snapshots ? (
              <table className="mn-platform-funds__table">
                <thead>
                  <tr>
                    <th>v</th>
                    <th>Reason</th>
                    <th>Created</th>
                    <th>Evidence hash</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshots.map((snapshot) => (
                    <tr key={snapshot.id}>
                      <td>{snapshot.version}</td>
                      <td>{snapshot.reason}</td>
                      <td>{fmtUtc(snapshot.createdAt)}</td>
                      <td>
                        <span className="mn-platform-funds__mono">
                          {snapshot.evidenceHash.slice(0, 24)}…
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="mn-platform-funds__mono" style={{ marginTop: 12, opacity: 0.7 }}>
        comparison {detail.id} · evidence {detail.breakdown.evidenceHash.slice(0, 32)}…
      </div>
    </section>
  ) : (
    <section className="mn-platform-funds__panel" aria-label="Comparison detail">
      {detailLoading ? (
        <p style={{ fontSize: 13 }}>Loading comparison…</p>
      ) : (
        <div>
          {detailError ? <div className="mn-platform-funds__error">{detailError}</div> : null}
          {!detailError ? (
            <p style={{ fontSize: 13, opacity: 0.85 }}>
              Select a comparison on the left, or start a new one. The comparison records the
              independently verified bank balance against what the ledger expects MonieNaija to hold —
              never the automated provider reconciliation, and never an action that moves money.
            </p>
          ) : null}
        </div>
      )}
    </section>
  );

  return (
    <div className="mn-reconciliation__workspace mn-platform-funds">
      <PageHeader
        eyebrow="Finance · Reconciliation"
        title="Platform Funds vs. Bank"
        description="Map the ledger-backed holding into the bank or settlement account you select, compare it with the balance Finance verified independently, and sign the comparison off through maker/checker review. This is staff-entered evidence, not an automated provider reconciliation; it never moves money and never posts a ledger adjustment."
      />
      <div className="mn-platform-funds__notice">
        Institution scope is resolved from your workforce assignments on every request. A platform
        comparison needs platform finance authority; an institution comparison needs an active
        assignment to that institution. Sign-off is blocked while the mapping is incomplete or
        ambiguous — the blockers say exactly what Finance must resolve.
      </div>
      <div className="mn-platform-funds__layout">
        {listPane}
        {mode === 'create' ? createPane : detailPane}
      </div>
    </div>
  );
};
