import './operational-surfaces.css';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Button,
  PageHeader,
  ScrollRegion,
  StatusBadge,
} from '../../design-system/primitives';
import { ApiError, NetworkError } from '../../services/api-client';
import {
  BankingAdminApi,
  type ExceptionResolution,
  type ProviderCapabilityDescriptor,
  type ProviderReadiness,
  type ProviderReadinessState,
  type ReconciliationException,
  type ReconciliationRun,
} from '../../services/banking-admin-api';

/**
 * ARENA 3D — banking operations workspace.
 *
 * Every figure and state on this screen comes from `/internal/banking/*`. Nothing is mocked, and no
 * value is derived: if the server has not said it, the screen does not show it.
 *
 * Three deliberate presentation decisions:
 *
 * - **Readiness is shown per provider, never as one global badge.** Approval, credentialing and
 *   operational status are institution-scoped facts; a single "banking is enabled" indicator would be
 *   making a claim about a specific institution without saying which.
 * - **Entitlement is rendered as unknown, in words.** The server never asserts an entitlement, and the
 *   screen must not let a green badge imply one. The copy says so explicitly.
 * - **Reconciliation actions are labelled as recording, not fixing.** Resolving an exception records a
 *   decision and evidence; it does not move money. The UI says that next to the buttons, because an
 *   operator who believes they just corrected a balance will not escalate the one that needed it.
 */

const READINESS_TONE: Record<ProviderReadinessState, 'success' | 'warning' | 'danger' | 'neutral'> =
  {
    OPERATIONAL_BUT_ENTITLEMENT_UNCONFIRMED: 'warning',
    APPROVED_NOT_CREDENTIALED: 'warning',
    CREDENTIALED_NOT_OPERATIONAL: 'warning',
    IMPLEMENTED_NOT_APPROVED: 'neutral',
    DISABLED: 'neutral',
    UNSUPPORTED: 'neutral',
    NOT_REGISTERED: 'danger',
  };

const READINESS_LABEL: Record<ProviderReadinessState, string> = {
  OPERATIONAL_BUT_ENTITLEMENT_UNCONFIRMED: 'Operational — entitlement unconfirmed',
  APPROVED_NOT_CREDENTIALED: 'Approved, not credentialed',
  CREDENTIALED_NOT_OPERATIONAL: 'Credentialed, not operational',
  IMPLEMENTED_NOT_APPROVED: 'Implemented, not approved',
  DISABLED: 'Disabled',
  UNSUPPORTED: 'Not supported',
  NOT_REGISTERED: 'Not registered',
};

function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    // 403 means the signed-in operator lacks the capability; say so rather than "something failed".
    if (error.status === 403)
      return 'You do not have the banking function required for this action.';
    if (error.status === 401) return 'Your session has expired. Sign in again.';
    return error.message;
  }
  if (error instanceof NetworkError) return 'The server could not be reached. Nothing was changed.';
  return 'An unexpected error occurred. Nothing was changed.';
}

export const BankingOperationsScreen: React.FC<{
  /** Deep link into the reconciliation evidence workspace for this institution. */
  onOpenReconciliation?: (institutionId: string) => void;
  initialInstitutionId?: string;
}> = ({ onOpenReconciliation, initialInstitutionId }) => {
  const [institutionId, setInstitutionId] = useState(initialInstitutionId ?? '');
  const [readiness, setReadiness] = useState<ProviderReadiness[] | null>(null);
  const [registered, setRegistered] = useState<string[]>([]);
  const [capabilities, setCapabilities] = useState<ProviderCapabilityDescriptor[]>([]);
  const [runs, setRuns] = useState<ReconciliationRun[]>([]);
  const [exceptions, setExceptions] = useState<ReconciliationException[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [exceptionQuery, setExceptionQuery] = useState('');
  const [exceptionSeverity, setExceptionSeverity] = useState('');
  const autoLoaded = useRef(false);

  const clearFeedback = () => {
    setError(null);
    setNotice(null);
  };

  const loadCapabilities = useCallback(async () => {
    try {
      setCapabilities(await BankingAdminApi.capabilities());
    } catch (caught) {
      setError(describeError(caught));
    }
  }, []);

  useEffect(() => {
    void loadCapabilities();
  }, [loadCapabilities]);

  const loadInstitution = useCallback(
    async (target: string, options: { keepNotice?: boolean } = {}) => {
      if (!target) return;
      setBusy(true);
      // A refresh triggered by a completed action must not erase the confirmation of that action; the
      // operator would click, see the banner vanish, and reasonably conclude it had not worked.
      if (!options.keepNotice) clearFeedback();
      else setError(null);
      try {
        const [readinessResponse, runList, exceptionList] = await Promise.all([
          BankingAdminApi.readiness(target),
          BankingAdminApi.reconciliationRuns(target),
          BankingAdminApi.exceptions(target),
        ]);
        setReadiness(readinessResponse.providers);
        setRegistered(readinessResponse.registered);
        setRuns(runList);
        setExceptions(exceptionList);
      } catch (caught) {
        setReadiness(null);
        setRuns([]);
        setExceptions([]);
        setError(describeError(caught));
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const startRun = async (providerKey: string) => {
    setBusy(true);
    clearFeedback();
    try {
      await BankingAdminApi.startReconciliation(
        institutionId,
        providerKey,
        `recon-${institutionId}-${providerKey}-${Date.now()}`,
      );
      setNotice(
        'Reconciliation run started. It only reads provider records and produces exceptions; it cannot move money.',
      );
      await loadInstitution(institutionId, { keepNotice: true });
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  };

  const resolve = async (exceptionId: string, resolution: ExceptionResolution, note: string) => {
    setBusy(true);
    clearFeedback();
    try {
      await BankingAdminApi.resolveException(exceptionId, resolution, note);
      setNotice(
        'Resolution recorded. This documents a decision and evidence; any actual correction must go through the separately authorized financial workflow.',
      );
      await loadInstitution(institutionId, { keepNotice: true });
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  };

  const anyUsable = useMemo(() => (readiness ?? []).some((entry) => entry.usable), [readiness]);

  // The exception list is the server's open set for this institution; these filters narrow what is
  // already loaded and never imply that unloaded exceptions do not exist.
  const visibleExceptions = useMemo(() => {
    const query = exceptionQuery.trim().toLowerCase();
    return exceptions.filter((exception) => {
      if (exceptionSeverity && exception.severity !== exceptionSeverity) return false;
      if (!query) return true;
      return `${exception.kind} ${exception.operationReference ?? ''} ${exception.id}`
        .toLowerCase()
        .includes(query);
    });
  }, [exceptions, exceptionQuery, exceptionSeverity]);

  useEffect(() => {
    if (autoLoaded.current || !initialInstitutionId) return;
    autoLoaded.current = true;
    void loadInstitution(initialInstitutionId);
  }, [initialInstitutionId, loadInstitution]);

  return (
    <div className="mn-page">
      <PageHeader
        eyebrow="Banking"
        title="Banking operations"
        description="Provider readiness, reconciliation runs and exception triage for one institution."
      />

      <div role="note" className="mn-muted" data-testid="banking-evidence-boundary">
        <strong>External provider evidence only.</strong> This workspace reads provider records and
        records decisions about them. Internal ledger agreement, statement evidence and the
        institution-wide break list live in Reconciliation → External Evidence &amp; Breaks.
        {onOpenReconciliation && (
          <>
            {' '}
            <Button
              type="button"
              variant="secondary"
              data-testid="banking-open-evidence-breaks"
              disabled={!institutionId.trim()}
              onClick={() => onOpenReconciliation(institutionId.trim())}
            >
              Open evidence &amp; breaks
            </Button>
          </>
        )}
      </div>

      <form
        className="mn-toolbar"
        onSubmit={(event) => {
          event.preventDefault();
          void loadInstitution(institutionId.trim());
        }}
      >
        <label htmlFor="banking-institution-id">Institution ID</label>
        <input
          id="banking-institution-id"
          value={institutionId}
          onChange={(event) => setInstitutionId(event.target.value)}
          placeholder="Institution UUID"
          autoComplete="off"
          spellCheck={false}
        />
        <Button type="submit" disabled={busy || institutionId.trim().length === 0}>
          {busy ? 'Loading…' : 'Load'}
        </Button>
      </form>

      {error ? (
        <Alert tone="danger" title="Could not load banking data">
          {error}
        </Alert>
      ) : null}
      {notice ? (
        <Alert tone="info" title="Recorded">
          {notice}
        </Alert>
      ) : null}

      <ScrollRegion label="Provider readiness">
        {readiness === null ? (
          <p className="mn-muted">
            Load an institution to see provider readiness. Nothing is shown until the server
            answers, because readiness is a statement about a specific institution.
          </p>
        ) : readiness.length === 0 ? (
          <Alert tone="warning" title="No banking provider is configured">
            No provider is registered for this deployment, so no banking capability is available.
            {registered.length === 0
              ? ' The registry is empty: banking is disabled unless credentials and approval are both present.'
              : null}
          </Alert>
        ) : (
          <>
            {!anyUsable ? (
              <Alert tone="warning" title="No provider is operational for this institution">
                Every provider below is in a state that cannot carry a live operation. New banking
                operations will be refused until one reaches operational readiness.
              </Alert>
            ) : null}
            <table className="mn-table">
              <caption className="mn-visually-hidden">
                Provider readiness states for the selected institution
              </caption>
              <thead>
                <tr>
                  <th scope="col">Provider</th>
                  <th scope="col">State</th>
                  <th scope="col">Approved</th>
                  <th scope="col">Credentialed</th>
                  <th scope="col">Entitlement</th>
                </tr>
              </thead>
              <tbody>
                {readiness.map((entry) => (
                  <tr key={`${entry.providerKey}-${entry.capability}`}>
                    <td>{entry.providerKey}</td>
                    <td>
                      <StatusBadge tone={READINESS_TONE[entry.state]}>
                        {READINESS_LABEL[entry.state]}
                      </StatusBadge>
                    </td>
                    <td>{entry.approved ? 'Yes' : 'No'}</td>
                    <td>{entry.credentialed ? 'Yes' : 'No'}</td>
                    <td>
                      {/*
                        Rendered in words on purpose. A blank or a dash would read as "none needed";
                        the truth is that we cannot confirm it.
                      */}
                      <span className="mn-muted">Unknown — not asserted by the system</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </ScrollRegion>

      <ScrollRegion label="Reconciliation runs">
        {runs.length === 0 ? (
          <p className="mn-muted">No reconciliation runs recorded for this institution.</p>
        ) : (
          <table className="mn-table">
            <caption className="mn-visually-hidden">Reconciliation runs</caption>
            <thead>
              <tr>
                <th scope="col">Started</th>
                <th scope="col">Provider</th>
                <th scope="col">State</th>
                <th scope="col">Observations</th>
                <th scope="col">Exceptions</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.id}>
                  <td>{new Date(run.started_at).toLocaleString()}</td>
                  <td>{run.provider_key}</td>
                  <td>
                    <StatusBadge
                      tone={
                        run.state === 'FAILED'
                          ? 'danger'
                          : run.state === 'RUNNING'
                            ? 'warning'
                            : 'success'
                      }
                    >
                      {run.state}
                    </StatusBadge>
                  </td>
                  <td>{run.observations}</td>
                  <td>{run.exceptions_raised}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {readiness && readiness.length > 0 ? (
          <div className="mn-toolbar">
            {readiness
              .filter((entry) => entry.usable)
              .map((entry) => (
                <Button
                  key={entry.providerKey}
                  type="button"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => void startRun(entry.providerKey)}
                >
                  Run reconciliation ({entry.providerKey})
                </Button>
              ))}
          </div>
        ) : null}
      </ScrollRegion>

      <ScrollRegion label="Open reconciliation exceptions">
        <div className="mn-toolbar" data-testid="banking-exception-filters">
          <label>
            <span className="mn-label">Filter loaded exceptions</span>
            <input
              className="mn-input"
              type="search"
              data-testid="banking-exception-search"
              placeholder="Kind, reference or exception id"
              value={exceptionQuery}
              onChange={(event) => setExceptionQuery(event.target.value)}
            />
          </label>
          <label>
            <span className="mn-label">Severity</span>
            <select
              className="mn-input"
              data-testid="banking-exception-severity"
              value={exceptionSeverity}
              onChange={(event) => setExceptionSeverity(event.target.value)}
            >
              <option value="">Any severity</option>
              <option value="CRITICAL">CRITICAL</option>
              <option value="ERROR">ERROR</option>
              <option value="WARNING">WARNING</option>
            </select>
          </label>
        </div>
        {exceptions.length === 0 ? (
          <p className="mn-muted">No open exceptions.</p>
        ) : visibleExceptions.length === 0 ? (
          <p className="mn-muted" data-testid="banking-exception-empty">
            No loaded open exception matches this filter. The institution still has{' '}
            {exceptions.length} open exception(s).
          </p>
        ) : (
          <table className="mn-table">
            <caption className="mn-visually-hidden">Open reconciliation exceptions</caption>
            <thead>
              <tr>
                <th scope="col">Kind</th>
                <th scope="col">Severity</th>
                <th scope="col">Reference</th>
                <th scope="col">Recorded</th>
                <th scope="col">Action</th>
              </tr>
            </thead>
            <tbody>
              {visibleExceptions.map((exception) => (
                <tr key={exception.id} data-testid={`banking-exception-row-${exception.id}`}>
                  <td>{exception.kind}</td>
                  <td>
                    <StatusBadge tone={exception.severity === 'ERROR' ? 'danger' : 'warning'}>
                      {exception.severity}
                    </StatusBadge>
                  </td>
                  <td>{exception.operationReference ?? '—'}</td>
                  <td>{new Date(exception.createdAt).toLocaleString()}</td>
                  <td>
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={busy}
                      onClick={() =>
                        void resolve(
                          exception.id,
                          'ESCALATED',
                          'Escalated for investigation from the banking workspace; no financial correction applied.',
                        )
                      }
                    >
                      Record escalation
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="mn-muted">
          Resolving an exception records a decision and the evidence behind it. It cannot move,
          correct or settle money — any real correction must use the separately authorized financial
          workflow. A resolution here is not internal ledger agreement: the ledger-side checks and
          statement evidence are reported separately.
        </p>
      </ScrollRegion>

      <ScrollRegion label="Adapter capabilities">
        {capabilities.length === 0 ? (
          <p className="mn-muted">No provider adapters are registered in this build.</p>
        ) : (
          <table className="mn-table">
            <caption className="mn-visually-hidden">Registered provider adapters</caption>
            <thead>
              <tr>
                <th scope="col">Provider</th>
                <th scope="col">Environment</th>
                <th scope="col">Capabilities</th>
              </tr>
            </thead>
            <tbody>
              {capabilities.map((capability) => (
                <tr key={capability.providerKey}>
                  <td>{capability.displayName}</td>
                  <td>{capability.environment}</td>
                  <td>
                    {Object.entries(capability.capabilities)
                      .filter(([, enabled]) => enabled)
                      .map(([name]) => name)
                      .join(', ') || 'None'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </ScrollRegion>
    </div>
  );
};
