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

@Entity({ name: 'agent_classes' })
@Index('uq_agent_classes_reference', ['reference'], { unique: true })
@Index('uq_agent_classes_code', ['code'], { unique: true })
@Check('chk_agent_classes_version', 'version > 0')
export class AgentClass {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 80 })
  reference!: string;

  @Column({ type: 'varchar', length: 80 })
  code!: string;

  @Column({ type: 'varchar', length: 160 })
  name!: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  description!: string | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ type: 'jsonb', nullable: true })
  requirements!: Record<string, unknown> | null;

  @Column({ name: 'required_information', type: 'jsonb', nullable: true })
  requiredInformation!: unknown | null;

  @Column({ name: 'required_document_categories', type: 'jsonb', nullable: true })
  requiredDocumentCategories!: unknown | null;

  @Column({ name: 'applicable_services', type: 'jsonb', nullable: true })
  applicableServices!: unknown | null;

  @Column({ name: 'applicable_limits', type: 'jsonb', nullable: true })
  applicableLimits!: unknown | null;

  @VersionColumn({ type: 'integer', default: 1 })
  version!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}
