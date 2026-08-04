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

@Entity({ name: 'beneficiary_ownerships' })
@Index('uq_beneficiary_ownerships_beneficiary', ['beneficiaryId'], {
  unique: true,
  where: 'deleted_at IS NULL',
})
@Index('idx_beneficiary_ownerships_customer', ['customerId'])
@Check('chk_beneficiary_ownerships_version', 'version > 0')
export class BeneficiaryOwnership {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'beneficiary_id', type: 'uuid' })
  beneficiaryId!: string;

  @Column({ name: 'customer_id', type: 'uuid' })
  customerId!: string;

  @VersionColumn({ type: 'integer', default: 1 })
  version!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}
