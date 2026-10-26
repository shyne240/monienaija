# Security Guidelines

## Security philosophy
Security and privacy are product requirements and shared operational responsibilities. MonieNaija uses defence in depth, least privilege, secure defaults, continuous verification, and rapid transparent response. Regulatory, contractual, and applicable standards requirements are identified with qualified legal/compliance and security owners; this guide does not substitute for them.

## Mandatory controls
- Classify data before collection; minimise collection, purpose-limit use, define retention/deletion, and protect data subject rights as applicable.
- Encrypt sensitive data in transit and at rest using approved, current cryptography and managed key lifecycle controls.
- Authenticate every principal; enforce MFA for privileged access, short-lived credentials, least privilege, segregation of duties, and periodic access recertification.
- Store secrets only in approved secret-management systems. Never commit, log, paste into tickets, or embed them in clients or images.
- Treat all input, events, callbacks, files, and partner data as untrusted. Validate, authorise, rate-limit, and record security-relevant decisions.
- Protect sensitive payment data according to applicable obligations. Do not store prohibited authentication data; tokenize and minimise payment-card exposure.
- Maintain immutable, access-controlled audit logs for financial, administrative, authentication, and security actions; monitor for tampering and anomalous access.
- Inventory, patch, scan, and review dependencies, infrastructure, images, and configuration. Create SBOMs and remediate based on exploitability and risk.

## Secure delivery
Threat model meaningful new capabilities and integrations before implementation. Require peer review, automated SAST/secret/dependency scanning, environment separation, signed/traceable artifacts where selected, change approval appropriate to risk, and tested rollback. Production access is exceptional, time-bounded, audited, and never shared.

## Incident readiness
Maintain an incident response plan with on-call contacts, severity definitions, evidence preservation, customer/regulator/partner communication decision paths, and post-incident corrective actions. Suspected compromise, fraud, data exposure, or financial integrity issue is escalated immediately; contain first, preserve evidence, and communicate only through approved channels.

## Security exceptions
Exceptions require a documented risk, compensating controls, accountable owner, approval from security and relevant risk owners, expiry date, and tracked remediation. There are no permanent exceptions for secrets, authentication, ledger integrity, or logging of prohibited data.
