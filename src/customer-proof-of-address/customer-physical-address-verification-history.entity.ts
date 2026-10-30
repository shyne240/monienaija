import { Check, Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

import {
  PhysicalAddressVerificationHistoryAction,
  PhysicalAddressVerificationOutcome,
  PhysicalAddressVerificationStatus,
} from './customer-proof-of-address.enums';

@Entity({ name: 'customer_physical_address_verification_history' })
@Index('idx_customer_physical_verification_history_record_created', ['verificationId', 'createdAt'])
@Check(
  'chk_customer_physical_verification_history_action',
  "action IN ('ASSIGNED', 'VISIT_RECORDED', 'FINDINGS_SUBMITTED', 'VERIFIED', 'REJECTED')",
)
@Check(
  'chk_customer_physical_verification_history_status',
  "(previous_status IS NULL OR previous_status IN ('PENDING', 'ASSIGNED', 'IN_PROGRESS', 'SUBMITTED', 'DECIDED')) AND (new_status IS NULL OR new_status IN ('PENDING', 'ASSIGNED', 'IN_PROGRESS', 'SUBMITTED', 'DECIDED'))",
)
@Check(
  'chk_customer_physical_verification_history_outcome',
  "(previous_outcome IS NULL OR previous_outcome IN ('PENDING', 'VERIFIED', 'REJECTED')) AND (new_outcome IS NULL OR new_outcome IN ('PENDING', 'VERIFIED', 'REJECTED'))",
)
@Check(
  'chk_customer_physical_verification_history_action_state',
  `(
    (action = 'ASSIGNED' AND new_status = 'ASSIGNED' AND new_outcome = 'PENDING')
    OR (action = 'VISIT_RECORDED' AND new_status = 'IN_PROGRESS' AND new_outcome = 'PENDING')
    OR (action = 'FINDINGS_SUBMITTED' AND new_status = 'SUBMITTED' AND new_outcome = 'PENDING')
    OR (action = 'VERIFIED' AND previous_status = 'SUBMITTED' AND new_status = 'DECIDED' AND previous_outcome = 'PENDING' AND new_outcome = 'VERIFIED')
    OR (action = 'REJECTED' AND previous_status = 'SUBMITTED' AND new_status = 'DECIDED' AND previous_outcome = 'PENDING' AND new_outcome = 'REJECTED')
  )`,
)
@Check(
  'chk_customer_physical_verification_history_rejection_reason',
  "action <> 'REJECTED' OR (reason IS NOT NULL AND length(btrim(reason)) > 0)",
)
export class CustomerPhysicalAddressVerificationHistory {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'verification_id', type: 'uuid' })
  verificationId!: string;

  @Column({ name: 'customer_id', type: 'uuid' })
  customerId!: string;

  @Column({ type: 'varchar', length: 32 })
  action!: PhysicalAddressVerificationHistoryAction;

  @Column({ name: 'previous_status', type: 'varchar', length: 24, nullable: true })
  previousStatus!: PhysicalAddressVerificationStatus | null;

  @Column({ name: 'new_status', type: 'varchar', length: 24, nullable: true })
  newStatus!: PhysicalAddressVerificationStatus | null;

  @Column({ name: 'previous_outcome', type: 'varchar', length: 24, nullable: true })
  previousOutcome!: PhysicalAddressVerificationOutcome | null;

  @Column({ name: 'new_outcome', type: 'varchar', length: 24, nullable: true })
  newOutcome!: PhysicalAddressVerificationOutcome | null;

  @Column({ name: 'actor_principal_id', type: 'varchar', length: 160 })
  actorPrincipalId!: string;

  @Column({ name: 'actor_role_key', type: 'varchar', length: 100 })
  actorRoleKey!: string;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  reason!: string | null;

  /** Changed-field metadata only; do not put document bytes or raw file content here. */
  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
