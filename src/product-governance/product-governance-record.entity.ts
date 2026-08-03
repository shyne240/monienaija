import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { ProductGovernanceKind, ProductGovernanceStatus } from './product-governance.enums';

@Entity({ name: 'product_governance_records' })
@Index('uq_product_governance_kind_key_version', ['kind', 'recordKey', 'version'], {
  unique: true,
})
@Index('idx_product_governance_kind_status', ['kind', 'status'])
@Index('idx_product_governance_parent', ['parentId'])
@Check('chk_product_governance_version_positive', 'version > 0')
export class ProductGovernanceRecord {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 40 })
  kind!: ProductGovernanceKind;

  @Column({ name: 'record_key', type: 'varchar', length: 160 })
  recordKey!: string;

  @Column({ type: 'varchar', length: 200 })
  name!: string;

  @Column({ type: 'varchar', length: 30 })
  status!: ProductGovernanceStatus;

  @Column({ type: 'integer', default: 1 })
  version!: number;

  @Column({ name: 'parent_id', type: 'uuid', nullable: true })
  parentId!: string | null;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  payload!: Record<string, unknown>;

  @Column({ name: 'immutable_record', type: 'boolean', default: true })
  immutableRecord!: boolean;

  @Column({ name: 'created_by', type: 'varchar', length: 160 })
  createdBy!: string;

  @Column({ name: 'updated_by', type: 'varchar', length: 160 })
  updatedBy!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
