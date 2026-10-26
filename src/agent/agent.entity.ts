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

import { AgentStatus } from './agent.enums';

@Entity({ name: 'agents' })
@Index('uq_agents_reference', ['reference'], { unique: true })
@Check('chk_agents_status', "status IN ('PENDING', 'ACTIVE', 'SUSPENDED', 'TERMINATED')")
@Check('chk_agents_version', 'version > 0')
export class Agent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 160 })
  reference!: string;

  @Column({ type: 'varchar', length: 20, default: AgentStatus.PENDING })
  status!: AgentStatus;

  @Column({ name: 'agent_class_id', type: 'uuid', nullable: true })
  agentClassId!: string | null;

  @Column({ name: 'origin_application_id', type: 'uuid', nullable: true })
  originApplicationId!: string | null;

  @VersionColumn({ type: 'integer', default: 1 })
  version!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}
