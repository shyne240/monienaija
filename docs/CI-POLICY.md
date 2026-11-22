# CI validation policy

The `CI` workflow classifies the changed paths before installing application dependencies or starting test jobs. The classifier is intentionally small and is covered by `test/ci-change-classification.test.cjs`.

- **Documentation only** (`*.md`): run the classifier's unit tests; skip application and PostgreSQL jobs.
- **Frontend only** (`apps/admin-web/**`, `apps/agent-mobile/**`, or `apps/customer-mobile/**`): validate the affected app(s), and skip backend/PostgreSQL jobs.
- **Backend, shared, mixed, or uncertain**: run backend lint, formatting, build and unit tests first; then run both mandatory PostgreSQL suites and the production container build. Also validate all three client apps because an API/shared change can affect them.
- **Release milestones** (`v*` tag pushes, published GitHub releases, and manual workflow dispatch): force the complete backend, PostgreSQL, container and all-client regression regardless of changed paths.

Only explicitly recognized frontend application roots and Markdown documentation are low-risk scopes. Migrations, financial operations, authentication/authorization, shared infrastructure, CI, scripts, and any future/unclassified path are backend-risk by default. A failed or empty change comparison is also treated conservatively. The PostgreSQL suites remain required checks on backend-risk changes; they are not made optional, tolerated on failure, or omitted at release milestones.
