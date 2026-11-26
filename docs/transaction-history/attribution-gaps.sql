-- Read-only diagnostic. Run only with authorized platform reporting access.
-- Returns affected business IDs, not inferred institution assignments.
SELECT 'CUSTOMER_FUNDING' AS product, r.id, r.status::text AS status,
       CASE WHEN r.journal_id IS NULL THEN 'NO_CREATION_TIME_CUSTODY_EVIDENCE' ELSE 'UNATTRIBUTED_JOURNAL' END AS reason
FROM customer_funding_requests r LEFT JOIN ledger_journals j ON j.id=r.journal_id
LEFT JOIN customer_funding_scope_evidence e ON e.request_id=r.id
WHERE e.institution_id IS NULL AND j.institution_id IS NULL
UNION ALL
SELECT CASE r.direction WHEN 'FUND' THEN 'AGENT_FUNDING' ELSE 'AGENT_DEFUNDING' END,
       r.id,r.status,CASE WHEN r.journal_id IS NULL THEN 'NO_POSTED_JOURNAL' ELSE 'PLATFORM_OR_UNATTRIBUTED_JOURNAL' END
FROM agent_funding_requests r LEFT JOIN ledger_journals j ON j.id=r.journal_id
WHERE j.institution_id IS NULL
UNION ALL
SELECT 'WALLET_TRANSFER',t.id,t.status::text,'NO_HISTORICAL_INSTITUTION_PROOF'
FROM transfers t LEFT JOIN ledger_journals j ON j.id=t.journal_id
WHERE j.institution_id IS NULL;
-- A NULL institution can be intentionally platform-scoped, not necessarily defective.
-- Never UPDATE it from a wallet/customer/agent's current institution.
