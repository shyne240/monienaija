import { Check, Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity({ name: 'authorization_functions' })
@Index('idx_authorization_functions_domain', ['domain'])
@Index('idx_authorization_functions_v1_status', ['v1Status'])
@Index('idx_authorization_functions_assignable', ['assignable'])
@Index('idx_authorization_functions_sensitivity', ['sensitivity'])
@Check(
  'chk_authorization_functions_sensitivity',
  `sensitivity IN ('READ','OPERATIONAL','SENSITIVE','PRIVILEGED','CRITICAL_FINANCIAL')`,
)
@Check(
  'chk_authorization_functions_v1_status',
  `v1_status IN ('IMPLEMENTED','PARTIALLY_IMPLEMENTED','BACKEND_ONLY','FUTURE','OUT_OF_V1_SCOPE')`,
)
export class AuthorizationFunction {
  /** Stable function identifier, e.g. 'customer.view'. Sourced exactly from V1-ADMIN-ROLE-AND-PERMISSION-SPEC-01.md. */
  @PrimaryColumn({ name: 'function_code', type: 'varchar', length: 100 })
  functionCode!: string;

  @Column({ type: 'varchar', length: 40 })
  domain!: string;

  @Column({ type: 'varchar', length: 200 })
  name!: string;

  @Column({ type: 'varchar', length: 800 })
  description!: string;

  @Column({ type: 'varchar', length: 30 })
  sensitivity!: string; // FunctionSensitivity

  @Column({ name: 'v1_status', type: 'varchar', length: 30 })
  v1Status!: string; // FunctionV1Status

  /** Whether this function may currently be assigned to any role. False for FUTURE/OUT_OF_V1_SCOPE and a small number of explicitly-deferred items. */
  @Column({ type: 'boolean', default: false })
  assignable!: boolean;

  /** True only for CRITICAL_FINANCIAL functions that must be restricted to roles flagged finance_role_class = true (enforced by a DB trigger — see migration 1785753600083). */
  @Column({ name: 'finance_class_restricted', type: 'boolean', default: false })
  financeClassRestricted!: boolean;

  /** Metadata only in this task — no runtime maker/checker engine reads this flag yet. */
  @Column({ name: 'maker_checker_required', type: 'boolean', default: false })
  makerCheckerRequired!: boolean;

  /** Metadata only in this task — no runtime approval workflow reads this flag yet. */
  @Column({ name: 'approval_required', type: 'boolean', default: false })
  approvalRequired!: boolean;

  /** True for functions a SUPER_ADMIN-class role must never directly execute or approve (all CRITICAL_FINANCIAL functions). */
  @Column({ name: 'super_admin_excluded', type: 'boolean', default: false })
  superAdminExcluded!: boolean;

  /** Whether a read_only role (e.g. FINANCE_AUDITOR) should be able to view this function's outcomes. */
  @Column({ name: 'auditor_visible', type: 'boolean', default: true })
  auditorVisible!: boolean;

  @Column({ type: 'varchar', length: 800, nullable: true })
  notes!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
