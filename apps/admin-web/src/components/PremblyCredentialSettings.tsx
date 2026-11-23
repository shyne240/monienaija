import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Field, StatusBadge } from '../design-system/primitives';
import type { WorkforcePrincipal } from '../store/auth-store';
import {
  createKycRequestId,
  PremblyCredentialApi,
  type PremblyConnectionTestResult,
  type PremblyCredentialProposal,
  type PremblyCredentialStatus,
} from '../services/kyc-governance-api';

interface Props {
  principal: WorkforcePrincipal | null;
  onGuardChange?: (guarded: boolean, busy: boolean) => void;
}

type CredentialEnvironment = 'sandbox' | 'production';

function describeProposal(proposal: PremblyCredentialProposal): string {
  const target = proposal.environment === 'sandbox' ? 'Sandbox' : 'Production';
  const action = proposal.operation === 'SET' ? 'credential replacement' : 'credential removal';
  return `${target} ${action}${proposal.fingerprint ? ` · ${proposal.fingerprint}` : ''}`;
}

export const PremblyCredentialSettings: React.FC<Props> = ({ principal, onGuardChange }) => {
  const [status, setStatus] = useState<PremblyCredentialStatus | null>(null);
  const [proposals, setProposals] = useState<PremblyCredentialProposal[]>([]);
  const [drafts, setDrafts] = useState<Record<CredentialEnvironment, string>>({
    sandbox: '',
    production: '',
  });
  const [testResult, setTestResult] = useState<PremblyConnectionTestResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [testBusy, setTestBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const alive = useRef(true);
  const pendingRequestIds = useRef<Record<CredentialEnvironment, string | null>>({
    sandbox: null,
    production: null,
  });

  const canPropose = Boolean(
    principal &&
    principal.assuranceLevel === 'MFA' &&
    !principal.readOnlyPrincipal &&
    principal.roles.includes('SUPER_ADMIN') &&
    principal.scopes.includes('kyc.provider.propose'),
  );
  const canReview = Boolean(
    principal &&
    principal.assuranceLevel === 'MFA' &&
    !principal.readOnlyPrincipal &&
    principal.roles.includes('COMPLIANCE') &&
    principal.scopes.includes('kyc.provider.approve'),
  );
  const unsavedSecret = Object.values(drafts).some((value) => value.length > 0);

  const refresh = useCallback(async () => {
    try {
      const [nextStatus, nextProposals] = await Promise.all([
        PremblyCredentialApi.status(),
        PremblyCredentialApi.proposals(),
      ]);
      if (!alive.current) return;
      setStatus(nextStatus);
      setProposals(nextProposals);
    } catch {
      if (alive.current)
        setError('Prembly credential status is unavailable. No key values were returned.');
    } finally {
      if (alive.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    void refresh();
    return () => {
      alive.current = false;
    };
  }, [refresh]);

  useEffect(() => {
    onGuardChange?.(unsavedSecret || busy || testBusy, busy || testBusy);
  }, [unsavedSecret, busy, testBusy, onGuardChange]);

  const propose = async (environment: CredentialEnvironment, operation: 'SET' | 'CLEAR') => {
    if (!canPropose || busy || !status) return;
    const apiKey = drafts[environment];
    if (operation === 'SET' && (!apiKey || !status.encryptionAvailable)) {
      setError(
        !status.encryptionAvailable
          ? 'Server-side KYC credential encryption is not configured. No key was submitted.'
          : 'Enter a new key value before proposing a credential change.',
      );
      return;
    }
    setError('');
    setNotice('');
    setTestResult(null);
    setBusy(true);
    try {
      const requestId = pendingRequestIds.current[environment] ?? createKycRequestId();
      pendingRequestIds.current[environment] = requestId;
      const result = await PremblyCredentialApi.propose({
        requestId,
        environment,
        operation,
        ...(operation === 'SET' ? { apiKey } : {}),
      });
      pendingRequestIds.current[environment] = null;
      setDrafts((current) => ({ ...current, [environment]: '' }));
      setNotice(
        result.replay
          ? `Existing credential proposal ${result.id} reloaded for independent review.`
          : `Credential proposal ${result.id} submitted for independent checker review.`,
      );
      await refresh();
    } catch {
      setError(
        'Credential proposal outcome is not confirmed. The key is never returned; retry the same value or refresh the proposal list.',
      );
    } finally {
      setBusy(false);
    }
  };

  const decide = async (proposal: PremblyCredentialProposal, decision: 'approve' | 'reject') => {
    if (
      !canReview ||
      busy ||
      proposal.state !== 'REQUESTED' ||
      proposal.makerId === principal?.principalId ||
      Date.parse(proposal.expiresAt) <= Date.now()
    )
      return;
    setError('');
    setNotice('');
    setBusy(true);
    try {
      const result =
        decision === 'approve'
          ? await PremblyCredentialApi.approve(proposal.id)
          : await PremblyCredentialApi.reject(proposal.id);
      setNotice(
        `${describeProposal(proposal)} ${result.state.toLowerCase()} by an independent checker.`,
      );
      await refresh();
    } catch {
      setError(
        'Credential decision outcome is not confirmed. Refresh the proposal list; do not assume a failed response means the decision was not recorded.',
      );
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const testSandbox = async () => {
    if (
      !canPropose ||
      !status?.sandbox.configured ||
      !status.sandboxTestEnabled ||
      testBusy ||
      busy
    )
      return;
    setError('');
    setNotice('');
    setTestResult(null);
    setTestBusy(true);
    try {
      const result = await PremblyCredentialApi.testSandboxConnection();
      setTestResult(result);
      setNotice('Received a real Prembly sandbox response. No provider response body was stored.');
      await refresh();
    } catch {
      setError(
        'Prembly sandbox connection test could not be confirmed. The request may have reached the provider; check the audit record before retrying.',
      );
    } finally {
      setTestBusy(false);
    }
  };

  const statusFor = (environment: CredentialEnvironment) => {
    const value = status?.[environment];
    if (!value) return 'Status unavailable';
    if (!value.configured) return 'Not configured';
    return `Configured · ${value.fingerprint ?? 'masked'} · credential version ${value.version}`;
  };

  return (
    <section className="kyc-governance-card" aria-labelledby="prembly-credentials-heading">
      <div className="kyc-governance-card__heading">
        <div>
          <h2 id="prembly-credentials-heading">Prembly credentials</h2>
          <p>
            Sandbox and production keys are stored separately, encrypted server-side and write-only.
            Every set/remove requires a SUPER_ADMIN proposal and a distinct MFA COMPLIANCE checker.
          </p>
        </div>
        <Button size="sm" disabled={busy || testBusy} onClick={() => void refresh()}>
          Refresh
        </Button>
      </div>

      <Alert tone="warning" title="Key and test-data handling">
        BVN Basic and NIN Basic use Prembly's documented x-api-key secret header. This screen does
        not request or send a separate appToken; Prembly's SDK appToken example is for Radar. The
        optional connection test is an actual BVN Basic request using Prembly's published sandbox
        test record. It sends no customer identity, never uses the production key, and may consume
        sandbox credits or quota. The test response is labeled as actual Prembly output, not a
        synthetic test.
      </Alert>

      {error ? (
        <Alert tone="danger" title="Prembly credential action">
          {error}
        </Alert>
      ) : null}
      {notice ? (
        <Alert tone="info" title="Prembly status">
          {notice}
        </Alert>
      ) : null}

      {loading && !status ? <p>Loading encrypted credential status…</p> : null}
      {status ? (
        <>
          <p>
            Server-side encryption: {status.encryptionAvailable ? 'available' : 'not configured'} ·
            production release flags: {status.productionReleased ? 'open' : 'closed'}.
          </p>
          <div className="kyc-provider-form-grid">
            {(['sandbox', 'production'] as const).map((environment) => {
              const environmentStatus = status[environment];
              const label = environment === 'sandbox' ? 'Sandbox' : 'Production';
              return (
                <fieldset className="kyc-provider-fieldset" key={environment}>
                  <legend>Prembly {label} key</legend>
                  <p>
                    <StatusBadge tone={environmentStatus.configured ? 'success' : 'warning'}>
                      {statusFor(environment)}
                    </StatusBadge>
                  </p>
                  {environment === 'production' ? (
                    <p className="kyc-governance-muted">
                      Used only when NODE_ENV=production and the Prembly production release, KYC
                      contract-review and live-call gates are all open. A sandbox key is never
                      substituted.
                    </p>
                  ) : (
                    <p className="kyc-governance-muted">
                      Customer sandbox calls require the explicit sandbox-call and KYC release
                      gates. The production verifier never reads this key.
                    </p>
                  )}
                  <Field
                    label={`New Prembly ${environment} API key (write-only)`}
                    htmlFor={`prembly-${environment}-key`}
                    hint="The value is sent over the authenticated admin API, encrypted on the server, and never returned."
                  >
                    <input
                      id={`prembly-${environment}-key`}
                      className="mn-input"
                      type="password"
                      autoComplete="new-password"
                      maxLength={512}
                      value={drafts[environment]}
                      disabled={!canPropose || busy || testBusy}
                      onChange={(event) =>
                        setDrafts((current) => ({ ...current, [environment]: event.target.value }))
                      }
                    />
                  </Field>
                  <div className="kyc-governance-actions">
                    <Button
                      variant="primary"
                      disabled={
                        !canPropose ||
                        busy ||
                        testBusy ||
                        !drafts[environment] ||
                        !status.encryptionAvailable
                      }
                      onClick={() => void propose(environment, 'SET')}
                    >
                      Propose {environment} key
                    </Button>
                    {environmentStatus.configured ? (
                      <Button
                        variant="danger"
                        disabled={!canPropose || busy || testBusy}
                        onClick={() => void propose(environment, 'CLEAR')}
                      >
                        Propose removal
                      </Button>
                    ) : null}
                  </div>
                  {!canPropose ? (
                    <p className="kyc-governance-muted">
                      Key changes require an MFA SUPER_ADMIN session with kyc.provider.propose.
                    </p>
                  ) : null}
                </fieldset>
              );
            })}
          </div>

          <div className="kyc-governance-actions">
            <Button
              variant="secondary"
              disabled={
                !canPropose ||
                !status.sandbox.configured ||
                !status.sandboxTestEnabled ||
                busy ||
                testBusy
              }
              onClick={() => void testSandbox()}
            >
              {testBusy ? 'Testing Prembly sandbox…' : 'Test saved sandbox key'}
            </Button>
            {!status.sandboxTestEnabled ? (
              <span className="kyc-governance-muted">
                Sandbox connection testing is disabled by deployment configuration.
              </span>
            ) : null}
            {!status.sandbox.configured ? (
              <span className="kyc-governance-muted">Save and approve a sandbox key first.</span>
            ) : null}
          </div>
          {testResult ? (
            <Alert
              tone={testResult.outcome === 'CONNECTED' ? 'success' : 'warning'}
              title="Actual Prembly sandbox result"
            >
              Source: {testResult.source} · operation: {testResult.operation} · outcome:{' '}
              {testResult.outcome} · HTTP {testResult.httpStatus ?? 'unknown'} · provider code{' '}
              {testResult.responseCode ?? 'unavailable'} ·{' '}
              {new Date(testResult.testedAt).toLocaleString()}. No identity fields, billing body,
              provider reference or API key is included.
            </Alert>
          ) : null}
        </>
      ) : null}

      <section aria-labelledby="prembly-credential-proposals-heading">
        <div className="kyc-governance-card__heading">
          <div>
            <h3 id="prembly-credential-proposals-heading">Credential proposals</h3>
            <p>Credential changes are version-bound, immutable and independently checked.</p>
          </div>
        </div>
        {proposals.length === 0 ? (
          <p>No Prembly credential proposals.</p>
        ) : (
          <div className="kyc-governance-list">
            {proposals.map((proposal) => (
              <article className="kyc-governance-list-item" key={proposal.id}>
                <div className="kyc-governance-list-item__heading">
                  <strong>{describeProposal(proposal)}</strong>
                  <StatusBadge
                    tone={
                      proposal.state === 'REQUESTED'
                        ? 'warning'
                        : proposal.state === 'APPROVED'
                          ? 'success'
                          : 'neutral'
                    }
                  >
                    {proposal.state}
                  </StatusBadge>
                </div>
                <p>
                  Proposal {proposal.id} · maker {proposal.makerId} · credential version{' '}
                  {proposal.expectedCredentialVersion} →{' '}
                  {proposal.expectedCredentialVersion + (proposal.state === 'APPROVED' ? 1 : 0)} ·
                  expires {new Date(proposal.expiresAt).toLocaleString()}.
                </p>
                {proposal.state === 'REQUESTED' && canReview ? (
                  <div className="kyc-governance-actions">
                    {proposal.makerId === principal?.principalId ? (
                      <span className="kyc-governance-muted">
                        Maker cannot review own proposal.
                      </span>
                    ) : null}
                    <Button
                      variant="primary"
                      disabled={
                        busy ||
                        testBusy ||
                        proposal.makerId === principal?.principalId ||
                        Date.parse(proposal.expiresAt) <= Date.now()
                      }
                      onClick={() => void decide(proposal, 'approve')}
                    >
                      Approve credential change
                    </Button>
                    <Button
                      variant="danger"
                      disabled={
                        busy ||
                        testBusy ||
                        proposal.makerId === principal?.principalId ||
                        Date.parse(proposal.expiresAt) <= Date.now()
                      }
                      onClick={() => void decide(proposal, 'reject')}
                    >
                      Reject credential change
                    </Button>
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        )}
        {!canReview ? (
          <p className="kyc-governance-muted">
            Decisions require a distinct MFA COMPLIANCE session with kyc.provider.approve.
          </p>
        ) : null}
      </section>
    </section>
  );
};
