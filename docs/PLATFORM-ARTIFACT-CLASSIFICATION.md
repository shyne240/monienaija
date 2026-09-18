# Platform Artifact Classification and Preservation Register

- **Task:** B2R01 — Authoritative Platform Roadmap and B2 Finance Reconciliation
- **Status:** Reconciled classification for completed legacy B2T01–B2T10 artifacts
- **Classification authority:** [`AUTHORITATIVE-PLATFORM-ROADMAP.md`](AUTHORITATIVE-PLATFORM-ROADMAP.md)
- **Preservation rule:** Classification changes future ownership and sequencing only; it does not rename, move, rewrite, invalidate, or change existing implementation

## 1. Purpose

The completed work labeled B2T01–B2T10 was implemented under the historical title “B2 Customer Activation and Public Commercial Platform.” The authoritative roadmap now defines B2 as **Finance Platform** and B10 as **Developer & Integration Platform**. This register classifies the completed work by actual architectural responsibility while preserving every existing artifact and technical identity.

This register does not claim that B2 Finance is complete. No legacy B2T01–B2T10 task is counted as completion of the authoritative B2 Finance Platform.

## 2. Non-destructive preservation decision

The following existing identifiers and artifacts remain valid historical/technical identifiers and **must not be renamed, renumbered, moved, rewritten, regenerated, or invalidated as part of roadmap reconciliation**:

- all `b2_*` database tables, columns, indexes, constraints, and persistence records;
- migration numbers and files from `1785753600039` onward, including `0039` through `0045` currently present;
- all B2-prefixed TypeScript class, type, constant, module, repository, service, entity, and interface names;
- all B2 contract names and contract versions;
- all existing B2 ADR numbers, filenames, titles, statuses, and cross-references;
- all B2 event names and payload identities;
- all B2 idempotency scopes and retention semantics;
- all B2 reference prefixes;
- all B2 cohort keys and cohort versions;
- `docs/api/B2-OPENAPI-v1.yaml` and its existing operation identities;
- all existing B2 tests, fixtures, snapshots, and assertions;
- all existing audit entity types, actor names, request hashes, decision hashes, and replay hashes;
- all historical task labels B2T01–B2T10 when referring to the work already performed.

This rule protects migration integrity, persisted-data compatibility, replay safety, event/audit correlation, ADR history, source history, and test evidence. A future platform may wrap or consume these artifacts through approved boundaries; it must not create a parallel authority merely to obtain a new prefix.

## 3. Task classification summary

| Historical task | Implemented capability                                                    | Authoritative future classification                                                           | Preservation disposition                                                  |
| --------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| B2T01           | Activation baseline and first public-commercial cohort                    | Activation/integration foundation; shared input mainly for B10                                | Preserve unchanged as historical baseline; do not count as B2 Finance     |
| B2T02           | Public API catalog and route-exposure contract                            | **B10 Developer & Integration Platform**                                                      | Preserve as B10 contract input                                            |
| B2T03           | Customer activation-readiness attestation                                 | Shared customer activation capability supporting later B10 activation and customer onboarding | Preserve as shared read-only projection                                   |
| B2T04           | Merchant and agent activation-readiness attestations                      | Primarily **B5 Merchant Platform**, with later B10 integration                                | Preserve; B5 adopts lifecycle ownership later without duplicating records |
| B2T05           | Commercial activation workflow                                            | B1 integration and commercial activation orchestration, primarily useful to B10 flows         | Preserve as bounded orchestration; B1 remains commercial authority        |
| B2T06           | Activation and marketing consent decisions                                | Cross-cutting consent/activation capability primarily supporting B10-facing activation        | Preserve; future owner must consume rather than recreate it               |
| B2T07           | OpenAPI, documentation, versioning, sandbox/developer-onboarding contract | **B10 Developer & Integration Platform**                                                      | Preserve as B10 foundation                                                |
| B2T08           | API consumers, credentials, quotas, and rate limits                       | **B10 Developer & Integration Platform**                                                      | Preserve as B10 foundation; do not confuse with B9 administrative IAM     |
| B2T09           | Webhook registration, verification, delivery, retry, and dead letter      | **B10 Developer & Integration Platform**                                                      | Preserve as B10 foundation                                                |
| B2T10           | Public API authentication decisions and minimized B1 exposure             | **B10 Developer & Integration Platform**, integrating A2 and B1                               | Preserve as B10 integration foundation                                    |

## 4. Detailed classification

### 4.1 B2T01 — Activation baseline / integration foundation

**Primary artifact**

- `docs/B2-ACTIVATION-BASELINE.md`

**Actual responsibility**

B2T01 selected a bounded customer-facing activation cohort for the B1 virtual-account inbound-funding commercial scope. It inventoried activation-adjacent customer, policy, product, partner, commercial, API, consent, credential, and webhook surfaces. It is an activation/integration foundation, not finance accounting architecture.

**Future ownership**

- B10 may consume the public activation cohort and developer-integration assumptions.
- B5 may consume merchant/agent-related constraints when its lifecycle is designed.
- B1 remains owner of the selected commercial scope.
- The authoritative B2 Finance Platform does not adopt the cohort as a Finance identity.

**Disposition:** preserve unchanged as historical evidence.

### 4.2 B2T02 — Public API catalog and route exposure

**Primary artifact**

- `docs/B2-PUBLIC-API-CATALOG-CONTRACT.md`

**Actual responsibility**

The API catalog, audience/scope annotations, route exposure, API version, quota cost, rate-limit tier, and public-surface contract are Developer & Integration Platform concerns.

**Future ownership:** B10 Developer & Integration Platform.

**Disposition:** preserve unchanged. Later B10 planning must adopt or explicitly version this contract rather than recreate an equivalent public catalog authority.

### 4.3 B2T03 — Customer activation readiness

**Artifacts**

- `docs/B2-CUSTOMER-ONBOARDING-CONTRACT.md`
- `docs/ADR/ADR-0074-B2-Customer-Activation-Readiness.md`
- `src/policy/b2-customer-activation-readiness.*`
- `src/migrations/1785753600039-CreateB2CustomerActivationReadinessTables.ts`
- `test/b2-customer-activation-readiness.*`

**Actual responsibility**

A deterministic, persisted, read-only activation-readiness attestation consuming customer, A3, A4, A7, B1, and consent facts. It does not own Customer, policy, product, commercial decisions, or ledger value.

**Future ownership**

Shared customer activation capability supporting later B10 activation and customer onboarding. The canonical customer/onboarding authorities remain upstream; B10 consumes the attestation. B2 Finance may only consume it if a future approved finance use case requires activation context; it must not make it a finance source of truth.

**Disposition:** preserve unchanged as a shared read-only projection.

### 4.4 B2T04 — Merchant and agent activation readiness

**Artifacts**

- `docs/B2-MERCHANT-AGENT-ONBOARDING-CONTRACT.md`
- `docs/ADR/ADR-0075-B2-Merchant-Agent-Activation-Readiness.md`
- `src/policy/b2-merchant-agent-activation-readiness.*`
- `src/migrations/1785753600040-CreateB2MerchantAgentActivationReadinessTables.ts`
- `test/b2-merchant-agent-activation-readiness.*`

**Actual responsibility**

Merchant and agent identity traces, verification/readiness, beneficial-owner and supervising-merchant relationships, and settlement/commercial eligibility inputs.

**Future ownership:** primarily B5 Merchant Platform, with later B10 integration for public/developer access.

B5 must define canonical merchant lifecycle without treating the existing readiness projections as a second Customer, A3, A4, partner, settlement, or ledger authority. It should consume or evolve the existing contract compatibly.

**Disposition:** preserve unchanged.

### 4.5 B2T05 — Commercial activation orchestration

**Artifacts**

- `docs/B2-COMMERCIAL-ACTIVATION-CONTRACT.md`
- `docs/ADR/ADR-0076-B2-Activation-Workflow.md`
- `src/policy/b2-activation-workflow.*`
- `src/migrations/1785753600041-CreateB2ActivationWorkflowTables.ts`
- `test/b2-activation-workflow.*`

**Actual responsibility**

A bounded activation state machine combining readiness, consent, policy, and B1 commercial compatibility. It orchestrates activation but does not replace B1 commercial decisions, A4 policy, A7 product, A6 partner, or A5 Ledger.

**Future ownership**

Commercial activation orchestration/B1 integration, primarily useful to B10 activation flows. If B5 later uses it for merchant activation, B5 must retain merchant lifecycle authority while consuming this bounded activation record.

**Disposition:** preserve unchanged; do not classify as Finance.

### 4.6 B2T06 — Consent and activation intent

**Artifacts**

- `docs/B2-CONSENT-CONTRACT.md`
- `docs/ADR/ADR-0077-B2-Consent-Authority.md`
- `src/policy/b2-consent.*`
- `src/migrations/1785753600042-CreateB2ConsentTables.ts`
- `test/b2-consent.*`

**Actual responsibility**

Explicit activation and marketing-consent decisions separated from notification delivery preference. This is a cross-cutting activation capability used by public integration flows.

**Future ownership**

Primarily supports B10-facing activation. Any future enterprise consent authority review must preserve existing records and establish one canonical relationship rather than duplicate them. B2 Finance may consume legally required consent evidence read-only but does not own public activation consent.

**Disposition:** preserve unchanged.

### 4.7 B2T07 — API documentation and developer onboarding

**Artifacts**

- `docs/B2-API-DOCUMENTATION-CONTRACT.md`
- `docs/api/B2-OPENAPI-v1.yaml`
- `docs/ADR/ADR-0078-B2-OpenAPI-Documentation.md`
- `test/b2-openapi.spec.ts`

**Actual responsibility:** OpenAPI, API versioning, documentation, sandbox contract, and developer onboarding.

**Future ownership:** B10 Developer & Integration Platform.

**Disposition:** preserve unchanged as B10 foundation. Frontend Developer Portal work remains later than backend platform maturity.

### 4.8 B2T08 — API consumers, credentials, quota, and rate limits

**Artifacts**

- `docs/B2-API-CREDENTIALS-CONTRACT.md`
- `docs/B2-QUOTA-RATE-LIMIT-CONTRACT.md`
- `docs/ADR/ADR-0079-B2-Api-Consumer-Quota-RateLimit.md`
- `src/policy/b2-api-consumer.*`
- `src/migrations/1785753600043-CreateB2ApiConsumerTables.ts`
- `test/b2-api-consumer.*`

**Actual responsibility:** developer/API consumer registry, external API credentials, quotas, and rate-limit buckets.

**Future ownership:** B10 Developer & Integration Platform.

B9 owns administrative IAM, not these developer API products. B9 may govern administrative access to B10, while B10 remains owner of API consumer and developer credential semantics.

**Disposition:** preserve unchanged.

### 4.9 B2T09 — Webhooks

**Artifacts**

- `docs/B2-WEBHOOK-CONTRACT.md`
- `docs/ADR/ADR-0080-B2-Webhook-Authority.md`
- `src/policy/b2-webhook.*`
- `src/migrations/1785753600044-CreateB2WebhookTables.ts`
- `test/b2-webhook.*`

**Actual responsibility:** webhook registration, verification, HMAC rules, replay/freshness controls, delivery lifecycle, bounded retry, and dead letter.

**Future ownership:** B10 Developer & Integration Platform.

C6 may later provide generic worker/queue infrastructure, but B10 retains webhook product semantics and delivery authority. C5 may provide key-management infrastructure, but it does not become webhook owner.

**Disposition:** preserve unchanged.

### 4.10 B2T10 — Public authentication and B1 exposure

**Artifacts**

- `docs/B2-PUBLIC-API-AUTHENTICATION-CONTRACT.md`
- `docs/ADR/ADR-0082-B2-Public-Api-Authentication-and-B1-Exposure.md`
- `src/policy/b2-public-api-authentication.*`
- `src/migrations/1785753600045-CreateB2PublicApiAuthenticationTables.ts`
- `test/b2-public-api-authentication.*`
- existing module registration in `src/app.module.ts`

**Actual responsibility**

A deterministic public API authentication decision integrating A2 audience/scope/session concepts with B10 consumer/credential/quota/rate-limit controls and minimized B1 commercial views. It does not mint JWTs or create public controllers.

**Future ownership:** B10 Developer & Integration Platform integrating A2 and B1.

- A2 remains authentication/authorization authority.
- B1 remains commercial catalog/decision authority.
- B10 owns the developer/public API product and integration gate.
- B2 Finance does not absorb this public API authentication module merely because it retains a `B2` prefix.

**Disposition:** preserve unchanged.

## 5. Artifact inventory summary

The completed implementation includes:

- eleven B2-named top-level contract/baseline documents, counting the two B2T08 contracts;
- one OpenAPI v1 document;
- eight accepted ADR files for B2T03–B2T10, with no renumbering;
- seven migrations, `1785753600039` through `1785753600045`;
- seven B2 runtime module families: customer readiness, merchant/agent readiness, activation workflow, consent, API consumer, webhook, and public API authentication;
- twenty-nine B2 test files, including the OpenAPI specification test;
- existing app-module wiring for the runtime modules.

B2T01 and B2T02 are documentation/contract foundations. B2T07 is documentation/OpenAPI/test evidence. B2T03–B2T06 and B2T08–B2T10 have implementation artifacts within their declared boundaries. None of this inventory is a B2 Finance completion claim.

## 6. Adoption rules for future platforms

1. **Consume before creating.** B5 or B10 must inventory and consume these artifacts before proposing a new equivalent table, authority, event, or idempotency scope.
2. **Preserve persisted identity.** Existing IDs, references, hashes, events, and replay behavior remain stable.
3. **Use compatibility layers if needed.** A later owner may introduce a documented adapter or versioned contract without destructive renaming.
4. **Do not infer ownership from prefix.** The `B2` prefix records implementation history; future ownership comes from this classification and the authoritative roadmap.
5. **No automatic production approval.** Preservation does not convert fixture-tested work into live certification or release approval.
6. **No Finance completion credit.** B2 Finance tasks use the separate `B2F` planning namespace and must produce their own evidence.
7. **No old closure tasks.** Historical B2T11 and B2T12 must not be executed. Their rollback/recovery/certification requirements may be reconsidered later under the correct B5/B10 plans.

## 7. Risks controlled by preservation

| Risk                         | Preservation control                                                                                        |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Migration divergence         | Never edit or renumber `0039`–`0045`; future changes use additive migrations only after approval.           |
| Replay/idempotency breakage  | Retain existing scopes, request hashes, and reference identities.                                           |
| Audit/event trace loss       | Retain event names, actor names, ADR references, and persisted correlations.                                |
| Duplicate merchant authority | B5 consumes/readily maps existing readiness artifacts and explicitly chooses canonical lifecycle ownership. |
| Duplicate developer platform | B10 adopts existing API, credential, quota, rate-limit, webhook, and auth contracts.                        |
| False Finance completion     | B2 Finance has a separate boundary and `B2F` task plan.                                                     |
| Source-history churn         | No bulk rename or move is authorized.                                                                       |

## 8. Required future reviews

- B5 must decide how merchant/agent readiness relates to its canonical merchant and agent lifecycle.
- B10 must decide how the existing contract/service modules become a complete developer platform without claiming that current work already provides public controllers, token minting, SDKs, API analytics, or a Developer Portal.
- B9/B10 must approve the administrative-IAM versus API-consumer credential boundary.
- C5/B10 must approve secret/key infrastructure versus API/webhook product ownership.
- C6/B10 must approve generic background processing versus webhook retry/delivery semantics.
- Security, Privacy, Legal, Risk, Compliance, Operations, and Support must retain the existing no-live-certification status until later release gates are completed.

## 9. B2 Finance artifact classification

This section is separate from and does not rewrite the preserved legacy B2T01–B2T10 classification.

| Historical implementation label                                   | Preserved capability                                                                                           | Authoritative planning classification                                                                       | Completion claim                               |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| B2F07 — Finance Accounting Treatment and Source Decision Adoption | Verified B1/A6 source adoption, treatment provenance, period/control/journal-draft integration; fail-closed A7 | **B2F09-PRE — Finance Accounting Treatment and Source Decision Adoption Foundation**, shared by B2F07–B2F10 | Does not complete authoritative B2F07 or B2F09 |

Preserved identity:

- commit `4e0e72c90fb336efdd9cf596cc1c8b60612b4589`;
- ADR-0088;
- migration `1785753600049`;
- `B2F-ACCOUNTING-TREATMENT` v1;
- `b2f_finance_accounting_treatments`;
- `b2.finance.accounting-treatment.idempotency.v1`;
- all source, class, event, reference, hash, and test identities.

The next authoritative task remains B2F07 Accounts Receivable. See [`B2F-TASK-SEQUENCE-RECONCILIATION.md`](B2F-TASK-SEQUENCE-RECONCILIATION.md).
