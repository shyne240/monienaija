# MonieNaija One full-console progress

The approved Login, Dashboard and Customer Directory references are the design authority. Status means the listed workspace received a substantive redesign and batch verification; it does not imply owner visual acceptance. Navigation inventory comes from `Layout.tsx`; Customer 360° sub-workspaces are noted separately. Screens sharing a component are listed individually so none are hidden in the count.

## Redesigned and batch-verified

- Login (outside authenticated navigation); Operational Dashboard; Customer Directory and preview (Customer 360° sections covered below).
- Support Inbox; Agent Network Management; Agent Classes & Capabilities; Customer 360° overview, personal information and Proof of Address.
- Transfers, Deposits and Withdrawals (shared transaction trace and fee simulation); customer transaction history.
- Cash-to-Cash Operations.
- Ledger & Reversals (account registry and journal workspace; reversal controls preserved).
- Reconciliation & Breaks.
- KYC Assessment Lookup & Review; Compliance Case Lookup; Fraud Case Lookup.
- Fee Rules, Commission Rules, Reward Rules, Product Catalogue and Limit Catalogue (shared commercial registry); Limit Assignments.
- Audit & Security Events; Privileged Approvals; Workforce Overview & Support Provisioning; Role Governance; Super-Admin Recovery; System Health; Dashboard Settings.

Evidence and source commit references are in [README.md](README.md) and the evidence manifests. Browser captures use disposable data and local services, not production records.

## Partially completed

- SMS & Email Notifications: event catalogue, delivery and notification-change inspection, SMS/email template history, provider status, probe preparation, and provider proposal queue exploration are redesigned and verified. Other notification tabs require their own substantive design and browser pass; see README.

## Remaining — core operations first

- Platform Administration: SMS & Email Notifications.

## Dependencies and policy boundaries

- Support assignment remains an existing principal-ID workflow: no assignee directory API is available.
- General transaction listing is unavailable; global trace requires the exact transaction ID. Customer history uses its existing customer-scoped endpoint.
- Production A00 sign-in, E05 Tier 3, E08 agent reclassification and E09 PIN support remain policy-blocked. These do not block unrelated UI work.
- A unified action count / flagged-transaction queue and agent/support free-text global search require backend capabilities not currently available. Never invent values or functionality.
- Vite build reports its existing large-chunk warning. Screen-reader and actual zoom testing have not been performed.

No merge, deployment, external notifications, real financial operations or production-data changes are authorized.
