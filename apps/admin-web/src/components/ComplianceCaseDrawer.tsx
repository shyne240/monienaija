import React from 'react';
import { WorkspaceDrawer } from '../design-system/WorkspaceDrawer';
import { CustomerComplianceCaseRow } from '../utils/compliance-case';

/** Only fields validated for the current customer are presented; no case mutation is implied. */
export function ComplianceCaseDrawer({ record, onClose }: { record: CustomerComplianceCaseRow; onClose: () => void }) {
  const opened = typeof record.openedAt === 'string' && Number.isFinite(Date.parse(record.openedAt)) ? new Date(record.openedAt).toLocaleString() : 'Not recorded';
  return <WorkspaceDrawer label="Case details" className="compliance-case-drawer" onDismiss={onClose}>
    <header className="compliance-case-drawer__header"><div><p className="compliance-workspace__eyebrow">AUTHORIZED CASE RECORD</p><h2>{record.caseNumber}</h2></div><button type="button" className="compliance-case-detail" onClick={onClose}>Close</button></header>
    <div className="compliance-case-drawer__body"><p>Read-only case details returned for this customer.</p><dl>
      <dt>Case ID</dt><dd>{record.id}</dd><dt>Customer ID</dt><dd>{record.customerId}</dd><dt>Category</dt><dd>{record.category}</dd><dt>Status</dt><dd>{record.status}</dd><dt>Severity</dt><dd>{record.severity}</dd><dt>Opened</dt><dd>{opened}</dd>
    </dl></div>
  </WorkspaceDrawer>;
}
