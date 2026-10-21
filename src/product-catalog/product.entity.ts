import {
  Check,
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
  VersionColumn,
} from 'typeorm';

/**
 * V1-COMMERCIAL-02 — authoritative product catalogue entry.
 *
 * Answers "What product is this?" only. Never carries fee/commission/reward rates or limit
 * thresholds — those are separate rule systems. `code` is the stable product identity shared
 * with limit enforcement (`limit_rules.product`), commercial decision snapshots
 * (`commercial_decision_snapshots.product`) and the runtime flows.
 */
@Entity({ name: 'products' })
@Index('idx_products_domain', ['domain'])
@Index('idx_products_scope', ['productScope'])
@Index('idx_products_status', ['status'])
@Index('idx_products_enabled', ['enabled'])
@Check('chk_products_code', "code ~ '^[A-Z0-9_]{3,80}$'")
@Check('chk_products_domain', "domain IN ('CUSTOMER','AGENT','AGGREGATOR','FINANCE','SUPPORT','PLATFORM')")
@Check('chk_products_currency', "currency ~ '^[A-Z]{3}$'")
@Check('chk_products_scope', "product_scope IN ('V1','V2')")
@Check('chk_products_status', "status IN ('ACTIVE','DISABLED','DEPRECATED')")
@Check('chk_products_configuration', "configuration_status IN ('CONFIGURED','NOT_CONFIGURED','DISABLED')")
@Check('chk_products_version', 'version > 0')
export class Product {
  @PrimaryColumn({ type: 'varchar', length: 80 })
  code!: string;

  @Column({ type: 'varchar', length: 160 })
  name!: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  description!: string | null;

  @Column({ type: 'varchar', length: 20 })
  domain!: string; // ProductDomain

  @Column({ type: 'varchar', length: 3 })
  currency!: string;

  @Column({ name: 'product_scope', type: 'varchar', length: 10, default: 'V1' })
  productScope!: string; // ProductScope

  @Column({ type: 'varchar', length: 20, default: 'ACTIVE' })
  status!: string; // ProductStatus

  @Column({ type: 'boolean', default: false })
  enabled!: boolean;

  @Column({ name: 'configuration_status', type: 'varchar', length: 20, default: 'NOT_CONFIGURED' })
  configurationStatus!: string; // ProductConfigurationStatus

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
