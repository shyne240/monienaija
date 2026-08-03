# Contributing to MonieNaija

## First principles
Contributors protect customers and the future operating licence by making small, reviewable, evidence-backed changes. Follow all repository policies and do not introduce application code until an approved implementation milestone authorises it.

## Branching strategy
The protected `main` branch represents releasable, reviewed work. Work is performed on short-lived branches created from current `main` and merged through pull requests. Branch names use a type and concise topic, for example `feat/wallet-limits`, `fix/retry-policy`, `docs/adr-process`, or `chore/tooling`. Release and emergency procedures will be defined by ADR before use. Never force-push shared/protected history.

## Commit strategy
Make atomic commits that each leave the repository coherent. Use Conventional Commit-style subjects: `type: imperative summary` (for example, `docs: establish engineering foundation`). Allowed types include `feat`, `fix`, `docs`, `test`, `refactor`, `build`, `ci`, `chore`, and `security`. Keep the subject under 72 characters; explain material risk, migrations, breaking changes, and test evidence in the body. Do not commit secrets, generated credentials, or unrelated formatting churn.

## Pull requests and review
PRs state the problem, scope, non-goals, design/ADR links, risks, test evidence, security/privacy impact, rollout/rollback plan, and operational/documentation changes. Authors self-review first. At least one qualified peer approves; changes to money, identity, security, compliance, data, infrastructure, or architecture require the relevant code/domain owner and additional reviewers defined by CODEOWNERS or governance. Resolve all substantive comments; approvals are invalidated by material changes.

## Definition of ready and done
Work is ready when its user/regulatory outcome, acceptance criteria, dependencies, data classification, threat/risk considerations, and owner are understood. It is done only under the repository-wide Definition of Done in `CODING_STANDARDS.md`.

## Documentation and ADR process
Update documentation in the same PR when behaviour, operations, policy, interfaces, or decisions change. Propose significant or durable technical decisions as an ADR using the next sequential number in `docs/ADR/`. ADRs include context, decision, alternatives, consequences, security/operational impact, and status. Discuss with affected owners, review in the PR, and mark the ADR Accepted only after approval. Do not rewrite accepted history; supersede it with a new ADR that links to the old one.

## Reporting concerns
Report vulnerabilities, suspected fraud, data exposure, or financial integrity issues privately through the future approved security/incident channel—not public issues or chat. Until that channel exists, contact the designated project security owner directly.
