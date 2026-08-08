import { Check, Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

import {
  ExternalOperationReferenceSource,
  ExternalOperationReferenceType,
} from './external-operation.enums';

@Entity({ name: 'external_operation_references' })
@Index(
  'uq_external_operation_references_partner_value',
  ['partnerKey', 'referenceType', 'referenceValue'],
  { unique: true },
)
@Index(
  'uq_external_operation_references_operation_value',
  ['externalOperationId', 'referenceType', 'referenceValue'],
  { unique: true },
)
@Index('idx_external_operation_references_operation', ['externalOperationId', 'createdAt', 'id'])
@Check('chk_external_operation_references_partner', "partner_key = 'NIBSS_NIP'")
@Check('chk_external_operation_references_value', "reference_value ~ '^[\\x20-\\x7E]{1,255}$'")
export class ExternalOperationReference {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'external_operation_id', type: 'uuid' })
  externalOperationId!: string;

  @Column({ name: 'partner_key', type: 'varchar', length: 64 })
  partnerKey!: string;

  @Column({ name: 'reference_type', type: 'varchar', length: 32 })
  referenceType!: ExternalOperationReferenceType;

  @Column({ name: 'reference_value', type: 'varchar', length: 255 })
  referenceValue!: string;

  @Column({ type: 'varchar', length: 120 })
  namespace!: string;

  @Column({ type: 'varchar', length: 32 })
  source!: ExternalOperationReferenceSource;

  @Column({ name: 'observed_at', type: 'timestamptz' })
  observedAt!: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
