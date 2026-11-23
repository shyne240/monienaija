import React, { useRef, useState } from 'react';

import { Button, StatusBadge } from '../../design-system/primitives';
import { ApiClient } from '../../services/api-client';
import { useAuthStore } from '../../store/auth-store';

import { previewQuery, type PreviewCall } from './commercial-authoring-contract';
import {
  assertAdvisoryPreview,
  type EffectiveConfigurationPreview,
  type PreviewSectionStatus,
} from './commercial-preview-contract';
import './commercial-authoring.css';

const TONE: Record<PreviewSectionStatus, 'success' | 'warning' | 'danger' | 'neutral'> = {
  RESOLVED: 'success',
  MISSING: 'danger',
  AMBIGUOUS: 'warning',
  NOT_APPLICABLE: 'neutral',
  UNAVAILABLE: 'warning',
};

/**
 * Read-only effective-configuration preview.
 *
 * Every value on this panel is the backend's answer. The component performs NO precedence,
 * eligibility, threshold or amount arithmetic: it submits a hypothetical operation and renders the
 * resolver evidence, including each resolver's refusal. Missing configuration shows as MISSING (a
 * blocker), ambiguous configuration as AMBIGUOUS with the conflicting rule ids — the panel never
 * fills a gap or breaks a tie itself.
 */
export const CommercialPreviewPanel: React.FC<{ defaultProduct?: string }> = ({ defaultProduct }) => {
  const principal = useAuthStore((state) => state.principal);
  const canPreview = principal?.scopes.includes('limit.view') === true;
  const [call, setCall] = useState<PreviewCall>({
    productCode: defaultProduct ?? 'WALLET_TRANSFER',
    currency: 'NGN',
    principalType: 'CUSTOMER',
    direction: 'OUTGOING',
  });
  const [result, setResult] = useState<EffectiveConfigurationPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const requestId = useRef(0);

  const run = async () => {
    const id = ++requestId.current;
    setLoading(true);
    setError('');
    try {
      const response = await ApiClient.get<unknown>(previewQuery(call));
      if (id !== requestId.current) return;
      // Trust nothing about a response that claims a write occurred.
      assertAdvisoryPreview(response);
      setResult(response);
    } catch (err) {
      if (id !== requestId.current) return;
      const status =
        err && typeof err === 'object' && 'status' in err
          ? (err as { status?: number }).status
          : undefined;
      setError(
        status === 403
          ? 'The API denied this preview for your session (limit.view is required).'
          : err instanceof Error
            ? err.message
            : 'The preview could not be evaluated.',
      );
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  };

  const set = (key: keyof PreviewCall, value: string) =>
    setCall((previous) => ({ ...previous, [key]: value }));

  return (
    <section className="commercial-preview" aria-labelledby="commercial-preview-heading">
      <div className="commercial-registry__heading">
        <div>
          <p className="commercial-kicker">EFFECTIVE CONFIGURATION · ADVISORY</p>
          <h2 id="commercial-preview-heading">What would govern this operation?</h2>
          <p>
            The backend resolvers explain which approved configuration applies, and why. This is an
            explanation, not an admission decision: nothing is reserved, charged, accrued or
            credited.
          </p>
        </div>
      </div>

      {!canPreview ? (
        <div className="commercial-state commercial-state--error" role="alert">
          This preview requires the <code>limit.view</code> function. The API applies the same rule;
          this message only explains why the control is not offered.
        </div>
      ) : (
        <>
          <form
            className="commercial-filters"
            aria-label="Effective configuration preview inputs"
            onSubmit={(event) => {
              event.preventDefault();
              void run();
            }}
          >
            <div className="commercial-filter-fields">
              <label className="commercial-filter-field">
                Product code
                <input
                  aria-label="Preview product code"
                  value={call.productCode}
                  onChange={(event) => set('productCode', event.target.value)}
                  required
                />
              </label>
              <label className="commercial-filter-field">
                Currency
                <input
                  aria-label="Preview currency"
                  value={call.currency}
                  onChange={(event) => set('currency', event.target.value)}
                  maxLength={3}
                  required
                />
              </label>
              <label className="commercial-filter-field">
                Principal type
                <select
                  aria-label="Preview principal type"
                  value={call.principalType}
                  onChange={(event) =>
                    set('principalType', event.target.value as PreviewCall['principalType'])
                  }
                >
                  <option value="CUSTOMER">CUSTOMER</option>
                  <option value="AGENT">AGENT</option>
                </select>
              </label>
              <label className="commercial-filter-field">
                Principal UUID
                <input
                  aria-label="Preview principal id"
                  value={call.principalId ?? ''}
                  onChange={(event) => set('principalId', event.target.value)}
                  placeholder="Needed for limits"
                />
              </label>
              <label className="commercial-filter-field">
                Institution UUID
                <input
                  aria-label="Preview institution id"
                  value={call.institutionId ?? ''}
                  onChange={(event) => set('institutionId', event.target.value)}
                  placeholder="Needed for tier limits"
                />
              </label>
              <label className="commercial-filter-field">
                Agent class UUID
                <input
                  aria-label="Preview agent class id"
                  value={call.agentClassId ?? ''}
                  onChange={(event) => set('agentClassId', event.target.value)}
                  placeholder="Commission/reward targeting"
                />
              </label>
              <label className="commercial-filter-field">
                Service class
                <input
                  aria-label="Preview service class"
                  value={call.serviceClass ?? ''}
                  onChange={(event) => set('serviceClass', event.target.value)}
                  placeholder="Optional tier policy key"
                />
              </label>
              <label className="commercial-filter-field">
                Channel
                <input
                  aria-label="Preview channel"
                  value={call.channel ?? ''}
                  onChange={(event) => set('channel', event.target.value)}
                  placeholder="Optional, matches channel-scoped rules"
                />
              </label>
              <label className="commercial-filter-field">
                Direction
                <select
                  aria-label="Preview direction"
                  value={call.direction}
                  onChange={(event) =>
                    set('direction', event.target.value as PreviewCall['direction'])
                  }
                >
                  <option value="OUTGOING">OUTGOING</option>
                  <option value="INCOMING">INCOMING</option>
                </select>
              </label>
              <label className="commercial-filter-field">
                Amount (minor units)
                <input
                  aria-label="Preview amount in minor units"
                  value={call.amountMinor ?? ''}
                  onChange={(event) => set('amountMinor', event.target.value)}
                  inputMode="numeric"
                  placeholder="Enables fee/commission/reward"
                />
              </label>
              <div className="commercial-filter-actions">
                <Button type="submit" size="sm" disabled={loading}>
                  {loading ? 'Evaluating…' : 'Evaluate configuration'}
                </Button>
              </div>
            </div>
            <p>
              Everything is evaluated by the backend at the instant it receives the request. An
              unevaluated field is reported as missing, never defaulted.
            </p>
          </form>

          {error && (
            <div className="commercial-state commercial-state--error" role="alert">
              {error}
            </div>
          )}

          {result && (
            <div className="commercial-preview__result" aria-live="polite">
              <div className="commercial-preview__boundary" role="note">
                <strong>Advisory preview</strong>
                <span>{result.disclaimer}</span>
                <span>
                  Evaluated <time dateTime={result.request.evaluatedAt}>{result.previewedAt}</time>{' '}
                  for {result.request.productCode} · {result.request.currency} ·{' '}
                  {result.request.direction.toLowerCase()}{' '}
                  {result.request.principalType.toLowerCase()} · authoritative:{' '}
                  {result.authoritative.replace('_', ' ').toLowerCase()}
                </span>
                <span>
                  Every value below is the backend resolver&apos;s answer. The Studio performs no
                  precedence, eligibility or amount arithmetic of its own.
                </span>
              </div>

              <div className="commercial-preview__summary" role="status">
                <span>{result.summary.blockerCount} blocker(s)</span>
                <span>{result.summary.warningCount} warning(s)</span>
                <span>No money moved: {result.guarantees.writesPerformed.length} writes</span>
              </div>

              {result.explanation.length > 0 && (
                <ul className="commercial-preview__explanation" aria-label="Configuration findings">
                  {result.explanation.map((item, index) => (
                    <li key={`${item.code}-${index}`} className={`is-${item.severity.toLowerCase()}`}>
                      <StatusBadge
                        tone={
                          item.severity === 'BLOCKER'
                            ? 'danger'
                            : item.severity === 'WARNING'
                              ? 'warning'
                              : 'info'
                        }
                        shape={item.severity === 'BLOCKER' ? 'square' : 'dot'}
                      >
                        {item.severity}
                      </StatusBadge>{' '}
                      <strong>{item.code}</strong>
                      <p>{item.message}</p>
                    </li>
                  ))}
                </ul>
              )}

              <Section title="Product and scope" status={result.product ? 'RESOLVED' : 'MISSING'}>
                <dl className="commercial-preview__kv">
                  <div>
                    <dt>Product</dt>
                    <dd>
                      {result.product
                        ? `${result.product.code} — ${result.product.name}`
                        : 'Not found'}
                    </dd>
                  </div>
                  <div>
                    <dt>Product status</dt>
                    <dd>{result.product?.status ?? '—'}</dd>
                  </div>
                  <div>
                    <dt>Product enabled</dt>
                    <dd>{result.product ? (result.product.enabled ? 'Yes' : 'No') : '—'}</dd>
                  </div>
                  <div>
                    <dt>Configuration status</dt>
                    <dd>{result.product?.configurationStatus ?? '—'}</dd>
                  </div>
                  <div>
                    <dt>Institution</dt>
                    <dd>
                      {result.institution
                        ? `${result.institution.name ?? 'Unnamed'} (${result.institution.status ?? 'unknown'})`
                        : 'No institution supplied'}
                    </dd>
                  </div>
                </dl>
              </Section>

              <Section title="Customer class" status={result.customerClass.status}>
                <p>{result.customerClass.note}</p>
              </Section>

              <Section
                title="KYC restrictions"
                status={result.kycRestriction.kycLevel ? 'RESOLVED' : 'NOT_APPLICABLE'}
              >
                <dl className="commercial-preview__kv">
                  <div>
                    <dt>KYC level</dt>
                    <dd>{result.kycRestriction.kycLevel ?? 'Not derived'}</dd>
                  </div>
                  <div>
                    <dt>Tier enforcement</dt>
                    <dd>
                      {result.kycRestriction.tierEnforcementActivationEnabled
                        ? 'Active in this environment'
                        : 'Inactive in this environment'}
                    </dd>
                  </div>
                  <div>
                    <dt>Tier policy version</dt>
                    <dd>{result.kycRestriction.tierMapping?.policyVersion ?? '—'}</dd>
                  </div>
                  <div>
                    <dt>Tier profile</dt>
                    <dd>{result.kycRestriction.tierMapping?.profileCode ?? '—'}</dd>
                  </div>
                </dl>
                {result.kycRestriction.note && <p>{result.kycRestriction.note}</p>}
              </Section>

              <Section title="Effective limit profile" status={result.limits.status}>
                <dl className="commercial-preview__kv">
                  <div>
                    <dt>Assignment profile</dt>
                    <dd>{result.limits.assignment?.limitProfileCode ?? 'None resolved'}</dd>
                  </div>
                  <div>
                    <dt>Assignment subject</dt>
                    <dd>{result.limits.assignment?.subjectType ?? '—'}</dd>
                  </div>
                  <div>
                    <dt>Assignment precedence</dt>
                    <dd>{result.limits.assignment?.precedence ?? '—'}</dd>
                  </div>
                  <div>
                    <dt>Governing profiles</dt>
                    <dd>{result.limits.governingProfileCodes.join(', ') || 'None'}</dd>
                  </div>
                  <div>
                    <dt>Tier profile</dt>
                    <dd>{result.limits.tierProfileCode ?? 'Not applied'}</dd>
                  </div>
                  <div>
                    <dt>Evaluated dimensions</dt>
                    <dd>{result.limits.evaluatedDimensions.join(', ') || 'None'}</dd>
                  </div>
                </dl>
                {result.limits.note && <p>{result.limits.note}</p>}
                {result.limits.rules.length > 0 && (
                  <table className="commercial-preview__table">
                    <caption>
                      All applicable rules are conjunctive; the most restrictive binds.
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col">Dimension</th>
                        <th scope="col">Profile</th>
                        <th scope="col">Source</th>
                        <th scope="col">Priority</th>
                        <th scope="col">Limit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.limits.rules.map((rule) => (
                        <tr key={rule.ruleId}>
                          <td>{rule.dimension}</td>
                          <td>{rule.profileCode}</td>
                          <td>{rule.source}</td>
                          <td>{rule.priority}</td>
                          <td>
                            {rule.limitValueMinor !== null
                              ? `${rule.limitValueMinor} minor`
                              : `${rule.limitValueCount ?? '—'} count`}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Section>

              <Section title="Applicable fee rule" status={result.fee.status}>
                <dl className="commercial-preview__kv">
                  <div>
                    <dt>Rule</dt>
                    <dd>{result.fee.rule?.ruleId ?? 'No applicable rule'}</dd>
                  </div>
                  <div>
                    <dt>Priority</dt>
                    <dd>{result.fee.rule?.priority ?? '—'}</dd>
                  </div>
                  <div>
                    <dt>Flat fee (minor)</dt>
                    <dd>{result.fee.rule?.flatFeeMinor ?? '—'}</dd>
                  </div>
                  <div>
                    <dt>Rate (bps)</dt>
                    <dd>{result.fee.rule?.percentageBps ?? '—'}</dd>
                  </div>
                  <div>
                    <dt>Computed fee (minor)</dt>
                    <dd>{result.fee.computed?.feeMinor ?? 'Not computed'}</dd>
                  </div>
                  <div>
                    <dt>Computed VAT (minor)</dt>
                    <dd>{result.fee.computed?.vatMinor ?? 'Not computed'}</dd>
                  </div>
                  <div>
                    <dt>Ambiguous priority</dt>
                    <dd>{result.fee.ambiguousPriority ?? '—'}</dd>
                  </div>
                  <div>
                    <dt>Ambiguous rules</dt>
                    <dd>{result.fee.ambiguousRuleIds?.join(', ') ?? '—'}</dd>
                  </div>
                </dl>
                {result.fee.note && <p>{result.fee.note}</p>}
              </Section>

              <Section title="Applicable commission rule" status={result.commission.status}>
                {result.commission.allocations.length === 0 ? (
                  <p>No commission allocation resolved.</p>
                ) : (
                  <ul>
                    {result.commission.allocations.map((allocation) => (
                      <li key={`${allocation.ruleId}-${allocation.recipientType}`}>
                        {allocation.recipientType}: {allocation.amountMinor} minor · rule{' '}
                        <code>{allocation.ruleId}</code>
                      </li>
                    ))}
                  </ul>
                )}
                {result.commission.note && <p>{result.commission.note}</p>}
              </Section>

              <Section title="Applicable reward rule" status={result.reward.status}>
                {result.reward.grants.length === 0 ? (
                  <p>No reward grant resolved.</p>
                ) : (
                  <ul>
                    {result.reward.grants.map((grant) => (
                      <li key={`${grant.ruleId}-${grant.beneficiaryType}`}>
                        {grant.beneficiaryType} {grant.rewardType}: {grant.amountMinor} minor · rule{' '}
                        <code>{grant.ruleId}</code>
                      </li>
                    ))}
                  </ul>
                )}
                {result.reward.note && <p>{result.reward.note}</p>}
              </Section>
            </div>
          )}
        </>
      )}
    </section>
  );
};

const Section: React.FC<{
  title: string;
  status: PreviewSectionStatus;
  children: React.ReactNode;
}> = ({ title, status, children }) => (
  <section className="commercial-preview__section">
    <header>
      <h3>{title}</h3>
      <StatusBadge tone={TONE[status]} shape="hollow">
        {status}
      </StatusBadge>
    </header>
    {children}
  </section>
);
