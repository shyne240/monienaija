import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import {
  PhysicalAddressVerificationOutcome,
  PhysicalAddressVerificationStatus,
} from './customer-proof-of-address.enums';

@Entity({ name: 'customer_physical_address_verifications' })
@Index('uq_customer_physical_verification_id_customer', ['id', 'customerId'], {
  unique: true,
})
@Index('idx_customer_physical_verifications_customer_address_created', [
  'customerId',
  'residentialAddressId',
  'createdAt',
])
@Check(
  'chk_customer_physical_verification_status',
  "status IN ('PENDING', 'ASSIGNED', 'IN_PROGRESS', 'SUBMITTED', 'DECIDED')",
)
@Check(
  'chk_customer_physical_verification_outcome',
  "outcome IN ('PENDING', 'VERIFIED', 'REJECTED')",
)
@Check(
  'chk_customer_physical_verification_decision_metadata',
  `(
    (status <> 'DECIDED' AND outcome = 'PENDING' AND decided_by_principal_id IS NULL AND decided_at IS NULL AND decision_reason IS NULL)
    OR (status = 'DECIDED' AND outcome = 'VERIFIED' AND decided_by_principal_id IS NOT NULL AND decided_at IS NOT NULL AND submitted_by_principal_id IS NOT NULL AND assigned_officer_principal_id IS NOT NULL)
    OR (status = 'DECIDED' AND outcome = 'REJECTED' AND decided_by_principal_id IS NOT NULL AND decided_at IS NOT NULL AND submitted_by_principal_id IS NOT NULL AND assigned_officer_principal_id IS NOT NULL AND decision_reason IS NOT NULL AND length(btrim(decision_reason)) > 0)
  )`,
)
@Check(
  'chk_customer_physical_verification_assigned_status',
  "status NOT IN ('ASSIGNED', 'IN_PROGRESS', 'SUBMITTED', 'DECIDED') OR assigned_officer_principal_id IS NOT NULL",
)
@Check(
  'chk_customer_physical_verification_submission_metadata',
  "status NOT IN ('SUBMITTED', 'DECIDED') OR (submitted_by_principal_id IS NOT NULL AND submitted_at IS NOT NULL)",
)
@Check(
  'chk_customer_physical_verification_separation',
  `(
    decided_by_principal_id IS NULL
    OR (decided_by_principal_id <> assigned_officer_principal_id AND decided_by_principal_id <> submitted_by_principal_id)
  )`,
)
@Check(
  'chk_customer_physical_verification_assignment',
  `(
    (assigned_officer_principal_id IS NULL AND assigned_by_principal_id IS NULL AND assigned_at IS NULL)
    OR (assigned_officer_principal_id IS NOT NULL AND assigned_by_principal_id IS NOT NULL AND assigned_at IS NOT NULL)
  )`,
)
export class CustomerPhysicalAddressVerification {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'customer_id', type: 'uuid' })
  customerId!: string;

  @Column({ name: 'residential_address_id', type: 'uuid' })
  residentialAddressId!: string;

  @Column({ type: 'varchar', length: 24, default: PhysicalAddressVerificationStatus.PENDING })
  status!: PhysicalAddressVerificationStatus;

  @Column({ type: 'varchar', length: 24, default: PhysicalAddressVerificationOutcome.PENDING })
  outcome!: PhysicalAddressVerificationOutcome;

  /** Method/provider codes remain policy-configurable and are not validated here. */
  @Column({ name: 'verification_method', type: 'varchar', length: 80, nullable: true })
  verificationMethod!: string | null;

  @Column({ name: 'provider_name', type: 'varchar', length: 200, nullable: true })
  providerName!: string | null;

  @Column({ name: 'provider_reference', type: 'varchar', length: 160, nullable: true })
  providerReference!: string | null;

  @Column({ name: 'assigned_officer_principal_id', type: 'varchar', length: 160, nullable: true })
  assignedOfficerPrincipalId!: string | null;

  @Column({ name: 'assigned_by_principal_id', type: 'varchar', length: 160, nullable: true })
  assignedByPrincipalId!: string | null;

  @Column({ name: 'assigned_at', type: 'timestamptz', nullable: true })
  assignedAt!: Date | null;

  @Column({ name: 'visit_date', type: 'date', nullable: true })
  visitDate!: string | null;

  @Column({ type: 'text', nullable: true })
  findings!: string | null;

  /** A reference to an independently secured report; never a public URL or uploaded file body. */
  @Column({ name: 'evidence_report_reference', type: 'varchar', length: 500, nullable: true })
  evidenceReportReference!: string | null;

  @Column({ name: 'submitted_by_principal_id', type: 'varchar', length: 160, nullable: true })
  submittedByPrincipalId!: string | null;

  @Column({ name: 'submitted_at', type: 'timestamptz', nullable: true })
  submittedAt!: Date | null;

  @Column({ name: 'decided_by_principal_id', type: 'varchar', length: 160, nullable: true })
  decidedByPrincipalId!: string | null;

  @Column({ name: 'decided_at', type: 'timestamptz', nullable: true })
  decidedAt!: Date | null;

  @Column({ name: 'decision_reason', type: 'varchar', length: 1000, nullable: true })
  decisionReason!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
