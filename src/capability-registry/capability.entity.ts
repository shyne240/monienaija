import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

import {
  CapabilityAdminUiStatus,
  CapabilityAgentUiStatus,
  CapabilityApiStatus,
  CapabilityBackendStatus,
  CapabilityBlockerType,
  CapabilityConfigurationStatus,
  CapabilityCustomerUiStatus,
  CapabilityDomain,
  CapabilityLifecycle,
  CapabilityProductScope,
} from './capability.enums';

@Entity({ name: 'capabilities' })
@Index('idx_capabilities_domain', ['domain'])
@Index('idx_capabilities_product_scope', ['productScope'])
@Index('idx_capabilities_backend_status', ['backendStatus'])
@Index('idx_capabilities_enabled', ['enabled'])
@Index('idx_capabilities_lifecycle', ['lifecycle'])
@Check('chk_capabilities_version', 'version > 0')
export class Capability {
  @PrimaryColumn({ name: 'capability_code', type: 'varchar', length: 80 })
  capabilityCode!: string;

  @Column({ type: 'varchar', length: 40 })
  domain!: string; // CapabilityDomain

  @Column({ type: 'varchar', length: 200 })
  name!: string;

  @Column({ type: 'varchar', length: 800 })
  description!: string;

  @Column({ name: 'product_scope', type: 'varchar', length: 20 })
  productScope!: string; // CapabilityProductScope V1/V2

  @Column({ type: 'varchar', length: 40 })
  lifecycle!: string; // CapabilityLifecycle

  @Column({ name: 'backend_status', type: 'varchar', length: 40 })
  backendStatus!: string; // CapabilityBackendStatus

  @Column({ name: 'api_status', type: 'varchar', length: 40 })
  apiStatus!: string; // CapabilityApiStatus

  @Column({ name: 'admin_ui_status', type: 'varchar', length: 40 })
  adminUiStatus!: string; // CapabilityAdminUiStatus

  @Column({ name: 'customer_ui_status', type: 'varchar', length: 40 })
  customerUiStatus!: string; // CapabilityCustomerUiStatus

  @Column({ name: 'agent_ui_status', type: 'varchar', length: 40 })
  agentUiStatus!: string; // CapabilityAgentUiStatus

  @Column({ type: 'boolean', default: false })
  enabled!: boolean;

  @Column({ name: 'configuration_status', type: 'varchar', length: 40 })
  configurationStatus!: string; // CapabilityConfigurationStatus

  @Column({ type: 'jsonb', nullable: true })
  dependencies!: string[] | null;

  @Column({ name: 'implementation_references', type: 'jsonb', nullable: true })
  implementationReferences!: string[] | null;

  @Column({ name: 'migration_references', type: 'jsonb', nullable: true })
  migrationReferences!: string[] | null;

  @Column({ name: 'test_references', type: 'jsonb', nullable: true })
  testReferences!: string[] | null;

  @Column({ name: 'documentation_references', type: 'jsonb', nullable: true })
  documentationReferences!: string[] | null;

  @Column({ type: 'integer', default: 1 })
  version!: number;

  @Column({ type: 'varchar', length: 80, nullable: true })
  owner!: string | null;

  @Column({ name: 'blocker_type', type: 'varchar', length: 40, default: CapabilityBlockerType.NONE })
  blockerType!: string;

  @Column({ name: 'blocker_description', type: 'varchar', length: 800, nullable: true })
  blockerDescription!: string | null;

  @Column({ type: 'varchar', length: 800, nullable: true })
  notes!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
