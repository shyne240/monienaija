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

export interface RegistrationReview {
  customerId: string;
  reference: string;
  customerType: string;
  customerStatus: string;
  isSynthetic: boolean;
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
  activationRoute: string;
  evaluatedAt: string;
}

const STATE_LABEL: Record<RegistrationReviewRequirementState, string> = {
  MET: 'Met',
  OUTSTANDING: 'Outstanding',
  UNAVAILABLE: 'Cannot be determined',
  BLOCKED: 'Blocked',
};

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
              ? (review.defaults.customerClass.className ??
                review.defaults.customerClass.classCode ??
                'Configured')
              : 'No class assigned'}
          </dd>
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
