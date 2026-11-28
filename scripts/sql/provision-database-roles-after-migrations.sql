-- ARENA 3 — grants applied after the migration chain. Ordinary runtime keeps the DML it needs for
-- normal application work; protected authentication/approval evidence stays authority-only.

GRANT USAGE ON SCHEMA public TO monienaija_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO monienaija_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO monienaija_runtime;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO monienaija_runtime;

GRANT USAGE ON SCHEMA public TO monienaija_authority_core;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO monienaija_authority_core;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO monienaija_authority_core;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO monienaija_authority_core;

GRANT USAGE ON SCHEMA protected_authority TO monienaija_authority_core;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA protected_authority
  TO monienaija_authority_core;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA protected_authority
  TO monienaija_authority_core;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA protected_authority
  TO monienaija_authority_core;

-- The runtime role must not be able to truncate, reference or re-trigger protected evidence, and
-- must not reach the protected schema at all.
REVOKE TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM monienaija_runtime;
REVOKE ALL ON SCHEMA protected_authority FROM monienaija_runtime;
REVOKE ALL ON ALL TABLES IN SCHEMA protected_authority FROM monienaija_runtime;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA protected_authority FROM monienaija_runtime;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA protected_authority FROM monienaija_runtime;

REVOKE ALL ON public.a2_workforce_sessions FROM monienaija_runtime;
REVOKE INSERT, UPDATE, DELETE ON public.a2_finance_role_assignments FROM monienaija_runtime;
REVOKE INSERT, UPDATE, DELETE ON public.a2_workforce_bootstrap_consumptions FROM monienaija_runtime;
REVOKE INSERT, UPDATE, DELETE ON public.a2_super_admin_recovery_consumptions FROM monienaija_runtime;
REVOKE INSERT, UPDATE, DELETE ON public.local_admin_credentials FROM monienaija_runtime;
REVOKE INSERT, UPDATE, DELETE ON public.authorization_roles FROM monienaija_runtime;
REVOKE INSERT, UPDATE, DELETE ON public.authorization_functions FROM monienaija_runtime;
REVOKE INSERT, UPDATE, DELETE ON public.authorization_role_functions FROM monienaija_runtime;
-- KYC provider routing and tier policy publication use the credential-separated authority.
-- Runtime retains read-only access for customer/admin projections but cannot forge proposals,
-- checker decisions, published configuration, or policy versions through ordinary SQL.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.kyc_provider_configuration FROM monienaija_runtime;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.kyc_provider_change_proposals FROM monienaija_runtime;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.kyc_provider_configuration_history FROM monienaija_runtime;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.kyc_tier_policy_head FROM monienaija_runtime;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.kyc_tier_policy_proposals FROM monienaija_runtime;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.kyc_tier_policy_versions FROM monienaija_runtime;
-- Institution tier->limit governance is the mapping that decides how much money a customer tier may
-- move, so its publication state must be authority-only for exactly the same reason. Migration
-- 1785753600504 revokes these three, but the blanket `GRANT ... ON ALL TABLES` above runs afterwards
-- and would silently restore runtime write, letting the ordinary application credential forge the
-- limit policy it is then checked against. Re-revoke explicitly; `authority_inspection` verifies it.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.institution_kyc_limit_policy_heads FROM monienaija_runtime;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.institution_kyc_limit_policy_proposals FROM monienaija_runtime;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.institution_kyc_limit_policy_versions FROM monienaija_runtime;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.governed_institution_lifecycle_executions
  FROM monienaija_runtime;
REVOKE INSERT, UPDATE, DELETE ON public.institution_affiliation_transition_evidence
  FROM monienaija_runtime;
REVOKE INSERT, UPDATE, DELETE ON public.governed_institution_affiliation_replay_results
  FROM monienaija_runtime;
DO $$
BEGIN
  IF to_regclass('public.governed_wallet_institution_attributions') IS NOT NULL THEN
    EXECUTE 'REVOKE INSERT, UPDATE, DELETE ON public.governed_wallet_institution_attributions FROM monienaija_runtime';
    EXECUTE 'REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.governed_wallet_institution_attributions FROM monienaija_runtime';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON public.governed_wallet_institution_attributions TO monienaija_authority_core';
  END IF;
  IF to_regclass('public.settlement_report_imports') IS NOT NULL THEN
    EXECUTE 'REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.settlement_report_imports, public.settlement_transaction_matches, public.settlement_batch_reconciliations, public.settlement_return_dispute_cases FROM monienaija_runtime';
    EXECUTE 'REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.settlement_report_rejected_rows, public.settlement_report_rows, public.settlement_return_dispute_events FROM monienaija_runtime';
  END IF;
END $$;

-- Protected governance approvals stay readable and usable for unprotected action types (row level
-- security in migration 1785753600501 refuses every protected action).
REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.privileged_action_approvals FROM monienaija_runtime;

-- Future migrations create tables as the migration role; keep ordinary runtime access converging
-- without granting it protected evidence.
ALTER DEFAULT PRIVILEGES FOR ROLE {{MIGRATOR_ROLE}} IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO monienaija_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE {{MIGRATOR_ROLE}} IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO monienaija_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE {{MIGRATOR_ROLE}} IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO monienaija_runtime;
