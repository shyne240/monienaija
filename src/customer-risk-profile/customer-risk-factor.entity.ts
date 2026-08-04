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

@Entity({ name: 'customer_risk_assessment_factors' })
@Index('idx_customer_risk_factors_profile_created', ['profileId', 'createdAt'])
@Check('chk_customer_risk_factors_score', 'score >= 0')
@Check('chk_customer_risk_factors_weight', 'weight > 0')
@Check('chk_customer_risk_factors_version', 'version > 0')
export class CustomerRiskFactor {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'profile_id', type: 'uuid' })
  profileId!: string;

  @Column({ name: 'customer_id', type: 'uuid' })
  customerId!: string;

  @Column({ type: 'varchar', length: 80 })
  category!: string;

  @Column({ type: 'double precision' })
  score!: number;

  @Column({ type: 'double precision' })
  weight!: number;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  remarks!: string | null;

  @VersionColumn({ type: 'integer', default: 1 })
  version!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}
