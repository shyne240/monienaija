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

import { MfaEnrollmentStatus } from './customer-authentication.enums';

@Entity({ name: 'mfa_enrollments' })
@Index('uq_mfa_enrollments_active_customer', ['customerId'], {
  unique: true,
  where: "deleted_at IS NULL AND status <> 'REVOKED'",
})
@Index('uq_mfa_enrollments_reference', ['reference'], { unique: true })
@Check('chk_mfa_enrollments_status', "status IN ('PENDING', 'ENABLED', 'DISABLED', 'REVOKED')")
@Check('chk_mfa_enrollments_reference', "reference ~ '^[a-z0-9][a-z0-9_.:-]{0,159}$'")
@Check('chk_mfa_enrollments_version', 'version > 0')
export class MfaEnrollment {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'customer_id', type: 'uuid' })
  customerId!: string;

  @Column({ type: 'varchar', length: 160 })
  reference!: string;

  @Column({ type: 'varchar', length: 20, default: MfaEnrollmentStatus.PENDING })
  status!: MfaEnrollmentStatus;

  @Column({ name: 'enabled_at', type: 'timestamptz', nullable: true })
  enabledAt!: Date | null;

  @VersionColumn({ type: 'integer', default: 1 })
  version!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}
