import { createHash, randomUUID } from 'node:crypto';

import { ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';

import { normalizeCurrency, parsePositiveMinorUnits } from '../common/money';
import { AuditService } from '../operations/audit.service';
import { IdempotencyService } from '../operations/idempotency.service';
import { ExternalCallbackReceipt } from './external-callback-receipt.entity';
import { ExternalCallbackReceiptStatus } from './external-callback.enums';
import {
  EXTERNAL_CALLBACK_CONTRACT_NAME,
  EXTERNAL_CALLBACK_CONTRACT_VERSION,
  EXTERNAL_CALLBACK_IDEMPOTENCY_SCOPE,
  type ExternalCallbackIngestionResult,
  type ExternalCallbackRejectionCode,
  type PartnerCallbackHeadersV1,
  type VerifiedPartnerCallbackV1,
} from './external-callback.types';
import {
  ExternalOperationReferenceSource,
  ExternalOperationReferenceType,
} from './external-operation.enums';
import { ExternalOperationService } from './external-operation.service';
import type { RecordProviderReferenceResult } from './external-operation.types';
import { PartnerCallbackAuthenticationService } from './partner-callback-authentication.service';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EXTERNAL_OPERATION_REFERENCE_PATTERN = /^external-operation:v1:[a-f0-9]{64}$/;
const SAFE_TEXT_PATTERN = /^[\x20-\x7E]+$/;
const IDEMPOTENCY_RETENTION_SECONDS = 86_400;

interface NormalizedCallback {
  callbackEventId: string;
  externalOperationId: string;
  externalOperationReference: string;
  correlationId: string;
  providerReferenceType: ExternalOperationReferenceType;
  providerReferenceValue: string;
  providerReferenceNamespace: string;
  providerStatus: string;
  amountMinor: string;
  currency: 'NGN';
  occurredAt: Date;
}

@Injectable()
export class PartnerCallbackIngestionService {
  constructor(
    @InjectRepository(ExternalCallbackReceipt)
    private readonly receiptRepository: Repository<ExternalCallbackReceipt>,
    private readonly dataSource: DataSource,
    private readonly authenticationService: PartnerCallbackAuthenticationService,
    private readonly idempotencyService: IdempotencyService,
    private readonly externalOperationService: ExternalOperationService,
    private readonly auditService: AuditService,
  ) {}

  async ingest(
    headers: PartnerCallbackHeadersV1,
    payload: unknown,
  ): Promise<ExternalCallbackIngestionResult> {
    const verified = this.authenticationService.authenticate(headers, payload);
    const normalized = this.normalizePayload(verified);
    return this.dataSource.transaction('SERIALIZABLE', (manager) =>
      this.ingestWithinTransaction(manager, verified, normalized),
    );
  }

  private async ingestWithinTransaction(
    manager: EntityManager,
    verified: VerifiedPartnerCallbackV1,
    callback: NormalizedCallback,
  ): Promise<ExternalCallbackIngestionResult> {
    const idempotencyKey = `NIBSS_NIP:${callback.callbackEventId}`;
    const reservation = await this.idempotencyService.reserve(manager, {
      scope: EXTERNAL_CALLBACK_IDEMPOTENCY_SCOPE,
      key: idempotencyKey,
      requestHash: verified.payloadHash,
      retentionSeconds: IDEMPOTENCY_RETENTION_SECONDS,
    });

    if (reservation.kind === 'IN_PROGRESS') {
      throw new PartnerCallbackRejectedException(
        'CALLBACK_IDEMPOTENCY_CONFLICT',
        'The callback event is already being processed',
      );
    }
    if (reservation.kind === 'REPLAY') {
      const receiptId = reservation.record.resourceId;
      if (!receiptId) {
        throw new PartnerCallbackRejectedException(
          'CALLBACK_EVIDENCE_UNAVAILABLE',
          'The callback replay receipt is incomplete',
        );
      }
      const receipt = await manager.getRepository(ExternalCallbackReceipt).findOne({
        where: { id: receiptId },
      });
      if (!receipt) {
        throw new PartnerCallbackRejectedException(
          'CALLBACK_EVIDENCE_UNAVAILABLE',
          'The callback replay receipt could not be found',
        );
      }
      return this.toResult(receipt, true);
    }

    const existingReceipt = await manager.getRepository(ExternalCallbackReceipt).findOne({
      where: {
        partnerKey: 'NIBSS_NIP',
        callbackEventId: callback.callbackEventId,
      },
    });
    if (existingReceipt) {
      if (existingReceipt.payloadHash !== verified.payloadHash) {
        throw new PartnerCallbackRejectedException(
          'CALLBACK_IDEMPOTENCY_CONFLICT',
          'The callback event ID was reused with a different payload',
        );
      }
      const replayed = this.toResult(existingReceipt, true);
      await this.completeIdempotency(manager, reservation.record.id, replayed, existingReceipt.id);
      return replayed;
    }

    let operation;
    try {
      operation = await this.externalOperationService.getInTransaction(
        manager,
        callback.externalOperationId,
      );
    } catch {
      return this.rejectWithinTransaction(
        manager,
        reservation.record.id,
        verified,
        callback,
        'UNKNOWN_PROVIDER_REFERENCE',
        null,
      );
    }

    if (operation.externalOperationReference !== callback.externalOperationReference) {
      return this.rejectWithinTransaction(
        manager,
        reservation.record.id,
        verified,
        callback,
        'EXTERNAL_OPERATION_REFERENCE_MISMATCH',
        operation.externalOperationId,
      );
    }
    if (operation.requestContext.correlationId !== callback.correlationId) {
      return this.rejectWithinTransaction(
        manager,
        reservation.record.id,
        verified,
        callback,
        'EXTERNAL_OPERATION_CORRELATION_MISMATCH',
        operation.externalOperationId,
      );
    }
    if (operation.amountMinor !== callback.amountMinor) {
      return this.rejectWithinTransaction(
        manager,
        reservation.record.id,
        verified,
        callback,
        'EXTERNAL_OPERATION_AMOUNT_MISMATCH',
        operation.externalOperationId,
      );
    }
    if (operation.currency !== callback.currency) {
      return this.rejectWithinTransaction(
        manager,
        reservation.record.id,
        verified,
        callback,
        'EXTERNAL_OPERATION_CURRENCY_MISMATCH',
        operation.externalOperationId,
      );
    }

    let reference: RecordProviderReferenceResult;
    try {
      reference = await this.externalOperationService.recordProviderReferenceInTransaction(
        manager,
        {
          externalOperationId: operation.externalOperationId,
          partnerKey: 'NIBSS_NIP',
          referenceType: callback.providerReferenceType,
          referenceValue: callback.providerReferenceValue,
          namespace: callback.providerReferenceNamespace,
          source: ExternalOperationReferenceSource.CALLBACK,
          observedAt: callback.occurredAt.toISOString(),
          requestContext: {
            requestId: callback.callbackEventId,
            correlationId: callback.correlationId,
            traceId: callback.callbackEventId,
          },
        },
      );
    } catch {
      return this.rejectWithinTransaction(
        manager,
        reservation.record.id,
        verified,
        callback,
        'DUPLICATE_CALLBACK',
        operation.externalOperationId,
      );
    }
    if (reference.replayed) {
      return this.rejectWithinTransaction(
        manager,
        reservation.record.id,
        verified,
        callback,
        'DUPLICATE_CALLBACK',
        operation.externalOperationId,
      );
    }

    const receipt = await this.saveReceipt(manager, {
      externalOperationId: operation.externalOperationId,
      callback,
      verified,
      status: ExternalCallbackReceiptStatus.RECEIVED,
      rejectionCode: null,
    });
    const result = this.toResult(receipt, false);
    await this.audit(manager, receipt, result);
    await this.completeIdempotency(manager, reservation.record.id, result, receipt.id);
    return result;
  }

  private async rejectWithinTransaction(
    manager: EntityManager,
    idempotencyRecordId: string,
    verified: VerifiedPartnerCallbackV1,
    callback: NormalizedCallback,
    code: ExternalCallbackRejectionCode,
    externalOperationId: string | null,
  ): Promise<ExternalCallbackIngestionResult> {
    const receipt = await this.saveReceipt(manager, {
      externalOperationId,
      callback,
      verified,
      status: ExternalCallbackReceiptStatus.REJECTED,
      rejectionCode: code,
    });
    const result = this.toResult(receipt, false);
    await this.audit(manager, receipt, result);
    await this.completeIdempotency(manager, idempotencyRecordId, result, receipt.id);
    return result;
  }

  private async saveReceipt(
    manager: EntityManager,
    input: {
      externalOperationId: string | null;
      callback: NormalizedCallback;
      verified: VerifiedPartnerCallbackV1;
      status: ExternalCallbackReceiptStatus;
      rejectionCode: ExternalCallbackRejectionCode | null;
    },
  ): Promise<ExternalCallbackReceipt> {
    const receipt = manager.getRepository(ExternalCallbackReceipt).create({
      id: randomUUID(),
      externalOperationId: input.externalOperationId,
      partnerKey: 'NIBSS_NIP',
      callbackEventId: input.callback.callbackEventId,
      payloadHash: input.verified.payloadHash,
      signatureHash: input.verified.signatureHash,
      providerReferenceType: input.callback.providerReferenceType,
      providerReferenceValue: input.callback.providerReferenceValue,
      providerReferenceNamespace: input.callback.providerReferenceNamespace,
      providerStatus: input.callback.providerStatus,
      providerOccurredAt: input.callback.occurredAt,
      receivedAt: new Date(),
      correlationId: input.callback.correlationId,
      status: input.status,
      rejectionCode: input.rejectionCode,
    });
    return manager.getRepository(ExternalCallbackReceipt).save(receipt);
  }

  private async completeIdempotency(
    manager: EntityManager,
    idempotencyRecordId: string,
    result: ExternalCallbackIngestionResult,
    receiptId: string,
  ): Promise<void> {
    await this.idempotencyService.complete(manager, idempotencyRecordId, {
      statusCode: result.accepted ? 202 : 409,
      responseBody: result as unknown as Record<string, unknown>,
      resourceType: 'EXTERNAL_CALLBACK_RECEIPT',
      resourceId: receiptId,
    });
  }

  private async audit(
    manager: EntityManager,
    receipt: ExternalCallbackReceipt,
    result: ExternalCallbackIngestionResult,
  ): Promise<void> {
    await this.auditService.record(manager, {
      entityType: 'A6_EXTERNAL_CALLBACK',
      entityId: receipt.id,
      action: result.accepted ? 'RECEIVED' : 'REJECTED',
      actor: 'a6-partner-callback',
      correlationId: receipt.correlationId,
      requestId: receipt.callbackEventId,
      newValues: {
        receiptId: receipt.id,
        callbackEventId: receipt.callbackEventId,
        externalOperationId: receipt.externalOperationId,
        payloadHash: receipt.payloadHash,
        signatureHash: receipt.signatureHash,
        providerReferenceType: receipt.providerReferenceType,
        providerReferenceHash: this.sha256(receipt.providerReferenceValue),
        providerReferenceNamespace: receipt.providerReferenceNamespace,
        providerStatus: receipt.providerStatus,
        status: receipt.status,
        rejectionCode: receipt.rejectionCode,
      },
    });
  }

  private normalizePayload(verified: VerifiedPartnerCallbackV1): NormalizedCallback {
    const payload = verified.payload as unknown as Record<string, unknown>;
    if (
      payload.contractName !== EXTERNAL_CALLBACK_CONTRACT_NAME ||
      payload.contractVersion !== EXTERNAL_CALLBACK_CONTRACT_VERSION ||
      payload.partnerKey !== 'NIBSS_NIP'
    ) {
      throw new PartnerCallbackRejectedException(
        'CALLBACK_SCHEMA_UNSUPPORTED',
        'The callback contract is unsupported',
      );
    }
    if (payload.callbackEventId !== verified.callbackEventId) {
      throw new PartnerCallbackRejectedException(
        'CALLBACK_MALFORMED',
        'The callback event ID is inconsistent',
      );
    }
    const externalOperationId = this.uuidValue(payload.externalOperationId, 'externalOperationId');
    const externalOperationReference = this.textValue(
      payload.externalOperationReference,
      'externalOperationReference',
    );
    if (!EXTERNAL_OPERATION_REFERENCE_PATTERN.test(externalOperationReference)) {
      throw new PartnerCallbackRejectedException(
        'CALLBACK_MALFORMED',
        'The external operation reference is invalid',
      );
    }
    const correlationId = this.textValue(payload.correlationId, 'correlationId');
    const providerReference = this.recordValue(payload.providerReference, 'providerReference');
    const referenceType = providerReference.referenceType;
    if (
      referenceType !== 'OPERATION' &&
      referenceType !== 'TRANSACTION' &&
      referenceType !== 'SETTLEMENT'
    ) {
      throw new PartnerCallbackRejectedException(
        'CALLBACK_MALFORMED',
        'The callback provider reference type is not supported',
      );
    }
    const normalizedReferenceType =
      referenceType === 'OPERATION'
        ? ExternalOperationReferenceType.OPERATION
        : referenceType === 'TRANSACTION'
          ? ExternalOperationReferenceType.TRANSACTION
          : ExternalOperationReferenceType.SETTLEMENT;
    const amountMinor = this.amountValue(payload.amountMinor);
    let currency: 'NGN';
    try {
      if (normalizeCurrency(this.textValue(payload.currency, 'currency')) !== 'NGN') {
        throw new Error('unsupported currency');
      }
      currency = 'NGN';
    } catch {
      throw new PartnerCallbackRejectedException(
        'CALLBACK_MALFORMED',
        'The callback currency is invalid',
      );
    }
    const occurredAt = this.timestampValue(payload.occurredAt, 'occurredAt');
    return {
      callbackEventId: verified.callbackEventId,
      externalOperationId,
      externalOperationReference,
      correlationId,
      providerReferenceType: normalizedReferenceType,
      providerReferenceValue: this.textValue(providerReference.value, 'providerReference.value'),
      providerReferenceNamespace: this.namespaceValue(providerReference.namespace),
      providerStatus: this.textValue(payload.providerStatus, 'providerStatus', 80),
      amountMinor,
      currency,
      occurredAt,
    };
  }

  private toResult(
    receipt: ExternalCallbackReceipt,
    replayed: boolean,
  ): ExternalCallbackIngestionResult {
    return {
      accepted: receipt.status === ExternalCallbackReceiptStatus.RECEIVED,
      status: receipt.status,
      replayed,
      duplicate: receipt.rejectionCode === 'DUPLICATE_CALLBACK',
      receiptId: receipt.id,
      callbackEventId: receipt.callbackEventId,
      externalOperationId: receipt.externalOperationId,
      correlationId: receipt.correlationId,
      providerReferenceType: receipt.providerReferenceType,
      providerReferenceHash: this.sha256(receipt.providerReferenceValue),
      providerStatus: receipt.providerStatus,
      rejectionCode: receipt.rejectionCode as ExternalCallbackRejectionCode | null,
    };
  }

  private recordValue(value: unknown, field: string): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new PartnerCallbackRejectedException('CALLBACK_MALFORMED', `${field} is invalid`);
    }
    return value as Record<string, unknown>;
  }

  private textValue(value: unknown, field: string, maxLength = 255): string {
    if (typeof value !== 'string') {
      throw new PartnerCallbackRejectedException('CALLBACK_MALFORMED', `${field} is invalid`);
    }
    const normalized = value.trim();
    if (!normalized || normalized.length > maxLength || !SAFE_TEXT_PATTERN.test(normalized)) {
      throw new PartnerCallbackRejectedException('CALLBACK_MALFORMED', `${field} is invalid`);
    }
    return normalized;
  }

  private uuidValue(value: unknown, field: string): string {
    const normalized = this.textValue(value, field).toLowerCase();
    if (!UUID_PATTERN.test(normalized)) {
      throw new PartnerCallbackRejectedException('CALLBACK_MALFORMED', `${field} is invalid`);
    }
    return normalized;
  }

  private amountValue(value: unknown): string {
    try {
      return parsePositiveMinorUnits(this.textValue(value, 'amountMinor')).toString();
    } catch {
      throw new PartnerCallbackRejectedException(
        'CALLBACK_MALFORMED',
        'amountMinor must be a positive integer',
      );
    }
  }

  private timestampValue(value: unknown, field: string): Date {
    const timestamp = new Date(this.textValue(value, field));
    if (Number.isNaN(timestamp.getTime())) {
      throw new PartnerCallbackRejectedException('CALLBACK_MALFORMED', `${field} is invalid`);
    }
    return timestamp;
  }

  private namespaceValue(value: unknown): string {
    const normalized = this.textValue(value, 'providerReference.namespace');
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,119}$/.test(normalized)) {
      throw new PartnerCallbackRejectedException(
        'CALLBACK_MALFORMED',
        'providerReference.namespace is invalid',
      );
    }
    return normalized;
  }

  private sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }
}

export class PartnerCallbackRejectedException extends ConflictException {
  constructor(
    readonly code: ExternalCallbackRejectionCode,
    message: string,
  ) {
    super({ code, message });
  }
}
