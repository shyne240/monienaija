import {
  Check,
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  VersionColumn,
} from 'typeorm';

import { CustomerBeneficiaryStatus, CustomerBeneficiaryType } from './customer-beneficiary.enums';

@Entity({ name: 'customer_beneficiaries' })
@Index('uq_customer_beneficiaries_reference', ['reference'], { unique: true })
@Index(
  'uq_customer_beneficiaries_customer_destination',
  ['customerId', 'normalizedDestinationIdentifier'],
  {
    unique: true,
    where: 'deleted_at IS NULL',
  },
)
@Index('idx_customer_beneficiaries_customer_status', ['customerId', 'status'])
@Check(
  'chk_customer_beneficiaries_type',
  "beneficiary_type IN ('INTERNAL_CUSTOMER', 'BANK_ACCOUNT', 'MOBILE_MONEY', 'CASH_AGENT')",
)
@Check(
  'chk_customer_beneficiaries_status',
  "status IN ('PENDING', 'ACTIVE', 'SUSPENDED', 'DELETED')",
)
@Check('chk_customer_beneficiaries_reference', "reference ~ '^[a-z0-9][a-z0-9_.:-]{0,159}$'")
@Check('chk_customer_beneficiaries_version', 'version > 0')
export class CustomerBeneficiary {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'customer_id', type: 'uuid' })
  customerId!: string;

  @Column({ name: 'beneficiary_type', type: 'varchar', length: 30 })
  type!: CustomerBeneficiaryType;

  @Column({ name: 'display_name', type: 'varchar', length: 200 })
  displayName!: string;

  @Column({ type: 'varchar', length: 160 })
  reference!: string;

  @Column({ name: 'destination_identifier', type: 'varchar', length: 160 })
  destinationIdentifier!: string;

  @Column({ name: 'normalized_destination_identifier', type: 'varchar', length: 160 })
  normalizedDestinationIdentifier!: string;

  @Column({ name: 'destination_name', type: 'varchar', length: 200, nullable: true })
  destinationName!: string | null;

  @Column({ name: 'destination_institution', type: 'varchar', length: 200, nullable: true })
  destinationInstitution!: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  nickname!: string | null;

  @Column({ type: 'varchar', length: 20, default: CustomerBeneficiaryStatus.PENDING })
  status!: CustomerBeneficiaryStatus;

  @Column({ type: 'boolean', default: false })
  verified!: boolean;

  @VersionColumn({ type: 'integer', default: 1 })
  version!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}
