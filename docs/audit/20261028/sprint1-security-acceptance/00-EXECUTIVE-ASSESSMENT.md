# 00 — Executive Security Assessment

## Verdict

**Integration readiness: NOT READY for independent security acceptance.** At source SHA `73eb1ca9b2ea74e063751ad71a34b76091537302`, the three assigned boundaries do not yet provide consistent function-level enforcement matching the relevant Admin gates/catalogue, and no Arena 1/2/3 Sprint 1 implementation branches were available to review. Existing integration tests intentionally assert broad principal-type access for notification delivery and limit diagnostics, so those tests must be reconciled with an explicit approved policy rather than simply weakened or treated as proof of least privilege.

A newly discovered P0 candidate also exists in the compliance case service: the HTTP DTOs carry caller-provided `actor`/`uploadedBy` values which are passed into history and `AuditService.record`. After route authorization is corrected, this still allows identity spoofing unless the actor is derived from the authenticated principal.

## Baseline verification

- Pinned branch at review start: `arena/870f970d-monienaija`, HEAD/audit commit `2fe5a2e9c882fe718370e582e13eb539cde8ca74`.
- Remote pinned ref matched that SHA at fetch time.
- Application source SHA: `73eb1ca9b2ea74e063751ad71a34b76091537302`.
- Integrated documentation tip: `d93328d0e433201f6168335dceecc468978e5271`; its sole parent is the application SHA. It is not a later application-code commit.
- Source final-closure documentation and the 20261028 audit package are present on the pinned branch.
- Latest ref inspection fetched all visible `origin/arena/*` refs; none had commits/files for the three Sprint 1 P0 authorizations. The old Arena 1/2 notification branches are historical notification implementation branches, not current P0 fixes.
- No reset, rebase, cherry-pick, merge, or force-push was performed in this review.

## P0 status summary

| Finding | Baseline status | Key reason | Implementation review |
|---|---|---|---|
| P0-01 Customer compliance | **FAIL — source boundary absent** | Generic `/customers/:id` route policy allows workforce principal types; compliance case controller has no `requireFunction`; generic `SELF` is not workforce subject scoping. UI scopes do not secure API. | **PENDING** — no implementation branch found |
| P0-02 Notification delivery | **FAIL — function-gate mismatch; policy must be reconciled** | `GET /internal/notifications/deliveries` has controller `requireWorkforce` only; UI uses `notification.view_deliveries`; tests approve SUPPORT/OPERATOR/SERVICE/PRIVILEGED with empty scopes. | **PENDING** |
| P0-03 Limit diagnostics | **FAIL vs Admin/catalogue parity; explicit source contract is workforce-type based** | GETs allow OPERATOR/SERVICE/PRIVILEGED without `limit.view`; Admin page requires `limit.view`; existing real-PG tests codify broad type access. | **PENDING** |
| P0-04 Caller-controlled compliance audit identity (new) | **FAIL — source-confirmed trust flaw** | DTO `actor`/`uploadedBy` is persisted in history and audit entries; controller passes it directly rather than deriving principal ID. | **New finding; needs owner triage and fix evidence** |

## Assumptions not supported by the source

1. It is **not** established that all customer compliance routes are restricted to the `COMPLIANCE` role. They are under the generic customers route policy; `compliance.manage_case` exists and is enforced only by Admin navigation/component logic, not by this controller.
2. It is **not** established that `SELF` restricts a workforce principal to one customer. `AuthorizationService.checkCustomerScope` only compares IDs for a `CUSTOMER` principal; for non-customer types it returns no mismatch after the principal-type allowlist.
3. It is **not** established that `notification.view_deliveries` is the intended exclusive scope. The role catalogue grants it to SUPER_ADMIN, FINANCE_AUDITOR, OPERATIONS, while the existing real-PG test explicitly expects SUPPORT, OPERATOR, SERVICE, PRIVILEGED to pass with empty `scopes`.
4. It is **not** established that the limit GET APIs should be restricted to `limit.view`. The Admin UI requires it, but route comments and real-PG tests intentionally codify OPERATOR/SERVICE/PRIVILEGED access. A product/security decision is needed.
5. A safe response projection is **not** equivalent to harmless data: notification results include recipient UUID, event/aggregate identifiers, message text, status/error and provider reference; limit results can expose principal IDs, amount/count usage, window and reservation metadata.
6. Test source is not a current executed integration pass. The previous audit's PG attempt could not connect to `127.0.0.1:5432`; existing tests are cited as source evidence, not rerun here.

## Recommendation

Do not accept or integrate Arena implementation branches until policy owners resolve the required role/scope sets and all three patches include controller/guard enforcement plus HTTP-level deny tests. For compliance, also require server-derived actor identity and category-aware authorization. Then run the focused real-PostgreSQL suites and combined regression on the merged candidate SHA. Acceptance remains separate from deployment approval.
