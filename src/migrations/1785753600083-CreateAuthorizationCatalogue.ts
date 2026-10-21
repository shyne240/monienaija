import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * V1-ADMIN-AUTHORIZATION-FOUNDATION-01
 *
 * Creates the database-backed FUNCTION CATALOGUE → ROLE → ROLE/FUNCTION
 * authorization foundation described in:
 *   - docs/V1/V1-ADMIN-ROLE-AND-PERMISSION-SPEC-01.md
 *   - docs/V1/V1-ADMIN-ROLE-AND-PERMISSION-DECISIONS-01.md
 *
 * This migration creates schema ONLY (tables, constraints, indexes, and two
 * narrow governance-integrity triggers). It deliberately does not INSERT any
 * seed rows — mirroring the existing capability-registry convention
 * (1785753600066-CreateCapabilityRegistry.ts), where seeding is performed
 * idempotently at application bootstrap by a dedicated seed service
 * (AuthorizationCatalogueSeedService), not inline in the migration.
 *
 * This is a fully ADDITIVE, standalone model. It does not alter, replace, or
 * depend on the existing A2 workforce/finance authorization runtime
 * (src/authorization/*, A2_FINANCE_ROLES_JSON, workforce-configuration.ts).
 * Both systems coexist; migrating the live runtime onto this model is an
 * explicitly later, separate task.
 */
export class CreateAuthorizationCatalogue1785753600083 implements MigrationInterface {
  name = 'CreateAuthorizationCatalogue1785753600083';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ---------------------------------------------------------------------
    // authorization_functions — the persistent V1 function catalogue.
    // A row existing here does NOT imply the function is assignable or
    // runtime-reachable; `assignable` and `v1_status` carry that distinction.
    // ---------------------------------------------------------------------
    await queryRunner.query(`
      CREATE TABLE authorization_functions (
        function_code VARCHAR(100) PRIMARY KEY,
        domain VARCHAR(40) NOT NULL,
        name VARCHAR(200) NOT NULL,
        description VARCHAR(800) NOT NULL,
        sensitivity VARCHAR(30) NOT NULL CHECK (sensitivity IN ('READ','OPERATIONAL','SENSITIVE','PRIVILEGED','CRITICAL_FINANCIAL')),
        v1_status VARCHAR(30) NOT NULL CHECK (v1_status IN ('IMPLEMENTED','PARTIALLY_IMPLEMENTED','BACKEND_ONLY','FUTURE','OUT_OF_V1_SCOPE')),
        assignable BOOLEAN NOT NULL DEFAULT FALSE,
        finance_class_restricted BOOLEAN NOT NULL DEFAULT FALSE,
        maker_checker_required BOOLEAN NOT NULL DEFAULT FALSE,
        approval_required BOOLEAN NOT NULL DEFAULT FALSE,
        super_admin_excluded BOOLEAN NOT NULL DEFAULT FALSE,
        auditor_visible BOOLEAN NOT NULL DEFAULT TRUE,
        notes VARCHAR(800),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await queryRunner.query(`CREATE INDEX idx_authorization_functions_domain ON authorization_functions (domain)`);
    await queryRunner.query(`CREATE INDEX idx_authorization_functions_v1_status ON authorization_functions (v1_status)`);
    await queryRunner.query(`CREATE INDEX idx_authorization_functions_assignable ON authorization_functions (assignable)`);
    await queryRunner.query(`CREATE INDEX idx_authorization_functions_sensitivity ON authorization_functions (sensitivity)`);

    // ---------------------------------------------------------------------
    // authorization_roles — persistent role records. Deliberately NOT a DB
    // enum and NOT bounded to a fixed count: role_key is a free-form unique
    // VARCHAR, so new roles can be added later by inserting rows, without a
    // schema change. The ten V1 roles seeded by the bootstrap service are an
    // initial configuration, not an immutable fixed set — `is_system_seeded`
    // only records provenance for traceability.
    //
    // `administrative_capability` generalizes the previously hardcoded
    // single-role reservation in workforce-configuration.ts
    // (`administrativeCapability` tied to the literal string 'FINANCE_ADMIN').
    // Here it is a boolean flag on any role, and a partial unique index below
    // enforces — structurally, at the database level — that at most one role
    // may hold it at a time, without naming that role.
    //
    // `finance_role_class` generalizes "the Finance role class" referenced in
    // the approved spec/decisions (FINANCE_PREPARER / FINANCE_CONTROLLER /
    // FINANCE_AUDITOR) as a boolean flag rather than a role-name check, so the
    // "CRITICAL_FINANCIAL functions cannot be assigned outside the Finance
    // role class" invariant can be enforced generically (see trigger below).
    //
    // `read_only` generalizes "a role with zero mutation authority" (the
    // FINANCE_AUDITOR boundary) as a reusable flag rather than a role-name
    // check, enforced generically by a trigger below.
    // ---------------------------------------------------------------------
    await queryRunner.query(`
      CREATE TABLE authorization_roles (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        role_key VARCHAR(100) NOT NULL,
        display_name VARCHAR(160) NOT NULL,
        description VARCHAR(500) NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        is_system_seeded BOOLEAN NOT NULL DEFAULT FALSE,
        finance_role_class BOOLEAN NOT NULL DEFAULT FALSE,
        administrative_capability BOOLEAN NOT NULL DEFAULT FALSE,
        read_only BOOLEAN NOT NULL DEFAULT FALSE,
        maker_eligible BOOLEAN NOT NULL DEFAULT FALSE,
        checker_eligible BOOLEAN NOT NULL DEFAULT FALSE,
        created_by VARCHAR(100) NOT NULL DEFAULT 'SYSTEM_SEED',
        updated_by VARCHAR(100),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_authorization_roles_role_key UNIQUE (role_key)
      )
    `);
    await queryRunner.query(`CREATE INDEX idx_authorization_roles_is_active ON authorization_roles (is_active)`);
    await queryRunner.query(`CREATE INDEX idx_authorization_roles_finance_role_class ON authorization_roles (finance_role_class)`);
    // Structural invariant: at most one role may ever hold the single
    // reserved "administrative capability" at a time (generalizes the old
    // single-FINANCE_ADMIN reservation without naming a role).
    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_authorization_roles_single_administrative_capability
      ON authorization_roles ((administrative_capability))
      WHERE administrative_capability = TRUE
    `);

    // ---------------------------------------------------------------------
    // authorization_role_functions — the role/function bundle join table.
    // `access_type` lives on the ASSIGNMENT (not the function) because the
    // same function_code can be legitimately held by two different roles in
    // two different capacities (e.g. a maker role holds it as INITIATE while
    // a checker role holds the same function_code as APPROVE) — mirroring
    // the existing A2_MAKER_CHECKER_RULES_JSON pattern of one action with
    // separate initiatingRoles/approvingRoles. Putting access_type on the
    // function itself would force inventing duplicate function codes per
    // role, which the approved spec's catalogue does not define.
    // ---------------------------------------------------------------------
    await queryRunner.query(`
      CREATE TABLE authorization_role_functions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        role_id UUID NOT NULL REFERENCES authorization_roles (id) ON DELETE CASCADE,
        function_code VARCHAR(100) NOT NULL REFERENCES authorization_functions (function_code) ON DELETE RESTRICT,
        access_type VARCHAR(20) NOT NULL CHECK (access_type IN ('VIEW','EXECUTE','INITIATE','APPROVE')),
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        assigned_by VARCHAR(100) NOT NULL DEFAULT 'SYSTEM_SEED',
        assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_authorization_role_functions_pair UNIQUE (role_id, function_code)
      )
    `);
    await queryRunner.query(`CREATE INDEX idx_authorization_role_functions_role_id ON authorization_role_functions (role_id)`);
    await queryRunner.query(`CREATE INDEX idx_authorization_role_functions_function_code ON authorization_role_functions (function_code)`);
    await queryRunner.query(`CREATE INDEX idx_authorization_role_functions_access_type ON authorization_role_functions (access_type)`);

    // ---------------------------------------------------------------------
    // Governance-integrity trigger: a CRITICAL_FINANCIAL, finance-class-
    // restricted function may only ever be assigned to a role flagged
    // finance_role_class = TRUE. This structurally enforces, at the data
    // layer, two of the named security invariants:
    //   - "CRITICAL FINANCIAL functions cannot be assigned outside the
    //     Finance role class"
    //   - "SUPER_ADMIN cannot directly execute or approve critical
    //     financial functions" (SUPER_ADMIN is seeded with
    //     finance_role_class = FALSE, so any attempt to assign it a
    //     finance_class_restricted function is rejected by this trigger)
    // This is a static, assignment-time integrity check only. It says
    // nothing about live request-time enforcement by the existing
    // AuthorizationService/RoutePolicyRegistry, which this task does not
    // wire this catalogue into.
    // ---------------------------------------------------------------------
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION fn_authorization_enforce_finance_class_restriction()
      RETURNS TRIGGER AS $$
      DECLARE
        v_restricted BOOLEAN;
        v_role_finance_class BOOLEAN;
      BEGIN
        SELECT finance_class_restricted INTO v_restricted
          FROM authorization_functions WHERE function_code = NEW.function_code;
        SELECT finance_role_class INTO v_role_finance_class
          FROM authorization_roles WHERE id = NEW.role_id;

        IF v_restricted = TRUE AND COALESCE(v_role_finance_class, FALSE) = FALSE THEN
          RAISE EXCEPTION 'authorization_role_functions: function % is finance_class_restricted and cannot be assigned to a role without finance_role_class = TRUE', NEW.function_code;
        END IF;

        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER trg_authorization_role_functions_finance_class
      BEFORE INSERT OR UPDATE ON authorization_role_functions
      FOR EACH ROW EXECUTE FUNCTION fn_authorization_enforce_finance_class_restriction()
    `);

    // ---------------------------------------------------------------------
    // Governance-integrity trigger: a role flagged read_only = TRUE may only
    // ever be assigned READ-sensitivity functions. This structurally
    // enforces, at the data layer, the "FINANCE_AUDITOR must have zero
    // mutation overlap" invariant in a generalized, non-role-name-specific
    // way (applies to any current or future role flagged read_only).
    // ---------------------------------------------------------------------
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION fn_authorization_enforce_read_only_role()
      RETURNS TRIGGER AS $$
      DECLARE
        v_sensitivity VARCHAR(30);
        v_role_read_only BOOLEAN;
      BEGIN
        SELECT sensitivity INTO v_sensitivity
          FROM authorization_functions WHERE function_code = NEW.function_code;
        SELECT read_only INTO v_role_read_only
          FROM authorization_roles WHERE id = NEW.role_id;

        IF COALESCE(v_role_read_only, FALSE) = TRUE AND v_sensitivity <> 'READ' THEN
          RAISE EXCEPTION 'authorization_role_functions: role % is read_only and cannot be assigned non-READ function %', NEW.role_id, NEW.function_code;
        END IF;

        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER trg_authorization_role_functions_read_only
      BEFORE INSERT OR UPDATE ON authorization_role_functions
      FOR EACH ROW EXECUTE FUNCTION fn_authorization_enforce_read_only_role()
    `);

    // No seed data is inserted here — see AuthorizationCatalogueSeedService.
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TRIGGER IF EXISTS trg_authorization_role_functions_read_only ON authorization_role_functions`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS fn_authorization_enforce_read_only_role()`);
    await queryRunner.query(`DROP TRIGGER IF EXISTS trg_authorization_role_functions_finance_class ON authorization_role_functions`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS fn_authorization_enforce_finance_class_restriction()`);
    await queryRunner.query(`DROP TABLE IF EXISTS authorization_role_functions`);
    await queryRunner.query(`DROP TABLE IF EXISTS authorization_roles`);
    await queryRunner.query(`DROP TABLE IF EXISTS authorization_functions`);
  }
}
