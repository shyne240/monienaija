import React from 'react';
import './customer-tier3-readiness.css';

interface CustomerTier3ReadinessPanelProps {
  customerType: string;
  customerStatus: string;
  phoneVerified: boolean | null;
  kycLevel: string;
  kycStatus: string;
  financialEligibility: string | null;
  signalsLoading?: boolean;
}

function labelForSignal(value: boolean | null): string {
  if (value === null) return 'Unavailable';
  return value ? 'Verified primary phone' : 'Not verified';
}

interface Signal { label: string; value: string; explanation: string }
const SignalList: React.FC<{ signals: Signal[] }> = ({ signals }) => (
  <dl className="cm-tier3-signals">
    {signals.map(signal => <div className="cm-tier3-signal" key={signal.label}>
      <dt>{signal.label}</dt><dd>{signal.value}</dd><small>{signal.explanation}</small>
    </div>)}
  </dl>
);

export const CustomerTier3ReadinessPanel: React.FC<CustomerTier3ReadinessPanelProps> = ({
  customerType, customerStatus, phoneVerified, kycLevel, kycStatus, financialEligibility, signalsLoading = false,
}) => {
  const accountSignals: Signal[] = [
    { label: 'Customer activation', value: customerStatus, explanation: 'Lifecycle status only; separate from phone verification.' },
    { label: 'Phone verification', value: signalsLoading ? 'Loading…' : labelForSignal(phoneVerified), explanation: 'Does not itself establish identity or Tier 3 eligibility.' },
    { label: 'KYC assessment', value: `${kycLevel} · ${kycStatus}`, explanation: 'Assessment state is shown separately from identity verification.' },
    { label: 'Financial eligibility', value: signalsLoading ? 'Loading…' : financialEligibility ?? 'Not recorded / unavailable', explanation: 'Existing operating eligibility is not a wallet-tier decision.' },
  ];
  const reviewSignals: Signal[] = [
    { label: 'Identity verification', value: 'Not separately recorded', explanation: 'Stored identity-document metadata is not proof of official verification.' },
    { label: 'Address-document review', value: 'Not configured', explanation: 'Policy and reviewer permissions for a documentary decision are pending approval.' },
    { label: 'Physical address verification', value: 'Not configured', explanation: 'Separate officer/provider workflow is not enabled.' },
    { label: 'Wallet-tier change', value: 'No action', explanation: `Customer type: ${customerType}. No tier mutation or privilege activation occurs here.` },
  ];
  return (
    <article className="cm-card cm-card-wide cm-tier3" aria-labelledby="cm-tier3-readiness-title">
      <div className="cm-card-heading cm-tier3__heading">
        <div><p className="cm-eyebrow">CUSTOMER OVERVIEW · READ ONLY</p><h2 id="cm-tier3-readiness-title">Tier 3 readiness factors</h2></div>
        <span className="cm-status cm-status-draft">No eligibility decision</span>
      </div>
      <div className="cm-tier3__boundary" role="note">
        <strong>Informational summary, not an eligibility assessment</strong>
        <p>Current approved policy and customer-type applicability are not configured here. No wallet-tier or customer privilege change is available from this screen.</p>
      </div>
      <div className="cm-tier3__groups">
        <section aria-labelledby="cm-tier3-account-title" className="cm-tier3__group">
          <div className="cm-tier3__group-heading"><div><p className="cm-tier3__eyebrow">ACCOUNT CONTEXT</p><h3 id="cm-tier3-account-title">Recorded signals</h3></div><span>Informational</span></div>
          <p className="cm-tier3__description">These states come from separate customer records and do not establish Tier 3 eligibility.</p>
          <SignalList signals={accountSignals} />
        </section>
        <section aria-labelledby="cm-tier3-review-title" className="cm-tier3__group">
          <div className="cm-tier3__group-heading"><div><p className="cm-tier3__eyebrow">POLICY &amp; EVIDENCE</p><h3 id="cm-tier3-review-title">Review and tier workflows</h3></div><span>Not enabled</span></div>
          <p className="cm-tier3__description">Document storage or a clean scan does not mean documentary or physical verification is complete.</p>
          <SignalList signals={reviewSignals} />
        </section>
      </div>
      <p className="cm-tier3__footer">Outstanding Tier 3 requirements cannot be computed until Compliance approves a policy and the related evidence/review workflows are enabled. No pending or rejected evidence is treated as verified.</p>
    </article>
  );
};
