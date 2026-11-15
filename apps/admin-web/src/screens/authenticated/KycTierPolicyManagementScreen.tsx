import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Field, PageHeader, StatusBadge } from '../../design-system/primitives';
import { useAuthStore, type WorkforcePrincipal } from '../../store/auth-store';
import {
  createKycRequestId,
  KycTierPolicyApi,
  type KycTierPolicyDefinition,
  type KycTierPolicyProposal,
  type KycTierPolicyVersion,
  type KycTierRequirements,
  type TierEvidenceCode,
} from '../../services/kyc-governance-api';
import './kyc-governance.css';

interface Props {
  onGuardChange?: (guarded: boolean, busy: boolean) => void;
}
type TierPolicyTextField = Exclude<keyof TierPolicyEditor, 'regulatoryRequirementsConfirmed'>;
interface TierPolicyEditor {
  regulatoryRequirementsConfirmed: boolean;
  effectiveFrom: string;
  effectiveUntil: string;
  regulatoryLevel1All: string;
  regulatoryLevel1Any: string;
  regulatoryLevel2All: string;
  regulatoryLevel2Any: string;
  regulatoryLevel3All: string;
  regulatoryLevel3Any: string;
  operatorLevel1All: string;
  operatorLevel1Any: string;
  operatorLevel2All: string;
  operatorLevel2Any: string;
  operatorLevel3All: string;
  operatorLevel3Any: string;
}

const EVIDENCE_CODES: readonly TierEvidenceCode[] = [
  'BVN',
  'NIN',
  'PHONE',
  'BIOMETRIC',
  'ADDRESS',
  'ADDRESS_VERIFICATION',
  'UTILITY_BILL',
  'GPS',
  'IDENTITY_DOCUMENT',
  'DATE_OF_BIRTH',
  'OCCUPATION',
  'SOURCE_OF_FUNDS',
  'SOURCE_OF_WEALTH',
  'BUSINESS_PURPOSE',
  'PEP_SCREENING',
  'SANCTIONS_SCREENING',
  'CUSTOMER_RISK_ASSESSMENT',
  'ENHANCED_DUE_DILIGENCE',
];
const EMPTY_EDITOR: TierPolicyEditor = {
  regulatoryRequirementsConfirmed: false,
  effectiveFrom: '',
  effectiveUntil: '',
  regulatoryLevel1All: '',
  regulatoryLevel1Any: '',
  regulatoryLevel2All: '',
  regulatoryLevel2Any: '',
  regulatoryLevel3All: '',
  regulatoryLevel3Any: '',
  operatorLevel1All: '',
  operatorLevel1Any: '',
  operatorLevel2All: '',
  operatorLevel2Any: '',
  operatorLevel3All: '',
  operatorLevel3Any: '',
};

function toLocalDateTime(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 23);
}
function listText(values: TierEvidenceCode[]): string {
  return values.join(', ');
}
function groupText(groups: TierEvidenceCode[][]): string {
  return groups.map((group) => group.join(' | ')).join('; ');
}
function editorFromDefinition(definition: KycTierPolicyDefinition | undefined): TierPolicyEditor {
  if (!definition) return { ...EMPTY_EDITOR };
  return {
    regulatoryRequirementsConfirmed: definition.regulatoryRequirementsConfirmed,
    effectiveFrom: toLocalDateTime(definition.effectiveFrom),
    effectiveUntil: toLocalDateTime(definition.effectiveUntil),
    regulatoryLevel1All: listText(definition.regulatory.LEVEL_1.all),
    regulatoryLevel1Any: groupText(definition.regulatory.LEVEL_1.any),
    regulatoryLevel2All: listText(definition.regulatory.LEVEL_2.all),
    regulatoryLevel2Any: groupText(definition.regulatory.LEVEL_2.any),
    regulatoryLevel3All: listText(definition.regulatory.LEVEL_3.all),
    regulatoryLevel3Any: groupText(definition.regulatory.LEVEL_3.any),
    operatorLevel1All: listText(definition.operator.LEVEL_1.all),
    operatorLevel1Any: groupText(definition.operator.LEVEL_1.any),
    operatorLevel2All: listText(definition.operator.LEVEL_2.all),
    operatorLevel2Any: groupText(definition.operator.LEVEL_2.any),
    operatorLevel3All: listText(definition.operator.LEVEL_3.all),
    operatorLevel3Any: groupText(definition.operator.LEVEL_3.any),
  };
}
function parseAll(value: string): TierEvidenceCode[] {
  const tokens = value
    .split(/[\n,]+/u)
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);
  if (tokens.some((item) => !EVIDENCE_CODES.includes(item as TierEvidenceCode)))
    throw new Error('Use only the documented evidence codes shown below.');
  if (new Set(tokens).size !== tokens.length) throw new Error('Remove duplicate evidence codes.');
  return tokens as TierEvidenceCode[];
}
function parseAny(value: string): TierEvidenceCode[][] {
  const groups = value
    .split(';')
    .map((group) =>
      group
        .split(/[|,\n]+/u)
        .map((item) => item.trim().toUpperCase())
        .filter(Boolean),
    )
    .filter((group) => group.length > 0);
  if (
    groups.some((group) => group.some((item) => !EVIDENCE_CODES.includes(item as TierEvidenceCode)))
  )
    throw new Error('Use only the documented evidence codes shown below.');
  if (groups.some((group) => new Set(group).size !== group.length))
    throw new Error('Remove duplicate evidence codes from an any-of group.');
  return groups as TierEvidenceCode[][];
}
function requirements(all: string, any: string): KycTierRequirements {
  return { all: parseAll(all), any: parseAny(any) };
}
function definitionFromEditor(editor: TierPolicyEditor): KycTierPolicyDefinition {
  if (!editor.regulatoryRequirementsConfirmed)
    throw new Error(
      'Confirm that this policy is sourced from approved regulatory and product-governance decisions before proposing it.',
    );
  if (!editor.effectiveFrom) throw new Error('Choose an effective-from date and time.');
  const effectiveFromDate = new Date(editor.effectiveFrom);
  const effectiveUntilDate = editor.effectiveUntil ? new Date(editor.effectiveUntil) : null;
  if (!Number.isFinite(effectiveFromDate.getTime()))
    throw new Error('The effective-from date is invalid.');
  if (
    editor.effectiveUntil &&
    (!effectiveUntilDate ||
      !Number.isFinite(effectiveUntilDate.getTime()) ||
      effectiveUntilDate <= effectiveFromDate)
  )
    throw new Error('The effective-until date must be later than effective-from.');
  return {
    regulatoryRequirementsConfirmed: true,
    effectiveFrom: effectiveFromDate.toISOString(),
    effectiveUntil: effectiveUntilDate?.toISOString() ?? null,
    regulatory: {
      LEVEL_1: requirements(editor.regulatoryLevel1All, editor.regulatoryLevel1Any),
      LEVEL_2: requirements(editor.regulatoryLevel2All, editor.regulatoryLevel2Any),
      LEVEL_3: requirements(editor.regulatoryLevel3All, editor.regulatoryLevel3Any),
    },
    operator: {
      LEVEL_1: requirements(editor.operatorLevel1All, editor.operatorLevel1Any),
      LEVEL_2: requirements(editor.operatorLevel2All, editor.operatorLevel2Any),
      LEVEL_3: requirements(editor.operatorLevel3All, editor.operatorLevel3Any),
    },
  };
}
function copyEditor(editor: TierPolicyEditor): TierPolicyEditor {
  return { ...editor };
}

export const KycTierPolicyManagementScreen: React.FC<Props> = (props) => {
  const { principal } = useAuthStore();
  const key = JSON.stringify([
    principal?.principalId,
    principal?.sessionId,
    principal?.roles,
    principal?.scopes,
    principal?.assuranceLevel,
    principal?.readOnlyPrincipal,
  ]);
  return <KycTierPolicyManagementWorkspace key={key} {...props} principal={principal} />;
};

const KycTierPolicyManagementWorkspace: React.FC<
  Props & { principal: WorkforcePrincipal | null }
> = ({ onGuardChange, principal }) => {
  const [versions, setVersions] = useState<KycTierPolicyVersion[]>([]);
  const [proposals, setProposals] = useState<KycTierPolicyProposal[]>([]);
  const [editor, setEditor] = useState<TierPolicyEditor>({ ...EMPTY_EDITOR });
  const [baseline, setBaseline] = useState<TierPolicyEditor>({ ...EMPTY_EDITOR });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [retryPending, setRetryPending] = useState(false);
  const editorRef = useRef<TierPolicyEditor>({ ...EMPTY_EDITOR });
  const baselineRef = useRef<TierPolicyEditor>({ ...EMPTY_EDITOR });
  const alive = useRef(true);
  const pendingProposal = useRef<{
    requestId: string;
    expectedVersion: number;
    definition: KycTierPolicyDefinition;
  } | null>(null);
  const canPropose = Boolean(
    principal &&
      principal.assuranceLevel === 'MFA' &&
      !principal.readOnlyPrincipal &&
      principal.roles.includes('SUPER_ADMIN') &&
      principal.scopes.includes('kyc.policy.propose'),
  );
  const canReview = Boolean(
    principal &&
      principal.assuranceLevel === 'MFA' &&
      !principal.readOnlyPrincipal &&
      principal.roles.includes('COMPLIANCE') &&
      principal.scopes.includes('kyc.policy.approve'),
  );
  const dirty = useMemo(
    () => JSON.stringify(editor) !== JSON.stringify(baseline),
    [editor, baseline],
  );
  const headVersion = versions[0]?.version ?? 0;

  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);
  useEffect(() => {
    baselineRef.current = baseline;
  }, [baseline]);

  const refresh = useCallback(async (resetEditor = false) => {
    try {
      const [nextVersions, nextProposals] = await Promise.all([
        KycTierPolicyApi.versions(),
        KycTierPolicyApi.proposals(),
      ]);
      if (!alive.current) return;
      setVersions(nextVersions);
      setProposals(nextProposals);
      const currentEditor = editorRef.current;
      const currentBaseline = baselineRef.current;
      if (resetEditor || JSON.stringify(currentEditor) === JSON.stringify(currentBaseline)) {
        const next = editorFromDefinition(nextVersions[0]?.definition);
        const nextBaseline = copyEditor(next);
        editorRef.current = next;
        baselineRef.current = nextBaseline;
        setEditor(next);
        setBaseline(nextBaseline);
      }
    } catch (e) {
      if (alive.current)
        setError(e instanceof Error ? e.message : 'Could not load tier-policy governance.');
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

  useEffect(() => {
    onGuardChange?.(dirty || busy || retryPending, busy);
  }, [dirty, busy, retryPending, onGuardChange]);

  const change = <K extends keyof TierPolicyEditor>(key: K, value: TierPolicyEditor[K]) => {
    setEditor((current) => ({ ...current, [key]: value }));
  };
  const setRequirementsText = (key: TierPolicyTextField, value: string) => change(key, value);

  const submitProposal = async () => {
    if (!canPropose || busy) return;
    setError('');
    setNotice('');
    if (!pendingProposal.current) {
      try {
        pendingProposal.current = {
          requestId: createKycRequestId(),
          expectedVersion: headVersion,
          definition: definitionFromEditor(editor),
        };
      } catch (e) {
        setError(e instanceof Error ? e.message : 'The tier policy is invalid.');
        return;
      }
    }
    setBusy(true);
    try {
      const result = await KycTierPolicyApi.propose(pendingProposal.current);
      pendingProposal.current = null;
      setRetryPending(false);
      const nextBaseline = copyEditor(editor);
      baselineRef.current = nextBaseline;
      setBaseline(nextBaseline);
      setNotice(
        result.replay
          ? `Existing proposal ${result.id} reloaded.`
          : `Tier-policy proposal ${result.id} submitted for independent review.`,
      );
      await refresh(false);
    } catch (e) {
      setRetryPending(true);
      setError(e instanceof Error ? e.message : 'Proposal outcome is not confirmed.');
      setNotice(
        'The same request id is retained in this screen. Retry only to replay this exact proposal, or reload and inspect proposal state.',
      );
    } finally {
      setBusy(false);
    }
  };

  const decide = async (proposal: KycTierPolicyProposal, decision: 'approve' | 'reject') => {
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
          ? await KycTierPolicyApi.approve(proposal.id)
          : await KycTierPolicyApi.reject(proposal.id);
      setNotice(`Proposal ${proposal.id} ${result.state.toLowerCase()}.`);
      await refresh(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Decision outcome is not confirmed.');
      setNotice(
        'The reloaded proposal state is authoritative. Do not assume a failed response means the decision was not recorded.',
      );
      await refresh(false);
    } finally {
      setBusy(false);
    }
  };

  const resetDraft = () => {
    const next = editorFromDefinition(versions[0]?.definition);
    const nextBaseline = copyEditor(next);
    editorRef.current = next;
    baselineRef.current = nextBaseline;
    setEditor(next);
    setBaseline(nextBaseline);
    pendingProposal.current = null;
    setRetryPending(false);
    setError('');
    setNotice('Draft reset to the latest approved policy version.');
  };

  if (loading && versions.length === 0 && proposals.length === 0) {
    return (
      <div className="kyc-governance-screen" aria-busy="true">
        <p>Loading tier-policy governance…</p>
      </div>
    );
  }

  return (
    <main className="kyc-governance-screen">
      <PageHeader
        eyebrow="Risk & compliance · tier governance"
        title="KYC tier policies"
        description="Review versioned policy requirements and submit changes for independent MFA approval. The editor contains no monetary limits and does not assign tiers to customers."
      />
      <div className="kyc-governance-notices">
        {error && (
          <Alert tone="danger" title="Tier-policy workspace error">
            {error}
          </Alert>
        )}
        {notice && (
          <Alert tone="info" title="Status">
            {notice}
          </Alert>
        )}
        <Alert tone="warning" title="Policy and evidence safeguards">
          Do not invent regulatory requirements: submit only values approved by the responsible
          governance process. The engine always retains the built-in Tier 1 BVN-or-NIN and Tier 2
          and Tier 3 BVN-and-NIN floors; Tier 3 also requires a separately approved, additional
          non-BVN/NIN evidence rule. Provider responses, synthetic fixtures, and policy approval
          alone do not create trusted KYC evidence or manually assign a customer tier.
        </Alert>
      </div>

      <section className="kyc-governance-card" aria-labelledby="kyc-tier-policy-version-heading">
        <div className="kyc-governance-card__heading">
          <div>
            <h2 id="kyc-tier-policy-version-heading">Published versions</h2>
            <p>Policy head version {headVersion} · newest version shown first.</p>
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
        {versions.length === 0 ? (
          <p>
            No policy version is published. Tier evaluation stays unconfigured and fails closed.
          </p>
        ) : (
          <div className="kyc-governance-list">
            {versions.map((version) => (
              <article className="kyc-governance-list-item" key={version.version}>
                <div className="kyc-governance-list-item__heading">
                  <strong>Version {version.version}</strong>
                  <StatusBadge tone="success">Approved</StatusBadge>
                </div>
                <p>
                  Effective {new Date(version.definition.effectiveFrom).toLocaleString()}{' '}
                  {version.definition.effectiveUntil
                    ? `through ${new Date(version.definition.effectiveUntil).toLocaleString()}`
                    : 'with no scheduled end'}
                  .
                </p>
                <p>
                  Maker {version.maker_id} · checker {version.checker_id} · published{' '}
                  {new Date(version.approved_at).toLocaleString()}.
                </p>
                <details>
                  <summary>View policy requirements</summary>
                  <pre>{JSON.stringify(version.definition, null, 2)}</pre>
                </details>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="kyc-governance-card" aria-labelledby="kyc-tier-policy-editor-heading">
        <div className="kyc-governance-card__heading">
          <div>
            <h2 id="kyc-tier-policy-editor-heading">Policy proposal</h2>
            <p>
              Expected head version: {headVersion}. A conflict must be resolved by reloading and
              reviewing the current version.
            </p>
          </div>
          <StatusBadge tone={dirty ? 'warning' : 'neutral'}>
            {dirty ? 'Unsaved changes' : 'No unsaved changes'}
          </StatusBadge>
        </div>
        <div className="kyc-policy-form-grid">
          <Field
            label="Effective from"
            htmlFor="kyc-policy-effective-from"
            hint="Required; choose the date approved for this policy version."
          >
            <input
              id="kyc-policy-effective-from"
              className="mn-input"
              type="datetime-local"
              step={0.001}
              value={editor.effectiveFrom}
              disabled={!canPropose || busy || retryPending}
              onChange={(event) => change('effectiveFrom', event.target.value)}
            />
          </Field>
          <Field
            label="Effective until (optional)"
            htmlFor="kyc-policy-effective-until"
            hint="Leave blank only if the approved decision sets no end date."
          >
            <input
              id="kyc-policy-effective-until"
              className="mn-input"
              type="datetime-local"
              step={0.001}
              value={editor.effectiveUntil}
              disabled={!canPropose || busy || retryPending}
              onChange={(event) => change('effectiveUntil', event.target.value)}
            />
          </Field>
          {(
            [
              ['regulatoryLevel1All', 'Regulatory · Tier 1 · all required'],
              ['regulatoryLevel1Any', 'Regulatory · Tier 1 · any-of groups'],
              ['regulatoryLevel2All', 'Regulatory · Tier 2 · all required'],
              ['regulatoryLevel2Any', 'Regulatory · Tier 2 · any-of groups'],
              ['regulatoryLevel3All', 'Regulatory · Tier 3 · all required'],
              ['regulatoryLevel3Any', 'Regulatory · Tier 3 · any-of groups'],
              ['operatorLevel1All', 'Operator · Tier 1 · all required'],
              ['operatorLevel1Any', 'Operator · Tier 1 · any-of groups'],
              ['operatorLevel2All', 'Operator · Tier 2 · all required'],
              ['operatorLevel2Any', 'Operator · Tier 2 · any-of groups'],
              ['operatorLevel3All', 'Operator · Tier 3 · all required'],
              ['operatorLevel3Any', 'Operator · Tier 3 · any-of groups'],
            ] as const
          ).map(([key, label]) => (
            <Field
              key={key}
              label={label}
              htmlFor={`kyc-policy-${key}`}
              hint={
                key.endsWith('Any')
                  ? 'Separate alternative groups with semicolons; use | or commas within a group.'
                  : 'Separate evidence codes with commas or new lines. Empty means no extra requirement in this layer.'
              }
            >
              <textarea
                id={`kyc-policy-${key}`}
                className="mn-input"
                value={editor[key]}
                disabled={!canPropose || busy || retryPending}
                onChange={(event) => setRequirementsText(key, event.target.value)}
              />
            </Field>
          ))}
        </div>
        <p className="kyc-governance-muted">
          Allowed evidence codes: {EVIDENCE_CODES.join(', ')}. For any-of groups, for example,{' '}
          <code>PHONE | BIOMETRIC; ADDRESS</code> means one from the first group and ADDRESS from
          the second. Do not use this editor to invent or assume legal requirements.
        </p>
        <label className="kyc-policy-confirmation kyc-governance-check">
          <input
            type="checkbox"
            checked={editor.regulatoryRequirementsConfirmed}
            disabled={!canPropose || busy || retryPending}
            onChange={(event) => change('regulatoryRequirementsConfirmed', event.target.checked)}
          />
          I have verified that this policy exactly reflects separately approved regulatory and
          product-governance decisions.
        </label>
        <div className="kyc-governance-actions">
          <Button
            variant="secondary"
            disabled={!dirty || busy || retryPending}
            onClick={resetDraft}
          >
            Discard draft
          </Button>
          {pendingProposal.current && (
            <Button
              variant="secondary"
              disabled={!canPropose || busy}
              onClick={() => void submitProposal()}
            >
              Retry same request
            </Button>
          )}
          <Button
            variant="primary"
            disabled={!canPropose || !dirty || busy || retryPending}
            onClick={() => void submitProposal()}
          >
            {busy ? 'Submitting…' : 'Submit policy proposal'}
          </Button>
          {!canPropose && (
            <span className="kyc-governance-muted">
              Proposal action requires an MFA SUPER_ADMIN session with kyc.policy.propose.
            </span>
          )}
        </div>
      </section>

      <section className="kyc-governance-card" aria-labelledby="kyc-tier-policy-proposals-heading">
        <div className="kyc-governance-card__heading">
          <div>
            <h2 id="kyc-tier-policy-proposals-heading">Policy proposals</h2>
            <p>Only a different MFA COMPLIANCE checker may approve or reject a live proposal.</p>
          </div>
        </div>
        {proposals.length === 0 ? (
          <p>No tier-policy proposals.</p>
        ) : (
          <div className="kyc-governance-list">
            {proposals.map((proposal) => (
              <article className="kyc-governance-list-item" key={proposal.id}>
                <div className="kyc-governance-list-item__heading">
                  <strong>Expected version {proposal.expected_version}</strong>
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
                  Proposal {proposal.id} · maker {proposal.maker_id} · expires{' '}
                  {new Date(proposal.expires_at).toLocaleString()}.
                </p>
                <details>
                  <summary>Review proposed requirements</summary>
                  <pre>{JSON.stringify(proposal.definition, null, 2)}</pre>
                </details>
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
            Decision actions require a distinct MFA COMPLIANCE session with kyc.policy.approve.
          </p>
        )}
      </section>
    </main>
  );
};
