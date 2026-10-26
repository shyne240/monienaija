# V1 UAT — catalogue, final report, and evidence

## Layout

- [`V1-UAT-MASTER-01.md`](V1-UAT-MASTER-01.md) — authoritative 191-item manual UAT catalogue (committed `67a842a`)
- [`V1-UAT-FINAL-01.md`](V1-UAT-FINAL-01.md) — authoritative final report: **V1 UAT CONDITIONALLY PASSED** (175 PASS / 0 FAIL / 16 BLOCKED / 0 NA)
- [`evidence/`](evidence/) — raw execution artifacts cited by the final report (all tracked since V1-DOCS-CLEANUP-02, contents byte-for-byte preserved)

| Evidence file | Role | md5 (unchanged by moves) |
|---|---|---|
| `evidence/V1-UAT-RUN-01-results.jsonl` | RUN-01 base ledger (all 191 attempted) — immutable checkpoint | `3b75282b00b78a6cdc2dacf6e9f4240e` |
| `evidence/V1-UAT-B0-results.jsonl` | B0 corrected re-execution ledger (replay-reconstructed; honestly labeled per final report §20) | `f3cdfa67ee54792794ebc7515de3e20b` |
| `evidence/V1-UAT-B0-REPORT.md` | Contemporaneous B0 narrative (authoritative B0 account) | `326f8d0ab4bf3504f0539670a01c5ee2` |
| `evidence/V1-UAT-D1-RETEST-results.jsonl` | Post-fix D1-RETEST ledger (48/48 PASS) | `9df32b525fbf9d7c9b401d89e301cb76` |
| `evidence/V1-UAT-DEFECT-001-RETEST.md` | UAT-DEFECT-001 closure record | `74211a9535f41402ae92513381d48c19` |
| `evidence/V1-UAT-RECOVERY-01.md` | Interruption/recovery governance doc for the UAT execution | `75e17131eebc3369346e7195c7659431` |

**Evidence contents are verbatim.** The six artifacts (including the recovery doc and both reports)
moved with `git mv` and, since V1-DOCS-CLEANUP-02, match the md5s above — no internal references were
retargeted. Path strings *inside* evidence files (e.g. ``docs/uat-evidence/…``, `uat-run-results.jsonl`)
describe the tree **as it was at UAT time** and are intentionally preserved as history; the canonical
current locations are the table above. The referencing *paths in the final report itself* were
updated during the reorganization so that every evidence citation resolves to these tracked files.

The repo-root duplicate `uat-run-results.jsonl` (byte-identical ancestor of the RUN-01 ledger, same
md5) was removed in V1-DOCS-CLEANUP-02 — the tracked ledger above is now the sole, integrity-verifiable
copy (audit finding C-6). The UAT harness specs (`test/tmp-uat-*.integration.spec.ts`) remain untracked
by design (execution tooling, not product documentation).

## Reference alias note (audit finding C-1)

The catalogue header cites **`V1-FINAL-GAP-AUDIT-01` ("V1 STATUS: COMPLETE · UAT STATUS: READY")** as
a generation input; no document by that literal title exists in the repository. During catalogue
authorship that alias referred to the pre-UAT completion evidence — today covered by
[`../V1/V1-HARDENING-10-FINAL-V1-OPERATIONAL-READINESS-AUDIT.md`](../V1/V1-HARDENING-10-FINAL-V1-OPERATIONAL-READINESS-AUDIT.md)
("operationally complete") together with
[`../V1/V1-PRODUCT-COMPLETION-AUDIT.md`](../V1/V1-PRODUCT-COMPLETION-AUDIT.md). The catalogue's own
historical text is left untouched; this note resolves the alias for readers.
