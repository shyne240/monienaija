import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { AuthorizationFunction } from './authorization-function.entity';
import { AuthorizationRole } from './authorization-role.entity';

/**
 * The role ↔ function bundle join table. A role is, structurally, nothing
 * more than the set of rows here pointing at it — the authorization
 * question this model is designed to support is "does this principal hold
 * function X" (via its role's rows here), not "does this principal have
 * role Y" as a string compared against hardcoded logic.
 *
 * `accessType` lives on this table (not on AuthorizationFunction) because
 * the same function_code can legitimately be held by two different roles in
 * two different capacities — e.g. FINANCE_PREPARER holds `ledger.post` as
 * INITIATE while FINANCE_CONTROLLER holds `fee_rule.create` as APPROVE —
 * mirroring the existing A2_MAKER_CHECKER_RULES_JSON convention of one
 * governed action with separate initiatingRoles/approvingRoles arrays.
 * Placing it on the function would force inventing duplicate function codes
 * per role, which the approved spec's catalogue does not define.
 */
@Entity({ name: 'authorization_role_functions' })
@Index('idx_authorization_role_functions_role_id', ['roleId'])
@Index('idx_authorization_role_functions_function_code', ['functionCode'])
@Index('idx_authorization_role_functions_access_type', ['accessType'])
export class AuthorizationRoleFunction {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'role_id', type: 'uuid' })
  roleId!: string;

  @ManyToOne(() => AuthorizationRole, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'role_id' })
  role!: AuthorizationRole;

  @Column({ name: 'function_code', type: 'varchar', length: 100 })
  functionCode!: string;

  @ManyToOne(() => AuthorizationFunction, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'function_code', referencedColumnName: 'functionCode' })
  function!: AuthorizationFunction;

  @Column({ name: 'access_type', type: 'varchar', length: 20 })
  accessType!: string; // RoleFunctionAccessType

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ name: 'assigned_by', type: 'varchar', length: 100, default: 'SYSTEM_SEED' })
  assignedBy!: string;

  @Column({ name: 'assigned_at', type: 'timestamptz' })
  assignedAt!: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
