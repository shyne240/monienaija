import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * A persistent, non-enum role record. `roleKey` is a free-form unique
 * string — not a fixed set — so new roles can be created later (subject to
 * future governance, not implemented in this task) without a schema or
 * code change. The ten V1 roles seeded by AuthorizationCatalogueSeedService
 * are an initial configuration (`isSystemSeeded = true`), not an immutable
 * system role set.
 */
@Entity({ name: 'authorization_roles' })
@Index('idx_authorization_roles_is_active', ['isActive'])
@Index('idx_authorization_roles_finance_role_class', ['financeRoleClass'])
export class AuthorizationRole {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'role_key', type: 'varchar', length: 100, unique: true })
  roleKey!: string;

  @Column({ name: 'display_name', type: 'varchar', length: 160 })
  displayName!: string;

  @Column({ type: 'varchar', length: 500 })
  description!: string;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  /** Provenance marker only (distinguishes the ten bootstrap-seeded V1 roles from later admin-created roles). Does not make the role immutable. */
  @Column({ name: 'is_system_seeded', type: 'boolean', default: false })
  isSystemSeeded!: boolean;

  /**
   * Generalizes "the Finance role class" (FINANCE_PREPARER / FINANCE_CONTROLLER
   * / FINANCE_AUDITOR) as a boolean flag rather than a role-name check, so
   * CRITICAL_FINANCIAL function restriction can be expressed structurally
   * (see migration trigger) instead of hardcoding role names.
   */
  @Column({ name: 'finance_role_class', type: 'boolean', default: false })
  financeRoleClass!: boolean;

  /**
   * Generalizes the previously hardcoded single-role "administrativeCapability"
   * reservation (workforce-configuration.ts, tied to the literal string
   * 'FINANCE_ADMIN'). A partial unique index in the migration enforces that
   * at most one role may hold this flag at a time, without naming a role.
   */
  @Column({ name: 'administrative_capability', type: 'boolean', default: false })
  administrativeCapability!: boolean;

  /** Generalizes "a role with zero mutation authority" (the FINANCE_AUDITOR boundary) as a reusable flag, enforced by a DB trigger. */
  @Column({ name: 'read_only', type: 'boolean', default: false })
  readOnly!: boolean;

  @Column({ name: 'maker_eligible', type: 'boolean', default: false })
  makerEligible!: boolean;

  @Column({ name: 'checker_eligible', type: 'boolean', default: false })
  checkerEligible!: boolean;

  /**
   * V1-ADMIN-ROLE-DEFINITION-GOVERNANCE-IMPLEMENTATION-01: optimistic-concurrency token,
   * incremented by `RoleDefinitionGovernanceService.apply()` on every successful MODIFY. Lets a
   * proposal's `expectedDefinitionVersion` detect that a role changed since the proposal was
   * submitted (or since it was approved), both at submit time and again at apply time.
   */
  @Column({ name: 'definition_version', type: 'integer', default: 1 })
  definitionVersion!: number;

  @Column({ name: 'created_by', type: 'varchar', length: 100, default: 'SYSTEM_SEED' })
  createdBy!: string;

  @Column({ name: 'updated_by', type: 'varchar', length: 100, nullable: true })
  updatedBy!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
