# Branch, concurrency and dependency plan

## Verified baseline and current constraint

- At the start of M0, this workspace was clean on the Arena-pinned branch `arena/92fd33dd-monienaija`. A fresh fetch showed local `HEAD` and the remote branch at discovery commit `cf60b9d8001c605f4d986a222c07ed10e7adee30`, divergence `0 0`.
- `git rev-parse cf60b9d8001c605f4d986a222c07ed10e7adee30:apps` and `git rev-parse d212c667c431b05b7b1771c27212e9dc7f360d17:apps` both returned `77099e5a06167041ba3e178cf73157599093f537`: discovery changed documentation, not the application tree. M0 is likewise documentation only. This tree equality does **not** imply independent integration or security acceptance.
- This local branch has no configured Git upstream; the `0 0` comparison was against the explicit remote-tracking ref `origin/arena/92fd33dd-monienaija`, not `@{upstream}`.
- The user wants a frontend/design branch separate from security/integration work. This session is **fixed to the current Arena branch**; it cannot create, switch to, rename or push another branch. Documentation is isolated here by path and commit, not by branch. **Do not implement UI on this pinned notification/discovery branch.**

## Required handoff before M1

1. Product/platform owner provisions a **separate Arena design workspace pinned to its own branch**, rather than asking this session to create or switch a branch. Its source should be the latest explicitly selected, verified integration baseline; if that is the baseline reviewed here, confirm the application tree equals `77099e5a06167041ba3e178cf73157599093f537`. If a newer integrated baseline is selected, diff and revalidate affected files, roles and contracts; do not assume tree equality or overwrite others' changes.
2. Preserve access to the discovery and M0 documentation in the new workspace through an ordinary, separately authorized history-preserving integration mechanism. Record the source commit and resulting base; do not reset, rebase, force-push, cherry-pick or merge in this session merely to obtain a branch. No work on any other agent's branch is implied.
3. Product approves the [design](03-design-approval.md), explicitly authorizes the exact [file allowlist](04-m1-scope.md#proposed-file-allowlist), and names the Admin, Design, QA/Accessibility and authorization reviewers. The authorization owner approves the role/scope/context parity matrix without changing policy. Any added file, dependency or behavior returns for approval.
4. In the new workspace, fetch the selected remote and verify branch name, clean worktree, `HEAD`, upstream divergence, application tree and ownership-sensitive diffs before edits. Record exact hashes and test baselines. Coordinate before concurrent changes to `Layout.tsx` or `CustomerDirectoryScreen.tsx`; no one should assume that frontend-only markup is independent of authorization behavior.
5. Implement and test only after the above gates and explicit M1 go-ahead. Commit/push only the branch assigned to that future workspace. Use normal reviewed change history; merge and deployment each require separate authorization. Stop if baseline or file ownership changes underfoot.

**Current state:** the separate workspace, owner approvals and explicit M1 authorization are not evidenced in M0. They are blockers, not actions this session has already taken.

## Concurrent ownership and non-interference

| Owner / stream | Boundary and coordination |
|---|---|
| Arena 1 — notification reliability | Existing handoff at [`d212c667…`](../../ARENA1-NOTIFICATION-RELIABILITY-HANDOFF-20261028.md). M0 only references it; M1 must not change notification/provider behavior or duplicate notification producer work. |
| Arena 2 — provider hardening | Exclusive F-01 provider-reference sanitization and F-05 missing DNS-boolean behavior. Avoid those files and provider activation; if future scope needs them, use a documented owner handoff. Existing egress, audit, MFA and maker-checker governance remain intact. |
| Arena 3 — authorization/funding/catalogue and producer work | Do not change its authorization catalogue, funding controllers or product-catalogue modules, or duplicate its business-event producer work. Request authoritative current role/scope/recipient information through a documented handoff; capability-registry corrections need implementation evidence. |
| Arena 4 — independent acceptance | Preserve its independence and worktree/branch. M0 and M1 design tests do not close or substitute for its security acceptance. Sensitive future integration/release work waits for the applicable separate decision. |
| Admin design pilot | Own only the approved shell/directory presentation files in a separately provisioned branch. No direct edits to other agent branches, no application changes in M0, and no concurrent uncoordinated ownership of the same files. |

## Dependency gates and sequencing

| Gate | Needed before | Responsible roles / evidence |
|---|---|---|
| D1 direction, explicit M1 file authorization, separate branch/workspace and verified integration base | **Starting M1** | Product Owner, Design, Admin lead, platform owner; approved scope and recorded hashes. |
| D8 role/scope/context and compliance-boundary parity review | **Starting M1**; again if catalogue/base changes | Authorization/Security owner and Arena 3 contact; existing 11-role tests plus negative/context/alias cases. |
| Desktop keyboard, zoom, actual screen readers and rendered contrast | **Accepting M1** | Accessibility/QA; recorded browser/AT versions and scoped results. No actual screen reader was available in M0. |
| Backend/Admin completion and acceptance, explicit Mobile file authorization, real device verification and D4/D7 | **Customer Mobile milestone** | Product, Mobile, Security, QA; do not expose orphan funding/withdrawal routes merely to pass TypeScript. |
| Backend/Admin completion, applicable independent security acceptance, D2/D3/D5/D12/D13 and explicit Agent file authorization | **Sensitive Agent Mobile/financial milestones** | Product, Finance/Operations, Security, Mobile, QA; preserve settlement and secret restrictions. |
| Arena 2 provider remediation / governance and Arena 4 acceptance | **Affected provider/integration/release work**, as their owners determine | Separate documented handoffs and independent evidence; no vendor activation or release is authorized here. |

Financial decisions do not block the isolated read-only M1 pilot **if** its scope remains strictly limited and it leaves the affected flows alone. They do block related future financial redesigns. Existing [roadmap estimates and dependencies](../06-roadmap-and-decisions.md) remain provisional; backend/API expansions and waiting for owners or independent acceptance are not included in those estimates. No claim of production readiness, launch date or available staffing is made.
