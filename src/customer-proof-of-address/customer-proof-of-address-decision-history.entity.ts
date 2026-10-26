import { Check, Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

import {
  CustomerProofOfAddressHistoryAction,
  CustomerProofOfAddressReviewStatus,
} from './customer-proof-of-address.enums';

@Entity({ name: 'customer_proof_of_address_decision_history' })
@Index('idx_customer_poa_decision_history_submission_created', ['submissionId', 'createdAt'])
@Check(
  'chk_customer_poa_decision_history_action',
  "action IN ('SUBMITTED', 'RESUBMITTED', 'VERIFIED', 'REJECTED')",
)
@Check(
  'chk_customer_poa_decision_history_status',
  "(previous_status IS NULL OR previous_status IN ('PENDING', 'VERIFIED', 'REJECTED')) AND new_status IN ('PENDING', 'VERIFIED', 'REJECTED')",
)
@Check(
  'chk_customer_poa_decision_history_action_status',
  `(
    (action IN ('SUBMITTED', 'RESUBMITTED') AND previous_status IS NULL AND new_status = 'PENDING')
    OR (action = 'VERIFIED' AND previous_status = 'PENDING' AND new_status = 'VERIFIED')
    OR (action = 'REJECTED' AND previous_status = 'PENDING' AND new_status = 'REJECTED')
  )`,
)
@Check(
  'chk_customer_poa_decision_history_rejection_reason',
  "action <> 'REJECTED' OR (reason IS NOT NULL AND length(btrim(reason)) > 0)",
)
export class CustomerProofOfAddressDecisionHistory {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'submission_id', type: 'uuid' })
  submissionId!: string;

  @Column({ name: 'customer_id', type: 'uuid' })
  customerId!: string;

  @Column({ type: 'varchar', length: 24 })
  action!: CustomerProofOfAddressHistoryAction;

  @Column({ name: 'previous_status', type: 'varchar', length: 16, nullable: true })
  previousStatus!: CustomerProofOfAddressReviewStatus | null;

  @Column({ name: 'new_status', type: 'varchar', length: 16 })
  newStatus!: CustomerProofOfAddressReviewStatus;

  @Column({ name: 'actor_principal_id', type: 'varchar', length: 160 })
  actorPrincipalId!: string;

  @Column({ name: 'actor_role_key', type: 'varchar', length: 100 })
  actorRoleKey!: string;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  reason!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
