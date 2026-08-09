/**
 * B1T05 — B1 billing engine, invoice engine, and statement-generation
 * engine persistence entity.
 *
 * The B1 billing engine, invoice engine, and statement-generation
 * engine entity is the durable TypeORM record for each B1 billing
 * document (billing record, invoice, invoice line, statement,
 * statement line, billing period, statement period). The B1
 * billing engine, invoice engine, and statement-generation engine
 * entity persists the B1 billing document record as a JSONB
 * payload alongside the B1 billing document key, the B1 billing
 * document reference, the B1 billing document version, the B1
 * billing document kind, the B1 billing document hash, the B1
 * billing document replay hash, the B1 billing document
 * idempotency scope, the B1 billing document idempotency key, and
 * the B1 billing document effective-from / effective-to as a
 * relational column.
 *
 * The B1 billing engine, invoice engine, and statement-generation
 * engine entity is the only B1 billing document persistence
 * surface; the B1 billing engine, invoice engine, and
 * statement-generation engine entity does NOT introduce a second
 * B1 billing document persistence surface.
 */

import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import type {
  B1BillingDocumentKind,
  B1BillingDocumentPersistenceRecordV1,
  B1BillingDocumentVersion,
} from './b1-billing-engine.types';

@Entity({ name: 'b1_billing_documents' })
@Index('uq_b1_billing_documents_reference', ['documentReference', 'documentVersion'], {
  unique: true,
})
@Index('idx_b1_billing_documents_scope', ['scopeKey', 'scopeVersion'])
@Index('idx_b1_billing_documents_kind', ['documentKind'])
@Index('idx_b1_billing_documents_hash', ['documentHash'])
@Index('idx_b1_billing_documents_replay_hash', ['documentReplayHash'])
@Index('idx_b1_billing_documents_idempotency', ['idempotencyScope', 'idempotencyKey'])
@Index('idx_b1_billing_documents_billing_record_reference', ['billingRecordReference'])
@Index('idx_b1_billing_documents_invoice_reference', ['invoiceReference'])
@Index('idx_b1_billing_documents_customer_id', ['customerId'])
@Index('idx_b1_billing_documents_correlation_id', ['correlationId'])
export class B1BillingDocument {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'document_reference', type: 'varchar', length: 200 })
  documentReference!: string;

  @Column({ name: 'document_version', type: 'integer' })
  documentVersion!: B1BillingDocumentVersion;

  @Column({ name: 'document_kind', type: 'varchar', length: 40 })
  documentKind!: B1BillingDocumentKind;

  @Column({ name: 'document_hash', type: 'varchar', length: 64 })
  documentHash!: string;

  @Column({ name: 'document_replay_hash', type: 'varchar', length: 64 })
  documentReplayHash!: string;

  @Column({ name: 'idempotency_scope', type: 'varchar', length: 80 })
  idempotencyScope!: string;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 255 })
  idempotencyKey!: string;

  @Column({ name: 'scope_key', type: 'varchar', length: 200 })
  scopeKey!: string;

  @Column({ name: 'scope_version', type: 'integer' })
  scopeVersion!: 1;

  @Column({ name: 'billing_record_reference', type: 'varchar', length: 200, nullable: true })
  billingRecordReference!: string | null;

  @Column({ name: 'invoice_reference', type: 'varchar', length: 200, nullable: true })
  invoiceReference!: string | null;

  @Column({ name: 'customer_id', type: 'varchar', length: 64 })
  customerId!: string;

  @Column({ name: 'merchant_id', type: 'varchar', length: 64 })
  merchantId!: string;

  @Column({ name: 'partner_id', type: 'varchar', length: 64 })
  partnerId!: string;

  @Column({ name: 'product_key', type: 'varchar', length: 80 })
  productKey!: string;

  @Column({ name: 'product_version', type: 'integer' })
  productVersion!: 1;

  @Column({ name: 'period_key', type: 'varchar', length: 200 })
  periodKey!: string;

  @Column({ name: 'period_version', type: 'integer' })
  periodVersion!: 1;

  @Column({ name: 'classification_level', type: 'varchar', length: 24 })
  classificationLevel!: string;

  @Column({ name: 'retention_days', type: 'integer' })
  retentionDays!: number;

  @Column({ name: 'effective_from', type: 'timestamptz', nullable: true })
  effectiveFrom!: Date | null;

  @Column({ name: 'effective_to', type: 'timestamptz', nullable: true })
  effectiveTo!: Date | null;

  @Column({ name: 'correlation_id', type: 'varchar', length: 255 })
  correlationId!: string;

  @Column({ name: 'record', type: 'jsonb' })
  record!: B1BillingDocumentPersistenceRecordV1['record'];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
