import {
  Check,
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  VersionColumn,
} from 'typeorm';

import { LimitProfile } from './limit-profile.entity';

@Entity({ name: 'limit_assignments' })
@Index('idx_limit_assignments_profile', ['limitProfileCode'])
@Index('idx_limit_assignments_subject', ['subjectType', 'subjectId'])
@Index('idx_limit_assignments_segment', ['segmentCode'])
@Index('idx_limit_assignments_effective', ['effectiveFrom', 'effectiveTo'])
@Index('idx_limit_assignments_active', ['isActive'])
@Index('uq_limit_assignments_active_key', ['subjectType', 'subjectId', 'segmentCode', 'limitProfileCode', 'effectiveFrom'], {
  unique: true,
  where: 'deleted_at IS NULL',
})
@Check('chk_limit_assignments_subject_type', "subject_type IN ('GLOBAL','SEGMENT','AGENT_CLASS','CUSTOMER','AGENT')")
@Check('chk_limit_assignments_segment', "segment_code IS NULL OR segment_code ~ '^[A-Z0-9_]{3,80}$'")
@Check('chk_limit_assignments_version', 'version > 0')
@Check('chk_limit_assignments_effective', 'effective_to IS NULL OR effective_to > effective_from')
@Check('chk_limit_assignments_subject_consistency', `
  (
    subject_type IN ('CUSTOMER','AGENT','AGENT_CLASS') AND subject_id IS NOT NULL AND segment_code IS NULL
  )
  OR
  (
    subject_type = 'SEGMENT' AND segment_code IS NOT NULL AND subject_id IS NULL
  )
  OR
  (
    subject_type = 'GLOBAL' AND subject_id IS NULL AND segment_code IS NULL
  )
`)
export class LimitAssignment {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'limit_profile_code', type: 'varchar', length: 80 })
  limitProfileCode!: string;

  @ManyToOne(() => LimitProfile, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'limit_profile_code', referencedColumnName: 'code' })
  limitProfile!: LimitProfile;

  @Column({ name: 'subject_type', type: 'varchar', length: 20 })
  subjectType!: string; // LimitAssignmentSubjectType

  @Column({ name: 'subject_id', type: 'uuid', nullable: true })
  subjectId!: string | null;

  @Column({ name: 'segment_code', type: 'varchar', length: 80, nullable: true })
  segmentCode!: string | null;

  @Column({ type: 'integer', default: 0 })
  precedence!: number;

  @Column({ name: 'effective_from', type: 'timestamptz', default: () => 'NOW()' })
  effectiveFrom!: Date;

  @Column({ name: 'effective_to', type: 'timestamptz', nullable: true })
  effectiveTo!: Date | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ name: 'created_by', type: 'varchar', length: 160 })
  createdBy!: string;

  @Column({ name: 'updated_by', type: 'varchar', length: 160, nullable: true })
  updatedBy!: string | null;

  @VersionColumn({ type: 'integer', default: 1 })
  version!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}
