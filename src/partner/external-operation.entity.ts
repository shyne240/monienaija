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

import { ExternalOperationResourceType } from './external-operation.enums';
import { ExternalOperationLifecycleState } from './external-operation-lifecycle.enums';

@Entity({ name: 'external_operations' })
@Index('uq_external_operations_internal_command_id', ['internalCommandId'], { unique: true })
@Index(
  'uq_external_operations_internal_idempotency',
  ['internalIdempotencyScope', 'internalIdempotencyKey'],
  { unique: true },
)
@Index(
  'uq_external_operations_provider_idempotency',
  ['providerIdempotencyScope', 'providerIdempotencyKey'],
  { unique: true },
)
@Index('idx_external_operations_resource', ['resourceType', 'resourceId'])
@Index('idx_external_operations_customer_created', ['customerId', 'createdAt', 'id'])
@Index('idx_external_operations_correlation', ['correlationId', 'createdAt', 'id'])
@Check('chk_external_operations_resource_type', "resource_type = 'WITHDRAWAL'")
@Check('chk_external_operations_partner', "partner_key = 'NIBSS_NIP'")
@Check(
  'chk_external_operations_capability',
  "capability_key = 'external.wallet.withdrawal.settlement'",
)
@Check('chk_external_operations_operation_type', "operation_type = 'OUTBOUND_BANK_SETTLEMENT'")
@Check('chk_external_operations_amount', 'amount_minor > 0')
@Check('chk_external_operations_currency', "currency = 'NGN'")
@Check('chk_external_operations_accounting_unit', "accounting_unit = 'CUSTOMER_FUNDS'")
@Check('chk_external_operations_request_hash', "request_hash ~ '^[a-f0-9]{64}$'")
@Check(
  'chk_external_operations_target_mapping_reference',
  "target_mapping_reference ~ '^a6-target:[a-f0-9]{64}$'",
)
@Check('chk_external_operations_version', 'version > 0')
@Check(
  'chk_external_operations_lifecycle_state',
  "lifecycle_state IN ('CREATED', 'SUBMITTING', 'PENDING_PROVIDER', 'PENDING_VERIFICATION', 'UNKNOWN', 'MANUAL_REVIEW', 'FAILED', 'CANCELLED')",
)
@Check(
  'chk_external_operations_attempts',
  'attempt_count >= 0 AND max_attempts > 0 AND attempt_count <= max_attempts',
)
@Check(
  'chk_external_operations_recovery_reference',
  "lifecycle_state NOT IN ('UNKNOWN', 'MANUAL_REVIEW') OR recovery_reference IS NOT NULL",
)
@Check(
  'chk_external_operations_failure_details',
  "lifecycle_state <> 'FAILED' OR (failure_code IS NOT NULL AND failure_message IS NOT NULL)",
)
export class ExternalOperation {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'operation_version', type: 'integer', default: 1 })
  operationVersion!: number;

  @Column({ name: 'partner_key', type: 'varchar', length: 64 })
  partnerKey!: string;

  @Column({ name: 'capability_key', type: 'varchar', length: 160 })
  capabilityKey!: string;

  @Column({ name: 'operation_type', type: 'varchar', length: 80 })
  operationType!: string;

  @Column({ name: 'resource_type', type: 'varchar', length: 40 })
  resourceType!: ExternalOperationResourceType;

  @Column({ name: 'resource_id', type: 'uuid' })
  resourceId!: string;

  @Column({ name: 'internal_command_id', type: 'uuid' })
  internalCommandId!: string;

  @Column({ name: 'customer_id', type: 'uuid' })
  customerId!: string;

  @Column({ name: 'wallet_account_id', type: 'uuid' })
  walletAccountId!: string;

  @Column({ name: 'ledger_account_id', type: 'uuid' })
  ledgerAccountId!: string;

  @Column({ name: 'target_mapping_reference', type: 'varchar', length: 180 })
  targetMappingReference!: string;

  @Column({ name: 'amount_minor', type: 'bigint' })
  amountMinor!: string;

  @Column({ type: 'varchar', length: 3 })
  currency!: string;

  @Column({ name: 'accounting_unit', type: 'varchar', length: 64 })
  accountingUnit!: string;

  @Column({ name: 'internal_idempotency_scope', type: 'varchar', length: 120 })
  internalIdempotencyScope!: string;

  @Column({ name: 'internal_idempotency_key', type: 'varchar', length: 255 })
  internalIdempotencyKey!: string;

  @Column({ name: 'provider_idempotency_scope', type: 'varchar', length: 120 })
  providerIdempotencyScope!: string;

  @Column({ name: 'provider_idempotency_key', type: 'varchar', length: 255 })
  providerIdempotencyKey!: string;

  @Column({ name: 'request_hash', type: 'char', length: 64 })
  requestHash!: string;

  @Column({ name: 'request_id', type: 'varchar', length: 255 })
  requestId!: string;

  @Column({ name: 'correlation_id', type: 'varchar', length: 255 })
  correlationId!: string;

  @Column({ name: 'trace_id', type: 'varchar', length: 255, nullable: true })
  traceId!: string | null;

  @Column({ name: 'causation_id', type: 'varchar', length: 255, nullable: true })
  causationId!: string | null;

  @Column({ name: 'lifecycle_state', type: 'varchar', length: 32 })
  lifecycleState!: ExternalOperationLifecycleState;

  @Column({ name: 'attempt_count', type: 'integer' })
  attemptCount!: number;

  @Column({ name: 'max_attempts', type: 'integer' })
  maxAttempts!: number;

  @Column({ name: 'next_retry_at', type: 'timestamptz', nullable: true })
  nextRetryAt!: Date | null;

  @Column({ name: 'last_attempt_at', type: 'timestamptz', nullable: true })
  lastAttemptAt!: Date | null;

  @Column({ name: 'provider_status', type: 'varchar', length: 80, nullable: true })
  providerStatus!: string | null;

  @Column({ name: 'failure_code', type: 'varchar', length: 80, nullable: true })
  failureCode!: string | null;

  @Column({ name: 'failure_message', type: 'varchar', length: 255, nullable: true })
  failureMessage!: string | null;

  @Column({ name: 'failure_status_code', type: 'integer', nullable: true })
  failureStatusCode!: number | null;

  @Column({ name: 'recovery_reference', type: 'varchar', length: 180, nullable: true })
  recoveryReference!: string | null;

  @Column({ name: 'submitting_at', type: 'timestamptz', nullable: true })
  submittingAt!: Date | null;

  @Column({ name: 'pending_at', type: 'timestamptz', nullable: true })
  pendingAt!: Date | null;

  @Column({ name: 'pending_verification_at', type: 'timestamptz', nullable: true })
  pendingVerificationAt!: Date | null;

  @Column({ name: 'unknown_at', type: 'timestamptz', nullable: true })
  unknownAt!: Date | null;

  @Column({ name: 'manual_review_at', type: 'timestamptz', nullable: true })
  manualReviewAt!: Date | null;

  @Column({ name: 'failed_at', type: 'timestamptz', nullable: true })
  failedAt!: Date | null;

  @Column({ name: 'cancelled_at', type: 'timestamptz', nullable: true })
  cancelledAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @VersionColumn({ type: 'integer', default: 1 })
  version!: number;
}
