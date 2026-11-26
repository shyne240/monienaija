# PR #27 — Products & Pricing: integration review

Status: **draft, not merged**. This document records what was verified on the combined revision, what
was found, and what still blocks merge review. It carries no claim that is not backed by a file or a
run link listed here.

## Revisions under review

| Role                      | Revision                                                                                                 |
| ------------------------- | -------------------------------------------------------------------------------------------------------- |
| PR head                   | `d953fcc1f83ac0d15e8772c1621777018c290110` (branch `arena/41dde913-monienaija`)                          |
| Integration base          | `aa8b1cf47c80e865a18934cdab46aa66fedbad3c` (`arena/5-main-web-integration`)                              |
| Merge base                | `41edf587`                                                                                               |
| **Combined revision**     | merge commit `df56a4b9dc0ba32c7e7ec2f034ab59de1827d8e5`, tree `d9eec218e89f9ed93b4b1520fa2a255c1977c334` |
| Branch carrying the merge | `arena/f5629bfa-monienaija`                                                                              |
| **Fixed combined head**   | `4222ed99b9bb156e96f5db4895e77bffadc131e6` — merge `df56a4b9` + the PR27-BROWSER-01 fix and its tests    |

`aa8b1cf4` is the tip of `arena/5-main-web-integration` at the time of writing, so the combined tree
above is the tree a reviewer would get by merging #27 today.

CI:

- PR head `d953fcc1`: runs [45805907501](https://github.com/shyne240/monienaija/actions/runs/45805907501)
  and [45805919140](https://github.com/shyne240/monienaija/actions/runs/45805919140) — `success`.
- **Combined revision `df56a4b9`:** run
  [45880877624](https://github.com/shyne240/monienaija/actions/runs/45880877624) — **failure**. 7 of 8
  jobs `success` (classify, backend lint/format/build/unit, admin web, both mobile apps, isolated
  PostgreSQL suites, container images). `Backend (real PostgreSQL integration)` failed after 2 h 16 m
  on **one** of 205 batch files:

  ```
  PostgreSQL: 1 failed, 0 missing of 205; 0 memory failures, 0 timeouts, 0 crashes.
  Failed batch files: test/a16-agent-cash-to-cash-claim.integration.spec.ts

  A16 Agent Cash→Cash CLAIM › concurrent initiation collisions reserve distinct immutable locator pairs
  ConflictException: The journal could not be posted after concurrent retries
    at LedgerService.transactionContentionExhaustedException (src/ledger/ledger.service.ts:1123)
    at LedgerService.postJournalWithRecoveryAuthority (src/ledger/ledger.service.ts:401)
    at GovernedFinancialFixture.fundLedgerAccount (test/support/governed-financial-fixture.ts:749)
  ```

  That suite passes locally on the same tree, twice, 95/95 including the exact test (run ids
  `a16flaky` and `a16flaky2`), and it passed on the PR head. It exercises ledger contention against a
  bounded retry budget, so a loaded runner can exhaust the retries without any product regression:
  recorded as a **flaky concurrency test, not a PR #27 failure** — but it does mean the combined tree
  has no green real-PostgreSQL run yet.

- **Fixed head `4222ed99`:** run
  [45898137816](https://github.com/shyne240/monienaija/actions/runs/45898137816) — started when the fix
  was pushed; its result is the one to read, and it was still running when this document was
  committed.

## What this review verified

### 1. Local gates (combined revision, disposable PostgreSQL 18.4)

- `npm run lint` → 0 errors (1 pre-existing warning in `test/b9-custom-role.integration.spec.ts`).
- `prettier --check` clean; `npm run build` (nest) OK; change classifier → 4/4 surfaces.
- Commercial/onboarding PostgreSQL batch: 4/4 suites, `["39 passed","12 passed","16 passed","1 passed"]`, 0 failures.
- Admin Web production bundle built with `ADMIN_WEB_API_BASE_URL=/api/v1`
  (`dist/assets/index-DpNX2UDe.js` 2,096.06 kB, `dist/assets/index-CY9AMcSI.css` 217.77 kB).

### 2. Real Admin Web walkthrough — one fee rule and one limit rule

`test/pr27-commercial-browser-walkthrough.integration.spec.ts` drives the production Admin Web bundle
in real Chromium against the real Nest application and a disposable database: real password login
through the shipped login screen, no token injection, nothing stubbed on the `/api` path.
**Result: 2/2 tests, 20/20 checks.** Machine-readable evidence:
`docs/commercial/evidence/pr27-browser-walkthrough.json`; screenshots and the full trace are written
to `data/validation/pr27-browser-walkthrough/` (git-ignored) and are regenerable from the command in
the spec header.

| Step                            | Fee (`WALLET_TRANSFER`)                                                                                                                                                                | Limit (`DAILY_AMOUNT`)                                                                                                                                                                                                                                                                        |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Author as `FINANCE_PREPARER`    | drawer refuses nothing; nothing is written to `fee_rules`                                                                                                                              | profile created in the Studio; proposal writes nothing to `limit_rules`                                                                                                                                                                                                                       |
| Maker cannot self-approve       | `nav-approvalsInbox` is not rendered for `FINANCE_PREPARER`                                                                                                                            | same session                                                                                                                                                                                                                                                                                  |
| Approve as `FINANCE_CONTROLLER` | approval `c3d10468…` → `APPROVED` via the inbox's own Approve button                                                                                                                   | approval `3d6417ce…` → `APPROVED`                                                                                                                                                                                                                                                             |
| Apply                           | **refused by the Studio** (finding below); the same approved change applied through the documented `execute-create` endpoint by the checker session → `CONSUMED`, one rule `f0306055…` | applied by the inbox's **Execute approved change** button → `CONSUMED`, one rule `147e3ef6…`                                                                                                                                                                                                  |
| Preview (browser)               | shows rule `f0306055…`, fee `100`, total `100100`                                                                                                                                      | shows `DAILY_AMOUNT`, threshold `100000`                                                                                                                                                                                                                                                      |
| Runtime                         | real `TransferQuoteService.create()`: fee `100`, VAT `0`, total debit `100100`, status `ACTIVE`                                                                                        | real `LimitEnforcementService.enforceWithManager()` in a `SERIALIZABLE` transaction: 50000 admitted under profile `PR27_BROWSER_WALK`, `ruleRefs` = `[147e3ef6…]`; 150000 refused with `LIMIT_DAILY_AMOUNT_EXCEEDED` ("amount 200000 exceeds 100000", the daily window already holding 50000) |
| No money moved                  | `ledger_journals` = 0                                                                                                                                                                  | no reservations committed outside the test transaction                                                                                                                                                                                                                                        |

Preview and runtime agree on the rule id and on every number in both flows.

## Findings

### PR27-BROWSER-01 — FIXED: the Studio could not apply a fee rule carrying VAT, a minimum or a maximum

**Was.** An approved `FEE_RULE_CREATE` proposal, executed from the Approval Inbox's _Execute approved
change_ button, returned

```
POST /api/v1/internal/fee-rules/changes/<id>/execute-create → 403
{"message":"Governed change rejected: executed payload does not match the approved request (FINGERPRINT_MISMATCH)"}
```

**Cause.** The inbox replays the approval's stored `policy.requestDetails`. That record is produced by
`sanitizeCommercialRequestDetails()` (`src/authorization/commercial-rule-governance.service.ts`) through
the allowlist `ALLOWED_COMMERCIAL_REQUEST_DETAIL_KEYS`, which did not contain `vatBps`,
`minimumFeeMinor` or `maximumFeeMinor` — it carried the unused `minFeeMinor` / `maxFeeMinor` /
`taxable` names instead. The executed payload therefore differed from the approved one only by the
fields the allowlist had dropped, and the fingerprint comparison refused it.

**Fix.** The allowlist now carries every field the create/update payload builders emit, per domain:
fees (`vatBps`, `minimumFeeMinor`, `maximumFeeMinor`), commissions (`recipientType`,
`flatCommissionMinor`, `minimumCommissionMinor`, `maximumCommissionMinor`, `agentId`, `aggregatorId`),
rewards (`beneficiaryType`, `rewardType`, `minimumRewardMinor`, `maximumRewardMinor`, `customerId`,
`customerKycLevel`, `agentId`). Dead names (`minFeeMinor`, `maxFeeMinor`, `taxable`) were removed. The
drawer already sent the correct names, so nothing changed in Admin Web: drawer, stored request and
executor now agree on one field vocabulary, and the comment above the list names the builders it
mirrors.

**Fingerprint and independent approval are unchanged.** The recomputation still covers the full
payload, and an altered replay is still refused. `test/commercial-stored-request-details-execution.integration.spec.ts`
pins both halves on disposable PostgreSQL (4 cases): fee with `vatBps 750` + 50/500 collar,
commission with a floor and a cap, reward with a floor and a cap — each authored as a maker, approved
by an independent checker, then replayed **from the stored `requestDetails`** and required to apply;
then a stored request altered in `vatBps`, `minimumFeeMinor`, `maximumFeeMinor` or `flatFeeMinor` is
refused with `FINGERPRINT_MISMATCH`, the approval stays `APPROVED`, no rule is written, and the
untouched details still apply afterwards.

**Confirmed, not assumed.** With the fix reverted, all four cases fail (the three untouched replays
get the same 403 the browser produced); with the fix in place all four pass. The commission and reward
drift reported from code reading was therefore real, not theoretical.

**Browser re-run (real Admin Web, real Chromium, disposable PostgreSQL).** The fee is now authored with
VAT `750` bps and a `50` / `500` min/max collar and applied from the inbox itself:

| Step                                                    | Result                                                                                                                                                                  |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Author as `FINANCE_PREPARER`                            | proposal recorded, `fee_rules` empty                                                                                                                                    |
| Approve as `FINANCE_CONTROLLER`                         | `APPROVED`, independent of the maker                                                                                                                                    |
| **Apply from the inbox**                                | _Execute approved change_ → `CONSUMED`; rule `569f5f3e…` with `flat_fee_minor 100`, `minimum_fee_minor 50`, `maximum_fee_minor 500`, `vat_bps 750`, `effective_to NULL` |
| Preview (browser)                                       | rule `569f5f3e…`, computed fee `100`, computed VAT `7`, computed total `100107`                                                                                         |
| Runtime (`TransferQuoteService.create()`, 100000 minor) | fee `100`, VAT `7`, total debit `100107`, `ACTIVE`                                                                                                                      |
| Money movement                                          | `ledger_journals` = 0                                                                                                                                                   |

Preview and runtime agree on the rule id and on all three amounts. 18/18 checks; evidence in
`docs/commercial/evidence/pr27-browser-walkthrough.json`.

### PR27-BROWSER-02 — OPEN: a product registration cannot be applied from its stored record

Adjacent to the finding above, different root cause, and **not** changed by this revision.

`redactRecord` classifies a bare `code` key as a credential carrier
(`src/common/sensitive-data-redaction.ts`, `SENSITIVE_KEY_NAMES`), and
`privileged-action-approval.service` redacts `requestDetails` a second time on write. So a product
registration approved with `code: 'PR27_NEW_PRODUCT'` is stored as `code: '[REDACTED]'` plus a
`productCode: 'PR27_NEW_PRODUCT'` alias injected for display. Neither reproduces the approved
fingerprint: `POST /api/v1/internal/products/changes/<id>/execute-create` returns 403
`FINGERPRINT_MISMATCH`, the approval stays `APPROVED` and no product row is written.

Measured, not inferred: `test/commercial-stored-request-details-execution.integration.spec.ts` records
the exact stored record and the refusal (`documents that a product registration is still refused from
its stored record (PR27-BROWSER-02)`). It is a deliberate characterisation, so fixing the defect shows
up as a failing expectation rather than a silent change.

Remedy requires a decision this review should not take alone: either the redaction boundary must
understand that a commercial payload's `code` is an entity identifier rather than a secret, or the
approval record must keep the approved payload under a separate, non-redacted, integrity-checked
field. Until then product registration stays an API-only flow.

### Known gaps carried forward (unchanged by this turn)

- Tier-ceiling parity for limit profiles (tracked with PR #24).
- Limit-profile CRUD is thinner in the Studio than the API (create + status only).
- `BANK_TO_WALLET` execution authority is **not** enabled here; live bank enablement belongs to the
  separate Bank to Wallet work. The product stays seeded `DISABLED`.
- Statutory charges beyond VAT, and the commission payout rail (V2), remain out of scope.

## What still blocks merge review

1. **PR27-BROWSER-02** (product registration cannot be applied from its stored record) — a
   pre-existing defect the same mechanism exposed, left open on purpose; see above.
2. **GitHub reports #27 as `CONFLICTING`** against `arena/5-main-web-integration`. The conflicts were
   resolved offline in merge `df56a4b9` (every gate in this document ran on that merge plus the fix),
   but the PR branch itself has not been merged forward, so GitHub cannot merge it as-is.
3. **A green `Backend (real PostgreSQL integration)` job.** On `df56a4b9` the job failed on one flaky
   contention test (`a16-agent-cash-to-cash-claim`, see above) that passes locally; the fixed head's
   run [45898137816](https://github.com/shyne240/monienaija/actions/runs/45898137816) is the one to
   read. Until it lands, no run on the combined code is green end to end.

Out of scope by instruction: live bank enablement, mobile apps (`apps/customer-mobile`,
`apps/agent-mobile` untouched), any live provider call, and any seeded production rate.
