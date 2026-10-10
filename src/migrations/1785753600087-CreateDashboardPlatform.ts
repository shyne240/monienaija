import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * V1-ADMIN-CONFIGURABLE-DASHBOARD-PLATFORM-01
 *
 * Creates the two new, purely additive tables for the configurable role-dashboard platform:
 *   1. `dashboard_templates` — Layer B: reusable dashboard shapes (stable key, display metadata,
 *      widget-placement layout, active flag, metadata). Seeded by `DashboardSeedService`.
 *   2. `role_dashboard_assignments` — Layer C: one active role_key -> template_key mapping per
 *      role. Seeded by `DashboardSeedService`, editable thereafter via `DashboardService`
 *      (authorized by `workforce.dashboard.assign`).
 *
 * Deliberately NOT a modification of `authorization_roles` / `authorization_role_functions` /
 * any existing table — keeps the three architectural layers (roles/functions, templates/widgets,
 * assignment) as strictly separate sources of truth, per the task's explicit instruction.
 */
export class CreateDashboardPlatform1785753600087 implements MigrationInterface {
  name = 'CreateDashboardPlatform1785753600087';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE dashboard_templates (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        template_key VARCHAR(80) NOT NULL,
        display_name VARCHAR(160) NOT NULL,
        description VARCHAR(1000) NOT NULL,
        operational_area VARCHAR(80) NOT NULL,
        layout JSONB NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        metadata JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_dashboard_templates_template_key ON dashboard_templates (template_key)
    `);

    await queryRunner.query(`
      CREATE TABLE role_dashboard_assignments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        role_key VARCHAR(100) NOT NULL,
        template_key VARCHAR(80) NOT NULL,
        assigned_by VARCHAR(160) NOT NULL,
        assigned_at TIMESTAMPTZ NOT NULL,
        reason VARCHAR(500),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_role_dashboard_assignments_role_key ON role_dashboard_assignments (role_key)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS role_dashboard_assignments`);
    await queryRunner.query(`DROP TABLE IF EXISTS dashboard_templates`);
  }
}
