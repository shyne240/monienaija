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

`aa8b1cf4` is the tip of `arena/5-main-web-integration` at the time of writing, so the combined tree
above is the tree a reviewer would get by merging #27 today.

CI:

- PR head `d953fcc1`: runs [45805907501](https://github.com/shyne240/monienaija/actions/runs/45805907501)
  and [45805919140](https://github.com/shyne240/monienaija/actions/runs/45805919140) — `success`.
- **Combined revision `df56a4b9`:** run
  [45880877624](https://github.com/shyne240/monienaija/actions/runs/45880877624) — 7 of 8 jobs
  `success`; job `Backend (real PostgreSQL integration)` was still `in_progress` when this document
  was written (see "What still blocks merge review").

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

### PR27-BROWSER-01 — the Studio cannot apply a fee rule that carries VAT, a minimum fee or a maximum fee

Reproduced in the browser: an approved `FEE_RULE_CREATE` proposal, executed from the Approval Inbox's
_Execute approved change_ button, returns

```
POST /api/v1/internal/fee-rules/changes/<id>/execute-create → 403
{"message":"Governed change rejected: executed payload does not match the approved request (FINGERPRINT_MISMATCH)"}
```

Mechanism (traced in code, not inferred from the message): the inbox replays the approval's stored
`policy.requestDetails`. That record is produced by `sanitizeCommercialRequestDetails()`
(`src/authorization/commercial-rule-governance.service.ts:162`) through the allowlist
`ALLOWED_COMMERCIAL_REQUEST_DETAIL_KEYS` (line 115), which **does not contain** `vatBps`,
`minimumFeeMinor` or `maximumFeeMinor` — it lists `minFeeMinor` / `maxFeeMinor`, names the fee body
never uses. The drawer's `buildAuthoringPayload` (`apps/admin-web/src/screens/authenticated/commercial-authoring-contract.ts`) sends the real names, so the approved fingerprint and the replayed payload
differ by exactly those keys. Observed stored details for the refused approval: `currency`,
`effectiveFrom`, `flatFeeMinor`, `isActive`, `percentageBps`, `priority`, `productCode`, `reason` —
`vatBps: 0` was dropped while the approved request carried it.

Blast radius: any fee with a VAT band, a minimum or a maximum — i.e. the ordinary way a fee is priced.
The refusal is safe (no rule written, approval left `APPROVED`, nothing consumed), and the API path
works, so this is a **UI-execution defect, not a governance hole**. `v1-commercial-configuration-authoring`
(39 cases) and `v1-applied-fee-runtime-quote` do not catch it because they replay the original
proposal body rather than the stored `requestDetails`.

The same drift, read from code (not exercised in the browser this turn): the drawer's commission
branch sends `recipientType`, `flatCommissionMinor`, `minimumCommissionMinor`, `maximumCommissionMinor`,
none of which the allowlist carries; the reward branch sends `beneficiaryType` and `rewardType`, also
absent. Expect the same 403 on the first commission or reward an operator tries to apply from the
Studio. Fee is the case proven end to end here; commission/reward should be re-checked once the key
list is unified.

Suggested fix: make the fee branch and the allowlist share one key list (widen the allowlist to
`vatBps` / `minimumFeeMinor` / `maximumFeeMinor` and drop the unused `minFeeMinor` / `maxFeeMinor`),
with a regression case that authorises a VAT-bearing fee, then executes from the stored
`requestDetails`. Alternative if the redaction is deliberate: hash a canonical copy of the _full_
payload at approval time and compare against that, keeping the redacted record purely for display.

Because of this finding, the walkthrough proves the fee lifecycle with the same approved change
applied through the documented endpoint by the same checker session, and says so in both the spec and
the evidence file. The limit flow needed no such workaround.

### Known gaps carried forward (unchanged by this turn)

- Tier-ceiling parity for limit profiles (tracked with PR #24).
- Limit-profile CRUD is thinner in the Studio than the API (create + status only).
- `BANK_TO_WALLET` execution authority is **not** enabled here; live bank enablement belongs to the
  separate Bank to Wallet work. The product stays seeded `DISABLED`.
- Statutory charges beyond VAT, and the commission payout rail (V2), remain out of scope.

## What still blocks merge review

1. **PR27-BROWSER-01** above — an operator cannot apply an ordinary VAT-bearing fee from the Studio.
2. **`Backend (real PostgreSQL integration)` on the combined revision has no completed result yet**
   (run [45880877624](https://github.com/shyne240/monienaija/actions/runs/45880877624), job started
   19:08Z). The PR head is green, but the combined tree is not signed off until that job lands.
3. **GitHub reports #27 as `CONFLICTING`** against `arena/5-main-web-integration`. The conflicts were
   resolved offline in merge `df56a4b9` (all gates above ran on that merge), but the PR branch itself
   has not been rebased/merged-forward, so GitHub cannot merge it as-is.

Out of scope by instruction: live bank enablement, mobile apps (`apps/customer-mobile`,
`apps/agent-mobile` untouched), any live provider call, and any seeded production rate.
