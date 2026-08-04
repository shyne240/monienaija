import {
  Check,
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { BeneficiaryHistoryAction, CustomerBeneficiaryStatus } from './customer-beneficiary.enums';

@Entity({ name: 'beneficiary_histories' })
@Index('idx_beneficiary_histories_beneficiary_created', ['beneficiaryId', 'createdAt'])
@Check(
  'chk_beneficiary_histories_action',
  "action IN ('CREATED', 'OWNERSHIP_CREATED', 'STATUS_CHANGED', 'VERIFIED')",
)
@Check(
  'chk_beneficiary_histories_previous_status',
  "previous_status IS NULL OR previous_status IN ('PENDING', 'ACTIVE', 'SUSPENDED', 'DELETED')",
)
@Check(
  'chk_beneficiary_histories_new_status',
  "new_status IS NULL OR new_status IN ('PENDING', 'ACTIVE', 'SUSPENDED', 'DELETED')",
)
export class BeneficiaryHistory {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'beneficiary_id', type: 'uuid' })
  beneficiaryId!: string;

  @Column({ type: 'varchar', length: 30 })
  action!: BeneficiaryHistoryAction;

  @Column({ name: 'previous_status', type: 'varchar', length: 20, nullable: true })
  previousStatus!: CustomerBeneficiaryStatus | null;

  @Column({ name: 'new_status', type: 'varchar', length: 20, nullable: true })
  newStatus!: CustomerBeneficiaryStatus | null;

  @Column({ name: 'previous_verified', type: 'boolean', nullable: true })
  previousVerified!: boolean | null;

  @Column({ name: 'new_verified', type: 'boolean', nullable: true })
  newVerified!: boolean | null;

  @Column({ type: 'varchar', length: 160 })
  actor!: string;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}
