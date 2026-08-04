import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity({ name: 'compliance_case_evidence' })
@Index('idx_compliance_case_evidence_case_created', ['caseId', 'createdAt'])
export class ComplianceCaseEvidence {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'case_id', type: 'uuid' })
  caseId!: string;

  @Column({ name: 'customer_id', type: 'uuid' })
  customerId!: string;

  @Column({ name: 'document_name', type: 'varchar', length: 200 })
  documentName!: string;

  @Column({ name: 'document_type', type: 'varchar', length: 80 })
  documentType!: string;

  @Column({ type: 'varchar', length: 160 })
  reference!: string;

  @Column({ name: 'uploaded_by', type: 'varchar', length: 160 })
  uploadedBy!: string;

  @Column({ name: 'uploaded_at', type: 'timestamptz' })
  uploadedAt!: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}
