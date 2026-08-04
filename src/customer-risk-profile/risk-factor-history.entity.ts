import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { RiskFactorHistoryAction } from './customer-risk-profile.enums';

@Entity({ name: 'risk_assessment_factor_histories' })
@Index('idx_risk_factor_histories_profile_created', ['profileId', 'createdAt'])
export class RiskFactorHistory {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'profile_id', type: 'uuid' })
  profileId!: string;

  @Column({ name: 'customer_id', type: 'uuid' })
  customerId!: string;

  @Column({ name: 'profile_version', type: 'integer' })
  profileVersion!: number;

  @Column({ type: 'varchar', length: 30 })
  action!: RiskFactorHistoryAction;

  @Column({ type: 'varchar', length: 80 })
  category!: string;

  @Column({ type: 'double precision' })
  score!: number;

  @Column({ type: 'double precision' })
  weight!: number;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  remarks!: string | null;

  @Column({ type: 'varchar', length: 160 })
  actor!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}
