# A1 Broken-Link Correction List

- **Task:** A1T13 — Consolidated Inventory and Cross-Document Consistency
- **Status:** Markdown link review record; no application changes
- **Scope:** Relative Markdown links in the A1 documentation package and existing documentation

## 1. Result

No broken relative Markdown links are expected after the A1T13 package is committed. The scan resolves links from the directory containing each document and excludes approved external URLs and fragment-only links.

## 2. Link coverage

| Link group                       | Expected targets                                                                          | Review result |
| -------------------------------- | ----------------------------------------------------------------------------------------- | ------------- |
| A1 plan and baseline inventories | A1 plan, ADR inventory, platform/customer, module/schema/API                              | Required      |
| A1 review inputs                 | Cross-cutting, overlap, risk/compliance, identifier/privacy documents                     | Required      |
| A1 synthesis package             | Ownership matrix, roadmap, dependency graph, implementation order, architecture inventory | Required      |
| Architecture phases              | PHASES, Architecture phase plan, A1-A8 references                                         | Required      |
| ADR references                   | ADR-0001 through ADR-0024                                                                 | Required      |
| Future contract inputs           | A4, A5, data-handling, and A2/A6 privacy inputs                                           | Required      |

## 3. Correction policy

If a later documentation change introduces a broken link:

1. Resolve the target relative to the linking document.
2. Preserve canonical filenames and avoid duplicate inventories or ADRs.
3. Correct the link in the owning document.
4. Re-run the repository Markdown-link scan.
5. Record the affected document and correction in the next consistency review.

## 4. Validation record

- Relative-link target existence scan: required before commit.
- New A1T13 artifact link scan: required before commit.
- Broken-link correction count: recorded after validation.
