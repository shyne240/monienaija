import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'governance_metadata' })
@Index('idx_governance_metadata_startup', ['startupTimestamp'])
export class GovernanceMetadata {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'application_version', type: 'varchar', length: 64 })
  applicationVersion!: string;

  @Column({ name: 'migration_head', type: 'varchar', length: 160 })
  migrationHead!: string;

  @Column({ name: 'configuration_fingerprint', type: 'char', length: 64 })
  configurationFingerprint!: string;

  @Column({ name: 'build_timestamp', type: 'timestamptz', nullable: true })
  buildTimestamp!: Date | null;

  @Column({ name: 'startup_timestamp', type: 'timestamptz' })
  startupTimestamp!: Date;

  @Column({ type: 'varchar', length: 20 })
  environment!: string;

  @Column({ name: 'api_version', type: 'varchar', length: 20 })
  apiVersion!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
