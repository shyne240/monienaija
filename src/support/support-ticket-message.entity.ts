import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'support_ticket_messages' })
@Index('idx_support_ticket_messages_ticket_created', ['ticketId', 'createdAt'])
@Check(
  'chk_support_ticket_messages_author_type',
  "author_type IN ('CUSTOMER','AGENT','SUPPORT','OPERATOR','SERVICE','PRIVILEGED')",
)
export class SupportTicketMessage {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'ticket_id', type: 'uuid' })
  ticketId!: string;

  @Column({ name: 'author_type', type: 'varchar', length: 20 })
  authorType!: string;

  @Column({ name: 'author_id', type: 'varchar', length: 160 })
  authorId!: string;

  @Column({ type: 'varchar', length: 4000 })
  body!: string;

  @Column({ name: 'is_internal', type: 'boolean', default: false })
  isInternal!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
