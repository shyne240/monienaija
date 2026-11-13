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
REVOKE INSERT, UPDATE, DELETE ON public.governed_institution_lifecycle_executions
  FROM monienaija_runtime;
REVOKE INSERT, UPDATE, DELETE ON public.institution_affiliation_transition_evidence
  FROM monienaija_runtime;
REVOKE INSERT, UPDATE, DELETE ON public.governed_institution_affiliation_replay_results
  FROM monienaija_runtime;

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
