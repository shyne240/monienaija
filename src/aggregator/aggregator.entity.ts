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

import { AggregatorStatus } from './aggregator.enums';

/**
 * Aggregator — first-class corporate participant.
 *
 * Implementation identifiers:
 * - `reference` and `code` are implementation-level unique identifiers, NOT regulatory
 *   registration numbers. They provide deterministic idempotency and lookup without
 *   claiming corporate registry validation. Registration/business identifiers can be
 *   added later as nullable, non-mandatory fields if Legal/Compliance requires.
 *
 * Financial boundary (A18):
 * - Aggregator has NO wallet, NO ledger balance, NO funding. It is a corporate identity
 *   that manages Agents, not a balance holder. Later funding phases will define
 *   ownership/accounting explicitly; A18 does not invent a ledger account.
 */
@Entity({ name: 'aggregators' })
@Index('uq_aggregators_reference', ['reference'], { unique: true })
@Index('uq_aggregators_code', ['code'], { unique: true })
@Check('chk_aggregators_status', "status IN ('PENDING', 'ACTIVE', 'SUSPENDED', 'TERMINATED')")
@Check('chk_aggregators_version', 'version > 0')
export class Aggregator {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 80 })
  reference!: string;

  @Column({ type: 'varchar', length: 80 })
  code!: string;

  @Column({ name: 'corporate_name', type: 'varchar', length: 320 })
  corporateName!: string;

  @Column({ name: 'display_name', type: 'varchar', length: 160, nullable: true })
  displayName!: string | null;

  @Column({ name: 'contact_email', type: 'varchar', length: 320, nullable: true })
  contactEmail!: string | null;

  @Column({ name: 'contact_phone', type: 'varchar', length: 20, nullable: true })
  contactPhone!: string | null;

  @Column({ type: 'varchar', length: 20, default: AggregatorStatus.PENDING })
  status!: AggregatorStatus;

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
