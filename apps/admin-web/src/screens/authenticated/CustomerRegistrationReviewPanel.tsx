import React from 'react';
import './customer-registration-review.css';

/**
 * `GET /api/v1/internal/customers/:id/registration-review` payload.
 *
 * Imported rather than redeclared in the screen so a backend field rename is a type error, not a
 * silently blank panel. Every field is read-only; this surface has no mutation path.
 */
export type RegistrationReviewRequirementState = 'MET' | 'OUTSTANDING' | 'UNAVAILABLE' | 'BLOCKED';

export interface RegistrationReviewRequirement {
  code: string;
  label: string;
  state: RegistrationReviewRequirementState;
  detail?: string;
}

export interface EffectiveLimitValue {
  dimension: string;
  status: 'RESOLVED' | 'UNLIMITED' | 'MISSING';
  limitValueMinor: string | null;
  limitValueCount: number | null;
  ruleId: string | null;
  profileCode: string | null;
  source: string | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  isUnlimited: boolean;
}

export interface EffectiveFeeValue {
  status: 'RESOLVED' | 'ZERO' | 'NOT_CONFIGURED' | 'AMBIGUOUS';
  ruleId: string | null;
  ruleVersion: number | null;
  flatFeeMinor: string | null;
  percentageBps: number | null;
  minimumFeeMinor: string | null;
  maximumFeeMinor: string | null;
  vatBps: number | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  priority: number | null;
  quote?: {
    amountMinor: string;
    feeMinor: string;
    vatMinor: string;
    totalMinor: string;
  } | null;
  ambiguousRuleIds?: string[];
}

export interface EffectiveProductConfiguration {
  productCode: string;
  productName: string;
  currency: string;
  fee: EffectiveFeeValue;
  limits: EffectiveLimitValue[];
}

export interface RegistrationReview {
  customerId: string;
  reference: string;
  customerType: string;
  customerStatus: string;
  isSynthetic: boolean;
  verifiedTier?: string | null;
  assignedClass?: {
    configured: boolean;
    classCode: string | null;
    className: string | null;
    source: string | null;
    effectiveFrom: string | null;
  } | null;
  defaults: {
    customerClass: {
      configured: boolean;
      classCode: string | null;
      className: string | null;
      source: string | null;
      effectiveFrom: string | null;
    };
    kyc: {
      level: string;
      status: string;
      assessment: {
        level: string;
        status: string;
        expiresAt: string | null;
        reason: string | null;
      } | null;
    };
  };
  onboardingWorkflow: { status: string | null; eligibility: string | null; completed: boolean };
  financialEligibility: string;
  restrictions: { active: string[] };
  identityConflicts: number;
  trustedEvidence: { state: string; verifiedKinds: string[]; detail?: string };
  wallet: { walletId: string; currency: string; status: string } | null;
  requirements: RegistrationReviewRequirement[];
  outstanding: string[];
  activatable: boolean;
  effectiveConfiguration?: {
    customerId: string;
    verifiedTier: string | null;
    assignedClass: {
      classCode: string;
      className: string;
      source: string;
      eligibleForVerifiedTier?: boolean | null;
      classId?: string | null;
    } | null;
    products: EffectiveProductConfiguration[];
    evaluatedAt: string;
  } | null;
  activationRoute: string;
  evaluatedAt: string;
}

const STATE_LABEL: Record<RegistrationReviewRequirementState, string> = {
  MET: 'Met',
  OUTSTANDING: 'Outstanding',
  UNAVAILABLE: 'Cannot be determined',
  BLOCKED: 'Blocked',
};

function formatMinor(minor: string | null | undefined, currency = 'NGN'): string {
  if (minor == null || minor === '') return '—';
  if (!/^-?\d+$/.test(minor)) return String(minor);
  const neg = minor.startsWith('-');
  const abs = neg ? minor.slice(1) : minor;
  const padded = abs.padStart(3, '0');
  const whole = padded.slice(0, -2);
  const frac = padded.slice(-2);
  return `${neg ? '-' : ''}${currency} ${Number(whole).toLocaleString('en-US')}.${frac}`;
}

function limitLabel(dim: string): string {
  switch (dim) {
    case 'MAX_AMOUNT_PER_TX':
      return 'Max amount per transaction';
    case 'DAILY_AMOUNT':
      return 'Daily limit';
    case 'WEEKLY_AMOUNT':
      return 'Weekly limit';
    case 'MONTHLY_AMOUNT':
      return 'Monthly limit';
    case 'WALLET_BALANCE_MAX':
      return 'Maximum wallet balance';
    default:
      return dim;
  }
}

/**
 * Read-only registration review for the DRAFT → ACTIVE decision.
 *
 * The panel deliberately has **no activate button**. Activation stays on the governed lifecycle
 * transition (`PATCH /customers/:id`) which is audited, maker-checked and separately authorised;
 * offering a second mutation path from a review screen is exactly the drift this panel exists to
 * prevent. Instead it surfaces the endpoint's own `activationRoute` so the reviewer knows where the
 * decision actually happens.
 *
 * `UNAVAILABLE` is never rendered as a failure of the customer: it means the platform could not read
 * the evidence, and the reviewer must not treat it as either "verified" or "rejected".
 */
export const CustomerRegistrationReviewPanel: React.FC<{
  review: RegistrationReview | null;
  loading?: boolean;
  error?: string | null;
}> = ({ review, loading = false, error = null }) => {
  if (loading) {
    return (
      <article className="cm-card cm-card-wide cm-regreview" aria-busy="true">
        <p className="cm-muted">Loading registration review…</p>
      </article>
    );
  }
  if (error) {
    return (
      <article className="cm-card cm-card-wide cm-regreview">
        <p className="cm-muted">{error}</p>
      </article>
    );
  }
  if (!review) {
    return (
      <article className="cm-card cm-card-wide cm-regreview">
        <p className="cm-muted">Registration review is unavailable.</p>
      </article>
    );
  }

  const mustFix = review.requirements.filter(
    (requirement) => requirement.state === 'BLOCKED' || requirement.state === 'UNAVAILABLE',
  );

  return (
    <article className="cm-card cm-card-wide cm-regreview" aria-labelledby="cm-regreview-title">
      <div className="cm-card-heading cm-regreview__heading">
        <div>
          <p className="cm-eyebrow">REGISTRATION REVIEW · READ ONLY</p>
          <h2 id="cm-regreview-title">Activation readiness</h2>
        </div>
        <span
          className={
            review.activatable ? 'cm-status cm-status-active' : 'cm-status cm-status-outstanding'
          }
        >
          {review.activatable ? 'Ready to activate' : 'Not ready'}
        </span>
      </div>

      <div className="cm-regreview__boundary" role="note">
        <strong>This screen cannot activate an account</strong>
        <p>
          The decision is taken on <code>{review.activationRoute}</code>, which is audited and
          requires the lifecycle permission. Nothing shown here is changed by viewing it.
        </p>
      </div>

      <dl className="cm-regreview__summary">
        <div>
          <dt>Reference</dt>
          <dd>{review.reference}</dd>
        </div>
        <div>
          <dt>Lifecycle status</dt>
          <dd>{review.customerStatus}</dd>
        </div>
        <div>
          <dt>Customer type</dt>
          <dd>
            {review.customerType}
            {review.isSynthetic ? ' · test record' : ''}
          </dd>
        </div>
        <div>
          <dt>Financial eligibility</dt>
          <dd>{review.financialEligibility}</dd>
        </div>
        <div>
          <dt>Customer class</dt>
          <dd>
            {review.defaults.customerClass.configured
              ? `${review.defaults.customerClass.classCode ?? ''} — ${review.defaults.customerClass.className ?? 'Configured'}`
              : 'No class assigned'}
            {review.defaults.customerClass.source
              ? ` (${review.defaults.customerClass.source})`
              : ''}
            {review.effectiveConfiguration?.assignedClass?.eligibleForVerifiedTier === false
              ? ' · Not eligible for verified tier'
              : review.effectiveConfiguration?.assignedClass?.eligibleForVerifiedTier === true
                ? ' · Eligible for verified tier'
                : ''}
          </dd>
        </div>
        <div>
          <dt>Verified tier</dt>
          <dd>{review.verifiedTier ?? review.defaults.kyc.level}</dd>
        </div>
        <div>
          <dt>KYC assessment</dt>
          <dd>
            {review.defaults.kyc.level} · {review.defaults.kyc.status}
            {review.defaults.kyc.assessment?.status
              ? ` (current: ${review.defaults.kyc.assessment.status})`
              : ' (no current assessment)'}
          </dd>
        </div>
        <div>
          <dt>Onboarding workflow</dt>
          <dd>
            {review.onboardingWorkflow.status ?? 'Not started'} ·{' '}
            {review.onboardingWorkflow.eligibility ?? 'No eligibility'}
          </dd>
        </div>
        <div>
          <dt>Wallet</dt>
          <dd>{review.wallet ? `${review.wallet.currency} · ${review.wallet.status}` : 'None'}</dd>
        </div>
      </dl>

      <section aria-labelledby="cm-regreview-requirements-title" className="cm-regreview__section">
        <div className="cm-regreview__section-heading">
          <div>
            <p className="cm-regreview__eyebrow">THE SAME LIST THE CUSTOMER SEES</p>
            <h3 id="cm-regreview-requirements-title">Requirements</h3>
          </div>
          <span>
            {review.requirements.filter((requirement) => requirement.state === 'MET').length} of{' '}
            {review.requirements.length} met
          </span>
        </div>
        <p className="cm-regreview__description">
          Produced by the same readiness service as the customer&apos;s own activation view, so the
          two can never disagree. &quot;Cannot be determined&quot; means the platform could not read
          the evidence — it is neither a pass nor a rejection.
        </p>
        <ul className="cm-regreview__requirements">
          {review.requirements.map((requirement) => (
            <li
              key={requirement.code}
              className={`cm-regreview__requirement cm-regreview__requirement--${requirement.state.toLowerCase()}`}
            >
              <span className="cm-regreview__requirement-label">{requirement.label}</span>
              <span className="cm-regreview__requirement-state">
                {STATE_LABEL[requirement.state]}
              </span>
              {requirement.detail ? (
                <small className="cm-regreview__requirement-detail">{requirement.detail}</small>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      {review.restrictions.active.length > 0 || review.identityConflicts > 0 ? (
        <section aria-labelledby="cm-regreview-blockers-title" className="cm-regreview__section">
          <div className="cm-regreview__section-heading">
            <div>
              <p className="cm-regreview__eyebrow">MUST BE RESOLVED</p>
              <h3 id="cm-regreview-blockers-title">Blockers</h3>
            </div>
          </div>
          <ul className="cm-regreview__requirements">
            {review.restrictions.active.map((restriction) => (
              <li
                key={restriction}
                className="cm-regreview__requirement cm-regreview__requirement--blocked"
              >
                <span className="cm-regreview__requirement-label">Active restriction</span>
                <span className="cm-regreview__requirement-state">{restriction}</span>
              </li>
            ))}
            {review.identityConflicts > 0 ? (
              <li className="cm-regreview__requirement cm-regreview__requirement--blocked">
                <span className="cm-regreview__requirement-label">
                  Identity ownership conflicts
                </span>
                <span className="cm-regreview__requirement-state">{review.identityConflicts}</span>
              </li>
            ) : null}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="cm-regreview-effective-title" className="cm-regreview__section">
        <div className="cm-regreview__section-heading">
          <div>
            <p className="cm-regreview__eyebrow">RUNTIME COMMERCIAL CONFIGURATION</p>
            <h3 id="cm-regreview-effective-title">Effective fees and limits</h3>
          </div>
        </div>
        {!review.effectiveConfiguration ? (
          <p className="cm-muted">Effective commercial configuration is unavailable.</p>
        ) : review.effectiveConfiguration.products.length === 0 ? (
          <p className="cm-muted">No enabled customer products are configured.</p>
        ) : (
          <div className="cm-regreview__effective">
            {review.effectiveConfiguration.products.map((product) => (
              <div key={product.productCode} className="cm-regreview__effective-product">
                <h4>
                  {product.productName} ({product.productCode})
                </h4>
                <p>
                  <strong>Fee:</strong>{' '}
                  {product.fee.status === 'NOT_CONFIGURED'
                    ? 'Missing configuration'
                    : product.fee.status === 'AMBIGUOUS'
                      ? `Ambiguous (${(product.fee.ambiguousRuleIds ?? []).join(', ')})`
                      : product.fee.status === 'ZERO'
                        ? `Explicit zero fee (rule ${product.fee.ruleId ?? '—'})`
                        : `Resolved (rule ${product.fee.ruleId ?? '—'}, v${product.fee.ruleVersion ?? '—'}, priority ${product.fee.priority ?? '—'})`}
                  {product.fee.quote
                    ? ` · Quote on ${formatMinor(product.fee.quote.amountMinor, product.currency)}: fee ${formatMinor(product.fee.quote.feeMinor, product.currency)}, VAT ${formatMinor(product.fee.quote.vatMinor, product.currency)}, total ${formatMinor(product.fee.quote.totalMinor, product.currency)}`
                    : ''}
                </p>
                <table className="cm-table" aria-label={`Effective limits for ${product.productCode}`}>
                  <thead>
                    <tr>
                      <th>Limit</th>
                      <th>Value</th>
                      <th>Source rule</th>
                    </tr>
                  </thead>
                  <tbody>
                    {product.limits.map((limit) => (
                      <tr key={limit.dimension}>
                        <td>{limitLabel(limit.dimension)}</td>
                        <td>
                          {limit.status === 'MISSING'
                            ? 'Missing configuration'
                            : limit.isUnlimited
                              ? 'Unlimited (explicit)'
                              : limit.limitValueMinor != null
                                ? formatMinor(limit.limitValueMinor, product.currency)
                                : limit.limitValueCount != null
                                  ? `${limit.limitValueCount} count`
                                  : '—'}
                        </td>
                        <td>
                          {limit.ruleId
                            ? `${limit.ruleId}${limit.profileCode ? ` (${limit.profileCode})` : ''}${limit.source ? ` · ${limit.source}` : ''}`
                            : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}
      </section>

      <p className="cm-regreview__footer">
        {mustFix.length > 0
          ? `${mustFix.length} requirement(s) cannot be confirmed from authoritative records. Do not activate until they are resolved.`
          : review.activatable
            ? 'Every pre-activation requirement is confirmed. Proceed on the governed lifecycle route.'
            : 'Requirements remain outstanding; the account cannot be activated yet.'}{' '}
        Evaluated {review.evaluatedAt}.
      </p>
    </article>
  );
};
