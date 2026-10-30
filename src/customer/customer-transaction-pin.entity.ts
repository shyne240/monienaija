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

@Entity({ name: 'customer_transaction_pins' })
@Index('uq_customer_transaction_pins_active_customer', ['customerId'], {
  unique: true,
  where: 'deleted_at IS NULL',
})
@Index('idx_customer_transaction_pins_customer', ['customerId'])
@Check('chk_customer_transaction_pins_pin_version', 'pin_version > 0')
@Check('chk_customer_transaction_pins_failed_count', 'failed_count >= 0')
@Check('chk_customer_transaction_pins_version', 'version > 0')
export class CustomerTransactionPin {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'customer_id', type: 'uuid' })
  customerId!: string;

  @Column({ name: 'pin_hash', type: 'varchar', length: 512 })
  pinHash!: string;

  @Column({ name: 'hash_algorithm', type: 'varchar', length: 20 })
  hashAlgorithm!: string;

  @Column({ name: 'pin_version', type: 'integer' })
  pinVersion!: number;

  @Column({ name: 'failed_count', type: 'integer', default: 0 })
  failedCount!: number;

  @Column({ name: 'account_locked', type: 'boolean', default: false })
  accountLocked!: boolean;

  @Column({ name: 'locked_at', type: 'timestamptz', nullable: true })
  lockedAt!: Date | null;

  @Column({ name: 'lock_reason', type: 'varchar', length: 500, nullable: true })
  lockReason!: string | null;

  @Column({ name: 'last_changed_at', type: 'timestamptz' })
  lastChangedAt!: Date;

  @VersionColumn({ type: 'integer', default: 1 })
  version!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}
