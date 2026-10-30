# A2 Exit Checklist

- **Task:** A2T10 — A2 Integration, Recovery, and Exit Evidence
- **Status:** Documentation package prepared; accountable-owner approval pending
- **Application code, API, entity, migration, and configuration changes:** None
- **Approval package:** [`A2-APPROVAL-PACKAGE.md`](A2-APPROVAL-PACKAGE.md)

## 1. A2 task evidence

| Task  | Evidence                                                     | Status             |
| ----- | ------------------------------------------------------------ | ------------------ |
| A2T01 | `docs/A2-TRUST-BOUNDARY-THREAT-MODEL.md`                     | Prepared           |
| A2T02 | Authentication execution service and tests                   | Implemented/tested |
| A2T03 | Session/token service, migration, and tests                  | Implemented/tested |
| A2T04 | Customer authentication/recovery runtime and tests           | Implemented/tested |
| A2T05 | MFA/trusted-device service, migration, and tests             | Implemented/tested |
| A2T06 | Authorization service/guard and tests                        | Implemented/tested |
| A2T07 | Privileged approval service, migration, and tests            | Implemented/tested |
| A2T08 | Runtime route guard/registry and tests                       | Implemented/tested |
| A2T09 | Redaction controls, checklist, and tests                     | Implemented/tested |
| A2T10 | Integration, recovery, review, handoff, and approval package | Prepared           |

## 2. A2 exit-gate checklist

- [x] Authentication execution, failure, lockout, and hash handling evidence passes.
- [x] Session issuance, validation, expiry, revocation, rotation, logout, and replay evidence passes.
- [x] Recovery validation, password rotation, session invalidation, and generic failure evidence passes.
- [x] MFA challenge, trusted-device, expiry, replay, scope, and redaction evidence passes.
- [x] Customer, support, service, operator, and privileged authorization contracts are implemented/tested.
- [x] Privileged maker-checker, approval expiry, rejection, cancellation, consumption, replay, and break-glass evidence passes.
- [x] Protected-route allowlist, bearer validation, customer scope, forbidden access, and rollback evidence is recorded.
- [x] Secret/hash/token/device redaction, audit/outbox/idempotency protection, and security checklist evidence passes.
- [x] A3/A4 handoff dependencies and prohibited edges are documented.
- [x] No A3-A8 implementation is included in the A2 exit package.
- [ ] ADR-0025 through ADR-0030 are approved by accountable owners.
- [ ] Security, Privacy/Legal, Operations, Risk/Compliance, and release owners approve A2.
- [ ] A2 entry/exit approval is recorded before A3/A4 implementation.

## 3. Exit result

**Documentation result:** Ready for final review.

**A2 approval result:** Pending. A2 must not be treated as approved for A3/A4 entry until the approval record is completed.
