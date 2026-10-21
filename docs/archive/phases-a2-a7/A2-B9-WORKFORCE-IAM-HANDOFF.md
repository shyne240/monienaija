# A2T11 to B9 Workforce IAM Handoff

A2T11 is an explicitly interim assignment authority. Its deterministic export preserves stable issuer/subject principal identity, assignment reference/version, role/scopes, effective/expiry dates, status, assigning/revoking actors, bootstrap/approval references, and audit references.

When B9 becomes operational it becomes permanent authority for role definitions, assignments, entitlements, reviews, revocation, and privileged administration. Cutover must inventory and reconcile every interim assignment, preserve A2 principal identity and historical evidence, fail closed on conflicts/unmapped identities, invalidate or narrow affected sessions, prevent dual active assignment authorities, support controlled rollback, disable new bootstrap consumption, and retain historical bootstrap/audit records.

A2 remains runtime authentication, session, assurance, authorization, and privileged approval authority after handoff. B2F06 continues consuming A2 principal/approval evidence. This document does not implement B9 or authorize cutover.
