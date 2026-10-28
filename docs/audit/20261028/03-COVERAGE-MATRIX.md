# 03 — Coverage Matrix and Classification

The detailed, row-level matrix is `admin-capability-inventory.csv`; the current menu manifest is `admin-navigation-inventory.csv`. The matrix deliberately distinguishes a user-facing screen from a backend endpoint or an unverified downstream effect. Its counts are capability assertions, not screen counts.

## Current classifications (42 assessed rows)

| Classification | Count | Interpretation |
|---|---:|---|
| COMPLETE | 0 | No end-to-end current-audit browser + real persistence/effect claim meets the audit threshold. |
| PARTIAL | 27 | Screen/source exists and performs a subset of expected read or write work, but complete acceptance/evidence is missing. |
| BACKEND_ONLY | 7 | Server operation exists, but corresponding Admin workflow is absent or materially incomplete. |
| FRONTEND_ONLY | 1 | Fraud-category selection/filter is client-side and does not isolate data at the API boundary. |
| POLICY_BLOCKED | 3 | Agent reclassification, Admin PIN unlock, and manual notification retry remain explicitly blocked/deferred; do not bypass governance. |
| MISSING | 1 | General discoverable privileged-approval queue is not present as a user journey; a known-ID lookup is not a queue. |
| UNVERIFIED | 3 | Reward operational effect, expiry-worker deployment/monitoring, and browser UAT remain without current evidence. |
| **Total** | **42** | 28 navigation entries + 14 cross-boundary/evidence capabilities. |

## Key end-to-end boundaries

- **Financial workflows:** Agent cash/C2C/funding paths have substantive backend implementation and historical integration evidence in cited source reports; this matrix does not repeat their historical completeness assertions as fresh proof. Admin agent funding/onboarding remains PARTIAL pending a current browser + PG read-after-write and separate maker/checker evidence.
- **Commercial management:** backend governed registries are distinct from Admin commercial views. Fee, commission, reward, product and limit writes are backend-only for Admin; a stored registry row is not proof of a consuming runtime effect.
- **Compliance and fraud:** backend case subresources exceed current Admin interactions. Client filtering is not access control. The missing dedicated function authorization is P0 until policy and tests establish otherwise.
- **Notification management:** template/configuration governance, preview, provider status, controlled test-send and delivery diagnostics are represented in source and were tested in prior integrated closure reports. Current audit did not rerun PG/browser tests; delivery-list authorization remains a distinct P0 issue. Manual retry remains deferred by requirement. Do not infer live provider delivery or production activation.
- **Expiry lifecycle:** code now includes a bounded expiry worker unlike the earlier 20261027 finding of no trigger. The flag defaults false. This changes the finding from missing implementation to deployment/operations-unverified; it does not change expired-funds disposition.
- **Observability:** transaction, ledger, reconciliation, health, audit and dashboard pages may be useful and correctly read-only. Read/refresh is not reversal, case resolution, remediation, payout, or arbitrary operations authority.

## Evidence convention

`persistence`, `business_effect`, and `browser` are `NOT TESTED IN THIS AUDIT`/`NOT EXECUTED` where appropriate. Historical report evidence is traced in `08-TEST-EVIDENCE-MATRIX.md`, not overwritten by a current pass claim. `COMPLETE` can be awarded selectively in a later audit once its acceptance evidence exists; no automatic promotion occurs from endpoint or test counts.
