import React, { useMemo, useState } from 'react';

import {
  Alert,
  Button,
  Field,
  PageHeader,
  ScrollRegion,
  StatusBadge,
} from '../../design-system/primitives';
import { useAuthStore } from '../../store/auth-store';
import {
  InstitutionAdminApi,
  type AttributionGapSummaryRow,
  type AttributionGap,
  type AuditEventRow,
  type InstitutionCoverage,
  type InstitutionSummary,
  type PendingApproval,
} from '../../services/institution-admin-api';
import {
  ACTION_LABELS,
  APPROVING_FUNCTION_BY_ACTION,
  APPROVING_ROLE_BY_ACTION,
  INSTITUTION_FUNCTIONS,
  STATUS_TONES,
  describeError,
  formatTimestamp,
  hasAnyScope,
  shortId,
} from './institution-console-support';
import { useConsoleData } from './institution-console-hooks';
import {
  InstitutionAccountsTab,
  InstitutionAgentsTab,
  InstitutionEnrolmentsTab,
  InstitutionWorkforceTab,
} from './InstitutionRelationshipTabs';
import '../../design-system/tokens.css';
import './institution-console.css';

/**
 * ARENA 4 — institutional workspace.
 *
 * One screen per institution with task-oriented sections. Every governed operation keeps the
 * existing shape: a *maker* records an intent (reason + evidence) through the institution module,
 * an independent *checker* approves it through the privileged-approval infrastructure, and the
 * maker's exact payload is then executed. The console never executes without an approval id and
 * never presents an approval as authority on its own.
 */

type TabKey =
  | 'overview'
  | 'lifecycle'
  | 'agents'
  | 'workforce'
  | 'enrolments'
  | 'accounts'
  | 'activity';

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'overview', label: 'Overview' },
  { key: 'lifecycle', label: 'Lifecycle & approvals' },
  { key: 'agents', label: 'Agents & affiliations' },
  { key: 'workforce', label: 'Workforce access' },
  { key: 'enrolments', label: 'Customer enrolments' },
  { key: 'accounts', label: 'Accounts & attribution' },
  { key: 'activity', label: 'Activity' },
];

interface InstitutionWorkspaceScreenProps {
  institutionId?: string;
  onBackToDirectory: () => void;
}

export const InstitutionWorkspaceScreen: React.FC<InstitutionWorkspaceScreenProps> = ({
  institutionId,
  onBackToDirectory,
}) => {
  const { principal } = useAuthStore();
  const scopes = principal?.scopes ?? [];
  const [tab, setTab] = useState<TabKey>('overview');

  const detail = useConsoleData<InstitutionSummary | null>(
    () =>
      institutionId
        ? InstitutionAdminApi.getInstitution(institutionId)
        : Promise.resolve(null),
    [institutionId],
    'The institution could not be loaded.',
  );

  const tabRefs = React.useRef<Record<string, HTMLButtonElement | null>>({});
  const institution = detail.data ?? null;

  const onTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    event.preventDefault();
    const delta = event.key === 'ArrowRight' ? 1 : -1;
    const next = TABS[(index + delta + TABS.length) % TABS.length];
    setTab(next.key);
    tabRefs.current[next.key]?.focus();
  };

  if (!institutionId) {
    return (
      <div className="mn-inst">
        <PageHeader
          title="Institution workspace"
          description="Institutional administration"
          actions={<Button onClick={onBackToDirectory}>Institution directory</Button>}
        />
        <div className="mn-inst__empty">
          <p>Select an institution from the directory to open its workspace.</p>
          <Button variant="primary" onClick={onBackToDirectory}>
            Go to the directory
          </Button>
        </div>
      </div>
    );
  }

  if (detail.loading && !institution) {
    return (
      <div className="mn-inst">
        <p role="status" className="mn-inst__hint">
          Loading institution…
        </p>
      </div>
    );
  }

  if (detail.error || !institution) {
    return (
      <div className="mn-inst">
        <PageHeader
          title="Institution workspace"
          description="Institutional administration"
          actions={<Button onClick={onBackToDirectory}>Institution directory</Button>}
        />
        <Alert tone="danger" title="Institution unavailable">
          {detail.error ??
            'This institution is not in your authorized scope, or it no longer exists.'}
        </Alert>
        <p className="mn-inst__hint">
          An institution outside your workforce scope is answered as not found; nothing about it is
          disclosed.
        </p>
      </div>
    );
  }

  return (
    <div className="mn-inst">
      <PageHeader
        title={institution.displayName || institution.legalName}
        description={`${institution.reference} · ${institution.code} · ${institution.institutionType.replace(
          /_/g,
          ' ',
        )}`}
        actions={
          <div className="mn-inst__head-actions">
            <StatusBadge tone={STATUS_TONES[institution.status]}>
              {institution.status.replace(/_/g, ' ')}
            </StatusBadge>
            <Button onClick={onBackToDirectory}>Directory</Button>
          </div>
        }
      />

      {institution.status !== 'APPROVED' ? (
        <Alert tone="warning" title="No financial authority">
          This institution is not operationally approved. It cannot back an institutional financial
          relationship until an independent checker approves its lifecycle.
        </Alert>
      ) : null}

      <div className="mn-inst__tabs" role="tablist" aria-label="Institution workspace sections">
        {TABS.map((item, index) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            id={`mn-inst-tab-${item.key}`}
            aria-controls="mn-inst-panel"
            aria-selected={tab === item.key}
            tabIndex={tab === item.key ? 0 : -1}
            className={`mn-inst__tab${tab === item.key ? ' is-selected' : ''}`}
            ref={(element) => {
              tabRefs.current[item.key] = element;
            }}
            onClick={() => setTab(item.key)}
            onKeyDown={(event) => onTabKeyDown(event, index)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div
        className="mn-inst__panel-body"
        id="mn-inst-panel"
        role="tabpanel"
        aria-labelledby={`mn-inst-tab-${tab}`}
      >
        {tab === 'overview' ? <OverviewTab institution={institution} /> : null}
        {tab === 'lifecycle' ? (
          <LifecycleTab institution={institution} onInstitutionChanged={detail.reload} />
        ) : null}
        {tab === 'agents' ? <InstitutionAgentsTab institution={institution} /> : null}
        {tab === 'workforce' ? <InstitutionWorkforceTab institution={institution} /> : null}
        {tab === 'enrolments' ? <InstitutionEnrolmentsTab institution={institution} /> : null}
        {tab === 'accounts' ? <InstitutionAccountsTab institution={institution} /> : null}
        {tab === 'activity' ? <ActivityTab institution={institution} scopes={scopes} /> : null}
      </div>
    </div>
  );
};

// --------------------------------------------------------------------------------- overview

const OverviewTab: React.FC<{ institution: InstitutionSummary }> = ({ institution }) => {
  const { principal } = useAuthStore();
  const scopes = principal?.scopes ?? [];
  const canSeeAttribution = hasAnyScope(scopes, INSTITUTION_FUNCTIONS.attributionView);
  const canSeePending = hasAnyScope(scopes, INSTITUTION_FUNCTIONS.view);

  const coverage = useConsoleData<InstitutionCoverage | null>(
    () =>
      InstitutionAdminApi.coverage().then(
        (rows) => rows.find((row) => row.institutionId === institution.id) ?? null,
      ),
    [institution.id],
    'Institutional coverage could not be loaded.',
  );

  const pending = useConsoleData<PendingApproval[]>(
    () =>
      canSeePending
        ? InstitutionAdminApi.pendingApprovals(institution.id)
        : Promise.resolve([]),
    [institution.id, canSeePending],
    'Pending governed actions could not be loaded.',
  );

  const gaps = useConsoleData<AttributionGap[]>(
    () =>
      canSeeAttribution
        ? InstitutionAdminApi.attributionGaps(200).then((rows) =>
            rows.filter((row) => row.institutionId === institution.id),
          )
        : Promise.resolve([]),
    [institution.id, canSeeAttribution],
    'Attribution gaps could not be loaded.',
  );

  const gapSummary = useConsoleData<AttributionGapSummaryRow[]>(
    () => (canSeeAttribution ? InstitutionAdminApi.attributionGapSummary() : Promise.resolve([])),
    [canSeeAttribution],
    'Attribution-gap summary could not be loaded.',
  );

  const openActions = (pending.data ?? []).filter((item) => item.awaitingChecker).length;
  const platformGaps = (gapSummary.data ?? []).reduce((total, row) => total + row.agentCount, 0);

  return (
    <div className="mn-inst__stack">
      <section className="mn-inst__panel" aria-labelledby="mn-inst-identity">
        <h2 id="mn-inst-identity" className="mn-inst__panel-title">
          Identity and evidence
        </h2>
        <dl className="mn-inst__record">
          <div>
            <dt>Legal name</dt>
            <dd>{institution.legalName}</dd>
          </div>
          <div>
            <dt>Reference / code</dt>
            <dd className="mn-inst__mono">
              {institution.reference} · {institution.code}
            </dd>
          </div>
          <div>
            <dt>Type</dt>
            <dd>{institution.institutionType.replace(/_/g, ' ')}</dd>
          </div>
          <div>
            <dt>Lifecycle status</dt>
            <dd>
              <StatusBadge tone={STATUS_TONES[institution.status]}>
                {institution.status.replace(/_/g, ' ')}
              </StatusBadge>
              {institution.statusReason ? (
                <span className="mn-inst__secondary"> {institution.statusReason}</span>
              ) : null}
            </dd>
          </div>
          <div>
            <dt>Financial authority</dt>
            <dd>
              {institution.operationalAuthority
                ? `Operational authority since ${formatTimestamp(institution.operationalApprovedAt)}`
                : 'None. Not operationally approved.'}
            </dd>
          </div>
          <div>
            <dt>Regulator recorded</dt>
            <dd>{institution.regulatorName || 'Not recorded'}</dd>
          </div>
          <div>
            <dt>Licence reference</dt>
            <dd>
              {institution.licenceReference || 'Not recorded'}
              <span className="mn-inst__secondary">
                {' '}
                — recorded evidence for verification, not a verified licence
              </span>
            </dd>
          </div>
          <div>
            <dt>Evidence reference</dt>
            <dd className="mn-inst__mono">{institution.evidenceReference || 'Not recorded'}</dd>
          </div>
          <div>
            <dt>Suspended / closed</dt>
            <dd>
              {institution.suspendedAt ? `Suspended ${formatTimestamp(institution.suspendedAt)}` : '—'}
              {institution.closedAt ? ` · Closed ${formatTimestamp(institution.closedAt)}` : ''}
            </dd>
          </div>
          <div>
            <dt>Record version</dt>
            <dd className="mn-inst__mono">v{institution.version}</dd>
          </div>
          <div>
            <dt>Created / updated</dt>
            <dd className="mn-inst__mono">
              {formatTimestamp(institution.createdAt)} · {formatTimestamp(institution.updatedAt)}
            </dd>
          </div>
        </dl>
      </section>

      <section className="mn-inst__panel" aria-labelledby="mn-inst-coverage">
        <h2 id="mn-inst-coverage" className="mn-inst__panel-title">
          Operational footprint
        </h2>
        <p className="mn-inst__panel-note">
          Counts come from the institutional coverage view (active enrolments, active affiliations,
          attributed wallets and institutional ledger accounts). A missing row means nothing is
          recorded yet, not zero risk.
        </p>
        {coverage.error ? (
          <p className="mn-inst__hint">{coverage.error}</p>
        ) : coverage.loading && !coverage.data ? (
          <p className="mn-inst__hint" role="status">
            Loading coverage…
          </p>
        ) : (
          <dl className="mn-inst__stats">
            <div>
              <dt>Active affiliations</dt>
              <dd>{coverage.data?.activeAffiliations ?? 0}</dd>
            </div>
            <div>
              <dt>Active enrolments</dt>
              <dd>{coverage.data?.activeEnrolments ?? 0}</dd>
            </div>
            <div>
              <dt>Attributed wallets</dt>
              <dd>{coverage.data?.attributedWallets ?? 0}</dd>
            </div>
            <div>
              <dt>Institutional ledger accounts</dt>
              <dd>{coverage.data?.institutionalLedgerAccounts ?? 0}</dd>
            </div>
          </dl>
        )}
      </section>

      <section className="mn-inst__panel" aria-labelledby="mn-inst-attention">
        <h2 id="mn-inst-attention" className="mn-inst__panel-title">
          Needs attention
        </h2>
        <ul className="mn-inst__attention">
          <li>
            <span>Governed actions awaiting an independent checker</span>
            <StatusBadge tone={openActions > 0 ? 'warning' : 'neutral'}>
              {pending.error ? 'unavailable' : openActions}
            </StatusBadge>
          </li>
          <li>
            <span>Unresolved attribution gaps for this institution</span>
            <StatusBadge tone={(gaps.data?.length ?? 0) > 0 ? 'warning' : 'neutral'}>
              {gaps.error ? 'not visible to this role' : (gaps.data?.length ?? 0)}
            </StatusBadge>
          </li>
          <li>
            <span>Platform-wide unresolved gaps reported by the resolver</span>
            <StatusBadge tone={platformGaps > 0 ? 'warning' : 'neutral'}>
              {gapSummary.error ? 'not visible to this role' : platformGaps}
            </StatusBadge>
          </li>
        </ul>
        {platformGaps > 0 && !gapSummary.error ? (
          <p className="mn-inst__hint">
            {(gapSummary.data ?? [])
              .map((row) => `${row.gapReason.replace(/_/g, ' ')}: ${row.agentCount}`)
              .join(' · ')}
          </p>
        ) : null}
        <p className="mn-inst__hint">
          Gaps are reported, never filled: an agent is never attributed to the institution with the
          most activity, the nearest reference or an aggregator relationship.
        </p>
      </section>
    </div>
  );
};

// -------------------------------------------------------------------------------- lifecycle

const LIFECYCLE_TARGETS: Array<'APPROVED' | 'SUSPENDED' | 'CLOSED'> = [
  'APPROVED',
  'SUSPENDED',
  'CLOSED',
];

const LifecycleTab: React.FC<{
  institution: InstitutionSummary;
  onInstitutionChanged: () => void;
}> = ({ institution, onInstitutionChanged }) => {
  const { principal } = useAuthStore();
  const scopes = principal?.scopes ?? [];
  const canManage = hasAnyScope(scopes, INSTITUTION_FUNCTIONS.manage) && !principal?.readOnlyPrincipal;
  const canRequest =
    hasAnyScope(scopes, INSTITUTION_FUNCTIONS.lifecyclePrepare) && !principal?.readOnlyPrincipal;
  const canExecute =
    hasAnyScope(scopes, INSTITUTION_FUNCTIONS.lifecycleApprove) && !principal?.readOnlyPrincipal;
  const canCheck =
    hasAnyScope(scopes, INSTITUTION_FUNCTIONS.privilegedApprove) &&
    !principal?.readOnlyPrincipal &&
    principal?.assuranceLevel === 'MFA';

  const [evidence, setEvidence] = useState({ evidenceReference: '', regulatorName: '', licenceReference: '' });
  const [evidenceBusy, setEvidenceBusy] = useState(false);
  const [evidenceMessage, setEvidenceMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

  const [requestForm, setRequestForm] = useState<{
    targetStatus: 'APPROVED' | 'SUSPENDED' | 'CLOSED';
    reason: string;
  }>({ targetStatus: 'APPROVED', reason: '' });
  const [requestBusy, setRequestBusy] = useState(false);
  const [requestMessage, setRequestMessage] = useState<string | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);

  const [executeForm, setExecuteForm] = useState<{
    approvalId: string;
    targetStatus: 'APPROVED' | 'SUSPENDED' | 'CLOSED';
    reason: string;
  }>({ approvalId: '', targetStatus: 'APPROVED', reason: '' });
  const [executeBusy, setExecuteBusy] = useState(false);
  const [executeMessage, setExecuteMessage] = useState<string | null>(null);
  const [executeError, setExecuteError] = useState<string | null>(null);

  const [approvalBusy, setApprovalBusy] = useState<string | null>(null);
  const [approvalError, setApprovalError] = useState<string | null>(null);
  const [approvalNotice, setApprovalNotice] = useState<string | null>(null);

  const pending = useConsoleData<PendingApproval[]>(
    () => InstitutionAdminApi.pendingApprovals(institution.id),
    [institution.id],
    'Pending governed actions could not be loaded.',
  );

  const lifecycleActions = (pending.data ?? []).filter(
    (item) => item.actionType === 'FINANCIAL_INSTITUTION_LIFECYCLE_CHANGE',
  );

  const submitEvidence = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canManage || evidenceBusy) return;
    setEvidenceMessage(null);
    if (!evidence.evidenceReference.trim()) {
      setEvidenceMessage({ tone: 'danger', text: 'An evidence reference is required.' });
      return;
    }
    setEvidenceBusy(true);
    try {
      await InstitutionAdminApi.recordEvidence(institution.id, {
        evidenceReference: evidence.evidenceReference.trim(),
        regulatorName: evidence.regulatorName.trim() || undefined,
        licenceReference: evidence.licenceReference.trim() || undefined,
      });
      setEvidence({ evidenceReference: '', regulatorName: '', licenceReference: '' });
      setEvidenceMessage({
        tone: 'success',
        text: 'Evidence recorded. The institution still holds no financial authority until its lifecycle is approved.',
      });
      onInstitutionChanged();
    } catch (error) {
      setEvidenceMessage({ tone: 'danger', text: describeError(error, 'Evidence could not be recorded.') });
    } finally {
      setEvidenceBusy(false);
    }
  };

  const submitRequest = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canRequest || requestBusy) return;
    setRequestError(null);
    setRequestMessage(null);
    if (requestForm.reason.trim().length < 10) {
      setRequestError('A reason of at least 10 characters is required.');
      return;
    }
    setRequestBusy(true);
    try {
      const receipt = await InstitutionAdminApi.requestLifecycle(institution.id, {
        targetStatus: requestForm.targetStatus,
        reason: requestForm.reason.trim(),
      });
      setRequestMessage(
        `Request recorded. Approval ${receipt.approvalId} must be decided by a different principal holding the approving function. It expires ${formatTimestamp(
          receipt.expiresAt,
        )}.`,
      );
      setExecuteForm((current) => ({
        ...current,
        approvalId: receipt.approvalId,
        targetStatus: requestForm.targetStatus,
        reason: requestForm.reason.trim(),
      }));
      pending.reload();
    } catch (error) {
      setRequestError(describeError(error, 'The lifecycle request was refused.'));
    } finally {
      setRequestBusy(false);
    }
  };

  const submitExecute = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canExecute || executeBusy) return;
    setExecuteError(null);
    setExecuteMessage(null);
    if (!executeForm.approvalId.trim()) {
      setExecuteError('An approval id is required.');
      return;
    }
    if (executeForm.reason.trim().length < 10) {
      setExecuteError('The reason must match the approved request (at least 10 characters).');
      return;
    }
    if (
      !window.confirm(
        `Apply ${executeForm.targetStatus} to ${institution.reference}? This changes the institution's financial authority and is audited.`,
      )
    ) {
      return;
    }
    setExecuteBusy(true);
    try {
      const updated = await InstitutionAdminApi.executeLifecycle(institution.id, {
        approvalId: executeForm.approvalId.trim(),
        targetStatus: executeForm.targetStatus,
        reason: executeForm.reason.trim(),
      });
      setExecuteMessage(`Lifecycle change applied. The institution is now ${updated.status}.`);
      setExecuteForm({ approvalId: '', targetStatus: 'APPROVED', reason: '' });
      onInstitutionChanged();
      pending.reload();
    } catch (error) {
      setExecuteError(describeError(error, 'The lifecycle change was refused.'));
    } finally {
      setExecuteBusy(false);
    }
  };

  const approve = async (item: PendingApproval) => {
    if (!canCheck) return;
    if (
      !window.confirm(
        `Approve ${ACTION_LABELS[item.actionType] ?? item.actionType} requested by ${shortId(
          item.requesterPrincipalId,
        )}? You become the accountable checker; the requester cannot approve their own request.`,
      )
    ) {
      return;
    }
    setApprovalBusy(item.approvalId);
    setApprovalError(null);
    setApprovalNotice(null);
    try {
      await InstitutionAdminApi.approveApproval(item.approvalId);
      setApprovalNotice(`Approval ${item.approvalId} recorded. The requester may now execute it.`);
      pending.reload();
    } catch (error) {
      setApprovalError(describeError(error, 'The approval was not recorded.'));
    } finally {
      setApprovalBusy(null);
    }
  };

  return (
    <div className="mn-inst__stack">
      <section className="mn-inst__panel" aria-labelledby="mn-inst-pending">
        <div className="mn-inst__list-head">
          <h2 id="mn-inst-pending" className="mn-inst__panel-title">
            Pending governed actions
          </h2>
          <Button variant="quiet" size="sm" onClick={pending.reload} disabled={pending.loading}>
            Refresh
          </Button>
        </div>
        <p className="mn-inst__panel-note">
          Requests whose payload carries this institution. Requester and checker must be different
          principals, the checker must hold the approving function, and the approval is bound to the
          request payload — execution with a different payload is refused.
        </p>
        {!canCheck ? (
          <p className="mn-inst__hint">
            Approving requires <code>privileged:approve</code>, the action's approving function, the
            configured checker role and an MFA-authenticated session — and the checker must not be
            the requester.
          </p>
        ) : null}
        {pending.error ? (
          <Alert tone="danger" title="Pending actions unavailable">
            {pending.error}
          </Alert>
        ) : pending.loading && !pending.data ? (
          <p className="mn-inst__hint" role="status">
            Loading pending actions…
          </p>
        ) : (pending.data ?? []).length === 0 ? (
          <p className="mn-inst__hint">No governed action with this institution as its subject is open.</p>
        ) : (
          <ScrollRegion label="Pending governed actions" hint="Scroll horizontally for all columns.">
            <table className="mn-inst__table">
              <thead>
                <tr>
                  <th scope="col">Action</th>
                  <th scope="col">Status</th>
                  <th scope="col">Requester</th>
                  <th scope="col">Reason</th>
                  <th scope="col">Requested</th>
                  <th scope="col">Expires</th>
                  <th scope="col">
                    <span className="mn-inst__sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {lifecycleActions.length === 0 && (pending.data ?? []).length > 0 ? (
                  <tr>
                    <td colSpan={7} className="mn-inst__hint">
                      These actions belong to other sections (affiliation, enrolment or attribution).
                    </td>
                  </tr>
                ) : null}
                {[...(pending.data ?? [])]
                  .sort((left, right) => right.requestedAt.localeCompare(left.requestedAt))
                  .map((item) => {
                    const checkerRole = APPROVING_ROLE_BY_ACTION[item.actionType];
                    const checkerReady =
                      canCheck &&
                      item.awaitingChecker &&
                      item.requesterPrincipalId !== principal?.principalId &&
                      Boolean(checkerRole && principal?.roles.includes(checkerRole)) &&
                      hasAnyScope(scopes, APPROVING_FUNCTION_BY_ACTION[item.actionType] ?? '');
                    return (
                      <tr key={item.approvalId}>
                        <td>
                          <span className="mn-inst__primary">
                            {ACTION_LABELS[item.actionType] ?? item.actionType}
                          </span>
                          <span className="mn-inst__mono">{item.approvalId}</span>
                        </td>
                        <td>
                          <StatusBadge tone={item.awaitingChecker ? 'warning' : 'success'}>
                            {item.awaitingChecker ? 'Awaiting checker' : 'Approved'}
                          </StatusBadge>
                        </td>
                        <td className="mn-inst__mono">{shortId(item.requesterPrincipalId)}</td>
                        <td className="mn-inst__reason">{item.reason}</td>
                        <td className="mn-inst__mono">{formatTimestamp(item.requestedAt)}</td>
                        <td className="mn-inst__mono">{formatTimestamp(item.expiresAt)}</td>
                        <td>
                          {item.awaitingChecker ? (
                            <Button
                              size="sm"
                              variant="primary"
                              disabled={!checkerReady || approvalBusy === item.approvalId}
                              title={
                                checkerReady
                                  ? 'Approve as the independent checker'
                                  : 'Only a different, MFA-authenticated principal holding the approving function may approve'
                              }
                              onClick={() => void approve(item)}
                            >
                              {approvalBusy === item.approvalId ? 'Approving…' : 'Approve'}
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              onClick={() => {
                                setExecuteForm((current) => ({
                                  ...current,
                                  approvalId: item.approvalId,
                                  reason: item.reason,
                                }));
                              }}
                            >
                              Use for execution
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </ScrollRegion>
        )}
        {approvalError ? (
          <Alert tone="danger" title="Approval not recorded">
            {approvalError}
          </Alert>
        ) : null}
        {approvalNotice ? (
          <Alert tone="success" title="Approval recorded">
            {approvalNotice}
          </Alert>
        ) : null}
      </section>

      {canManage ? (
        <section className="mn-inst__panel" aria-labelledby="mn-inst-evidence">
          <h2 id="mn-inst-evidence" className="mn-inst__panel-title">
            Record regulatory evidence
          </h2>
          <p className="mn-inst__panel-note">
            Records the reference supplied for verification. Recording evidence moves the institution
            no further than <strong>EVIDENCE_SUBMITTED</strong> and grants no authority.
          </p>
          <form className="mn-inst__grid" onSubmit={submitEvidence}>
            <Field label="Evidence reference" htmlFor="inst-evidence-ref">
              <input
                id="inst-evidence-ref"
                className="mn-input"
                value={evidence.evidenceReference}
                maxLength={160}
                onChange={(event) =>
                  setEvidence({ ...evidence, evidenceReference: event.target.value })
                }
                required
              />
            </Field>
            <Field label="Regulator (optional)" htmlFor="inst-evidence-regulator">
              <input
                id="inst-evidence-regulator"
                className="mn-input"
                value={evidence.regulatorName}
                maxLength={160}
                onChange={(event) => setEvidence({ ...evidence, regulatorName: event.target.value })}
              />
            </Field>
            <Field label="Licence reference (optional)" htmlFor="inst-evidence-licence">
              <input
                id="inst-evidence-licence"
                className="mn-input"
                value={evidence.licenceReference}
                maxLength={120}
                onChange={(event) =>
                  setEvidence({ ...evidence, licenceReference: event.target.value })
                }
              />
            </Field>
            <div className="mn-inst__form-actions">
              <Button type="submit" variant="primary" disabled={evidenceBusy}>
                {evidenceBusy ? 'Recording…' : 'Record evidence'}
              </Button>
            </div>
          </form>
          {evidenceMessage ? (
            <Alert tone={evidenceMessage.tone} title="Evidence">
              {evidenceMessage.text}
            </Alert>
          ) : null}
        </section>
      ) : null}

      {canRequest ? (
        <section className="mn-inst__panel" aria-labelledby="mn-inst-request">
          <h2 id="mn-inst-request" className="mn-inst__panel-title">
            Request a lifecycle change
          </h2>
          <p className="mn-inst__panel-note">
            Creates a governed request. Nothing changes until an independent checker approves it and
            the approved payload is executed.
          </p>
          <form className="mn-inst__grid" onSubmit={submitRequest}>
            <Field label="Target status" htmlFor="inst-request-target">
              <select
                id="inst-request-target"
                className="mn-input"
                value={requestForm.targetStatus}
                onChange={(event) =>
                  setRequestForm({
                    ...requestForm,
                    targetStatus: event.target.value as 'APPROVED' | 'SUSPENDED' | 'CLOSED',
                  })
                }
              >
                {LIFECYCLE_TARGETS.map((target) => (
                  <option key={target} value={target}>
                    {target}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Reason" htmlFor="inst-request-reason" hint="At least 10 characters; stored on the approval.">
              <textarea
                id="inst-request-reason"
                className="mn-input"
                rows={3}
                maxLength={500}
                value={requestForm.reason}
                onChange={(event) => setRequestForm({ ...requestForm, reason: event.target.value })}
                required
              />
            </Field>
            <div className="mn-inst__form-actions">
              <Button type="submit" variant="primary" disabled={requestBusy}>
                {requestBusy ? 'Requesting…' : 'Request change'}
              </Button>
            </div>
          </form>
          {requestError ? (
            <Alert tone="danger" title="Request refused">
              {requestError}
            </Alert>
          ) : null}
          {requestMessage ? (
            <Alert tone="success" title="Request recorded">
              {requestMessage}
            </Alert>
          ) : null}
        </section>
      ) : null}

      {canExecute ? (
        <section className="mn-inst__panel" aria-labelledby="mn-inst-execute">
          <h2 id="mn-inst-execute" className="mn-inst__panel-title">
            Execute an approved change
          </h2>
          <p className="mn-inst__panel-note">
            The target status and reason must match the approved request exactly. The approval is
            bound to the request payload, so any difference is refused with{' '}
            <code>403</code> rather than silently applied.
          </p>
          <form className="mn-inst__grid" onSubmit={submitExecute}>
            <Field label="Approval id" htmlFor="inst-execute-approval">
              <input
                id="inst-execute-approval"
                className="mn-input mn-inst__mono"
                value={executeForm.approvalId}
                onChange={(event) =>
                  setExecuteForm({ ...executeForm, approvalId: event.target.value })
                }
                required
              />
            </Field>
            <Field label="Target status" htmlFor="inst-execute-target">
              <select
                id="inst-execute-target"
                className="mn-input"
                value={executeForm.targetStatus}
                onChange={(event) =>
                  setExecuteForm({
                    ...executeForm,
                    targetStatus: event.target.value as 'APPROVED' | 'SUSPENDED' | 'CLOSED',
                  })
                }
              >
                {LIFECYCLE_TARGETS.map((target) => (
                  <option key={target} value={target}>
                    {target}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Reason (as approved)" htmlFor="inst-execute-reason">
              <textarea
                id="inst-execute-reason"
                className="mn-input"
                rows={3}
                maxLength={500}
                value={executeForm.reason}
                onChange={(event) => setExecuteForm({ ...executeForm, reason: event.target.value })}
                required
              />
            </Field>
            <div className="mn-inst__form-actions">
              <Button type="submit" variant="danger" disabled={executeBusy}>
                {executeBusy ? 'Executing…' : 'Execute approved change'}
              </Button>
            </div>
          </form>
          {executeError ? (
            <Alert tone="danger" title="Not executed">
              {executeError}
            </Alert>
          ) : null}
          {executeMessage ? (
            <Alert tone="success" title="Executed">
              {executeMessage}
            </Alert>
          ) : null}
        </section>
      ) : null}
    </div>
  );
};

// --------------------------------------------------------------------------------- activity

const ActivityTab: React.FC<{ institution: InstitutionSummary; scopes: readonly string[] }> = ({
  institution,
  scopes,
}) => {
  const canRead = hasAnyScope(scopes, INSTITUTION_FUNCTIONS.auditSearch);
  const events = useConsoleData<AuditEventRow[]>(
    () =>
      canRead
        ? InstitutionAdminApi.auditEvents('FINANCIAL_INSTITUTION', institution.id)
        : Promise.resolve([]),
    [institution.id, canRead],
    'Audit history could not be loaded.',
  );

  const columns = useMemo(() => {
    const keys = new Set<string>();
    (events.data ?? []).slice(0, 25).forEach((row) => {
      Object.keys(row).forEach((key) => {
        if (typeof row[key] !== 'object') keys.add(key);
      });
    });
    return Array.from(keys).slice(0, 7);
  }, [events.data]);

  if (!canRead) {
    return (
      <div className="mn-inst__stack">
        <Alert tone="info" title="Audit history is not available to this role">
          Reading audit events requires <code>audit.search</code>. The institution's governed
          actions remain visible in the approval queue with their requester, checker and timestamps.
        </Alert>
      </div>
    );
  }

  return (
    <div className="mn-inst__stack">
      <section className="mn-inst__panel" aria-labelledby="mn-inst-activity-title">
        <div className="mn-inst__list-head">
          <h2 id="mn-inst-activity-title" className="mn-inst__panel-title">
            Activity for this institution
          </h2>
          <Button variant="quiet" size="sm" onClick={events.reload} disabled={events.loading}>
            Refresh
          </Button>
        </div>
        <p className="mn-inst__panel-note">
          Audit reads are anchored to this entity id; the audit surface is not a free-text search.
          Registration, evidence, lifecycle, affiliation, enrolment and attribution executions
          appear here as they are written.
        </p>
        {events.error ? (
          <Alert tone="danger" title="Audit history unavailable">
            {events.error}
          </Alert>
        ) : events.loading && !events.data ? (
          <p className="mn-inst__hint" role="status">
            Loading audit events…
          </p>
        ) : (events.data ?? []).length === 0 ? (
          <p className="mn-inst__hint">No audit events recorded for this institution yet.</p>
        ) : (
          <ScrollRegion label="Institution audit events" hint="Scroll horizontally for all columns.">
            <table className="mn-inst__table">
              <thead>
                <tr>
                  {columns.map((column) => (
                    <th key={column} scope="col">
                      {column.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase())}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(events.data ?? []).map((row, index) => (
                  <tr key={String(row.id ?? row.eventId ?? index)}>
                    {columns.map((column) => (
                      <td key={column} className="mn-inst__cell">
                        {String(row[column] ?? '—')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollRegion>
        )}
      </section>
    </div>
  );
};
