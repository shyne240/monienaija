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

import { TrustedDeviceStatus } from './customer-authentication.enums';

@Entity({ name: 'trusted_devices' })
@Index('uq_trusted_devices_customer_reference', ['customerId', 'deviceReference'], {
  unique: true,
  where: 'deleted_at IS NULL',
})
@Index('idx_trusted_devices_customer_status', ['customerId', 'status'])
@Check('chk_trusted_devices_status', "status IN ('PENDING', 'TRUSTED', 'SUSPENDED', 'REVOKED')")
@Check('chk_trusted_devices_version', 'version > 0')
export class TrustedDevice {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'customer_id', type: 'uuid' })
  customerId!: string;

  @Column({ name: 'device_reference', type: 'varchar', length: 160 })
  deviceReference!: string;

  @Column({ name: 'device_name', type: 'varchar', length: 160 })
  deviceName!: string;

  @Column({ type: 'varchar', length: 80 })
  platform!: string;

  @Column({ name: 'device_fingerprint_hash', type: 'varchar', length: 512 })
  deviceFingerprintHash!: string;

  @Column({ type: 'varchar', length: 20, default: TrustedDeviceStatus.PENDING })
  status!: TrustedDeviceStatus;

  @Column({ name: 'registered_at', type: 'timestamptz' })
  registeredAt!: Date;

  @Column({ name: 'last_seen_at', type: 'timestamptz', nullable: true })
  lastSeenAt!: Date | null;

  @VersionColumn({ type: 'integer', default: 1 })
  version!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}
