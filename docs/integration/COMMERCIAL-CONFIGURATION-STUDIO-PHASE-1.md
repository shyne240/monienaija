# Commercial Configuration Studio — Phase 1

Base: `arena/5-main-web-integration` at `f8d5105af83bc64db4e8308df5944b116f5488bc`.

Open an existing commercial catalogue entry in Admin Web. The **Commercial Rule Registries** workspace shows the tabs permitted by the workforce session. The **Assignments** tab is alongside **Limits** and uses the same `limit.view` function. It is separate from the existing assignment management workspace and has no write controls, even for operators with write privileges.

## Baseline dependencies

The studio uses the existing authenticated Admin Web API client and paginated list routes. Details reuse each list row's documented projection; opening a drawer does not make a second request.

| Catalogue | Existing GET route | Studio read function | Catalogue-wide filters |
| --- | --- | --- | --- |
| Products | `/internal/products` | `product.view` | Domain, product scope, lifecycle status, enabled flag, configuration status |
| Fees | `/internal/fee-rules` | `fee_rule.view` | Product code, currency, active flag |
| Commissions | `/internal/commission-rules` | `commission_rule.view` | Product code, currency, active flag, recipient type |
| Rewards | `/internal/reward-rules` | `reward_rule.view` | Product code, currency, active flag, beneficiary type |
| Limit profiles | `/internal/limit-profiles` | `limit.view` | Profile kind, lifecycle status, enabled flag, configuration status |
| Limit rules | `/internal/limit-rules` | `limit.view` | Profile code, product, currency, active flag, dimension |
| Limit assignments | `/internal/limit-assignments` | `limit.view` | Profile code, subject type, subject UUID, segment code, active flag |

Read functions are UI visibility checks, not substitutes for the baseline API's workforce authorization. A denied read is not an empty catalogue. Free-text search and effective-window filtering apply only to the loaded page: the baseline APIs do not offer catalogue-wide text or date queries. Window status is relative to the displayed page load time, uses the inclusive start/exclusive end convention, and does not imply an active flag, a matching subject, a configured product, or a live transaction decision. An active flag is not a production feature flag.

Precedence guidance is based on the existing fee, commission, reward and limit-profile resolvers and limit enforcement service. The studio does not select winners, compute amounts or resolve current limits. Assignment subject IDs and segment codes are shown as stored; the studio does not join customer data or add customer-class behavior.

No dependency on PR #4 (fee targeting and limit mutation governance) or PR #6 (approval workflows), no new libraries or endpoints, and no changes to deployment configuration, shared infrastructure, customer-class ownership, financial engines, or financial feature flags.

## Verification

From `apps/admin-web`, run `npm ci`, `npm run ts:check`, `npm run build`, and `npm test -- --runInBand`. The commercial catalogue tests use test-only response fixtures to check baseline routes, filter and paging behavior, precedence/scope presentation, inclusive/exclusive window edges, read permissions, late responses, and API denial. The application does not supply fixture financial data. Operator verification against a deployed API requires a workforce session with the relevant view functions and existing catalogue records; an empty registry is valid and does not imply a zero rate or limit.
