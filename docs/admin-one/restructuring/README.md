# Admin Console restructuring review

**Review this first:** [interactive review.html](review.html) (standalone/offline; JavaScript required for the searchable inventories). Its blueprint sections are also available as accessible Markdown in [BLUEPRINT.md](BLUEPRINT.md). Nothing in this directory changes the application, policy, database or deployment.

## Deliverables

- `review.html` — navigation comparison; 28 current view IDs and page briefs; 43 significant inner-component/gap records; searchable source controls, calls, DTOs, controllers, entities, services and seed role/function assignments; enrollment and policy blueprint; implementation plan. The artifact embeds its data and does not fetch it from a server.
- `BLUEPRINT.md` — executive findings, exact current/proposed structure, customer versus agent field and workflow comparison, class/limit enforcement distinctions, design standards, safety/acceptance matrix and owner decisions.
- `source-inventory.json` — source-line discovery index for the admin frontend and backend controller/entity/DTO/service surfaces. It is intentionally not a claim that every extracted item is mounted, usable or semantically fully audited.
- `blueprint-data.cjs` — curated mapping and status assessments used by the review; `extract-source.cjs`, `review-template.html`, `build-review.cjs`, and `verify-review.cjs` — reproducible documentation tooling.

## Evidence boundaries

Baseline: `6596545b04603886e56e165e9aef566228640de5`. The review is source-based, with previously recorded **narrow** synthetic browser observations linked in the blueprint. The static source index includes 69 admin TS/TSX files, 88 controller files, 156 entity files, 142 DTO files, 182 service paths, 94 seed catalogue functions and 207 seed role grants. Backend entries include APIs and entities outside the admin console; those are not automatically current admin features. Static extraction cannot resolve every condition, dynamic call, import, runtime gate, inherited validator, provider configuration, or all page-to-database behavior. Long code expressions are shortened. All unverified action outcomes remain unverified; status does not turn component rendering into a functional claim. A complete action-by-action end-to-end test and full semantic verification of every extracted field remain future acceptance work, not silently asserted here.

The review does not consult a database, credentials, `.env`, Docker, production, staging or external services. Existing customer/agent fields and security restrictions are not altered. The final architecture requires product-owner approval before implementation.

## Verification / regeneration

From the repository root with its existing Node dependencies installed:

```sh
node docs/admin-one/restructuring/extract-source.cjs
node docs/admin-one/restructuring/build-review.cjs
node docs/admin-one/restructuring/verify-review.cjs
```

The extraction is a read-only source scan that writes only its documented artifact. Regenerate at the stated baseline, or update the baseline and re-review the interpretation when source changes; the extractor is not a substitute for semantic audit. The verification checks route coverage, referenced source files, role seed count and embedded JavaScript syntax. This review was additionally opened as a local file in Chromium at 1440, 768 and 375 pixels; matrix search/expansion, source filters/paging and role search worked, with no page errors or document-level horizontal overflow. This verifies the review artifact, not the live console or every workflow.
