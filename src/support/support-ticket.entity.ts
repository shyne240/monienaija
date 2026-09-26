import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  VersionColumn,
} from 'typeorm';

import {
  SupportTicketCategory,
  SupportTicketPriority,
  SupportTicketStatus,
} from './support.enums';

@Entity({ name: 'support_tickets' })
@Index('uq_support_tickets_reference', ['reference'], { unique: true })
@Index('idx_support_tickets_customer_created', ['customerId', 'createdAt'])
@Index('idx_support_tickets_agent_created', ['agentId', 'createdAt'])
@Index('idx_support_tickets_status_created', ['status', 'createdAt'])
@Index('idx_support_tickets_assigned', ['assignedTo'])
@Index('idx_support_tickets_funding_request', ['fundingRequestId'])
@Index('idx_support_tickets_transfer', ['relatedTransferId'])
@Check(
  'chk_support_tickets_status',
  "status IN ('OPEN','IN_PROGRESS','RESOLVED','CLOSED')",
)
@Check(
  'chk_support_tickets_category',
  "category IN ('FUNDING','TRANSFER','WALLET','CASH_IN','CASH_OUT','CASH_TO_CASH','PROFILE','PIN','AUTHENTICATION','AGENT_FUNDING','OUTLET','TERMINAL','OTHER')",
)
@Check(
  'chk_support_tickets_priority',
  "priority IN ('LOW','MEDIUM','HIGH','CRITICAL')",
)
@Check(
  'chk_support_tickets_created_by_type',
  "created_by_type IN ('CUSTOMER','AGENT','SUPPORT','OPERATOR','SERVICE','PRIVILEGED')",
)
@Check('chk_support_tickets_version', 'version > 0')
export class SupportTicket {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 64 })
  reference!: string;

  @Column({ name: 'customer_id', type: 'uuid', nullable: true })
  customerId!: string | null;

  @Column({ name: 'agent_id', type: 'uuid', nullable: true })
  agentId!: string | null;

  @Column({ name: 'created_by_type', type: 'varchar', length: 20 })
  createdByType!: string;

  @Column({ name: 'created_by_id', type: 'varchar', length: 160 })
  createdById!: string;

  @Column({ type: 'varchar', length: 200 })
  subject!: string;

  @Column({ type: 'varchar', length: 60 })
  category!: SupportTicketCategory;

  @Column({ type: 'varchar', length: 4000 })
  description!: string;

  @Column({ type: 'varchar', length: 20, default: SupportTicketStatus.OPEN })
  status!: SupportTicketStatus;

  @Column({ type: 'varchar', length: 20, default: SupportTicketPriority.MEDIUM })
  priority!: SupportTicketPriority;

  @Column({ name: 'assigned_to', type: 'varchar', length: 160, nullable: true })
  assignedTo!: string | null;

  @Column({ name: 'funding_request_id', type: 'uuid', nullable: true })
  fundingRequestId!: string | null;

  @Column({ name: 'related_transfer_id', type: 'uuid', nullable: true })
  relatedTransferId!: string | null;

  @Column({ name: 'resolved_at', type: 'timestamptz', nullable: true })
  resolvedAt!: Date | null;

  @Column({ name: 'closed_at', type: 'timestamptz', nullable: true })
  closedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @VersionColumn({ type: 'integer', default: 1 })
  version!: number;
}
