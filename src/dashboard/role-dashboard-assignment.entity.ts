import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * V1-ADMIN-CONFIGURABLE-DASHBOARD-PLATFORM-01
 *
 * Layer C of the three-layer architecture: a persistent, data-driven mapping of a catalogue
 * `role_key` (Layer A — `authorization_roles.role_key`, validated at write time, not a DB-level
 * FK, so this table can evolve independently of the authorization catalogue schema) to a
 * dashboard template (Layer B — `dashboard_templates.template_key`, validated at write time).
 *
 * One active assignment row per `role_key` (upsert-on-change, not append-only) — assignment
 * HISTORY is not modelled here; every change is independently recorded via the existing
 * `AuditService` (see `DashboardService.assignTemplate`), which is the audit trail of record.
 *
 * Holding/changing this record NEVER grants, changes, or removes any authorization function or
 * role — it only controls which pre-approved, pre-built widget layout a role's Admin Web session
 * renders. Every widget's underlying data endpoint independently re-validates the caller's real
 * function grants from the (untouched) authorization catalogue, regardless of this assignment.
 */
@Entity({ name: 'role_dashboard_assignments' })
@Index('uq_role_dashboard_assignments_role_key', ['roleKey'], { unique: true })
export class RoleDashboardAssignment {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'role_key', type: 'varchar', length: 100 })
  roleKey!: string;

  @Column({ name: 'template_key', type: 'varchar', length: 80 })
  templateKey!: string;

  @Column({ name: 'assigned_by', type: 'varchar', length: 160 })
  assignedBy!: string;

  @Column({ name: 'assigned_at', type: 'timestamptz' })
  assignedAt!: Date;

  @Column({ type: 'varchar', length: 500, nullable: true })
  reason!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
