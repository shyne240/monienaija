import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity({ name: 'funding_instrument_verifications' })
@Index('idx_funding_instrument_verifications_instrument_created', ['instrumentId', 'createdAt'])
export class FundingInstrumentVerification {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'instrument_id', type: 'uuid' })
  instrumentId!: string;

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
