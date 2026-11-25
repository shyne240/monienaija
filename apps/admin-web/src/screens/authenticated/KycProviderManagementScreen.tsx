import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Field, PageHeader, StatusBadge } from '../../design-system/primitives';
import { PremblyCredentialSettings } from '../../components/PremblyCredentialSettings';
import { useAuthStore, type WorkforcePrincipal } from '../../store/auth-store';
import {
  createKycRequestId,
  KycProviderGovernanceApi,
  PremblyCredentialApi,
  KYC_PROVIDER_CAPABILITIES,
  type KycProviderCapability,
  type KycProviderCode,
  type KycProviderConfiguration,
  type KycProviderHistory,
  type KycProviderProposal,
  type KycProviderWorkspace,
  type PremblyConnectionTestResult,
  type PremblyCredentialProposal,
  type PremblyCredentialStatus,
} from '../../services/kyc-governance-api';
import './kyc-governance.css';

interface Props {
  onGuardChange?: (guarded: boolean, busy: boolean) => void;
  onNavigateToKycReviews?: () => void;
  onNavigateToTierPolicies?: () => void;
}

function copyConfiguration(value: KycProviderConfiguration): KycProviderConfiguration {
  return {
    providers: {
      MONNIFY: {
        enabled: value.providers.MONNIFY.enabled,
        capabilities: [...value.providers.MONNIFY.capabilities],
      },
      DOJAH: {
        enabled: value.providers.DOJAH.enabled,
        capabilities: [...value.providers.DOJAH.capabilities],
      },
      PREMBLY: {
        enabled: value.providers.PREMBLY.enabled,
        capabilities: [...value.providers.PREMBLY.capabilities],
      },
      SYNTHETIC: {
        enabled: value.providers.SYNTHETIC.enabled,
        capabilities: [...value.providers.SYNTHETIC.capabilities],
      },
    },
    routes: Object.fromEntries(
      KYC_PROVIDER_CAPABILITIES.map((capability) => [capability, { ...value.routes[capability] }]),
    ) as KycProviderConfiguration['routes'],
  };
}

const CANDIDATE_CAPABILITIES: Record<
  'MONNIFY' | 'DOJAH' | 'PREMBLY',
  readonly KycProviderCapability[]
> = {
  MONNIFY: ['BVN', 'NIN'],
  DOJAH: ['BVN', 'NIN', 'ADDRESS_VERIFICATION', 'ENHANCED_DUE_DILIGENCE'],
  PREMBLY: ['BVN', 'NIN'],
};
const CAPABILITY_LABELS: Record<KycProviderCapability, string> = {
  BVN: 'BVN identity-number check',
  NIN: 'NIN identity-number check',
  ADDRESS_VERIFICATION: 'Address verification (candidate; review workflow disabled)',
  ENHANCED_DUE_DILIGENCE: 'Enhanced due diligence (candidate; not tier evidence)',
};

const ROUTE_OPTIONS: readonly { value: KycProviderCode | ''; label: string }[] = [
  { value: '', label: 'Not routed' },
  { value: 'MONNIFY', label: 'Monnify (candidate, not dispatch-ready)' },
  { value: 'DOJAH', label: 'Dojah (candidate, not dispatch-ready)' },
  { value: 'PREMBLY', label: 'Prembly (candidate, not dispatch-ready)' },
  { value: 'SYNTHETIC', label: 'Synthetic (test-only)' },
];
const CANDIDATE_PROVIDERS = [
  {
    code: 'MONNIFY',
    name: 'Monnify',
    readiness:
      'Account access, endpoint selection, contract terms, credentials and production controls are not confirmed.',
  },
  {
    code: 'DOJAH',
    name: 'Dojah',
    readiness:
      'Documented BVN Validate and Advanced NIN are candidates only. Address verification and enhanced due diligence are requested operation families, not confirmed Dojah products or contracts; account entitlement and production controls remain unverified.',
  },
  {
    code: 'PREMBLY',
    name: 'Prembly',
    readiness:
      'BVN Basic and NIN Basic endpoints are documented. Sandbox and production API keys are separate, application-encrypted and checker-approved; production remains unavailable until explicit deployment release gates are set.',
  },
] as const;

export const KycProviderManagementScreen: React.FC<Props> = (props) => {
  const { principal } = useAuthStore();
  const key = JSON.stringify([
    principal?.principalId,
    principal?.sessionId,
    principal?.roles,
    principal?.scopes,
    principal?.assuranceLevel,
    principal?.readOnlyPrincipal,
  ]);
  return <KycProviderManagementWorkspace key={key} {...props} principal={principal} />;
};

const KycProviderManagementWorkspace: React.FC<
  Props & { principal: WorkforcePrincipal | null }
> = ({ onGuardChange, onNavigateToKycReviews, onNavigateToTierPolicies, principal }) => {
  const [workspace, setWorkspace] = useState<KycProviderWorkspace | null>(null);
  const [draft, setDraft] = useState<KycProviderConfiguration | null>(null);
  const [baseline, setBaseline] = useState<KycProviderConfiguration | null>(null);
  const [proposals, setProposals] = useState<KycProviderProposal[]>([]);
  const [history, setHistory] = useState<KycProviderHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [reason, setReason] = useState<'INITIAL_SETUP' | 'ROUTING_CHANGE' | 'PROVIDER_DISABLE'>(
    'ROUTING_CHANGE',
  );
  const [retryPending, setRetryPending] = useState(false);
  const [credentialGuard, setCredentialGuard] = useState(false);
  const [credentialBusy, setCredentialBusy] = useState(false);
  const draftRef = useRef<KycProviderConfiguration | null>(null);
  const baselineRef = useRef<KycProviderConfiguration | null>(null);
  const pendingProposal = useRef<{
    requestId: string;
    expectedVersion: number;
    configuration: KycProviderConfiguration;
    reason: 'INITIAL_SETUP' | 'ROUTING_CHANGE' | 'PROVIDER_DISABLE';
  } | null>(null);
  const alive = useRef(true);
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
  const dirty = useMemo(
    () => Boolean(draft && baseline && JSON.stringify(draft) !== JSON.stringify(baseline)),
    [draft, baseline],
  );

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);
  useEffect(() => {
    baselineRef.current = baseline;
  }, [baseline]);

  const refresh = useCallback(async (resetDraft = false) => {
    try {
      const [nextWorkspace, nextProposals, nextHistory] = await Promise.all([
        KycProviderGovernanceApi.workspace(),
        KycProviderGovernanceApi.proposals(),
        KycProviderGovernanceApi.history(),
      ]);
      if (!alive.current) return;
      setWorkspace(nextWorkspace);
      setProposals(nextProposals);
      setHistory(nextHistory);
      const currentDraft = draftRef.current;
      const currentBaseline = baselineRef.current;
      if (
        resetDraft ||
        !currentDraft ||
        !currentBaseline ||
        JSON.stringify(currentDraft) === JSON.stringify(currentBaseline)
      ) {
        const next = copyConfiguration(nextWorkspace.configuration);
        const nextBaseline = copyConfiguration(next);
        draftRef.current = next;
        baselineRef.current = nextBaseline;
        setDraft(next);
        setBaseline(nextBaseline);
      }
    } catch (e) {
      if (alive.current)
        setError(e instanceof Error ? e.message : 'Could not load provider governance.');
    } finally {
      if (alive.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    void refresh(true);
    return () => {
      alive.current = false;
    };
  }, [refresh]);

  const reportCredentialGuard = useCallback((guarded: boolean, isBusy: boolean) => {
    setCredentialGuard(guarded);
    setCredentialBusy(isBusy);
  }, []);

  useEffect(() => {
    onGuardChange?.(dirty || busy || retryPending || credentialGuard, busy || credentialBusy);
  }, [dirty, busy, retryPending, credentialGuard, credentialBusy, onGuardChange]);

  const updateProvider = (
    code: KycProviderCode,
    update: (
      value: KycProviderConfiguration['providers'][KycProviderCode],
    ) => KycProviderConfiguration['providers'][KycProviderCode],
  ) => {
    setDraft((current) =>
      current
        ? {
            ...current,
            providers: { ...current.providers, [code]: update(current.providers[code]) },
          }
        : current,
    );
  };
  const updateRoute = (
    kind: KycProviderCapability,
    field: 'primary' | 'fallback',
    value: string,
  ) => {
    const selected = value ? (value as KycProviderCode) : null;
    setDraft((current) => {
      if (!current) return current;
      const route = current.routes[kind];
      if (field === 'fallback' && (!route.primary || selected === route.primary)) return current;
      const nextRoute =
        field === 'primary'
          ? {
              primary: selected,
              fallback: selected && selected !== route.fallback ? route.fallback : null,
            }
          : { ...route, fallback: selected };
      return {
        ...current,
        routes: { ...current.routes, [kind]: nextRoute },
      };
    });
  };

  const submitProposal = async () => {
    if (!workspace || !draft || !canPropose || busy) return;
    setError('');
    setNotice('');
    if (!pendingProposal.current) {
      try {
        pendingProposal.current = {
          requestId: createKycRequestId(),
          expectedVersion: workspace.version,
          configuration: copyConfiguration(draft),
          reason,
        };
      } catch (e) {
        setError(e instanceof Error ? e.message : 'A secure request id could not be created.');
        return;
      }
    }
    setBusy(true);
    try {
      const result = await KycProviderGovernanceApi.propose(pendingProposal.current);
      pendingProposal.current = null;
      setRetryPending(false);
      const nextBaseline = copyConfiguration(draft);
      baselineRef.current = nextBaseline;
      setBaseline(nextBaseline);
      setNotice(
        result.replay
          ? `Existing proposal ${result.id} reloaded.`
          : `Proposal ${result.id} submitted for independent review.`,
      );
      await refresh(false);
    } catch (e) {
      setRetryPending(true);
      setError(e instanceof Error ? e.message : 'Proposal outcome is not confirmed.');
      setNotice(
        'The same request id is retained in this screen. Retry only to replay this exact proposal, or refresh and inspect the proposal list.',
      );
    } finally {
      setBusy(false);
    }
  };

  const decide = async (proposal: KycProviderProposal, decision: 'approve' | 'reject') => {
    if (
      !canReview ||
      busy ||
      dirty ||
      proposal.state !== 'REQUESTED' ||
      proposal.maker_id === principal?.principalId
    )
      return;
    setError('');
    setNotice('');
    setBusy(true);
    try {
      const result =
        decision === 'approve'
          ? await KycProviderGovernanceApi.approve(proposal.id)
          : await KycProviderGovernanceApi.reject(proposal.id);
      setNotice(`Proposal ${proposal.id} ${result.state.toLowerCase()}.`);
      await refresh(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Decision outcome is not confirmed.');
      setNotice(
        'Reloaded proposal state is authoritative. Do not assume a failed response means the decision was not recorded.',
      );
      await refresh(false);
    } finally {
      setBusy(false);
    }
  };

  const resetDraft = () => {
    if (!workspace) return;
    const next = copyConfiguration(workspace.configuration);
    const nextBaseline = copyConfiguration(next);
    draftRef.current = next;
    baselineRef.current = nextBaseline;
    setDraft(next);
    setBaseline(nextBaseline);
    pendingProposal.current = null;
    setRetryPending(false);
    setError('');
    setNotice('Draft reset to the latest published configuration.');
  };

  if (loading && !workspace) {
    return (
      <div className="kyc-governance-screen" aria-busy="true">
        <p>Loading provider governance…</p>
      </div>
    );
  }

  return (
    <main className="kyc-governance-screen">
      <PageHeader
        eyebrow="Risk & compliance · provider governance"
        title="KYC provider management"
        description="Review fail-closed provider readiness and propose non-secret routing changes. Provider approval does not grant access, establish contract terms, or make an unavailable provider dispatch-ready."
      />
      {(onNavigateToKycReviews || onNavigateToTierPolicies) && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          {onNavigateToKycReviews && (
            <Button variant="secondary" onClick={onNavigateToKycReviews}>
              ← Operational KYC Reviews
            </Button>
          )}
          {onNavigateToTierPolicies && (
            <Button variant="secondary" onClick={onNavigateToTierPolicies}>
              KYC Tier Policies →
            </Button>
          )}
        </div>
      )}
      <div className="kyc-governance-notices">
        {error && (
          <Alert tone="danger" title="Provider workspace error">
            {error}
          </Alert>
        )}
        {notice && (
          <Alert tone="info" title="Status">
            {notice}
          </Alert>
        )}
        <Alert tone="warning" title="Routing approval is not provider readiness">
          The routing editor never accepts or exposes provider secrets. Prembly credentials are
          managed separately below with encrypted, write-only, maker/checker governance. A routing
          proposal cannot satisfy contract-review, credential, adapter, capability or live-call
          release gates. Address verification and enhanced due diligence have no active evidence or
          tier-transition workflow here. Synthetic verification is test-only and is never customer
          evidence.
        </Alert>
      </div>
      {!workspace || !draft ? (
        <section className="kyc-governance-card">
          <p>Provider configuration is unavailable. No provider will be selected.</p>
          <Button
            onClick={() => {
              setLoading(true);
              void refresh(true);
            }}
          >
            Retry
          </Button>
        </section>
      ) : (
        <>
          <section className="kyc-governance-card" aria-labelledby="kyc-provider-role-summary-heading">
            <div className="kyc-governance-card__heading">
              <div>
                <h2 id="kyc-provider-role-summary-heading">Provider roles &amp; routing paths</h2>
                <p>
                  Governed routing applies consistently across customer registration KYC sessions
                  and post-claim customer BVN/NIN verification.
                </p>
              </div>
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                gap: 12,
                fontSize: 13,
              }}
            >
              <div>
                <strong>MONNIFY — Identity (BVN / NIN)</strong>
                <p style={{ margin: '4px 0 0', color: '#475569' }}>
                  Candidate primary or fallback for BVN and NIN verification; gated by{' '}
                  <code>MONNIFY_VERIFICATION_ENABLED</code> and runtime API credentials.
                </p>
              </div>
              <div>
                <strong>DOJAH — Identity &amp; Address Assurance</strong>
                <p style={{ margin: '4px 0 0', color: '#475569' }}>
                  Candidate for BVN/NIN plus the sole configured route holder for{' '}
                  <code>ADDRESS_VERIFICATION</code> and enhanced assurance; assurance adapter fails
                  closed until contract and live-call gates are enabled.
                </p>
              </div>
              <div>
                <strong>PREMBLY — Governed BVN / NIN Adapter</strong>
                <p style={{ margin: '4px 0 0', color: '#475569' }}>
                  Documented BVN Basic and NIN Basic adapter backed by maker-checker AES-256-GCM
                  credentials below (<code>kyc_provider_credentials</code>) and environment release
                  gates.
                </p>
              </div>
            </div>
          </section>
          <section className="kyc-governance-card" aria-labelledby="kyc-provider-readiness-heading">
            <div className="kyc-governance-card__heading">
              <div>
                <h2 id="kyc-provider-readiness-heading">Provider readiness</h2>
                <p>
                  Published routing version {workspace.version}. Readiness is independent from
                  governance approval.
                </p>
              </div>
              <Button
                size="sm"
                onClick={() => {
                  setLoading(true);
                  void refresh(false);
                }}
              >
                Refresh
              </Button>
            </div>
            <div className="kyc-provider-readiness-grid">
              {workspace.catalogue.map((item) => (
                <article className="kyc-provider-status" key={item.code}>
                  <div className="kyc-provider-status__title">
                    <h3>
                      {item.code === 'SYNTHETIC'
                        ? 'Synthetic fixture'
                        : item.code === 'DOJAH'
                          ? 'Dojah'
                          : item.code === 'PREMBLY'
                            ? 'Prembly'
                            : 'Monnify'}
                    </h3>
                    <StatusBadge tone={item.ready ? 'success' : 'warning'}>
                      {item.ready
                        ? 'Ready in this environment'
                        : item.testOnly
                          ? 'Test only'
                          : 'Not dispatch-ready'}
                    </StatusBadge>
                  </div>
                  <p>Candidate capabilities: {item.candidateCapabilities.join(', ') || 'none'}.</p>
                  <p>
                    Confirmed capabilities for this account:{' '}
                    {item.confirmedCapabilities.join(', ') || 'none'}.
                  </p>
                  <ul aria-label={`${item.code} capability readiness`}>
                    {item.capabilities.map((capability) => (
                      <li key={capability.code}>
                        {CAPABILITY_LABELS[capability.code]}:{' '}
                        {capability.ready ? 'ready' : 'not ready'}
                        {capability.confirmed ? ' · contract confirmed' : ' · unconfirmed'}
                      </li>
                    ))}
                  </ul>
                  <p>
                    {item.code === 'MONNIFY'
                      ? 'Public documentation is not entitlement evidence. Account access, endpoint selection, and negotiated terms still require confirmation.'
                      : item.code === 'DOJAH'
                        ? 'Public documentation is not endpoint entitlement or account approval. BVN full-record Basic/Advance access is not assumed; the documented BVN Validate and Advanced NIN products still require account confirmation.'
                        : item.code === 'PREMBLY'
                          ? 'Prembly Basic verification returns provider identity fields used only for server-side matching. Sandbox test keys never satisfy the production key, release, contract-review, or live-call gates.'
                          : 'Synthetic responses are not identity evidence and cannot establish a customer tier.'}
                  </p>
                </article>
              ))}
            </div>
          </section>

          <section className="kyc-governance-card" aria-labelledby="kyc-provider-draft-heading">
            <div className="kyc-governance-card__heading">
              <div>
                <h2 id="kyc-provider-draft-heading">Routing proposal</h2>
                <p>Maker proposals are version-bound and require a different MFA checker.</p>
              </div>
              <StatusBadge tone={dirty ? 'warning' : 'neutral'}>
                {dirty ? 'Unsaved changes' : 'No unsaved changes'}
              </StatusBadge>
            </div>
            <div className="kyc-provider-form-grid">
              {CANDIDATE_PROVIDERS.map(({ code, name, readiness }) => (
                <fieldset className="kyc-provider-fieldset" key={code}>
                  <legend>{name} candidate</legend>
                  <label className="kyc-governance-check">
                    <input
                      type="checkbox"
                      checked={draft.providers[code].enabled}
                      disabled={!canPropose || busy || retryPending}
                      onChange={(event) =>
                        updateProvider(code, (value) => ({
                          ...value,
                          enabled: event.target.checked,
                        }))
                      }
                    />
                    Allow in governed routing configuration (does not activate dispatch)
                  </label>
                  <div className="kyc-governance-checks">
                    {CANDIDATE_CAPABILITIES[code].map((capability) => (
                      <label className="kyc-governance-check" key={capability}>
                        <input
                          type="checkbox"
                          checked={draft.providers[code].capabilities.includes(capability)}
                          disabled={
                            !canPropose ||
                            busy ||
                            retryPending ||
                            draft.routes[capability].primary === code ||
                            draft.routes[capability].fallback === code
                          }
                          onChange={(event) =>
                            updateProvider(code, (value) => ({
                              ...value,
                              capabilities: event.target.checked
                                ? [...value.capabilities, capability]
                                : value.capabilities.filter((item) => item !== capability),
                            }))
                          }
                        />
                        {CAPABILITY_LABELS[capability]}
                      </label>
                    ))}
                  </div>
                  <p className="kyc-governance-muted">
                    {readiness} Remove every route referencing a capability before removing it.
                    These candidate operations do not establish provider entitlement or activate
                    customer evidence and tier transitions.
                  </p>
                </fieldset>
              ))}
              <fieldset className="kyc-provider-fieldset">
                <legend>Synthetic fixture</legend>
                <p>
                  Enabled: {draft.providers.SYNTHETIC.enabled ? 'yes' : 'no'} · Capabilities:{' '}
                  {draft.providers.SYNTHETIC.capabilities.join(', ') || 'none'}
                </p>
                <p className="kyc-governance-muted">
                  Read-only here. Test-only; never select it as customer verification evidence.
                </p>
              </fieldset>
              {KYC_PROVIDER_CAPABILITIES.map((kind) => (
                <fieldset className="kyc-provider-fieldset" key={kind}>
                  <legend>{CAPABILITY_LABELS[kind]} route</legend>
                  {(['primary', 'fallback'] as const).map((field) => (
                    <Field
                      key={field}
                      label={`${field === 'primary' ? 'Primary' : 'Fallback'} provider`}
                      htmlFor={`kyc-provider-${kind}-${field}`}
                    >
                      <select
                        id={`kyc-provider-${kind}-${field}`}
                        className="mn-select"
                        value={draft.routes[kind][field] ?? ''}
                        disabled={!canPropose || busy || retryPending}
                        onChange={(event) => updateRoute(kind, field, event.target.value)}
                      >
                        {ROUTE_OPTIONS.map((option) => {
                          const route = draft.routes[kind];
                          const capabilityAvailable =
                            option.value === '' ||
                            draft.providers[option.value].capabilities.includes(kind);
                          const unavailableFallback =
                            field === 'fallback' &&
                            Boolean(option.value) &&
                            (!route.primary || route.primary === option.value);
                          const selectedTestOnly =
                            option.value === 'SYNTHETIC' && route[field] === 'SYNTHETIC';
                          return (
                            <option
                              key={option.value || 'none'}
                              value={option.value}
                              disabled={
                                !capabilityAvailable ||
                                unavailableFallback ||
                                (option.value === 'SYNTHETIC' && !selectedTestOnly)
                              }
                            >
                              {option.label}
                            </option>
                          );
                        })}
                      </select>
                    </Field>
                  ))}
                </fieldset>
              ))}
              <Field label="Proposal reason" htmlFor="kyc-provider-reason">
                <select
                  id="kyc-provider-reason"
                  className="mn-select"
                  value={reason}
                  disabled={!canPropose || busy || retryPending}
                  onChange={(event) => setReason(event.target.value as typeof reason)}
                >
                  <option value="INITIAL_SETUP">Initial setup</option>
                  <option value="ROUTING_CHANGE">Routing change</option>
                  <option value="PROVIDER_DISABLE">Provider disable</option>
                </select>
              </Field>
            </div>
            <div className="kyc-governance-actions">
              <Button
                variant="secondary"
                onClick={resetDraft}
                disabled={!dirty || busy || retryPending}
              >
                Discard draft
              </Button>
              {pendingProposal.current && (
                <Button
                  variant="secondary"
                  onClick={() => void submitProposal()}
                  disabled={!canPropose || busy}
                >
                  Retry same request
                </Button>
              )}
              <Button
                variant="primary"
                onClick={() => void submitProposal()}
                disabled={!canPropose || !dirty || busy || retryPending}
              >
                {busy ? 'Submitting…' : 'Submit proposal'}
              </Button>
              {!canPropose && (
                <span className="kyc-governance-muted">
                  Proposal action requires an MFA SUPER_ADMIN session with kyc.provider.propose.
                </span>
              )}
            </div>
          </section>

          <section className="kyc-governance-card" aria-labelledby="kyc-provider-proposals-heading">
            <div className="kyc-governance-card__heading">
              <div>
                <h2 id="kyc-provider-proposals-heading">Change proposals</h2>
                <p>Approval/rejection is single-use. A proposal cannot be checked by its maker.</p>
              </div>
            </div>
            {proposals.length === 0 ? (
              <p>No provider proposals.</p>
            ) : (
              <div className="kyc-governance-list">
                {proposals.map((proposal) => (
                  <article className="kyc-governance-list-item" key={proposal.id}>
                    <div className="kyc-governance-list-item__heading">
                      <strong>
                        Version {proposal.expected_version} · {proposal.reason_code}
                      </strong>
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
                    <dl>
                      <dt>Proposal</dt>
                      <dd>{proposal.id}</dd>
                      <dt>Maker</dt>
                      <dd>{proposal.maker_id}</dd>
                      <dt>Expires</dt>
                      <dd>{new Date(proposal.expires_at).toLocaleString()}</dd>
                      <dt>Proposed routing</dt>
                      <dd>
                        {KYC_PROVIDER_CAPABILITIES.map((capability, index) => {
                          const route = proposal.configuration.routes[capability];
                          return (
                            <React.Fragment key={capability}>
                              {index > 0 ? ' · ' : ''}
                              {capability}: {route.primary ?? 'none'}
                              {route.fallback ? ` → ${route.fallback}` : ''}
                            </React.Fragment>
                          );
                        })}
                      </dd>
                    </dl>
                    {proposal.state === 'REQUESTED' && canReview && (
                      <div className="kyc-governance-actions">
                        {proposal.maker_id === principal?.principalId && (
                          <span className="kyc-governance-muted">
                            Maker cannot review own proposal.
                          </span>
                        )}
                        <Button
                          variant="primary"
                          disabled={
                            busy ||
                            dirty ||
                            proposal.maker_id === principal?.principalId ||
                            Date.parse(proposal.expires_at) <= Date.now()
                          }
                          onClick={() => void decide(proposal, 'approve')}
                        >
                          Approve
                        </Button>
                        <Button
                          variant="danger"
                          disabled={
                            busy ||
                            dirty ||
                            proposal.maker_id === principal?.principalId ||
                            Date.parse(proposal.expires_at) <= Date.now()
                          }
                          onClick={() => void decide(proposal, 'reject')}
                        >
                          Reject
                        </Button>
                      </div>
                    )}
                  </article>
                ))}
              </div>
            )}
            {!canReview && (
              <p className="kyc-governance-muted">
                Decision actions require a distinct MFA COMPLIANCE session with
                kyc.provider.approve.
              </p>
            )}
          </section>

          <section className="kyc-governance-card" aria-labelledby="kyc-provider-history-heading">
            <div className="kyc-governance-card__heading">
              <div>
                <h2 id="kyc-provider-history-heading">Published history</h2>
                <p>Non-secret configuration history is read-only.</p>
              </div>
            </div>
            {history.length === 0 ? (
              <p>No approved provider configuration versions.</p>
            ) : (
              <div className="kyc-governance-list">
                {history.map((entry) => (
                  <article className="kyc-governance-list-item" key={entry.version}>
                    <div className="kyc-governance-list-item__heading">
                      <strong>Version {entry.version}</strong>
                      <StatusBadge tone="success">Published</StatusBadge>
                    </div>
                    <p>
                      Maker {entry.maker_id} · checker {entry.checker_id} · {entry.reason_code} ·{' '}
                      {new Date(entry.applied_at).toLocaleString()}
                    </p>
                    <p>
                      {KYC_PROVIDER_CAPABILITIES.map((capability, index) => {
                        const route = entry.configuration.routes[capability];
                        return (
                          <React.Fragment key={capability}>
                            {index > 0 ? ' · ' : ''}
                            {capability}: {route.primary ?? 'none'}
                            {route.fallback ? ` → ${route.fallback}` : ''}
                          </React.Fragment>
                        );
                      })}
                    </p>
                  </article>
                ))}
              </div>
            )}
          </section>
        </>
      )}
      <PremblyCredentialSettings principal={principal} onGuardChange={reportCredentialGuard} />
    </main>
  );
};
