# ARENA 3D — Production Infrastructure, Operational Readiness and Financial Completion

Continuation record. Updated as each group lands; the workspace is the source of truth.

---

## 1. Checkpoints

| Point | Commit | Notes |
| --- | --- | --- |
| Mission start (accepted banking checkpoint) | `e0e0d550` | Conditional engineering acceptance of the banking mission. Local == remote, clean tree. |
| Latest pushed | `e3835cd7` | Group 3 (agent operating float) complete. |

Branch: `arena/defdd0fd-monienaija`. There is no upstream; push with `git push origin <branch>`.

---

## 2. Mission framing, as executed

This mission has four distinct kinds of work, and conflating them is how infrastructure missions
produce documents instead of software:

1. **Financial completion** (groups 3–5) — close gaps where an authoritative contract and an
   approved controlled policy exist. Where they do not, refuse explicitly and preserve the
   obligation.
2. **Infrastructure** (groups 6–12) — deployment, containers, configuration, secrets, database
   operations, migrations, backup/restore, disaster recovery. All of it must be *executable here*,
   not aspirational.
3. **Operations** (groups 13–29) — workers, scheduling, observability, integrity monitoring,
   alerting, admin centre, security, access, risk, compliance, support, disputes, notifications,
   privacy.
4. **Acceptance** (groups 30–38) — performance, CI, the consolidated matrix, provider sandbox
   readiness, mobile release, browser acceptance, the readiness gate, journeys A–J, the final
   matrix.

The standing constraint across all four is the mission's own refusal list: no invented provider
contracts, no invented settlement evidence, no invented financial policy, no weakened protected
authority, no automatic ledger adjustment. Those refusals are implemented as code that refuses,
not as documentation that warns.

---

## 3. Completed work

### Group 3 — Agent operating float funding

**The gap.** Three refusals, each individually correct, together made institution agent float
impossible to raise:

- `BankingAgentFundingService` provisions a funding account and reports
  `VERIFIED_AWAITING_FLOAT_CREDIT`; it never credits, because a bank transfer alone cannot
  distinguish float from a customer cash-in.
- `AgentFundingService` refuses to fund an institution-attributed agent, because
  `AGENT_FUNDING_POOL-NGN` is an unattributed platform liability and posting it into an
  institution-attributed wallet would invent an institution-bound funding rail.
- Nothing else existed.

**How it was closed.** By building the missing rail, not by relaxing either refusal. Both still
hold and both are still asserted by their own suites.

```
DEBIT   institution SETTLEMENT asset     (its bank balance grew — the money arrived)
CREDIT  the agent's float account        (the institution now owes the agent that float)
```

Both legs are institution-scoped in the same accounting unit. That is enforced by the ledger, not
by a comment: `LedgerService.resolveJournalInstitution` refuses a journal that mixes an
institution-attributed account with an unattributed one, so the mixed posting this service could
otherwise produce is rejected by the database layer.

**Files.**

| Path | Role |
| --- | --- |
| `src/migrations/1785753600605-CreateInstitutionAgentFloatFunding.ts` | Policy, receipt and obligation tables; four triggers. |
| `src/banking/agent-float-funding-authority.ts` | `AgentFloatFundingAuthority` contract; `UnavailableAgentFloatFundingAuthority` (shipped, approves nothing); `PolicyAgentFloatFundingAuthority` (reads approved policies, exercised in acceptance, deliberately not the runtime default). |
| `src/banking/agent-float-funding.service.ts` | The ledger effect, idempotency, obligation preservation. |
| `src/banking/banking.module.ts` | Wiring. The runtime authority approves nothing. |
| `test/a3d-agent-float-funding.integration.spec.ts` | 14 acceptance cases. |

**Design decisions.**

- *Policy is separate from verification and from posting.* `AgentFloatFundingAuthority` answers
  only "does an approved policy permit this payment to credit this agent". Merging that into
  verification would make every verified payment into a funding account automatically float.
- *The shipped authority approves nothing.* The policy-reading implementation exists and is
  exercised, but is not the runtime default: a database row must not be able to authorize money
  movement by itself.
- *Production is withheld* even with an ACTIVE production policy (`PRODUCTION_EXECUTION_WITHHELD`).
  A sandbox policy proves the lifecycle; it does not authorize real money.
- *A verified payment that is not credited is preserved* as a durable obligation with a closed-set
  reason. "The agent was suspended so we did not credit" and "we lost the payment" must not look
  the same to operations.
- *Exactly-once is a constraint, not a loop.* The unique key on
  `(provider_key, environment, provider_reference_hash)` is what makes duplicate webhooks, racing
  workers and restarts collapse onto one credit. The retry loop only handles serialization failures.

**Triggers added** (each closes a way the system could otherwise lie):

1. A policy's settlement asset must be *that same institution's* `SETTLEMENT` account, in the
   policy's currency, and active.
2. Funding receipts are immutable — no update, no delete.
3. An obligation cannot be resolved as credited unless a funding receipt exists for its reference.
   Operations cannot declare money moved.
4. `last_observed_at` advances on every re-observation, so a repeatedly-seen uncredited payment is
   visibly accumulating rather than frozen.

**Acceptance — 14/14** (`test/a3d-agent-float-funding.integration.spec.ts`, real PostgreSQL, real
application instance, institutions created through the authenticated console):

| Case | Proves |
| --- | --- |
| Balanced journal and immutable receipt | Both legs moved by the full amount; receipt records the accounts. |
| Duplicate delivery | Three calls, one credit, replays return the original receipt. |
| Ten concurrent attempts | One `CREDITED`, nine `REPLAYED`, one credit in the ledger. |
| Conflicting terms | Same reference, different amount → refused; original credit stands. |
| No active policy | `OBLIGATION / NO_ACTIVE_POLICY`, zero ledger movement, obligation visible. |
| Production withheld | ACTIVE production policy → `PRODUCTION_EXECUTION_WITHHELD`, zero movement. |
| Policy authority, sandbox | Credits under an approved sandbox policy. |
| Suspended agent | `AGENT_INELIGIBLE`, payment preserved. |
| Wrong funding account | `ACCOUNT_NOT_AGENT_FUNDING_ACCOUNT`, zero movement. |
| Customer wallet | `WALLET_NOT_AGENT_OWNED`; a deposit booked as float is refused. |
| Obligation closed by later credit | Status becomes `RESOLVED_CREDITED` against the real receipt. |
| Obligation cannot claim credit | Database refuses `RESOLVED_CREDITED` without a receipt. |
| Receipts immutable | Update and delete both refused by trigger. |
| Cross-institution settlement asset | Refused by trigger. |

**Verification.** Root unit suite 3053/3053 unchanged; migration-chain 20/20; migration-inventory
7/7; eslint and prettier clean on every touched file.

---

## 4. Outstanding

Groups 1, 2, 4–40 remain. See §6 for the immediate next action.

## 5. External blockers (already known at mission start)

- **Browser / visual acceptance** — two independent causes, both demonstrated: `npx playwright
  install chromium` fails with `Download failure, code=1` (egress is restricted to registry, git and
  PyPI hosts), and the binary's system libraries (`libnss3`/`libnspr4`/`libnssutil3`) are absent and
  not installable (`apt-get`: `E: Unable to locate package libnss3`).
- **Provider sandbox acceptance** — no authorized Monnify or Dojah sandbox credentials have been
  supplied, and provider calls are outside this mission's authorization.
- **Container runtime** — to be verified in group 7; if unavailable, the exact blocker must be
  recorded and every executable portion validated independently.

## 6. Exact next action

Continue in group order. Next: **group 2** (correct the banking handoff's stale opening statement),
then **group 4** (inbound customer funding boundaries), which is largely built and needs its gaps
identified and closed where policy permits.

## 7. Required product-owner decisions

None yet. Decisions will be recorded here as they arise — each is a question the mission explicitly
forbids answering by invention.
