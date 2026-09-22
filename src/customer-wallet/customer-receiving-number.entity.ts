import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  VersionColumn,
} from 'typeorm';

import {
  CustomerReceivingNumberSource,
  CustomerReceivingNumberStatus,
} from './customer-receiving-number.enums';

/**
 * Primary MonieNaija receiving number.
 *
 * A system-issued, exactly-10-digit, numeric-only identifier that a customer
 * shares to receive intra-MonieNaija transfers. It is a RECEIVING / LOOKUP
 * identifier bound 1:1-at-a-time to a PRIMARY CustomerWallet; it is never a
 * CustomerWallet.id, WalletAccount.id, LedgerAccount.id, or customerId, and
 * (per the A3 identifier baseline) never carries financial-account semantics.
 *
 * Invariants:
 * - exactly 10 ASCII digits (CHECK),
 * - globally unique, forever (plain UNIQUE; numbers are never recycled),
 * - at most one ACTIVE number per wallet (partial UNIQUE),
 * - deterministic: derived from the customer's canonical Nigerian phone NSN,
 * - auditable: issuance is recorded in wallet provisioning history + audit log.
 */
@Entity({ name: 'customer_receiving_numbers' })
@Index('uq_customer_receiving_numbers_number', ['number'], { unique: true })
@Index('uq_customer_receiving_numbers_active_wallet', ['walletId'], {
  unique: true,
  where: "status = 'ACTIVE'",
})
@Index('idx_customer_receiving_numbers_customer', ['customerId', 'status'])
@Check('chk_customer_receiving_numbers_number', "number ~ '^[0-9]{10}$'")
@Check('chk_customer_receiving_numbers_version', 'version > 0')
export class CustomerReceivingNumber {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'customer_id', type: 'uuid' })
  customerId!: string;

  @Column({ name: 'wallet_id', type: 'uuid' })
  walletId!: string;

  /** Exactly 10 digits; for PHONE-derived issuance this is the canonical phone NSN. */
  @Column({ type: 'varchar', length: 10 })
  number!: string;

  @Column({ type: 'varchar', length: 30, default: CustomerReceivingNumberSource.PHONE_NSN })
  source!: CustomerReceivingNumberSource;

  @Column({ type: 'varchar', length: 20, default: CustomerReceivingNumberStatus.ACTIVE })
  status!: CustomerReceivingNumberStatus;

  /** The canonical +234 phone this number was derived from (audit trail only). */
  @Column({ name: 'derived_from_phone', type: 'varchar', length: 16, nullable: true })
  derivedFromPhone!: string | null;

  @VersionColumn({ type: 'integer', default: 1 })
  version!: number;

  @CreateDateColumn({ name: 'issued_at', type: 'timestamptz' })
  issuedAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @Column({ name: 'deactivated_at', type: 'timestamptz', nullable: true })
  deactivatedAt!: Date | null;
}
