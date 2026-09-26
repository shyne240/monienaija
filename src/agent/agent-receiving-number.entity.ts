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

export enum AgentReceivingNumberStatus {
  ACTIVE = 'ACTIVE',
  REVOKED = 'REVOKED',
}

@Entity({ name: 'agent_receiving_numbers' })
@Index('uq_agent_receiving_numbers_agent_id', ['agentId'], { unique: true })
@Index('uq_agent_receiving_numbers_number', ['receivingNumber'], { unique: true })
@Check('chk_agent_receiving_numbers_status', "status IN ('ACTIVE', 'REVOKED')")
@Check('chk_agent_receiving_numbers_number', "receiving_number ~ '^[0-9]{10}$'")
@Check('chk_agent_receiving_numbers_version', 'version > 0')
export class AgentReceivingNumber {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'agent_id', type: 'uuid', unique: true })
  agentId!: string;

  @Column({ name: 'receiving_number', type: 'varchar', length: 10, unique: true })
  receivingNumber!: string;

  @Column({ type: 'varchar', length: 20, default: AgentReceivingNumberStatus.ACTIVE })
  status!: AgentReceivingNumberStatus;

  @Column({ name: 'assigned_at', type: 'timestamptz' })
  assignedAt!: Date;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt!: Date | null;

  @VersionColumn({ type: 'integer', default: 1 })
  version!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}
