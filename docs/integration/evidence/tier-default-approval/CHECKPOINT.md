# Arena 3 checkpoint — Tier default class approval (#38 consolidated revision)

Consolidated on top of PR **#38 (`e46aeffbdfb77fba76077aaa9a230d4e8fe65763`)** · PR #38 left draft and unmerged

## 1. Schema-free UUID audit fix (kept from #38)

`customer_tier_default_classes` remains keyed by the **tier code** (`tier VARCHAR(20) PRIMARY KEY`,
values `LEVEL_1`/`LEVEL_2`/`LEVEL_3`) with zero schema/migration changes. Because
`audit_events.entity_id` is `UUID NOT NULL`, `CustomerTierDefaultClassService` derives a stable
RFC 4122 v5 UUID from the tier code (`TIER_DEFAULT_AUDIT_NAMESPACE` + `tierDefaultAuditEntityId(tier)`)
and records the tier code inside `previousValues` / `newValues`:

| Tier      | Audit entity id                        |
| --------- | -------------------------------------- |
| `LEVEL_1` | `7394d412-36a4-5faf-9162-cbdf1979f584` |
| `LEVEL_2` | `3f1bcc35-6398-5c9f-81c5-ea552af1b6c4` |
| `LEVEL_3` | `f2a04c6a-e471-50df-9572-bd78ea0b2d99` |

## 2. Scoped tier-default route coverage & configurable maker/checker governance

- **Route policy coverage (`src/authorization/route-policy-registry.ts`)**:
  - Extended `customer-class` route policy to cover `POST /api/v1/internal/customer-classes/tier-defaults/proposals`
    and `POST /api/v1/internal/customer-classes/tier-defaults/proposals/:approvalId/execute` under
    `WORKFORCE_SESSION`, `SUPPORT` exclusion on mutations, `requiredFunctions: ['customer.manage_classes']`,
    and `auditDeniedWorkforceFunction: true`.
- **Catalogue-backed maker/checker (`CUSTOMER_CLASS_TIER_DEFAULTS_CONFIGURE` only)**:
  - `CUSTOMER_CLASS_TIER_DEFAULTS_ACTION` sets `initiatingRoles: []` and `approvingRoles: []` with
    `initiatingFunctionCodes: ['customer.manage_classes']` and `approvingFunctionCodes: ['customer.manage_classes']`.
  - Scoped strictly to `CUSTOMER_CLASS_TIER_DEFAULTS_CONFIGURE` in `PrivilegedActionApprovalService`
    and `A2WorkforceAdministrationController`:
    - Makers require active, non-`read_only` catalogue role access `INITIATE` or `EXECUTE` on `customer.manage_classes` plus MFA.
    - Independent checkers require active, non-`read_only` catalogue role access `APPROVE` or `EXECUTE` on `customer.manage_classes` plus MFA (`requesterPrincipalId !== approverPrincipalId` enforced across sessions and multi-role principals).
    - `withAuthority()` dynamically projects `approvingRoles` from active catalogue roles holding `APPROVE | EXECUTE` on `customer.manage_classes` for `CUSTOMER_CLASS_TIER_DEFAULTS_CONFIGURE` while leaving every unrelated action's static `rule.approvingRoles` untouched.
  - Seeded grants in `authorization-catalogue.seed.ts` and all 11 workforce accounts are preserved unchanged.
- **Admin Web (`CustomerClassesScreen.tsx`)**:
  - Surfaces pending/approved `CUSTOMER_CLASS_TIER_DEFAULTS_CONFIGURE` proposals with self-approval UI blocking (`Independent checker required`) and independent checker approve/apply actions.

## 3. Focused PostgreSQL & real-HTTP verification

- `test/customer-tier-default-approval.isolated-pg.test.ts` (isolated socket-only PostgreSQL cluster, full migration chain):
  - Deterministic tier UUID derivation (`tierDefaultAuditEntityId`), seeded `PENDING_APPROVAL` non-effectiveness, single-role maker proposal + cross-session/dual-role self-approval denial (`SELF_APPROVAL_FORBIDDEN`), independent single-role checker approval + `UPDATED` UUID audit rows, missing-row `INSERT` + `CREATED` UUID audit row, and configurable custom `INITIATE` maker / `APPROVE` checker roles.
- `test/customer-tier-default-approval.integration.spec.ts` (real PostgreSQL + governed Fastify HTTP):
  - 11-role & seeded-grant preservation, route-guard `403` denials, cross-session & dual-role self-approval refusal + `409` on unapproved execute, independent checker approve + execute (`UPDATED` and `CREATED` UUID audit events), governed B9 custom `INITIATE`/`APPROVE`/`VIEW` roles, and preservation of unrelated governed workflows (`FEE_RULE_CREATE`).
