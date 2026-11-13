import React, { useState } from 'react';

import {
  Alert,
  Button,
  Field,
  ScrollRegion,
  StatusBadge,
} from '../../design-system/primitives';
import { useAuthStore } from '../../store/auth-store';
import {
  InstitutionAdminApi,
  type AffiliationChangeKind,
  type AffiliationEvidenceType,
  type AgentDirectoryRow,
  type AttributionEvidenceType,
  type AttributionRecord,
  type CustomerEnrolment,
  type EnrolmentStatus,
  type FinancialEligibility,
  type InstitutionAffiliation,
  type InstitutionLedgerAccount,
  type InstitutionSummary,
  type LedgerPurpose,
  type UnattributedAccount,
  type WorkforceAssignment,
} from '../../services/institution-admin-api';
import {
  AFFILIATION_TONES,
  ELIGIBILITY_TONES,
  ENROLMENT_TONES,
  INSTITUTION_FUNCTIONS,
  RELATIONSHIP_LABELS,
  describeError,
  formatTimestamp,
  hasAnyScope,
  shortId,
} from './institution-console-support';
import { useConsoleData } from './institution-console-hooks';

/**
 * ARENA 4 — institutional relationship tabs.
 *
 * Each tab has one subject: agent affiliations, workforce institution scope, customer enrolments,
 * or financial account attribution. All four keep the same governed shape (request → independent
 * approval → execution) and the same honesty rules:
 *   - an aggregator relationship is never presented as an institutional affiliation;
 *   - an enrolment is never presented as financial eligibility;
 *   - a wallet with posted ledger history cannot be re-attributed, and that is explained here
 *     rather than worked around.
 */

const CHANGE_KINDS: AffiliationChangeKind[] = [
  'ASSIGN',
  'TRANSFER',
  'SUSPEND',
  'REACTIVATE',
  'TERMINATE',
];

const AFFILIATION_EVIDENCE: AffiliationEvidenceType[] = [
  'INSTITUTION_APPROVAL_LETTER',
  'REGULATOR_RECORD',
  'OPERATIONAL_DIRECTIVE',
  'CONTRACT_REFERENCE',
  'AGGREGATOR_RELATIONSHIP',
];

const ATTRIBUTION_EVIDENCE: AttributionEvidenceType[] = [
  'INSTITUTION_AGREEMENT',
  'CUSTOMER_MANDATE',
  'REGULATOR_RECORD',
  'OPERATIONAL_DIRECTIVE',
  'SETTLEMENT_INSTRUCTION',
];

// ------------------------------------------------------------------------------ affiliations

export const InstitutionAgentsTab: React.FC<{ institution: InstitutionSummary }> = ({
  institution,
}) => {
  const { principal } = useAuthStore();
  const scopes = principal?.scopes ?? [];
  const canPrepare =
    hasAnyScope(scopes, INSTITUTION_FUNCTIONS.affiliationPrepare) && !principal?.readOnlyPrincipal;
  const canExecute =
    hasAnyScope(scopes, INSTITUTION_FUNCTIONS.affiliationApprove) && !principal?.readOnlyPrincipal;
  const canReadDirectory = hasAnyScope(scopes, INSTITUTION_FUNCTIONS.attributionView);

  const [search, setSearch] = useState('');
  const [mode, setMode] = useState<'AFFILIATED' | 'UNAFFILIATED'>('AFFILIATED');
  const [historyAgent, setHistoryAgent] = useState<string | null>(null);

  const [requestForm, setRequestForm] = useState({
    agentId: '',
    changeKind: 'ASSIGN' as AffiliationChangeKind,
    evidenceType: 'INSTITUTION_APPROVAL_LETTER' as AffiliationEvidenceType,
    evidenceReference: '',
    reason: '',
  });
  const [executeForm, setExecuteForm] = useState({
    agentId: '',
    changeKind: 'ASSIGN' as AffiliationChangeKind,
    evidenceType: 'INSTITUTION_APPROVAL_LETTER' as AffiliationEvidenceType,
    evidenceReference: '',
    reason: '',
    approvalId: '',
  });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const affiliations = useConsoleData<InstitutionAffiliation[]>(
    () => InstitutionAdminApi.listInstitutionAffiliations(institution.id),
    [institution.id],
    'Affiliations could not be loaded.',
  );

  const directory = useConsoleData<AgentDirectoryRow[]>(
    () =>
      canReadDirectory
        ? InstitutionAdminApi.agentDirectory(
            mode === 'AFFILIATED'
              ? { institutionId: institution.id, limit: 200 }
              : { affiliation: 'UNAFFILIATED', limit: 200 },
          )
        : Promise.resolve([]),
    [institution.id, mode, canReadDirectory],
    'The platform agent directory could not be loaded.',
  );

  const history = useConsoleData<InstitutionAffiliation[]>(
    () =>
      historyAgent
        ? InstitutionAdminApi.agentAffiliationHistory(historyAgent)
        : Promise.resolve([]),
    [historyAgent],
    'Affiliation history could not be loaded.',
  );

  const reloadAll = () => {
    affiliations.reload();
    directory.reload();
    if (historyAgent) history.reload();
  };

  const submitRequest = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canPrepare || busy) return;
    setError(null);
    setNotice(null);
    if (!requestForm.agentId.trim() || !requestForm.evidenceReference.trim()) {
      setError('Agent id and evidence reference are required.');
      return;
    }
    if (requestForm.reason.trim().length < 10) {
      setError('A reason of at least 10 characters is required.');
      return;
    }
    setBusy(true);
    try {
      const receipt = await InstitutionAdminApi.requestAffiliation(requestForm.agentId.trim(), {
        institutionId: institution.id,
        changeKind: requestForm.changeKind,
        evidenceType: requestForm.evidenceType,
        evidenceReference: requestForm.evidenceReference.trim(),
        reason: requestForm.reason.trim(),
      });
      setNotice(
        `Affiliation request recorded (approval ${receipt.approvalId}). An independent checker must approve it before execution.`,
      );
      setExecuteForm({
        ...requestForm,
        agentId: requestForm.agentId.trim(),
        evidenceReference: requestForm.evidenceReference.trim(),
        reason: requestForm.reason.trim(),
        approvalId: receipt.approvalId,
      });
      affiliations.reload();
    } catch (caught) {
      setError(describeError(caught, 'The affiliation request was refused.'));
    } finally {
      setBusy(false);
    }
  };

  const submitExecute = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canExecute || busy) return;
    setError(null);
    setNotice(null);
    if (!executeForm.agentId.trim() || !executeForm.approvalId.trim()) {
      setError('Agent id and approval id are required.');
      return;
    }
    if (
      !window.confirm(
        `Apply ${executeForm.changeKind} to agent ${shortId(
          executeForm.agentId,
        )} at ${institution.reference}? The affiliation becomes effective immediately and is audited.`,
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      await InstitutionAdminApi.executeAffiliation(executeForm.agentId.trim(), {
        institutionId: institution.id,
        changeKind: executeForm.changeKind,
        evidenceType: executeForm.evidenceType,
        evidenceReference: executeForm.evidenceReference.trim(),
        reason: executeForm.reason.trim(),
        approvalId: executeForm.approvalId.trim(),
      });
      setNotice('Affiliation change executed.');
      setExecuteForm({
        agentId: '',
        changeKind: 'ASSIGN',
        evidenceType: 'INSTITUTION_APPROVAL_LETTER',
        evidenceReference: '',
        reason: '',
        approvalId: '',
      });
      reloadAll();
    } catch (caught) {
      setError(describeError(caught, 'The affiliation change was refused.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mn-inst__stack">
      <Alert tone="info" title="Three relationships are distinct">
        An <strong>institutional affiliation</strong> is a governed record naming one institution. An{' '}
        <strong>aggregator relationship</strong> links an agent to an aggregator and is never read as
        an institutional affiliation. An agent with neither is <strong>independent</strong>. The
        directory below reports the relationship; it never infers one.
      </Alert>

      <section className="mn-inst__panel" aria-labelledby="mn-inst-affiliations">
        <div className="mn-inst__list-head">
          <h2 id="mn-inst-affiliations" className="mn-inst__panel-title">
            Affiliation records for this institution
          </h2>
          <Button variant="quiet" size="sm" onClick={affiliations.reload} disabled={affiliations.loading}>
            Refresh
          </Button>
        </div>
        {affiliations.error ? (
          <Alert tone="danger" title="Affiliations unavailable">
            {affiliations.error}
          </Alert>
        ) : affiliations.loading && !affiliations.data ? (
          <p className="mn-inst__hint" role="status">
            Loading affiliations…
          </p>
        ) : (affiliations.data ?? []).length === 0 ? (
          <p className="mn-inst__hint">
            No agent is affiliated to this institution. Registering the institution does not
            affiliate anyone.
          </p>
        ) : (
          <ScrollRegion label="Institution affiliations" hint="Scroll horizontally for all columns.">
            <table className="mn-inst__table">
              <thead>
                <tr>
                  <th scope="col">Agent</th>
                  <th scope="col">Status</th>
                  <th scope="col">Change</th>
                  <th scope="col">Evidence</th>
                  <th scope="col">Effective</th>
                  <th scope="col">Approval</th>
                  <th scope="col">
                    <span className="mn-inst__sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {(affiliations.data ?? []).map((row) => (
                  <tr key={row.affiliationId}>
                    <td className="mn-inst__mono">{shortId(row.agentId)}</td>
                    <td>
                      <StatusBadge tone={AFFILIATION_TONES[row.status]}>{row.status}</StatusBadge>
                    </td>
                    <td>{row.changeKind}</td>
                    <td>
                      <span className="mn-inst__secondary">{row.evidenceType.replace(/_/g, ' ')}</span>
                      <span className="mn-inst__secondary">{row.evidenceReference}</span>
                    </td>
                    <td className="mn-inst__mono">
                      {formatTimestamp(row.effectiveFrom)}
                      {row.effectiveTo ? ` → ${formatTimestamp(row.effectiveTo)}` : ''}
                    </td>
                    <td className="mn-inst__mono">{shortId(row.approvalId)}</td>
                    <td>
                      <Button size="sm" variant="quiet" onClick={() => setHistoryAgent(row.agentId)}>
                        History
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollRegion>
        )}
      </section>

      {historyAgent ? (
        <section className="mn-inst__panel" aria-labelledby="mn-inst-affiliation-history">
          <div className="mn-inst__list-head">
            <h2 id="mn-inst-affiliation-history" className="mn-inst__panel-title">
              Affiliation history · {shortId(historyAgent)}
            </h2>
            <Button variant="quiet" size="sm" onClick={() => setHistoryAgent(null)}>
              Close
            </Button>
          </div>
          {history.error ? (
            <p className="mn-inst__hint">{history.error}</p>
          ) : history.loading && !history.data ? (
            <p className="mn-inst__hint" role="status">
              Loading history…
            </p>
          ) : (history.data ?? []).length === 0 ? (
            <p className="mn-inst__hint">No institutional affiliation has ever been recorded for this agent.</p>
          ) : (
            <ul className="mn-inst__timeline">
              {(history.data ?? []).map((row) => (
                <li key={`${row.affiliationId}-${row.executedAt}`}>
                  <span className="mn-inst__mono">{formatTimestamp(row.executedAt)}</span>{' '}
                  <strong>{row.changeKind}</strong> → {row.status} · institution{' '}
                  <span className="mn-inst__mono">{shortId(row.institutionId)}</span> · evidence{' '}
                  {row.evidenceType.replace(/_/g, ' ')} {row.evidenceReference}
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      <section className="mn-inst__panel" aria-labelledby="mn-inst-directory">
        <div className="mn-inst__list-head">
          <h2 id="mn-inst-directory" className="mn-inst__panel-title">
            Agent directory (platform)
          </h2>
          <div className="mn-inst__filters">
            <Field label="Directory view" htmlFor="inst-directory-mode" layout="inline">
              <select
                id="inst-directory-mode"
                className="mn-input"
                value={mode}
                onChange={(event) => setMode(event.target.value as 'AFFILIATED' | 'UNAFFILIATED')}
              >
                <option value="AFFILIATED">Affiliated to this institution</option>
                <option value="UNAFFILIATED">Unattributed (no institution)</option>
              </select>
            </Field>
            <Field label="Search agent reference" htmlFor="inst-directory-search" layout="inline">
              <input
                id="inst-directory-search"
                className="mn-input"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </Field>
            <Button variant="quiet" size="sm" onClick={directory.reload} disabled={directory.loading}>
              Refresh
            </Button>
          </div>
        </div>
        {!canReadDirectory ? (
          <p className="mn-inst__hint">
            The platform directory requires <code>institution.attribution.view</code>. The
            institution's own affiliation records above remain available.
          </p>
        ) : directory.error ? (
          <Alert tone="danger" title="Directory unavailable">
            {directory.error}
          </Alert>
        ) : directory.loading && !directory.data ? (
          <p className="mn-inst__hint" role="status">
            Loading directory…
          </p>
        ) : (
          <ScrollRegion label="Agent directory" hint="Scroll horizontally for all columns.">
            <table className="mn-inst__table">
              <thead>
                <tr>
                  <th scope="col">Agent</th>
                  <th scope="col">Agent status</th>
                  <th scope="col">Relationship</th>
                  <th scope="col">Institution affiliation</th>
                  <th scope="col">Aggregator</th>
                  <th scope="col">
                    <span className="mn-inst__sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {(directory.data ?? [])
                  .filter((row) =>
                    search.trim()
                      ? row.agentReference.toLowerCase().includes(search.trim().toLowerCase())
                      : true,
                  )
                  .map((row) => (
                    <tr key={row.agentId}>
                      <td className="mn-inst__mono">
                        {row.agentReference}
                        <span className="mn-inst__secondary">{shortId(row.agentId)}</span>
                      </td>
                      <td>{row.agentStatus}</td>
                      <td>
                        <StatusBadge
                          tone={
                            row.relationship === 'INSTITUTION_AFFILIATED'
                              ? 'success'
                              : row.relationship === 'AGGREGATOR_LINKED'
                                ? 'info'
                                : 'neutral'
                          }
                        >
                          {RELATIONSHIP_LABELS[row.relationship] ?? row.relationship}
                        </StatusBadge>
                      </td>
                      <td>
                        {row.affiliationStatus ? (
                          <>
                            <StatusBadge tone={AFFILIATION_TONES[row.affiliationStatus]}>
                              {row.affiliationStatus}
                            </StatusBadge>
                            <span className="mn-inst__secondary">
                              since {formatTimestamp(row.affiliationEffectiveFrom)}
                            </span>
                          </>
                        ) : (
                          <span className="mn-inst__secondary">No active affiliation</span>
                        )}
                      </td>
                      <td>{row.aggregatorReference || '—'}</td>
                      <td>
                        <Button
                          size="sm"
                          variant="quiet"
                          onClick={() => {
                            setRequestForm((current) => ({ ...current, agentId: row.agentId }));
                            setExecuteForm((current) => ({ ...current, agentId: row.agentId }));
                          }}
                        >
                          Use agent
                        </Button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </ScrollRegion>
        )}
      </section>

      {canPrepare ? (
        <section className="mn-inst__panel" aria-labelledby="mn-inst-affiliate-request">
          <h2 id="mn-inst-affiliate-request" className="mn-inst__panel-title">
            Request an affiliation change
          </h2>
          <p className="mn-inst__panel-note">
            The evidence reference is what a checker verifies. Selecting{' '}
            <code>AGGREGATOR_RELATIONSHIP</code> records evidence a human supplied; it does not turn
            an aggregator assignment into an institutional affiliation.
          </p>
          <form className="mn-inst__grid" onSubmit={submitRequest}>
            <Field label="Agent id" htmlFor="inst-affiliate-agent">
              <input
                id="inst-affiliate-agent"
                className="mn-input mn-inst__mono"
                value={requestForm.agentId}
                onChange={(event) => setRequestForm({ ...requestForm, agentId: event.target.value })}
                required
              />
            </Field>
            <Field label="Change kind" htmlFor="inst-affiliate-kind">
              <select
                id="inst-affiliate-kind"
                className="mn-input"
                value={requestForm.changeKind}
                onChange={(event) =>
                  setRequestForm({
                    ...requestForm,
                    changeKind: event.target.value as AffiliationChangeKind,
                  })
                }
              >
                {CHANGE_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {kind}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Evidence type" htmlFor="inst-affiliate-evidence-type">
              <select
                id="inst-affiliate-evidence-type"
                className="mn-input"
                value={requestForm.evidenceType}
                onChange={(event) =>
                  setRequestForm({
                    ...requestForm,
                    evidenceType: event.target.value as AffiliationEvidenceType,
                  })
                }
              >
                {AFFILIATION_EVIDENCE.map((type) => (
                  <option key={type} value={type}>
                    {type.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Evidence reference" htmlFor="inst-affiliate-evidence-ref">
              <input
                id="inst-affiliate-evidence-ref"
                className="mn-input"
                value={requestForm.evidenceReference}
                maxLength={160}
                onChange={(event) =>
                  setRequestForm({ ...requestForm, evidenceReference: event.target.value })
                }
                required
              />
            </Field>
            <Field label="Reason" htmlFor="inst-affiliate-reason" hint="At least 10 characters.">
              <textarea
                id="inst-affiliate-reason"
                className="mn-input"
                rows={3}
                maxLength={500}
                value={requestForm.reason}
                onChange={(event) => setRequestForm({ ...requestForm, reason: event.target.value })}
                required
              />
            </Field>
            <div className="mn-inst__form-actions">
              <Button type="submit" variant="primary" disabled={busy}>
                {busy ? 'Requesting…' : 'Request affiliation change'}
              </Button>
            </div>
          </form>
        </section>
      ) : null}

      {canExecute ? (
        <section className="mn-inst__panel" aria-labelledby="mn-inst-affiliate-execute">
          <h2 id="mn-inst-affiliate-execute" className="mn-inst__panel-title">
            Execute an approved affiliation change
          </h2>
          <p className="mn-inst__panel-note">
            Every field must match the approved request. A different payload is refused (the approval
            is bound to a fingerprint of the original request).
          </p>
          <form className="mn-inst__grid" onSubmit={submitExecute}>
            <Field label="Agent id" htmlFor="inst-affiliate-exec-agent">
              <input
                id="inst-affiliate-exec-agent"
                className="mn-input mn-inst__mono"
                value={executeForm.agentId}
                onChange={(event) =>
                  setExecuteForm({ ...executeForm, agentId: event.target.value })
                }
                required
              />
            </Field>
            <Field label="Approval id" htmlFor="inst-affiliate-exec-approval">
              <input
                id="inst-affiliate-exec-approval"
                className="mn-input mn-inst__mono"
                value={executeForm.approvalId}
                onChange={(event) =>
                  setExecuteForm({ ...executeForm, approvalId: event.target.value })
                }
                required
              />
            </Field>
            <Field label="Change kind" htmlFor="inst-affiliate-exec-kind">
              <select
                id="inst-affiliate-exec-kind"
                className="mn-input"
                value={executeForm.changeKind}
                onChange={(event) =>
                  setExecuteForm({
                    ...executeForm,
                    changeKind: event.target.value as AffiliationChangeKind,
                  })
                }
              >
                {CHANGE_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {kind}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Evidence type" htmlFor="inst-affiliate-exec-evidence-type">
              <select
                id="inst-affiliate-exec-evidence-type"
                className="mn-input"
                value={executeForm.evidenceType}
                onChange={(event) =>
                  setExecuteForm({
                    ...executeForm,
                    evidenceType: event.target.value as AffiliationEvidenceType,
                  })
                }
              >
                {AFFILIATION_EVIDENCE.map((type) => (
                  <option key={type} value={type}>
                    {type.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Evidence reference (as approved)" htmlFor="inst-affiliate-exec-evidence-ref">
              <input
                id="inst-affiliate-exec-evidence-ref"
                className="mn-input"
                value={executeForm.evidenceReference}
                maxLength={160}
                onChange={(event) =>
                  setExecuteForm({ ...executeForm, evidenceReference: event.target.value })
                }
                required
              />
            </Field>
            <Field label="Reason (as approved)" htmlFor="inst-affiliate-exec-reason">
              <textarea
                id="inst-affiliate-exec-reason"
                className="mn-input"
                rows={3}
                maxLength={500}
                value={executeForm.reason}
                onChange={(event) => setExecuteForm({ ...executeForm, reason: event.target.value })}
                required
              />
            </Field>
            <div className="mn-inst__form-actions">
              <Button type="submit" variant="danger" disabled={busy}>
                {busy ? 'Executing…' : 'Execute approved change'}
              </Button>
            </div>
          </form>
        </section>
      ) : null}

      {error ? (
        <Alert tone="danger" title="Not completed">
          {error}
        </Alert>
      ) : null}
      {notice ? (
        <Alert tone="success" title="Governed action">
          {notice}
        </Alert>
      ) : null}
    </div>
  );
};

// ---------------------------------------------------------------------------------- workforce

export const InstitutionWorkforceTab: React.FC<{ institution: InstitutionSummary }> = ({
  institution,
}) => {
  const { principal } = useAuthStore();
  const scopes = principal?.scopes ?? [];
  const canAssign =
    hasAnyScope(scopes, INSTITUTION_FUNCTIONS.workforceAssign) &&
    !principal?.readOnlyPrincipal &&
    principal?.roles.some((role) => role === 'SUPER_ADMIN' || role === 'ADMINISTRATOR');
  const [principalId, setPrincipalId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const assignments = useConsoleData<WorkforceAssignment[]>(
    () => InstitutionAdminApi.listWorkforce(institution.id),
    [institution.id],
    'Workforce assignments could not be loaded.',
  );

  const grant = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canAssign || busy) return;
    setError(null);
    setNotice(null);
    if (!principalId.trim()) {
      setError('A workforce principal id is required.');
      return;
    }
    setBusy(true);
    try {
      await InstitutionAdminApi.grantWorkforce(institution.id, principalId.trim());
      setNotice(
        'Institution scope granted. The principal gains access to this institution only; no function code was added or widened.',
      );
      setPrincipalId('');
      assignments.reload();
    } catch (caught) {
      setError(describeError(caught, 'The assignment was refused.'));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (assignment: WorkforceAssignment) => {
    if (!canAssign || busy) return;
    if (
      !window.confirm(
        `Revoke institution scope for ${shortId(assignment.principalId)}? They lose access to this institution immediately; history is retained.`,
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await InstitutionAdminApi.revokeWorkforce(institution.id, assignment.principalId);
      setNotice('Institution scope revoked. The assignment remains in history.');
      assignments.reload();
    } catch (caught) {
      setError(describeError(caught, 'The revocation was refused.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mn-inst__stack">
      <Alert tone="info" title="Platform-level versus institution-scoped">
        Institution assignments are an <strong>additional scope</strong>: they let an existing
        workforce principal act on this institution. They never add a function code, never widen an
        existing authority and never grant platform-wide reach. Granting and revoking is a
        platform-level action confined to <code>SUPER_ADMIN</code>.
      </Alert>

      <section className="mn-inst__panel" aria-labelledby="mn-inst-workforce-list">
        <div className="mn-inst__list-head">
          <h2 id="mn-inst-workforce-list" className="mn-inst__panel-title">
            Workforce assignments
          </h2>
          <Button variant="quiet" size="sm" onClick={assignments.reload} disabled={assignments.loading}>
            Refresh
          </Button>
        </div>
        {assignments.error ? (
          <Alert tone="danger" title="Assignments unavailable">
            {assignments.error}
          </Alert>
        ) : assignments.loading && !assignments.data ? (
          <p className="mn-inst__hint" role="status">
            Loading assignments…
          </p>
        ) : (assignments.data ?? []).length === 0 ? (
          <p className="mn-inst__hint">
            No workforce principal is assigned to this institution. Only platform principals can act
            on it until one is.
          </p>
        ) : (
          <ScrollRegion label="Workforce assignments" hint="Scroll horizontally for all columns.">
            <table className="mn-inst__table">
              <thead>
                <tr>
                  <th scope="col">Principal</th>
                  <th scope="col">Status</th>
                  <th scope="col">Granted</th>
                  <th scope="col">Revoked</th>
                  <th scope="col">
                    <span className="mn-inst__sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {(assignments.data ?? []).map((row) => (
                  <tr key={row.id}>
                    <td className="mn-inst__mono">{shortId(row.principalId)}</td>
                    <td>
                      <StatusBadge tone={row.status === 'ACTIVE' ? 'success' : 'neutral'}>
                        {row.status}
                      </StatusBadge>
                    </td>
                    <td className="mn-inst__mono">
                      {formatTimestamp(row.grantedAt)}
                      <span className="mn-inst__secondary">by {shortId(row.grantedBy)}</span>
                    </td>
                    <td className="mn-inst__mono">
                      {row.revokedAt ? formatTimestamp(row.revokedAt) : '—'}
                      {row.revokedBy ? (
                        <span className="mn-inst__secondary">by {shortId(row.revokedBy)}</span>
                      ) : null}
                    </td>
                    <td>
                      {canAssign && row.status === 'ACTIVE' ? (
                        <Button size="sm" variant="danger" disabled={busy} onClick={() => void revoke(row)}>
                          Revoke
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollRegion>
        )}
      </section>

      {canAssign ? (
        <section className="mn-inst__panel" aria-labelledby="mn-inst-workforce-grant">
          <h2 id="mn-inst-workforce-grant" className="mn-inst__panel-title">
            Assign institution scope
          </h2>
          <form className="mn-inst__grid" onSubmit={grant}>
            <Field
              label="Workforce principal id"
              htmlFor="inst-workforce-principal"
              hint="The principal must already exist. This grants institution scope only."
            >
              <input
                id="inst-workforce-principal"
                className="mn-input mn-inst__mono"
                value={principalId}
                onChange={(event) => setPrincipalId(event.target.value)}
                required
              />
            </Field>
            <div className="mn-inst__form-actions">
              <Button type="submit" variant="primary" disabled={busy}>
                {busy ? 'Assigning…' : 'Assign scope'}
              </Button>
            </div>
          </form>
        </section>
      ) : (
        <p className="mn-inst__hint">
          Assigning or revoking institution scope requires <code>institution.workforce.assign</code>{' '}
          with a platform-level principal.
        </p>
      )}

      {error ? (
        <Alert tone="danger" title="Not completed">
          {error}
        </Alert>
      ) : null}
      {notice ? (
        <Alert tone="success" title="Workforce scope">
          {notice}
        </Alert>
      ) : null}
    </div>
  );
};

// --------------------------------------------------------------------------------- enrolments

const ENROLMENT_STATUSES: EnrolmentStatus[] = ['PENDING', 'ACTIVE', 'SUSPENDED', 'CLOSED'];
const ELIGIBILITIES: FinancialEligibility[] = ['PENDING_KYC', 'ELIGIBLE', 'RESTRICTED'];

interface EnrolmentFormState {
  customerId: string;
  reference: string;
  targetStatus: EnrolmentStatus;
  financialEligibility: '' | FinancialEligibility;
  statusReason: string;
  kycEvidenceReference: string;
  kycConsentReference: string;
  kycPolicyReference: string;
  approvalId: string;
}

const EMPTY_ENROLMENT: EnrolmentFormState = {
  customerId: '',
  reference: '',
  targetStatus: 'PENDING',
  financialEligibility: '',
  statusReason: '',
  kycEvidenceReference: '',
  kycConsentReference: '',
  kycPolicyReference: '',
  approvalId: '',
};

function enrolmentPayload(form: EnrolmentFormState) {
  const kycFields = [
    form.kycEvidenceReference.trim(),
    form.kycConsentReference.trim(),
    form.kycPolicyReference.trim(),
  ];
  const filled = kycFields.filter(Boolean).length;
  if (filled > 0 && filled < 3) {
    throw new Error(
      'KYC reuse is all-or-nothing: evidence reference, consent reference and policy reference are required together.',
    );
  }
  return {
    customerId: form.customerId.trim(),
    reference: form.reference.trim(),
    targetStatus: form.targetStatus,
    financialEligibility: form.financialEligibility || undefined,
    statusReason: form.statusReason.trim(),
    kycReuse:
      filled === 3
        ? {
            evidenceReference: kycFields[0],
            consentReference: kycFields[1],
            policyReference: kycFields[2],
          }
        : undefined,
  };
}

export const InstitutionEnrolmentsTab: React.FC<{ institution: InstitutionSummary }> = ({
  institution,
}) => {
  const { principal } = useAuthStore();
  const scopes = principal?.scopes ?? [];
  const canPrepare =
    hasAnyScope(scopes, INSTITUTION_FUNCTIONS.enrolmentPrepare) && !principal?.readOnlyPrincipal;
  const canExecute =
    hasAnyScope(scopes, INSTITUTION_FUNCTIONS.enrolmentApprove) && !principal?.readOnlyPrincipal;
  const canCrossRead = hasAnyScope(scopes, INSTITUTION_FUNCTIONS.attributionView);

  const [form, setForm] = useState<EnrolmentFormState>({ ...EMPTY_ENROLMENT });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [lookupId, setLookupId] = useState('');
  const [lookup, setLookup] = useState<CustomerEnrolment[] | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);

  const enrolments = useConsoleData<CustomerEnrolment[]>(
    () => InstitutionAdminApi.listEnrolments(institution.id),
    [institution.id],
    'Enrolments could not be loaded.',
  );

  const submit = async (mode: 'request' | 'execute') => {
    if (busy) return;
    setError(null);
    setNotice(null);
    let payload;
    try {
      payload = enrolmentPayload(form);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The enrolment form is incomplete.');
      return;
    }
    if (!payload.customerId || !payload.reference) {
      setError('Customer id and enrolment reference are required.');
      return;
    }
    if (payload.statusReason.length < 10) {
      setError('A status reason of at least 10 characters is required.');
      return;
    }
    if (mode === 'execute' && !form.approvalId.trim()) {
      setError('An approval id is required to execute.');
      return;
    }
    if (
      mode === 'execute' &&
      !window.confirm(
        `Execute the approved enrolment change for customer ${shortId(payload.customerId)} at ${institution.reference}?`,
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      if (mode === 'request') {
        const receipt = await InstitutionAdminApi.requestEnrolment(institution.id, payload);
        setNotice(
          `Enrolment request recorded (approval ${receipt.approvalId}). Approval by an independent checker is still required before execution.`,
        );
        setForm((current) => ({ ...current, approvalId: receipt.approvalId }));
      } else {
        await InstitutionAdminApi.executeEnrolment(institution.id, {
          ...payload,
          approvalId: form.approvalId.trim(),
        });
        setNotice(
          'Enrolment change executed. Enrolment is a relationship record; it does not by itself make the customer financially eligible.',
        );
        setForm({ ...EMPTY_ENROLMENT });
        enrolments.reload();
      }
    } catch (caught) {
      setError(describeError(caught, 'The enrolment change was refused.'));
    } finally {
      setBusy(false);
    }
  };

  const runLookup = async () => {
    if (!canCrossRead || !lookupId.trim()) return;
    setLookupError(null);
    setLookup(null);
    try {
      const rows = await InstitutionAdminApi.customerEnrolments(lookupId.trim());
      setLookup(rows);
    } catch (caught) {
      setLookupError(describeError(caught, 'The customer enrolment lookup was refused.'));
    }
  };

  return (
    <div className="mn-inst__stack">
      <Alert tone="info" title="Enrolment is not eligibility">
        An enrolment records that a customer has a relationship with this institution. Financial
        eligibility is a separate gate (<code>PENDING_KYC</code>, <code>ELIGIBLE</code>,{' '}
        <code>RESTRICTED</code>), and a globally verified customer is not automatically eligible at
        an institution. The customer identity stays unified: an enrolment never creates a second
        customer record.
      </Alert>

      <section className="mn-inst__panel" aria-labelledby="mn-inst-enrolments">
        <div className="mn-inst__list-head">
          <h2 id="mn-inst-enrolments" className="mn-inst__panel-title">
            Enrolments at this institution
          </h2>
          <Button variant="quiet" size="sm" onClick={enrolments.reload} disabled={enrolments.loading}>
            Refresh
          </Button>
        </div>
        {enrolments.error ? (
          <Alert tone="danger" title="Enrolments unavailable">
            {enrolments.error}
          </Alert>
        ) : enrolments.loading && !enrolments.data ? (
          <p className="mn-inst__hint" role="status">
            Loading enrolments…
          </p>
        ) : (enrolments.data ?? []).length === 0 ? (
          <p className="mn-inst__hint">No customer is enrolled at this institution.</p>
        ) : (
          <ScrollRegion label="Institution enrolments" hint="Scroll horizontally for all columns.">
            <table className="mn-inst__table">
              <thead>
                <tr>
                  <th scope="col">Reference</th>
                  <th scope="col">Customer</th>
                  <th scope="col">Status</th>
                  <th scope="col">Financial eligibility</th>
                  <th scope="col">KYC reuse</th>
                  <th scope="col">Effective</th>
                  <th scope="col">Approval</th>
                </tr>
              </thead>
              <tbody>
                {(enrolments.data ?? []).map((row) => (
                  <tr key={row.id}>
                    <td className="mn-inst__mono">{row.reference}</td>
                    <td className="mn-inst__mono">{shortId(row.customerId)}</td>
                    <td>
                      <StatusBadge tone={ENROLMENT_TONES[row.status]}>
                        {row.status}
                      </StatusBadge>
                    </td>
                    <td>
                      <StatusBadge tone={ELIGIBILITY_TONES[row.financialEligibility] ?? 'neutral'}>
                        {row.financialEligibility.replace(/_/g, ' ')}
                      </StatusBadge>
                    </td>
                    <td>
                      {row.kycReuseAuthorized ? (
                        <StatusBadge tone="info">Reuse declared</StatusBadge>
                      ) : (
                        <span className="mn-inst__secondary">None</span>
                      )}
                    </td>
                    <td className="mn-inst__mono">
                      {formatTimestamp(row.effectiveFrom)}
                      {row.effectiveTo ? ` → ${formatTimestamp(row.effectiveTo)}` : ''}
                    </td>
                    <td className="mn-inst__mono">{shortId(row.approvalId)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollRegion>
        )}
      </section>

      {canPrepare ? (
        <section className="mn-inst__panel" aria-labelledby="mn-inst-enrolment-form">
          <h2 id="mn-inst-enrolment-form" className="mn-inst__panel-title">
            Request or execute an enrolment change
          </h2>
          <p className="mn-inst__panel-note">
            One form covers both steps: request first, then paste the approval id issued by the
            request and execute as the separate executing principal.
          </p>
          <form
            className="mn-inst__grid"
            onSubmit={(event) => {
              event.preventDefault();
              void submit('request');
            }}
          >
            <Field label="Customer id" htmlFor="inst-enrol-customer">
              <input
                id="inst-enrol-customer"
                className="mn-input mn-inst__mono"
                value={form.customerId}
                onChange={(event) => setForm({ ...form, customerId: event.target.value })}
                required
              />
            </Field>
            <Field label="Enrolment reference" htmlFor="inst-enrol-reference" hint="3–80 characters.">
              <input
                id="inst-enrol-reference"
                className="mn-input"
                value={form.reference}
                maxLength={80}
                onChange={(event) => setForm({ ...form, reference: event.target.value })}
                required
              />
            </Field>
            <Field label="Target status" htmlFor="inst-enrol-status">
              <select
                id="inst-enrol-status"
                className="mn-input"
                value={form.targetStatus}
                onChange={(event) =>
                  setForm({ ...form, targetStatus: event.target.value as EnrolmentStatus })
                }
              >
                {ENROLMENT_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label="Financial eligibility (optional)"
              htmlFor="inst-enrol-eligibility"
              hint="Recorded as a separate gate. ACTIVE enrolment alone is not eligibility."
            >
              <select
                id="inst-enrol-eligibility"
                className="mn-input"
                value={form.financialEligibility}
                onChange={(event) =>
                  setForm({
                    ...form,
                    financialEligibility: event.target.value as '' | FinancialEligibility,
                  })
                }
              >
                <option value="">Leave unchanged</option>
                {ELIGIBILITIES.map((value) => (
                  <option key={value} value={value}>
                    {value.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Status reason" htmlFor="inst-enrol-reason" hint="At least 10 characters.">
              <textarea
                id="inst-enrol-reason"
                className="mn-input"
                rows={3}
                maxLength={500}
                value={form.statusReason}
                onChange={(event) => setForm({ ...form, statusReason: event.target.value })}
                required
              />
            </Field>
            <Field label="KYC reuse evidence (optional)" htmlFor="inst-enrol-kyc-evidence">
              <input
                id="inst-enrol-kyc-evidence"
                className="mn-input"
                value={form.kycEvidenceReference}
                maxLength={160}
                onChange={(event) =>
                  setForm({ ...form, kycEvidenceReference: event.target.value })
                }
              />
            </Field>
            <Field label="KYC reuse consent (optional)" htmlFor="inst-enrol-kyc-consent">
              <input
                id="inst-enrol-kyc-consent"
                className="mn-input"
                value={form.kycConsentReference}
                maxLength={160}
                onChange={(event) => setForm({ ...form, kycConsentReference: event.target.value })}
              />
            </Field>
            <Field
              label="KYC reuse policy (optional)"
              htmlFor="inst-enrol-kyc-policy"
              hint="All three KYC-reuse references are required together, or none."
            >
              <input
                id="inst-enrol-kyc-policy"
                className="mn-input"
                value={form.kycPolicyReference}
                maxLength={160}
                onChange={(event) => setForm({ ...form, kycPolicyReference: event.target.value })}
              />
            </Field>
            <div className="mn-inst__form-actions">
              <Button type="submit" variant="primary" disabled={busy}>
                {busy ? 'Working…' : 'Request enrolment change'}
              </Button>
            </div>
          </form>

          {canExecute ? (
            <div className="mn-inst__execute-row">
              <Field label="Approval id" htmlFor="inst-enrol-approval">
                <input
                  id="inst-enrol-approval"
                  className="mn-input mn-inst__mono"
                  value={form.approvalId}
                  onChange={(event) => setForm({ ...form, approvalId: event.target.value })}
                />
              </Field>
              <Button variant="danger" disabled={busy} onClick={() => void submit('execute')}>
                Execute approved enrolment change
              </Button>
            </div>
          ) : (
            <p className="mn-inst__hint">
              Executing requires <code>institution.enrolment.approve</code> plus an approval issued to
              this exact payload.
            </p>
          )}
        </section>
      ) : null}

      {canCrossRead ? (
        <section className="mn-inst__panel" aria-labelledby="mn-inst-enrolment-lookup">
          <h2 id="mn-inst-enrolment-lookup" className="mn-inst__panel-title">
            Customer-anchored lookup (platform only)
          </h2>
          <p className="mn-inst__panel-note">
            Shows every institution enrolment held by one unified customer identity. This is a
            platform-level read: an institution-scoped operator cannot enumerate another
            institution's relationship through a shared customer id.
          </p>
          <div className="mn-inst__execute-row">
            <Field label="Customer id" htmlFor="inst-enrol-lookup">
              <input
                id="inst-enrol-lookup"
                className="mn-input mn-inst__mono"
                value={lookupId}
                onChange={(event) => setLookupId(event.target.value)}
              />
            </Field>
            <Button onClick={() => void runLookup()} disabled={!lookupId.trim()}>
              Look up enrolments
            </Button>
          </div>
          {lookupError ? <p className="mn-inst__hint">{lookupError}</p> : null}
          {lookup ? (
            lookup.length === 0 ? (
              <p className="mn-inst__hint">This customer holds no institution enrolment.</p>
            ) : (
              <ul className="mn-inst__timeline">
                {lookup.map((row) => (
                  <li key={row.id}>
                    institution <span className="mn-inst__mono">{shortId(row.institutionId)}</span> ·{' '}
                    {row.status} · {row.financialEligibility.replace(/_/g, ' ')} · since{' '}
                    {formatTimestamp(row.effectiveFrom)}
                  </li>
                ))}
              </ul>
            )
          ) : null}
        </section>
      ) : null}

      {error ? (
        <Alert tone="danger" title="Not completed">
          {error}
        </Alert>
      ) : null}
      {notice ? (
        <Alert tone="success" title="Enrolment">
          {notice}
        </Alert>
      ) : null}
    </div>
  );
};

// ----------------------------------------------------------------------------------- accounts

const LEDGER_PURPOSES: LedgerPurpose[] = ['SETTLEMENT', 'SUSPENSE', 'CLEARING'];

export const InstitutionAccountsTab: React.FC<{ institution: InstitutionSummary }> = ({
  institution,
}) => {
  const { principal } = useAuthStore();
  const scopes = principal?.scopes ?? [];
  const canManage = hasAnyScope(scopes, INSTITUTION_FUNCTIONS.manage) && !principal?.readOnlyPrincipal;
  const canPrepare =
    hasAnyScope(scopes, INSTITUTION_FUNCTIONS.attributionPrepare) && !principal?.readOnlyPrincipal;
  const canExecute =
    hasAnyScope(scopes, INSTITUTION_FUNCTIONS.attributionApprove) && !principal?.readOnlyPrincipal;
  const canSeePlatform = hasAnyScope(scopes, INSTITUTION_FUNCTIONS.attributionView);

  const [accountForm, setAccountForm] = useState({
    code: '',
    name: '',
    accountType: 'LIABILITY' as 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE',
    normalBalance: 'CREDIT' as 'DEBIT' | 'CREDIT',
    currency: 'NGN',
    purpose: 'SETTLEMENT' as LedgerPurpose,
  });
  const [attributionForm, setAttributionForm] = useState({
    walletId: '',
    evidenceType: 'INSTITUTION_AGREEMENT' as AttributionEvidenceType,
    evidenceReference: '',
    reason: '',
    approvalId: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const accounts = useConsoleData<InstitutionLedgerAccount[]>(
    () => InstitutionAdminApi.listLedgerAccounts(institution.id),
    [institution.id],
    'Institutional ledger accounts could not be loaded.',
  );
  const attributions = useConsoleData<AttributionRecord[]>(
    () => InstitutionAdminApi.listAttributions(institution.id),
    [institution.id],
    'Wallet attributions could not be loaded.',
  );
  const unattributed = useConsoleData<UnattributedAccount[]>(
    () =>
      canSeePlatform
        ? InstitutionAdminApi.unattributedAccounts({ limit: 200 })
        : Promise.resolve([]),
    [canSeePlatform],
    'Unattributed accounts could not be loaded.',
  );

  const openAccount = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canManage || busy) return;
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      await InstitutionAdminApi.openLedgerAccount(institution.id, {
        code: accountForm.code.trim(),
        name: accountForm.name.trim(),
        accountType: accountForm.accountType,
        normalBalance: accountForm.normalBalance,
        currency: accountForm.currency.trim().toUpperCase(),
        purpose: accountForm.purpose,
      });
      setNotice(
        'Institutional ledger account opened. Only institution-scoped purposes are available; platform operations accounts are designated separately by the platform.',
      );
      setAccountForm({
        code: '',
        name: '',
        accountType: 'LIABILITY',
        normalBalance: 'CREDIT',
        currency: 'NGN',
        purpose: 'SETTLEMENT',
      });
      accounts.reload();
    } catch (caught) {
      setError(describeError(caught, 'The ledger account could not be opened.'));
    } finally {
      setBusy(false);
    }
  };

  const submitAttribution = async (mode: 'request' | 'execute') => {
    if (busy) return;
    setError(null);
    setNotice(null);
    if (!attributionForm.walletId.trim() || !attributionForm.evidenceReference.trim()) {
      setError('Wallet id and evidence reference are required.');
      return;
    }
    if (attributionForm.reason.trim().length < 10) {
      setError('A reason of at least 10 characters is required.');
      return;
    }
    if (mode === 'execute' && !attributionForm.approvalId.trim()) {
      setError('An approval id is required to execute.');
      return;
    }
    if (
      mode === 'execute' &&
      !window.confirm(
        `Attribute wallet ${shortId(attributionForm.walletId)} to ${institution.reference}? Attribution is effective immediately and audited.`,
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const payload = {
        walletId: attributionForm.walletId.trim(),
        evidenceType: attributionForm.evidenceType,
        evidenceReference: attributionForm.evidenceReference.trim(),
        reason: attributionForm.reason.trim(),
      };
      if (mode === 'request') {
        const receipt = await InstitutionAdminApi.requestAttribution(institution.id, payload);
        setNotice(
          `Attribution request recorded (approval ${receipt.approvalId}). An independent checker must approve it; the wallet is unchanged until execution.`,
        );
        setAttributionForm((current) => ({ ...current, approvalId: receipt.approvalId }));
      } else {
        await InstitutionAdminApi.executeAttribution(institution.id, {
          ...payload,
          approvalId: attributionForm.approvalId.trim(),
        });
        setNotice('Wallet attribution executed.');
        setAttributionForm({
          walletId: '',
          evidenceType: 'INSTITUTION_AGREEMENT',
          evidenceReference: '',
          reason: '',
          approvalId: '',
        });
        attributions.reload();
        unattributed.reload();
      }
    } catch (caught) {
      setError(describeError(caught, 'The attribution change was refused.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mn-inst__stack">
      <Alert tone="info" title="Attribution moves no money">
        Attributing a wallet records which institution owns it. It never migrates a balance, never
        re-posts ledger history and never changes a customer's funds. A wallet whose ledger account
        already carries posted history cannot be re-attributed — the ledger is append-only, so the
        only safe path is a governed cut-over performed as its own approved operation, which this
        console does not perform.
      </Alert>

      <section className="mn-inst__panel" aria-labelledby="mn-inst-accounts">
        <div className="mn-inst__list-head">
          <h2 id="mn-inst-accounts" className="mn-inst__panel-title">
            Institutional ledger accounts
          </h2>
          <Button variant="quiet" size="sm" onClick={accounts.reload} disabled={accounts.loading}>
            Refresh
          </Button>
        </div>
        {accounts.error ? (
          <Alert tone="danger" title="Accounts unavailable">
            {accounts.error}
          </Alert>
        ) : accounts.loading && !accounts.data ? (
          <p className="mn-inst__hint" role="status">
            Loading accounts…
          </p>
        ) : (accounts.data ?? []).length === 0 ? (
          <p className="mn-inst__hint">
            No institutional ledger account is open. Settlement, suspense and clearing accounts are
            opened here; platform operations accounts are not yours to open.
          </p>
        ) : (
          <ScrollRegion label="Institutional ledger accounts" hint="Scroll horizontally for all columns.">
            <table className="mn-inst__table">
              <thead>
                <tr>
                  <th scope="col">Code</th>
                  <th scope="col">Name</th>
                  <th scope="col">Type</th>
                  <th scope="col">Normal balance</th>
                  <th scope="col">Currency</th>
                  <th scope="col">Purpose</th>
                  <th scope="col">Scope</th>
                  <th scope="col">Active</th>
                </tr>
              </thead>
              <tbody>
                {(accounts.data ?? []).map((row) => (
                  <tr key={row.id}>
                    <td className="mn-inst__mono">{row.code}</td>
                    <td>{row.name}</td>
                    <td>{row.accountType}</td>
                    <td>{row.normalBalance}</td>
                    <td>{row.currency}</td>
                    <td>{row.institutionalPurpose?.replace(/_/g, ' ') ?? '—'}</td>
                    <td>
                      <StatusBadge tone={row.institutionalScope === 'INSTITUTION' ? 'success' : 'neutral'}>
                        {row.institutionalScope}
                      </StatusBadge>
                    </td>
                    <td>{row.isActive ? 'Yes' : 'No'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollRegion>
        )}
      </section>

      {canManage ? (
        <section className="mn-inst__panel" aria-labelledby="mn-inst-open-account">
          <h2 id="mn-inst-open-account" className="mn-inst__panel-title">
            Open an institutional ledger account
          </h2>
          <form className="mn-inst__grid" onSubmit={openAccount}>
            <Field label="Code" htmlFor="inst-account-code" hint="3–100 characters.">
              <input
                id="inst-account-code"
                className="mn-input"
                value={accountForm.code}
                maxLength={100}
                onChange={(event) => setAccountForm({ ...accountForm, code: event.target.value })}
                required
              />
            </Field>
            <Field label="Name" htmlFor="inst-account-name">
              <input
                id="inst-account-name"
                className="mn-input"
                value={accountForm.name}
                maxLength={160}
                onChange={(event) => setAccountForm({ ...accountForm, name: event.target.value })}
                required
              />
            </Field>
            <Field label="Account type" htmlFor="inst-account-type">
              <select
                id="inst-account-type"
                className="mn-input"
                value={accountForm.accountType}
                onChange={(event) =>
                  setAccountForm({
                    ...accountForm,
                    accountType: event.target.value as typeof accountForm.accountType,
                  })
                }
              >
                {['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'].map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Normal balance" htmlFor="inst-account-normal">
              <select
                id="inst-account-normal"
                className="mn-input"
                value={accountForm.normalBalance}
                onChange={(event) =>
                  setAccountForm({
                    ...accountForm,
                    normalBalance: event.target.value as 'DEBIT' | 'CREDIT',
                  })
                }
              >
                <option value="DEBIT">DEBIT</option>
                <option value="CREDIT">CREDIT</option>
              </select>
            </Field>
            <Field label="Currency" htmlFor="inst-account-currency" hint="ISO 4217, e.g. NGN.">
              <input
                id="inst-account-currency"
                className="mn-input"
                value={accountForm.currency}
                maxLength={3}
                onChange={(event) =>
                  setAccountForm({ ...accountForm, currency: event.target.value })
                }
                required
              />
            </Field>
            <Field label="Purpose" htmlFor="inst-account-purpose">
              <select
                id="inst-account-purpose"
                className="mn-input"
                value={accountForm.purpose}
                onChange={(event) =>
                  setAccountForm({ ...accountForm, purpose: event.target.value as LedgerPurpose })
                }
              >
                {LEDGER_PURPOSES.map((purpose) => (
                  <option key={purpose} value={purpose}>
                    {purpose}
                  </option>
                ))}
              </select>
            </Field>
            <div className="mn-inst__form-actions">
              <Button type="submit" variant="primary" disabled={busy}>
                {busy ? 'Opening…' : 'Open account'}
              </Button>
            </div>
          </form>
        </section>
      ) : null}

      <section className="mn-inst__panel" aria-labelledby="mn-inst-attributions">
        <div className="mn-inst__list-head">
          <h2 id="mn-inst-attributions" className="mn-inst__panel-title">
            Governed wallet attributions
          </h2>
          <Button variant="quiet" size="sm" onClick={attributions.reload} disabled={attributions.loading}>
            Refresh
          </Button>
        </div>
        {attributions.error ? (
          <Alert tone="danger" title="Attributions unavailable">
            {attributions.error}
          </Alert>
        ) : attributions.loading && !attributions.data ? (
          <p className="mn-inst__hint" role="status">
            Loading attributions…
          </p>
        ) : (attributions.data ?? []).length === 0 ? (
          <p className="mn-inst__hint">No wallet is attributed to this institution.</p>
        ) : (
          <ScrollRegion label="Wallet attributions" hint="Scroll horizontally for all columns.">
            <table className="mn-inst__table">
              <thead>
                <tr>
                  <th scope="col">Wallet</th>
                  <th scope="col">Owner</th>
                  <th scope="col">Evidence</th>
                  <th scope="col">Executed</th>
                  <th scope="col">By</th>
                  <th scope="col">Approval</th>
                </tr>
              </thead>
              <tbody>
                {(attributions.data ?? []).map((row) => (
                  <tr key={row.attributionId}>
                    <td className="mn-inst__mono">{shortId(row.walletId)}</td>
                    <td>
                      {row.ownerClass}
                      <span className="mn-inst__secondary">{row.ownerReference}</span>
                    </td>
                    <td>
                      <span className="mn-inst__secondary">
                        {row.evidenceType.replace(/_/g, ' ')}
                      </span>
                      <span className="mn-inst__secondary">{row.evidenceReference}</span>
                    </td>
                    <td className="mn-inst__mono">{formatTimestamp(row.executedAt)}</td>
                    <td className="mn-inst__mono">{shortId(row.executedBy)}</td>
                    <td className="mn-inst__mono">{shortId(row.approvalId)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollRegion>
        )}

        {canPrepare ? (
          <form
            className="mn-inst__grid mn-inst__grid--spaced"
            onSubmit={(event) => {
              event.preventDefault();
              void submitAttribution('request');
            }}
          >
            <Field label="Wallet id" htmlFor="inst-attr-wallet">
              <input
                id="inst-attr-wallet"
                className="mn-input mn-inst__mono"
                value={attributionForm.walletId}
                onChange={(event) =>
                  setAttributionForm({ ...attributionForm, walletId: event.target.value })
                }
                required
              />
            </Field>
            <Field label="Evidence type" htmlFor="inst-attr-evidence-type">
              <select
                id="inst-attr-evidence-type"
                className="mn-input"
                value={attributionForm.evidenceType}
                onChange={(event) =>
                  setAttributionForm({
                    ...attributionForm,
                    evidenceType: event.target.value as AttributionEvidenceType,
                  })
                }
              >
                {ATTRIBUTION_EVIDENCE.map((type) => (
                  <option key={type} value={type}>
                    {type.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Evidence reference" htmlFor="inst-attr-evidence-ref">
              <input
                id="inst-attr-evidence-ref"
                className="mn-input"
                value={attributionForm.evidenceReference}
                maxLength={160}
                onChange={(event) =>
                  setAttributionForm({ ...attributionForm, evidenceReference: event.target.value })
                }
                required
              />
            </Field>
            <Field label="Reason" htmlFor="inst-attr-reason" hint="At least 10 characters.">
              <textarea
                id="inst-attr-reason"
                className="mn-input"
                rows={3}
                maxLength={500}
                value={attributionForm.reason}
                onChange={(event) =>
                  setAttributionForm({ ...attributionForm, reason: event.target.value })
                }
                required
              />
            </Field>
            <div className="mn-inst__form-actions">
              <Button type="submit" variant="primary" disabled={busy}>
                {busy ? 'Working…' : 'Request attribution'}
              </Button>
            </div>
          </form>
        ) : null}

        {canExecute ? (
          <div className="mn-inst__execute-row">
            <Field label="Approval id" htmlFor="inst-attr-approval">
              <input
                id="inst-attr-approval"
                className="mn-input mn-inst__mono"
                value={attributionForm.approvalId}
                onChange={(event) =>
                  setAttributionForm({ ...attributionForm, approvalId: event.target.value })
                }
              />
            </Field>
            <Button variant="danger" disabled={busy} onClick={() => void submitAttribution('execute')}>
              Execute approved attribution
            </Button>
          </div>
        ) : (
          <p className="mn-inst__hint">
            Executing an attribution requires <code>institution.attribution.approve</code> and an
            approval bound to the same wallet, evidence and reason.
          </p>
        )}
      </section>

      {canSeePlatform ? (
        <section className="mn-inst__panel" aria-labelledby="mn-inst-unattributed">
          <div className="mn-inst__list-head">
            <h2 id="mn-inst-unattributed" className="mn-inst__panel-title">
              Unattributed financial accounts (platform)
            </h2>
            <Button variant="quiet" size="sm" onClick={unattributed.reload} disabled={unattributed.loading}>
              Refresh
            </Button>
          </div>
          <p className="mn-inst__panel-note">
            Accounts with no institutional attribution. Accounts with posted ledger lines are listed
            but cannot be attributed here: their history belongs to the ledger and is not rewritten.
          </p>
          {unattributed.error ? (
            <p className="mn-inst__hint">{unattributed.error}</p>
          ) : unattributed.loading && !unattributed.data ? (
            <p className="mn-inst__hint" role="status">
              Loading unattributed accounts…
            </p>
          ) : (unattributed.data ?? []).length === 0 ? (
            <p className="mn-inst__hint">No unattributed financial account was reported.</p>
          ) : (
            <ScrollRegion label="Unattributed accounts" hint="Scroll horizontally for all columns.">
              <table className="mn-inst__table">
                <thead>
                  <tr>
                    <th scope="col">Entity</th>
                    <th scope="col">Owner</th>
                    <th scope="col">Currency</th>
                    <th scope="col">Status</th>
                    <th scope="col">Posted ledger lines</th>
                    <th scope="col">Balance (minor)</th>
                    <th scope="col">Attributable</th>
                  </tr>
                </thead>
                <tbody>
                  {(unattributed.data ?? []).map((row) => (
                    <tr key={`${row.entity}-${row.entityId}`}>
                      <td>{row.entity}</td>
                      <td>
                        {row.ownerClass ?? '—'}
                        <span className="mn-inst__secondary">{row.ownerReference ?? ''}</span>
                      </td>
                      <td>{row.currency}</td>
                      <td>{row.status}</td>
                      <td className="mn-inst__mono">{row.ledgerLineCount}</td>
                      <td className="mn-inst__mono">{row.balanceMinor}</td>
                      <td>
                        {row.ledgerLineCount > 0 ? (
                          <StatusBadge tone="warning">Posted history — not attributable</StatusBadge>
                        ) : (
                          <StatusBadge tone="info">Attributable via governed request</StatusBadge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollRegion>
          )}
        </section>
      ) : null}

      {error ? (
        <Alert tone="danger" title="Not completed">
          {error}
        </Alert>
      ) : null}
      {notice ? (
        <Alert tone="success" title="Financial accounts">
          {notice}
        </Alert>
      ) : null}
    </div>
  );
};
