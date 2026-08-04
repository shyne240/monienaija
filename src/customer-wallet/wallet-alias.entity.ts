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

@Entity({ name: 'wallet_aliases' })
@Index('uq_wallet_aliases_alias', ['alias'], { unique: true, where: 'deleted_at IS NULL' })
@Index('idx_wallet_aliases_wallet', ['walletId'])
@Check('chk_wallet_aliases_alias', "alias ~ '^[a-z0-9][a-z0-9_.:-]{0,159}$'")
@Check('chk_wallet_aliases_version', 'version > 0')
export class WalletAlias {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'wallet_id', type: 'uuid' })
  walletId!: string;

  @Column({ type: 'varchar', length: 160 })
  alias!: string;

  @VersionColumn({ type: 'integer', default: 1 })
  version!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}
