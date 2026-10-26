import React from 'react';

interface CustomerTier3ReadinessPanelProps {
  customerType: string;
  customerStatus: string;
  phoneVerified: boolean | null;
  kycLevel: string;
  kycStatus: string;
  financialEligibility: string | null;
}

function labelForSignal(value: boolean | null): string {
  if (value === null) return 'Unavailable';
  return value ? 'Verified primary phone' : 'Not verified';
}

export const CustomerTier3ReadinessPanel: React.FC<CustomerTier3ReadinessPanelProps> = ({
  customerType,
  customerStatus,
  phoneVerified,
  kycLevel,
  kycStatus,
  financialEligibility,
}) => (
  <article className="cm-card cm-card-wide" aria-labelledby="cm-tier3-readiness-title">
    <div className="cm-card-heading">
      <div>
        <p className="cm-eyebrow">INFORMATIONAL CHECKLIST</p>
        <h2 id="cm-tier3-readiness-title">Tier 3 readiness factors</h2>
      </div>
      <span className="cm-status cm-status-draft">No eligibility decision</span>
    </div>
    <p className="cm-policy-notice" role="note">
      This is a read-only status summary, not a Tier 3 eligibility assessment. Current approved
      policy and customer-type applicability are not configured here. No wallet-tier or customer
      privilege change is available from this screen.
    </p>
    <dl className="cm-detail-grid cm-readiness-grid">
      <div>
        <dt>Customer activation</dt>
        <dd>{customerStatus}</dd>
        <small>Lifecycle status only; separate from phone verification.</small>
      </div>
      <div>
        <dt>Phone verification</dt>
        <dd>{labelForSignal(phoneVerified)}</dd>
        <small>Does not itself establish identity or Tier 3 eligibility.</small>
      </div>
      <div>
        <dt>Identity verification</dt>
        <dd>Not separately recorded</dd>
        <small>Stored identity-document metadata is not proof of official verification.</small>
      </div>
      <div>
        <dt>Address-document review</dt>
        <dd>Not configured</dd>
        <small>Policy, secure storage, and reviewer permissions are pending approval.</small>
      </div>
      <div>
        <dt>Physical address verification</dt>
        <dd>Not configured</dd>
        <small>Separate officer/provider workflow is not enabled.</small>
      </div>
      <div>
        <dt>KYC assessment</dt>
        <dd>
          {kycLevel} · {kycStatus}
        </dd>
        <small>Assessment state is shown separately from identity verification.</small>
      </div>
      <div>
        <dt>Financial eligibility</dt>
        <dd>{financialEligibility ?? 'Not recorded / unavailable'}</dd>
        <small>Existing operating eligibility is not a wallet-tier decision.</small>
      </div>
      <div>
        <dt>Wallet-tier change</dt>
        <dd>No action</dd>
        <small>
          Customer type: {customerType}. No tier mutation or privilege activation occurs here.
        </small>
      </div>
    </dl>
    <p className="cm-muted">
      Outstanding Tier 3 requirements cannot be computed until Compliance approves a policy and the
      related evidence/review workflows are enabled. No pending or rejected evidence is treated as
      verified.
    </p>
  </article>
);
