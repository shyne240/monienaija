import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  VersionColumn,
} from 'typeorm';

import { CustomerAgreementType } from './customer-onboarding.enums';

@Entity({ name: 'customer_agreements' })
@Index(
  'uq_customer_agreements_onboarding_type_version',
  ['onboardingId', 'type', 'agreementVersion'],
  {
    unique: true,
    where: 'deleted_at IS NULL',
  },
)
@Index('idx_customer_agreements_customer', ['customerId', 'createdAt'])
export class CustomerAgreement {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'customer_id', type: 'uuid' })
  customerId!: string;

  @Column({ name: 'onboarding_id', type: 'uuid' })
  onboardingId!: string;

  @Column({ name: 'agreement_type', type: 'varchar', length: 40 })
  type!: CustomerAgreementType;

  @Column({ name: 'agreement_version', type: 'varchar', length: 40 })
  agreementVersion!: string;

  @Column({ name: 'is_required', type: 'boolean', default: true })
  isRequired!: boolean;

  @Column({ type: 'boolean', default: false })
  accepted!: boolean;

  @Column({ name: 'accepted_at', type: 'timestamptz', nullable: true })
  acceptedAt!: Date | null;

  @Column({ name: 'accepted_by', type: 'varchar', length: 160, nullable: true })
  acceptedBy!: string | null;

  @VersionColumn({ type: 'integer', default: 1 })
  version!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}
