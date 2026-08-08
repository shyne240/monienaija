import { Check, Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

import { ExternalCallbackReceiptStatus } from './external-callback.enums';
import { ExternalOperationReferenceType } from './external-operation.enums';

@Entity({ name: 'external_callback_receipts' })
@Index('uq_external_callback_receipts_partner_event', ['partnerKey', 'callbackEventId'], {
  unique: true,
})
@Index('idx_external_callback_receipts_operation', ['externalOperationId', 'receivedAt', 'id'])
@Index('idx_external_callback_receipts_provider_reference', [
  'partnerKey',
  'providerReferenceType',
  'providerReferenceValue',
])
@Check('chk_external_callback_receipts_partner', "partner_key = 'NIBSS_NIP'")
@Check('chk_external_callback_receipts_event_id', "callback_event_id ~ '^[\\x20-\\x7E]{1,255}$'")
@Check('chk_external_callback_receipts_payload_hash', "payload_hash ~ '^[a-f0-9]{64}$'")
@Check('chk_external_callback_receipts_signature_hash', "signature_hash ~ '^[a-f0-9]{64}$'")
@Check(
  'chk_external_callback_receipts_reference_type',
  "provider_reference_type IN ('OPERATION', 'TRANSACTION', 'SETTLEMENT')",
)
@Check('chk_external_callback_receipts_status', "status IN ('RECEIVED', 'REJECTED')")
export class ExternalCallbackReceipt {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'external_operation_id', type: 'uuid', nullable: true })
  externalOperationId!: string | null;

  @Column({ name: 'partner_key', type: 'varchar', length: 64 })
  partnerKey!: string;

  @Column({ name: 'callback_event_id', type: 'varchar', length: 255 })
  callbackEventId!: string;

  @Column({ name: 'payload_hash', type: 'char', length: 64 })
  payloadHash!: string;

  @Column({ name: 'signature_hash', type: 'char', length: 64 })
  signatureHash!: string;

  @Column({ name: 'provider_reference_type', type: 'varchar', length: 32 })
  providerReferenceType!: ExternalOperationReferenceType;

  @Column({ name: 'provider_reference_value', type: 'varchar', length: 255 })
  providerReferenceValue!: string;

  @Column({ name: 'provider_reference_namespace', type: 'varchar', length: 120 })
  providerReferenceNamespace!: string;

  @Column({ name: 'provider_status', type: 'varchar', length: 80 })
  providerStatus!: string;

  @Column({ name: 'provider_occurred_at', type: 'timestamptz' })
  providerOccurredAt!: Date;

  @Column({ name: 'received_at', type: 'timestamptz' })
  receivedAt!: Date;

  @Column({ name: 'correlation_id', type: 'varchar', length: 255 })
  correlationId!: string;

  @Column({ name: 'status', type: 'varchar', length: 24 })
  status!: ExternalCallbackReceiptStatus;

  @Column({ name: 'rejection_code', type: 'varchar', length: 80, nullable: true })
  rejectionCode!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
