import React, { useEffect, useMemo, useState } from 'react';

import {
  CANDIDATE_PROOF_OF_ADDRESS_FILE_EXTENSIONS,
  CANDIDATE_PROOF_OF_ADDRESS_MIME_TYPES,
  CANDIDATE_PROOF_OF_ADDRESS_TYPES,
  candidateProofTypesForCategory,
} from '../../../../../src/customer-proof-of-address/customer-proof-of-address.constants';

const CANDIDATE_CATEGORIES = Array.from(
  new Set(CANDIDATE_PROOF_OF_ADDRESS_TYPES.map((candidate) => candidate.category)),
);

const FILE_ACCEPT = [
  ...CANDIDATE_PROOF_OF_ADDRESS_FILE_EXTENSIONS,
  ...CANDIDATE_PROOF_OF_ADDRESS_MIME_TYPES,
].join(',');

export const CustomerProofOfAddressPanel: React.FC = () => {
  const [category, setCategory] = useState<string>(CANDIDATE_CATEGORIES[0] ?? '');
  const candidateTypes = useMemo(() => candidateProofTypesForCategory(category), [category]);
  const [documentType, setDocumentType] = useState<string>(candidateTypes[0]?.type ?? '');

  useEffect(() => {
    if (!candidateTypes.some((candidate) => candidate.type === documentType)) {
      setDocumentType(candidateTypes[0]?.type ?? '');
    }
  }, [candidateTypes, documentType]);

  return (
    <div className="cm-proof-address-stack">
      <section className="cm-card cm-card-wide" aria-labelledby="cm-poa-title">
        <div className="cm-card-heading">
          <div>
            <p className="cm-eyebrow">DOCUMENTARY EVIDENCE</p>
            <h2 id="cm-poa-title">Proof of Address</h2>
          </div>
          <span className="cm-status cm-status-draft">Not enabled</span>
        </div>
        <p className="cm-supporting-text">
          Proof of Address is a separate evidence record linked to a residential address. It is not
          the residential address itself and is not an identity-verification result.
        </p>

        <div className="cm-policy-notice" role="note">
          <strong>Policy-neutral candidates only.</strong> The categories and document types below
          are configurable candidates, not an approved acceptance list. No freshness period,
          automatic verification, or Tier 3 eligibility rule is applied.
        </div>

        <div className="cm-wizard-field-grid cm-poa-metadata-preview">
          <label htmlFor="cm-poa-category">
            Candidate category
            <select
              id="cm-poa-category"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
            >
              {CANDIDATE_CATEGORIES.map((option) => (
                <option key={option} value={option}>
                  {option.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </label>
          <label htmlFor="cm-poa-document-type">
            Candidate document type
            <select
              id="cm-poa-document-type"
              value={documentType}
              onChange={(event) => setDocumentType(event.target.value)}
            >
              {candidateTypes.map((candidate) => (
                <option key={candidate.type} value={candidate.type}>
                  {candidate.label}
                </option>
              ))}
            </select>
          </label>
          <label htmlFor="cm-poa-associated-address">
            Associated residential address
            <select id="cm-poa-associated-address" disabled value="">
              <option value="">Address selection awaits approved access</option>
            </select>
          </label>
          <label htmlFor="cm-poa-document-date">
            Document date (metadata only)
            <input id="cm-poa-document-date" type="date" disabled />
          </label>
          <label htmlFor="cm-poa-file">
            Document file (PDF, JPG, JPEG, PNG)
            <input id="cm-poa-file" type="file" accept={FILE_ACCEPT} disabled />
          </label>
        </div>

        <div className="cm-policy-notice cm-policy-notice-warning" role="status">
          Upload, preview, and download are disabled. No file is sent or stored from this screen
          while the private-storage, scanning, size-limit, retention, and access-control design is
          awaiting security approval.
        </div>

        <div className="cm-actions-row">
          <button className="cm-button cm-button-primary" type="button" disabled>
            Upload Proof of Address (not enabled)
          </button>
          <button className="cm-button cm-button-secondary" type="button" disabled>
            Review / decision (not enabled)
          </button>
        </div>

        <div className="cm-table-meta cm-poa-history-heading">
          <span>Submission history</span>
          <span>Not queried: customer-scoped read permission is not yet approved.</span>
        </div>
        <p className="cm-empty-state">
          No document records are displayed here. This screen does not infer that the customer has
          no existing evidence; the PoA read API is not enabled until the permission matrix is
          approved.
        </p>
      </section>

      <section className="cm-card cm-card-wide" aria-labelledby="cm-physical-address-title">
        <div className="cm-card-heading">
          <div>
            <p className="cm-eyebrow">IN-PERSON / PROVIDER WORKFLOW</p>
            <h2 id="cm-physical-address-title">Physical address verification</h2>
          </div>
          <span className="cm-status">Not configured</span>
        </div>
        <p className="cm-supporting-text">
          Physical verification is independent from documentary Proof of Address review. Assignment,
          visit method/date, findings, report reference, outcome, independent reviewer, and history
          will be recorded separately when the role matrix is approved.
        </p>
        <dl className="cm-detail-grid cm-physical-address-preview">
          <div>
            <dt>Officer / provider assignment</dt>
            <dd>Not configured</dd>
          </div>
          <div>
            <dt>Method and visit date</dt>
            <dd>Not recorded</dd>
          </div>
          <div>
            <dt>Findings / report reference</dt>
            <dd>Not loaded</dd>
          </div>
          <div>
            <dt>Outcome / independent approver</dt>
            <dd>Not enabled</dd>
          </div>
        </dl>
        <div className="cm-policy-notice" role="note">
          No visit assignment, findings submission, verification, rejection, or approval action is
          enabled. The proposed workflow requires an authenticated officer and a separate reviewer.
        </div>
      </section>
    </div>
  );
};
