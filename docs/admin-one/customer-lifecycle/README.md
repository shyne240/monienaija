# Customer lifecycle investigation

- `TECHNICAL-REPORT.md` — source-referenced findings, endpoint and transition details, worked example, roles and risk register.
- `PRODUCT-OWNER-REPORT.md` — plain-English briefing and owner decisions.
- `CONFIGURATION-INVENTORY.md` — policy, data-store and management inventory.
- `review.html` — self-contained offline interactive review of all three reports; searchable and expandable. GitHub source links require connectivity. Download the HTML from Drive and open it locally.
- `build-review.cjs` — deterministic documentation-only HTML generator; reads these reports. Does not touch application code or connect to services.

Baseline investigated: `5a7c14896dbb3ef8a2534a00b6f7415dbbad4da5`. No operational systems or user data were inspected; no real transactions, notifications or database changes were made. Source inspection is not end-to-end verification. Regenerate with `node docs/admin-one/customer-lifecycle/build-review.cjs`.
