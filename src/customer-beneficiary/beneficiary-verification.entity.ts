import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity({ name: 'beneficiary_verifications' })
@Index('idx_beneficiary_verifications_beneficiary_created', ['beneficiaryId', 'createdAt'])
export class BeneficiaryVerification {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'beneficiary_id', type: 'uuid' })
  beneficiaryId!: string;

  @Column({ name: 'verified_by', type: 'varchar', length: 160 })
  verifiedBy!: string;

  @Column({ name: 'verified_at', type: 'timestamptz' })
  verifiedAt!: Date;

  @Column({ name: 'verification_method', type: 'varchar', length: 80 })
  verificationMethod!: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  remarks!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}
