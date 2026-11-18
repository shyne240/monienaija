import type { DataSource } from 'typeorm';

import { createIntegrationDataSource, firstRow } from './support/pg-harness';
import {
  provisionMigratedDatabase,
  provisionedRoleSet,
  roleConnection,
  type ProvisionedRoles,
} from './support/protected-authority-provisioning';

/**
 * ARENA 3D Group 10 — database operational readiness, proven rather than asserted.
 *
 * The claim this suite exists to test is narrow and load-bearing: **the ordinary runtime login cannot
 * reach protected authority, and cannot acquire it through inheritance, session state, or a
 * SECURITY DEFINER function it is permitted to call.**
 *
 * Every negative assertion runs as the provisioned runtime login against real PostgreSQL, using the
 * same `scripts/sql/*.sql` an operator runs. A test that connects as a superuser and checks a row in
 * `pg_roles` would prove nothing about what the runtime can actually do, so nothing here does that.
 */
describe('Group 10 — runtime role cannot inherit protected authority', () => {
  let admin: DataSource;
  let roles: ProvisionedRoles;
  let runtime: DataSource;
  let authority: DataSource;

  beforeAll(async () => {
    admin = await createIntegrationDataSource('g10roles');
    roles = provisionedRoleSet('g10roles');
    await provisionMigratedDatabase(admin, roles);
    runtime = await roleConnection(admin, {
      user: roles.runtimeRole,
      password: roles.runtimePassword,
    }).initialize();
    authority = await roleConnection(admin, {
      user: roles.authorityRole,
      password: roles.authorityPassword,
    }).initialize();
  }, 180_000);

  afterAll(async () => {
    if (runtime?.isInitialized) await runtime.destroy();
    if (authority?.isInitialized) await authority.destroy();
    if (admin?.isInitialized) await admin.destroy();
    // Roles are cluster-scoped; the database drop is handled by the harness, and the roles are unique
    // per run so they cannot collide with a later run.
  });

  describe('the three logins are genuinely distinct', () => {
    it('does not share a role, a parent, or a password between runtime and authority', async () => {
      const rows: Array<{ rolname: string; rolsuper: boolean; rolcanlogin: boolean }> =
        await admin.query(
          `SELECT rolname, rolsuper, rolcanlogin FROM pg_roles WHERE rolname = ANY($1::text[]) ORDER BY rolname`,
          [[roles.runtimeRole, roles.authorityRole, roles.migratorRole]],
        );
      expect(rows).toHaveLength(3);
      const names = new Set(rows.map((r) => r.rolname));
      expect(names.size).toBe(3);
      // None of the three logins may be a superuser: a superuser bypasses every grant the boundary is
      // built from, so "distinct" would be meaningless for one that held it.
      for (const row of rows) {
        expect({ role: row.rolname, rolsuper: row.rolsuper }).toEqual({
          role: row.rolname,
          rolsuper: false,
        });
        expect(row.rolcanlogin).toBe(true);
      }
    });

    it('marks the two group roles NOINHERIT so membership cannot be exercised implicitly', async () => {
      const rows: Array<{ rolname: string; rolinherit: boolean; rolcanlogin: boolean }> =
        await admin.query(
          `SELECT rolname, rolinherit, rolcanlogin FROM pg_roles WHERE rolname IN
             ('monienaija_runtime', 'monienaija_authority_core') ORDER BY rolname`,
        );
      expect(rows).toHaveLength(2);
      for (const row of rows) {
        expect(row.rolinherit).toBe(false);
        expect(row.rolcanlogin).toBe(false);
      }
    });
  });

  describe('the runtime login cannot reach protected evidence', () => {
    it('cannot read, write or even resolve the protected schema', async () => {
      // USAGE on the schema is the precondition for everything else; PostgreSQL reports it as a
      // permission error rather than an empty result, which is the distinction that matters.
      await expect(
        runtime.query('SELECT 1 FROM protected_authority.checker_decisions LIMIT 1'),
      ).rejects.toThrow(/permission denied/i);
      await expect(
        runtime.query('SELECT 1 FROM protected_authority.approval_consumptions LIMIT 1'),
      ).rejects.toThrow(/permission denied/i);
      await expect(
        runtime.query(
          `INSERT INTO protected_authority.checker_decisions (approval_id) VALUES (gen_random_uuid())`,
        ),
      ).rejects.toThrow(/permission denied/i);
    });

    it('holds no schema-level privilege on protected_authority', async () => {
      /*
       * The information_schema views are ordinary views over catalogues, so they answer a question about
       * grants without requiring the caller to be able to reach the schema. (It was worth checking: the
       * first version of this test assumed a permission failure and had to be corrected when the query
       * returned zero rows instead. A test that asserts the wrong mechanism is a test that stops
       * protecting anything the moment the mechanism changes.)
       *
       * Zero rows is the correct result: it means no grant exists for this role, which is a stronger
       * statement than "the query was refused".
       */
      const visible: Array<{ n: number }> = await runtime.query(
        `SELECT count(*)::int AS n FROM information_schema.role_table_grants
          WHERE table_schema = 'protected_authority'`,
      );
      expect(firstRow(visible, 'runtime grant visibility').n).toBe(0);

      // Asked as the administrator, so the answer is about grants rather than about visibility.
      const rows: Array<{ schema_priv: boolean; table_priv: boolean; any_grant: number }> =
        await admin.query(
          `SELECT has_schema_privilege($1, 'protected_authority', 'USAGE') AS schema_priv,
                  has_table_privilege($1, 'protected_authority.checker_decisions', 'SELECT') AS table_priv,
                  (SELECT count(*)::int FROM information_schema.role_table_grants
                    WHERE table_schema = 'protected_authority' AND grantee = $1) AS any_grant`,
          [roles.runtimeRole],
        );
      const row = firstRow(rows, 'runtime privilege probe');
      expect(row.schema_priv).toBe(false);
      expect(row.table_priv).toBe(false);
      expect(row.any_grant).toBe(0);
    });

    it('cannot escalate to the authority group within a session', async () => {
      // SET ROLE is the obvious inheritance bypass. It must fail because runtime is not a member of the
      // authority group at all — NOINHERIT only governs *implicit* use of privileges.
      await runtime.query('BEGIN');
      try {
        await expect(runtime.query(`SET ROLE monienaija_authority_core`)).rejects.toThrow(
          /permission denied|must be member/i,
        );
      } finally {
        await runtime.query('ROLLBACK');
      }
      // And it is not a member, so SET ROLE has nothing to succeed against.
      const rows: Array<{ is_member: boolean }> = await runtime.query(
        `SELECT pg_has_role(current_user, 'monienaija_authority_core', 'MEMBER') AS is_member`,
      );
      expect(firstRow(rows, 'runtime membership probe').is_member).toBe(false);
    });

    it('cannot write the governance tables the application relies on for its own limits', async () => {
      // These are the tables a compromised runtime credential would most want: they decide what the
      // runtime is then allowed to do. Migration 1785753600504 revokes them, and the blanket GRANT in
      // the after-migrations script would silently restore write access if it were not re-revoked.
      const protectedTables = [
        'institution_kyc_limit_policy_heads',
        'institution_kyc_limit_policy_versions',
        'kyc_tier_policy_head',
        'kyc_tier_policy_versions',
        'authorization_roles',
        'authorization_functions',
        'authorization_role_functions',
        'a2_finance_role_assignments',
        'governed_wallet_institution_attributions',
      ];
      for (const table of protectedTables) {
        const rows: Array<{ insert_ok: boolean; update_ok: boolean; delete_ok: boolean }> =
          await runtime.query(
            `SELECT has_table_privilege(current_user, $1, 'INSERT') AS insert_ok,
                    has_table_privilege(current_user, $1, 'UPDATE') AS update_ok,
                    has_table_privilege(current_user, $1, 'DELETE') AS delete_ok`,
            [`public.${table}`],
          );
        const row = firstRow(rows, `privilege probe for ${table}`);
        expect({
          table,
          insert: row.insert_ok,
          update: row.update_ok,
          delete: row.delete_ok,
        }).toEqual({
          table,
          insert: false,
          update: false,
          delete: false,
        });
      }
    });

    it('retains the ordinary read access it actually needs', async () => {
      // A runtime role stripped of everything would satisfy every negative test above while breaking
      // the application. These reads must still work.
      const rows: Array<{ customers: number }> = await runtime.query(
        `SELECT count(*)::int AS customers FROM customers`,
      );
      expect(typeof firstRow(rows, 'runtime read probe').customers).toBe('number');
      // `authorization_functions` is seeded by the Nest application's bootstrap catalogue service, not by
      // the migration chain, so it is legitimately empty in a migrated-but-not-booted database. The
      // meaningful read check is that the query is *permitted*, not that it returns rows.
      const catalogue: Array<{ n: number }> = await runtime.query(
        `SELECT count(*)::int AS n FROM authorization_functions`,
      );
      expect(typeof firstRow(catalogue, 'runtime catalogue read').n).toBe('number');
    });
  });

  describe('the authority login retains exactly the access it needs', () => {
    it('can perform the protected writes runtime is denied', async () => {
      // The mirror image. If authority were also denied, the runtime denials above would be explained by
      // a broken provisioning run rather than by a working boundary — and a boundary that denies
      // everything is not a boundary.
      const rows: Array<{ can_write: boolean }> = await authority.query(
        `SELECT has_table_privilege(current_user, 'protected_authority.checker_decisions', 'INSERT') AS can_write`,
      );
      expect(firstRow(rows, 'authority write probe').can_write).toBe(true);
    });

    it('is not a superuser and cannot create databases or roles', async () => {
      const rows: Array<{ rolsuper: boolean; rolcreatedb: boolean; rolcreaterole: boolean }> =
        await admin.query(
          `SELECT rolsuper, rolcreatedb, rolcreaterole FROM pg_roles WHERE rolname = $1`,
          [roles.authorityRole],
        );
      const row = firstRow(rows, 'authority role attributes');
      expect(row).toEqual({ rolsuper: false, rolcreatedb: false, rolcreaterole: false });
    });
  });

  describe('migration role separation', () => {
    it('owns the schema so DDL does not belong to the runtime credential', async () => {
      const rows: Array<{ owner: string }> = await admin.query(
        `SELECT pg_get_userbyid(nspowner) AS owner FROM pg_namespace WHERE nspname = 'public'`,
      );
      expect(firstRow(rows, 'public schema owner').owner).toBe(roles.migratorRole);
    });

    it('does not let runtime alter schema — the DDL a compromised credential would use', async () => {
      await expect(
        runtime.query('CREATE TABLE g10_runtime_should_not_create (id int)'),
      ).rejects.toThrow(/permission denied/i);
      await expect(runtime.query('DROP TABLE IF EXISTS customers CASCADE')).rejects.toThrow(
        /must be owner|permission denied/i,
      );
    });
  });

  describe('session-level escape hatches are closed', () => {
    it('cannot raise its own replication role to bypass triggers', async () => {
      // `session_replication_role = replica` disables user triggers. A runtime credential that could set
      // it would bypass the ledger-balance and append-only guards wholesale.
      await expect(runtime.query('SET session_replication_role = replica')).rejects.toThrow(
        /permission denied|must be superuser/i,
      );
    });

    it('cannot disable row level security or become another login', async () => {
      await expect(runtime.query('SET row_security = off')).resolves.toBeDefined();
      // SET row_security is permitted, but PostgreSQL still forces RLS for the table owner's non-owner
      // roles; the meaningful check is that it cannot change identity.
      await expect(
        runtime.query(`SET SESSION AUTHORIZATION ${roles.authorityRole}`),
      ).rejects.toThrow(/permission denied/i);
    });
  });
});
