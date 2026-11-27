# Arena 3 checkpoint — Tier default class approval (#38)

Branch `arena/0f3ce003-monienaija` · base `arena/5-main-web-integration` · PR **#38 (draft, unmerged)**

| | |
| --- | --- |
| Previous tip | `f15855ba` |
| **Tested + pushed SHA** | **`f4abd31184f471f47e01d389cc0a15965b746287`** |
| Rollout | `f15855ba..f4abd311` |
| PR | https://github.com/shyne240/monienaija/pull/38 (still draft) |

## 1. The defect that blocked tier-default approval

`customer_tier_default_classes` is keyed by the **tier code** (`tier VARCHAR(20) PRIMARY KEY`,
values `LEVEL_1`/`LEVEL_2`/`LEVEL_3`). The approval path passed that same tier code to
`AuditService.record` as `entityId`:

```ts
// before — src/customer-class/customer-tier-default-class.service.ts
entityId: tier,   // 'LEVEL_1'
```

`audit_events.entity_id` is `UUID NOT NULL` (`1785753600005-CreateOperationalResilience.ts:39`).
So an approved tier default did this inside one transaction:

1. `UPDATE customer_tier_default_classes SET status='APPROVED', approval_id=…` — succeeds;
2. `INSERT INTO audit_events (… entity_id …) VALUES (… 'LEVEL_1' …)` — fails
   `invalid input syntax for type uuid: "LEVEL_1"`;
3. the transaction rolls back, so the approval is silently discarded.

This is exactly the reported class of bug: **an audit write receiving a tier code where a
mapping UUID is required.**

### The fix

A stable, name-based UUID (RFC 4122 v5 layout, SHA-1 over a fixed namespace) derived from the
tier code, so the audit entity id is always a UUID and always the same value for a given tier.
The tier itself stays in the audit payload (`newValues.tier`).

```ts
export const TIER_DEFAULT_AUDIT_NAMESPACE = '2f1c1d9e-5b3a-5c7e-9a11-6d4c0b8f7e21';

export function tierDefaultAuditEntityId(tier: string): string { … } // sha1(ns || tier), v5 bits

// after
entityId: tierDefaultAuditEntityId(tier),   // 'LEVEL_1' -> 7394d412-36a4-5faf-9162-cbdf1979f584
```

| Tier | Audit entity id |
| --- | --- |
| `LEVEL_1` | `7394d412-36a4-5faf-9162-cbdf1979f584` |
| `LEVEL_2` | `3f1bcc35-6398-5c9f-81c5-ea552af1b6c4` |
| `LEVEL_3` | `f2a04c6a-e471-50df-9572-bd78ea0b2d99` |

**Cause-and-effect proven**, not assumed: with the fix reverted, the two approval tests fail with
`QueryFailedError: invalid input syntax for type uuid: "LEVEL_1"`; with the fix in place both pass.

## 2. Maker / checker behaviour proved

New suite `test/customer-tier-default-approval.isolated-pg.test.ts`, run on the disposable,
socket-only cluster with the **complete migration chain** (so the real `UUID` constraint is in
force, unlike a hand-built schema). 5 tests:

| # | Check | Result |
| --- | --- | --- |
| 1 | Derived ids are stable, distinct per tier, UUID-v5 shaped | pass |
| 2 | Migration seeds three `PENDING_APPROVAL` mappings that are **not** effective (`getApprovedDefaultForTier` → `null`, `allApproved=false`) | pass |
| 3 | Maker proposes; **same `principalId` cannot approve even in a second session with both roles and MFA** (`SELF_APPROVAL_FORBIDDEN`); mapping stays `PENDING_APPROVAL` on the seeded class | pass |
| 4 | Independent checker approves; request is applied; all three mappings `APPROVED` with the checker's `approval_id`/`approved_by`, version 2, effective default resolves to `PREMIUM`; one UUID-keyed `UPDATED` audit row per tier carrying `{tier,status,approvalId}` | pass |
| 5 | **New mapping created** (tier row deleted first): `INSERT` path, `status=APPROVED`, `approval_id` set, version 1, `CREATED` audit row on the derived UUID | pass |

Both required paths are covered: **updating a migration-seeded mapping** (test 4) and
**creating a new one** (test 5).

## 3. Policy decision needed before changing grants (not changed)

`CUSTOMER_CLASS_TIER_DEFAULTS_ACTION` (`src/authorization/governed-action.registry.ts:318`) is the
only entry whose roles are arrays of length > 1, and the two gates read them with **opposite
quantifiers**:

```ts
initiatingRoles: ['SUPER_ADMIN', 'CUSTOMER_SERVICE'],
approvingRoles:  ['SUPER_ADMIN', 'CUSTOMER_SERVICE'],
```

- At **proposal** time `CommercialRuleGovernanceService.requestChange` passes
  `requiredRoles: initiatingRoles`, and `AuthorizationService.evaluate` applies
  `requiredRoles.every(...)` — **all-of**. A proposer must therefore hold *both* `SUPER_ADMIN`
  **and** `CUSTOMER_SERVICE`.
- At **decision** time `PrivilegedActionApprovalService.decide` uses
  `approvingRoles.some(...)` — **any-of**.

Neither of the eleven seeded workforce accounts (`SUPER_ADMIN`, `FINANCE_PREPARER`,
`FINANCE_CONTROLLER`, `FINANCE_AUDITOR`, `ADMINISTRATOR`, `OPERATIONS`,
`AGENT_NETWORK_MANAGER`, `COMPLIANCE`, `RISK_FRAUD`, `CUSTOMER_SERVICE`, `TREASURY`) holds both
`SUPER_ADMIN` and `CUSTOMER_SERVICE`, so **no single account can legitimately propose a tier
default today**. The tests exercise the mechanism with a dual-role principal rather than
loosening a grant.

**Decision needed:** should the proposer gate for tier defaults be *either* role (matching the
checker gate and the apparent intent of an array of two roles), or a deliberate separation of
duties with a distinct maker role? Only the policy owner can answer; no grant was changed and the
guard was left intact.

## 4. Test results at `f4abd311`

| Suite | Result |
| --- | --- |
| Root `npx jest` | **311/311 suites, 3606/3606 tests** |
| Isolated PG (`npm run test:pg:isolated-kyc`) | **13/13 suites, 160/160 tests** (was 12/155; +1 suite, +5 tests) |
| `apps/admin-web` jest | **106/106 suites, 1081/1081 tests** |
| `npx tsc --noEmit` | clean |
| `npm run lint` | **0 errors**, 1 pre-existing warning |

`test/postgres-acceptance.spec.ts` is the CI inventory guard that counts isolated suites; it
correctly reported `Expected: 12, Received: 13` until the expected count was updated, which also
confirms the new suite is claimed by the `npm run test:pg:isolated-kyc` runner CI invokes.

## 5. Working tree / scope

Only three files are in `f4abd311`:
`src/customer-class/customer-tier-default-class.service.ts`,
`test/customer-tier-default-approval.isolated-pg.test.ts` (new), `test/postgres-acceptance.spec.ts`.

Still **uncommitted and untouched** from the earlier operator-journey task: the regenerated
screens/JSON under `docs/integration/evidence/operator-journey/`, and the new
`scripts/operator-journey/mobile-claim.cjs`. Nothing was reverted; they are left for that thread.

All eleven workforce accounts and passwords are intact (`scripts/local-dev-seed-11-roles.js` was
not modified). OTP handling was not touched. PR #38 remains draft and unmerged.
