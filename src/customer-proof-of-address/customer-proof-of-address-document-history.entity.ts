import { Check, Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

import {
  CustomerProofOfAddressDocumentHistoryAction,
  CustomerProofOfAddressDocumentStatus,
} from './customer-proof-of-address.enums';

@Entity({ name: 'customer_proof_of_address_document_history' })
@Index('idx_customer_poa_document_history_submission_created', ['submissionId', 'createdAt'])
@Index('idx_customer_poa_document_history_customer_created', ['customerId', 'createdAt'])
@Check(
  'chk_customer_poa_document_history_action',
  "action IN ('UPLOADED', 'SCAN_CLEAN', 'QUARANTINED', 'SUPERSEDED', 'WITHDRAWN', 'ARCHIVED')",
)
@Check(
  'chk_customer_poa_document_history_status',
  "(previous_document_status IS NULL OR previous_document_status IN ('QUARANTINED', 'AVAILABLE', 'SUPERSEDED', 'WITHDRAWN', 'ARCHIVED')) AND (new_document_status IS NULL OR new_document_status IN ('QUARANTINED', 'AVAILABLE', 'SUPERSEDED', 'WITHDRAWN', 'ARCHIVED'))",
)
export class CustomerProofOfAddressDocumentHistory {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'submission_id', type: 'uuid' })
  submissionId!: string;

  @Column({ name: 'customer_id', type: 'uuid' })
  customerId!: string;

  @Column({ type: 'varchar', length: 32 })
  action!: CustomerProofOfAddressDocumentHistoryAction;

  @Column({ name: 'previous_document_status', type: 'varchar', length: 16, nullable: true })
  previousDocumentStatus!: CustomerProofOfAddressDocumentStatus | null;

  @Column({ name: 'new_document_status', type: 'varchar', length: 16, nullable: true })
  newDocumentStatus!: CustomerProofOfAddressDocumentStatus | null;

  @Column({ name: 'actor_principal_id', type: 'varchar', length: 160 })
  actorPrincipalId!: string;

  @Column({ name: 'actor_role_key', type: 'varchar', length: 100 })
  actorRoleKey!: string;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  reason!: string | null;

  /** Only non-sensitive operational fields are recorded; never include file content or URLs. */
  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
