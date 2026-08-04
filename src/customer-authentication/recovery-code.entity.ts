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

import { RecoveryCodeStatus } from './customer-authentication.enums';

@Entity({ name: 'recovery_codes' })
@Index('uq_recovery_codes_hash', ['codeHash'], { unique: true })
@Index('idx_recovery_codes_customer_status', ['customerId', 'status'])
@Check('chk_recovery_codes_status', "status IN ('AVAILABLE', 'USED', 'REVOKED')")
@Check('chk_recovery_codes_version', 'code_version > 0 AND version > 0')
export class RecoveryCode {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'customer_id', type: 'uuid' })
  customerId!: string;

  @Column({ name: 'enrollment_id', type: 'uuid', nullable: true })
  enrollmentId!: string | null;

  @Column({ name: 'code_hash', type: 'varchar', length: 512 })
  codeHash!: string;

  @Column({ name: 'code_version', type: 'integer' })
  codeVersion!: number;

  @Column({ type: 'varchar', length: 20, default: RecoveryCodeStatus.AVAILABLE })
  status!: RecoveryCodeStatus;

  @Column({ name: 'generated_at', type: 'timestamptz' })
  generatedAt!: Date;

  @Column({ name: 'used_at', type: 'timestamptz', nullable: true })
  usedAt!: Date | null;

  @VersionColumn({ type: 'integer', default: 1 })
  version!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}
