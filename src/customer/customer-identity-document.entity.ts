import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { IdentityDocumentType } from './customer.enums';

@Entity({ name: 'customer_identity_documents' })
@Index('uq_customer_identity_document_type', ['customerId', 'type'], {
  unique: true,
  where: 'deleted_at IS NULL',
})
@Index('idx_customer_identity_documents_customer', ['customerId', 'deletedAt'])
export class CustomerIdentityDocument {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'customer_id', type: 'uuid' })
  customerId!: string;

  @Column({ type: 'varchar', length: 30 })
  type!: IdentityDocumentType;

  @Column({ name: 'document_number', type: 'varchar', length: 160 })
  documentNumber!: string;

  @Column({ name: 'issuing_country', type: 'varchar', length: 3 })
  issuingCountry!: string;

  @Column({ name: 'issued_at', type: 'date', nullable: true })
  issuedAt!: string | null;

  @Column({ name: 'expires_at', type: 'date', nullable: true })
  expiresAt!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}
