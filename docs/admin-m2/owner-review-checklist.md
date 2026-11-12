# M2 owner review checklist

**Status:** 38 implemented and pending acceptance; 0 accepted; four policy-blocked separately. The [38-row visual package](visual-review-package.md) links a mobile and desktop screenshot for each implemented row. The [acceptance report](acceptance-review.md) contains evidence and open limitations.

## Run locally on Windows

Follow [Windows local setup](windows-local-run.md) for a disposable Docker database, backend and Admin Web. The Arena preview was stopped after a reported 404; it is not available. Sign in with the development-only local seed, and use dummy data only. The 11 separate disposable local test accounts provide role-specific sessions, but are not production authentication or proof of real IdP/MFA. Do not enable real SMS, deployed workers or providers.

A fresh local database will have few business records. Empty, unavailable or role-restricted views are not necessarily defects; the seeded SUPER_ADMIN cannot exercise all role-specific surfaces (including the funding checker queue). The [historical visual package](visual-review-package.md) illustrates synthetic populated states, not local DB data or functional proof. These local principals are distinct, but production-equivalent role and maker/checker review still requires a separately approved isolated environment.

## Screens to review

Use the sidebar labels below, and inspect both desktop and mobile layouts. Record findings and explicit approval/rejection for each row in your owner system, including commit, reviewer and date.

- [ ] **Operational Dashboard**, **Dashboard Settings** — A01–A02.
- [ ] **Customer & KYC Servicing** — directory A03; open a locally created dummy customer for overview E01, registration E02, personal/contact E03, and Proof of Address E04. Physical verification remains unconfigured.
- [ ] **Agent Network Management**, **Agent Classes & Capabilities**, **Support Inbox** — A04–A05, A07; inspect Agent funding E06, credential/session controls E07 and unified history E10.
- [ ] **Transaction & Fee Ops — Transfers / Deposits / Withdrawals**, **Cash-to-Cash Operations**, **Ledger & Reversals**, **Reconciliation & Breaks** — A06, A08–A12.
- [ ] **5.1 Fee Rules** through **5.6 Limit Assignments** — A13–A18. Review list, scrolling and diagnostics; do not infer complete authorization from the local administrator.
- [ ] **6.1 KYC Assessment Lookup & Review**, **6.2 Compliance Case Lookup**, **6.3 Fraud Case Lookup** — A19–A21.
- [ ] **Workforce Overview & Support Provisioning**, **Role Governance**, **Privileged Approvals**, **Super-Admin Recovery** — A22–A25 and E11. Use the separate local FINANCE_CONTROLLER checker; SUPER_ADMIN does not substitute.
- [ ] **SMS & Email Notifications**, **System Health**, **Audit & Security Events** — A26–A28; inspect both channel-template workspaces E12 and provider configuration E13 without running test-send or a worker.

## Decisions and approvals required

- [ ] **Product/Design:** approve or reject the 38 visual rows and remaining action, loading, empty, error and restricted states; review text, hierarchy, responsiveness and intentional table scrolling.
- [ ] **Accessibility:** use a real desktop browser at confirmed 200% and 400% zoom; test keyboard focus order/dialogs/reflow and a real screen reader. Record browser, OS, assistive technology and findings. Automated axe and narrow viewport checks do not substitute.
- [ ] **Security:** approve a safe isolated test environment, test principals and expected role/function/MFA matrix; verify scoped reads, denied actions, role changes and recovery through real authentication. Share access through an approved secure channel, not chat.
- [ ] **Finance/Operations:** independently verify funding/defunding maker/checker separation, approvals, ledger, reconciliation, idempotency and uncertain/late outcomes in that environment; obtain applicable operational sign-off.
- [ ] **CI/Security:** review the [pause-safe CI investigation](ci-pause-safety.md), audit the permitted isolated mocked worker tests and approve an egress-isolated plan without weakening the mandatory PostgreSQL gate. Real SMS and deployed workers remain paused.

## Separate policy blocks — not part of the 38

- **A00:** Product/Security must approve the production workforce sign-in/authentication policy and route.
- **E05:** Product/Compliance must approve Tier 3 eligibility, evidence and review policy.
- **E08:** Product/Security must decide whether and how Agent reclassification is governed and exposed.
- **E09:** Product/Security must decide authorized PIN status/unlock policy and callbacks.

Do not treat a screenshot or disabled placeholder as approval of these policies. Do not record final acceptance until the necessary live, accessibility and owner evidence is complete.
