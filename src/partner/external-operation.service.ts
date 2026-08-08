import { createHash, randomUUID } from 'node:crypto';

import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, QueryFailedError, Repository } from 'typeorm';

import { normalizeCurrency, parsePositiveMinorUnits } from '../common/money';
import { AuditService } from '../operations/audit.service';
import { IdempotencyService } from '../operations/idempotency.service';
import type { RequestContext } from '../production/request-context';
import { PartnerConnectionService } from './partner-connection.service';
import { ExternalOperation } from './external-operation.entity';
import {
  ExternalOperationReferenceSource,
  ExternalOperationReferenceType,
  ExternalOperationResourceType,
} from './external-operation.enums';
import { ExternalOperationReference } from './external-operation-reference.entity';
import type {
  CreateExternalOperationCommand,
  ExternalOperationAuditContext,
  ExternalOperationReferenceView,
  ExternalOperationView,
  RecordProviderReferenceCommand,
  RecordProviderReferenceResult,
} from './external-operation.types';
import {
  EXTERNAL_OPERATION_CONTRACT_VERSION,
  EXTERNAL_OPERATION_IDEMPOTENCY_SCOPE,
  EXTERNAL_OPERATION_PROVIDER_IDEMPOTENCY_SCOPE,
} from './external-operation.types';
import {
  EXTERNAL_WALLET_WITHDRAWAL_SETTLEMENT_CAPABILITY,
  NIBSS_NIP_PARTNER_KEY,
  OUTBOUND_BANK_SETTLEMENT_OPERATION,
} from './partner-adapter.types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAFE_REFERENCE_PATTERN = /^[\x20-\x7E]+$/;
const TARGET_MAPPING_PATTERN = /^a6-target:[a-f0-9]{64}$/;
const MAX_TEXT_LENGTH = 255;
const IDEMPOTENCY_RETENTION_SECONDS = 86_400;

interface NormalizedCreateExternalOperationCommand
  extends Omit<
    CreateExternalOperationCommand,
    | 'resourceId'
    | 'internalCommandId'
    | 'customerId'
    | 'walletAccountId'
    | 'ledgerAccountId'
    | 'targetMappingReference'
    | 'amountMinor'
    | 'currency'
    | 'idempotencyKey'
    | 'requestContext'
    | 'causationId'
  > {
  resourceId: string;
  internalCommandId: string;
  customerId: string;
  walletAccountId: string;
  ledgerAccountId: string;
  targetMappingReference: string;
  amountMinor: string;
  currency: 'NGN';
  idempotencyKey: string;
  requestContext: RequestContext;
  causationId: string | null;
  requestHash: string;
}

type NormalizedCreateExternalOperationWithoutHash = Omit<
  NormalizedCreateExternalOperationCommand,
  'requestHash'
>;

interface NormalizedRecordProviderReferenceCommand
  extends Omit<
    RecordProviderReferenceCommand,
    'externalOperationId' | 'referenceValue' | 'namespace' | 'observedAt' | 'requestContext'
  > {
  externalOperationId: string;
  referenceValue: string;
  namespace: string;
  observedAt: Date;
  requestContext: RequestContext;
}

@Injectable()
export class ExternalOperationService {
  constructor(
    @InjectRepository(ExternalOperation)
    private readonly operationRepository: Repository<ExternalOperation>,
    @InjectRepository(ExternalOperationReference)
    private readonly referenceRepository: Repository<ExternalOperationReference>,
    private readonly dataSource: DataSource,
    private readonly idempotencyService: IdempotencyService,
    private readonly auditService: AuditService,
    private readonly partnerConnectionService: PartnerConnectionService,
  ) {}

  async create(command: CreateExternalOperationCommand): Promise<ExternalOperationView> {
    const normalized = this.normalizeCreate(command);
    return this.dataSource.transaction('SERIALIZABLE', (manager) =>
      this.createWithinTransaction(manager, normalized),
    );
  }

  async get(externalOperationId: string): Promise<ExternalOperationView> {
    const normalizedId = this.normalizeUuid(externalOperationId, 'externalOperationId');
    const operation = await this.operationRepository.findOne({ where: { id: normalizedId } });
    if (!operation) {
      throw new NotFoundException(`External operation ${normalizedId} was not found`);
    }
    return this.toView(
      operation,
      await this.referenceRepository.find({
        where: { externalOperationId: normalizedId },
        order: { createdAt: 'ASC', id: 'ASC' },
      }),
      false,
    );
  }

  async recordProviderReference(
    command: RecordProviderReferenceCommand,
  ): Promise<RecordProviderReferenceResult> {
    const normalized = this.normalizeProviderReference(command);
    return this.dataSource.transaction('SERIALIZABLE', (manager) =>
      this.recordProviderReferenceWithinTransaction(manager, normalized),
    );
  }

  async getInTransaction(
    manager: EntityManager,
    externalOperationId: string,
  ): Promise<ExternalOperationView> {
    const normalizedId = this.normalizeUuid(externalOperationId, 'externalOperationId');
    const operation = await manager.getRepository(ExternalOperation).findOne({
      where: { id: normalizedId },
    });
    if (!operation) {
      throw new NotFoundException(`External operation ${normalizedId} was not found`);
    }
    return this.toView(operation, await this.referencesFor(manager, normalizedId), false);
  }

  async recordProviderReferenceInTransaction(
    manager: EntityManager,
    command: RecordProviderReferenceCommand,
  ): Promise<RecordProviderReferenceResult> {
    const normalized = this.normalizeProviderReference(command);
    return this.recordProviderReferenceWithinTransaction(manager, normalized);
  }

  private async createWithinTransaction(
    manager: EntityManager,
    command: NormalizedCreateExternalOperationCommand,
  ): Promise<ExternalOperationView> {
    const reservation = await this.idempotencyService.reserve(manager, {
      scope: EXTERNAL_OPERATION_IDEMPOTENCY_SCOPE,
      key: command.idempotencyKey,
      requestHash: command.requestHash,
      retentionSeconds: IDEMPOTENCY_RETENTION_SECONDS,
    });

    if (reservation.kind === 'IN_PROGRESS') {
      throw new ConflictException('The external operation request is already in progress');
    }

    if (reservation.kind === 'REPLAY') {
      const replayed = await this.replayFromReservation(manager, reservation.record.resourceId);
      await this.recordAudit({
        manager,
        action: 'REPLAYED',
        operation: replayed,
        reference: null,
        requestContext: command.requestContext,
      });
      return replayed;
    }

    const existingCommand = await manager.getRepository(ExternalOperation).findOne({
      where: { internalCommandId: command.internalCommandId },
    });
    if (existingCommand) {
      if (existingCommand.requestHash !== command.requestHash) {
        throw new ConflictException(
          'The internal command ID was already used for another operation',
        );
      }
      const replayed = this.toView(
        existingCommand,
        await this.referencesFor(manager, existingCommand.id),
        true,
      );
      await this.idempotencyService.complete(manager, reservation.record.id, {
        statusCode: 200,
        responseBody: replayed as unknown as Record<string, unknown>,
        resourceType: 'EXTERNAL_OPERATION',
        resourceId: existingCommand.id,
      });
      await this.recordAudit({
        manager,
        action: 'REPLAYED',
        operation: replayed,
        reference: null,
        requestContext: command.requestContext,
      });
      return replayed;
    }

    const profile = this.partnerConnectionService.getProfile();
    if (
      profile.partnerKey !== command.partnerKey ||
      profile.capabilityKey !== command.capabilityKey ||
      profile.operationType !== command.operationType
    ) {
      throw new ConflictException(
        'The external operation capability does not match A6 configuration',
      );
    }

    const externalOperationId = randomUUID();
    const providerIdempotencyKey = this.providerIdempotencyKey(externalOperationId);
    const operation = manager.getRepository(ExternalOperation).create({
      id: externalOperationId,
      operationVersion: EXTERNAL_OPERATION_CONTRACT_VERSION,
      partnerKey: command.partnerKey,
      capabilityKey: command.capabilityKey,
      operationType: command.operationType,
      resourceType: command.resourceType,
      resourceId: command.resourceId,
      internalCommandId: command.internalCommandId,
      customerId: command.customerId,
      walletAccountId: command.walletAccountId,
      ledgerAccountId: command.ledgerAccountId,
      targetMappingReference: command.targetMappingReference,
      amountMinor: command.amountMinor,
      currency: command.currency,
      accountingUnit: command.accountingUnit,
      internalIdempotencyScope: EXTERNAL_OPERATION_IDEMPOTENCY_SCOPE,
      internalIdempotencyKey: command.idempotencyKey,
      providerIdempotencyScope: EXTERNAL_OPERATION_PROVIDER_IDEMPOTENCY_SCOPE,
      providerIdempotencyKey,
      requestHash: command.requestHash,
      requestId: command.requestContext.requestId,
      correlationId: command.requestContext.correlationId,
      traceId: command.requestContext.traceId,
      causationId: command.causationId,
      version: 1,
    });
    const savedOperation = await manager.getRepository(ExternalOperation).save(operation);

    const providerReference = await this.saveReference(manager, {
      externalOperationId: savedOperation.id,
      partnerKey: savedOperation.partnerKey as typeof NIBSS_NIP_PARTNER_KEY,
      referenceType: ExternalOperationReferenceType.PROVIDER_IDEMPOTENCY,
      referenceValue: providerIdempotencyKey,
      namespace: EXTERNAL_OPERATION_PROVIDER_IDEMPOTENCY_SCOPE,
      source: ExternalOperationReferenceSource.REQUEST,
      observedAt: new Date(),
    });
    const result = this.toView(savedOperation, [providerReference], false);
    await this.recordAudit({
      manager,
      action: 'CREATED',
      operation: result,
      reference: this.toReferenceView(providerReference, false),
      requestContext: command.requestContext,
    });
    await this.idempotencyService.complete(manager, reservation.record.id, {
      statusCode: 201,
      responseBody: result as unknown as Record<string, unknown>,
      resourceType: 'EXTERNAL_OPERATION',
      resourceId: savedOperation.id,
    });
    return result;
  }

  private async recordProviderReferenceWithinTransaction(
    manager: EntityManager,
    command: NormalizedRecordProviderReferenceCommand,
  ): Promise<RecordProviderReferenceResult> {
    const operation = await manager
      .getRepository(ExternalOperation)
      .createQueryBuilder('operation')
      .where('operation.id = :externalOperationId', {
        externalOperationId: command.externalOperationId,
      })
      .setLock('pessimistic_write')
      .getOne();
    if (!operation) {
      throw new NotFoundException(
        `External operation ${command.externalOperationId} was not found`,
      );
    }
    if (operation.partnerKey !== command.partnerKey) {
      throw new ConflictException('The provider reference partner does not match the operation');
    }

    const existing = await manager.getRepository(ExternalOperationReference).findOne({
      where: {
        partnerKey: command.partnerKey,
        referenceType: command.referenceType,
        referenceValue: command.referenceValue,
      },
    });
    if (existing) {
      if (existing.externalOperationId !== operation.id) {
        throw new ConflictException(
          'The provider reference is already mapped to another operation',
        );
      }
      const replayed = this.toReferenceView(existing, true);
      await this.recordAudit({
        manager,
        action: 'PROVIDER_REFERENCE_RECORDED',
        operation: this.toView(operation, await this.referencesFor(manager, operation.id), true),
        reference: replayed,
        requestContext: command.requestContext,
      });
      return { reference: replayed, replayed: true };
    }

    let saved: ExternalOperationReference;
    try {
      saved = await this.saveReference(manager, command);
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException(
          'The provider reference was concurrently mapped to another operation',
        );
      }
      throw error;
    }
    const reference = this.toReferenceView(saved, false);
    await this.recordAudit({
      manager,
      action: 'PROVIDER_REFERENCE_RECORDED',
      operation: this.toView(operation, await this.referencesFor(manager, operation.id), false),
      reference,
      requestContext: command.requestContext,
    });
    return { reference, replayed: false };
  }

  private async saveReference(
    manager: EntityManager,
    command: Omit<NormalizedRecordProviderReferenceCommand, 'requestContext'>,
  ): Promise<ExternalOperationReference> {
    return manager.getRepository(ExternalOperationReference).save(
      manager.getRepository(ExternalOperationReference).create({
        id: randomUUID(),
        externalOperationId: command.externalOperationId,
        partnerKey: command.partnerKey,
        referenceType: command.referenceType,
        referenceValue: command.referenceValue,
        namespace: command.namespace,
        source: command.source,
        observedAt: command.observedAt,
      }),
    );
  }

  private async replayFromReservation(
    manager: EntityManager,
    resourceId: string | null,
  ): Promise<ExternalOperationView> {
    if (!resourceId || !UUID_PATTERN.test(resourceId)) {
      throw new ConflictException('The idempotent external-operation result is incomplete');
    }
    const operation = await manager.getRepository(ExternalOperation).findOne({
      where: { id: resourceId },
    });
    if (!operation) {
      throw new ConflictException('The idempotent external-operation result could not be found');
    }
    return this.toView(operation, await this.referencesFor(manager, operation.id), true);
  }

  private async referencesFor(
    manager: EntityManager,
    externalOperationId: string,
  ): Promise<ExternalOperationReference[]> {
    return manager.getRepository(ExternalOperationReference).find({
      where: { externalOperationId },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
  }

  private toView(
    operation: ExternalOperation,
    references: ExternalOperationReference[],
    replayed: boolean,
  ): ExternalOperationView {
    return {
      operationVersion: 1,
      externalOperationId: operation.id,
      externalOperationReference: this.externalOperationReference(operation.id),
      partnerKey: operation.partnerKey as typeof NIBSS_NIP_PARTNER_KEY,
      capabilityKey:
        operation.capabilityKey as typeof EXTERNAL_WALLET_WITHDRAWAL_SETTLEMENT_CAPABILITY,
      operationType: operation.operationType as typeof OUTBOUND_BANK_SETTLEMENT_OPERATION,
      resourceType: operation.resourceType,
      resourceId: operation.resourceId,
      internalCommandId: operation.internalCommandId,
      customerId: operation.customerId,
      walletAccountId: operation.walletAccountId,
      ledgerAccountId: operation.ledgerAccountId,
      targetMappingReference: operation.targetMappingReference,
      amountMinor: operation.amountMinor,
      currency: operation.currency,
      accountingUnit: operation.accountingUnit as 'CUSTOMER_FUNDS',
      internalIdempotencyScope: operation.internalIdempotencyScope,
      internalIdempotencyKey: operation.internalIdempotencyKey,
      providerIdempotencyScope: operation.providerIdempotencyScope,
      providerIdempotencyKey: operation.providerIdempotencyKey,
      requestHash: operation.requestHash,
      requestContext: {
        requestId: operation.requestId,
        correlationId: operation.correlationId,
        traceId: operation.traceId ?? operation.requestId,
      },
      causationId: operation.causationId,
      providerReferences: references.map((reference) => this.toReferenceView(reference, false)),
      replayed,
      createdAt: operation.createdAt,
      updatedAt: operation.updatedAt,
      version: operation.version,
    };
  }

  private toReferenceView(
    reference: ExternalOperationReference,
    replayed: boolean,
  ): ExternalOperationReferenceView {
    return {
      id: reference.id,
      externalOperationId: reference.externalOperationId,
      partnerKey: reference.partnerKey as typeof NIBSS_NIP_PARTNER_KEY,
      referenceType: reference.referenceType,
      referenceValue: reference.referenceValue,
      namespace: reference.namespace,
      source: reference.source,
      observedAt: reference.observedAt,
      createdAt: reference.createdAt,
      replayed,
    };
  }

  private normalizeCreate(
    command: CreateExternalOperationCommand,
  ): NormalizedCreateExternalOperationCommand {
    if (
      command.partnerKey !== NIBSS_NIP_PARTNER_KEY ||
      command.capabilityKey !== EXTERNAL_WALLET_WITHDRAWAL_SETTLEMENT_CAPABILITY ||
      command.operationType !== OUTBOUND_BANK_SETTLEMENT_OPERATION ||
      command.resourceType !== ExternalOperationResourceType.WITHDRAWAL
    ) {
      throw new ConflictException('The external operation is outside the selected A6 capability');
    }
    const normalized: NormalizedCreateExternalOperationWithoutHash = {
      ...command,
      resourceId: this.normalizeUuid(command.resourceId, 'resourceId'),
      internalCommandId: this.normalizeUuid(command.internalCommandId, 'internalCommandId'),
      customerId: this.normalizeUuid(command.customerId, 'customerId'),
      walletAccountId: this.normalizeUuid(command.walletAccountId, 'walletAccountId'),
      ledgerAccountId: this.normalizeUuid(command.ledgerAccountId, 'ledgerAccountId'),
      targetMappingReference: this.normalizeTargetMappingReference(command.targetMappingReference),
      amountMinor: parsePositiveMinorUnits(command.amountMinor).toString(),
      currency: this.normalizeNgn(command.currency),
      idempotencyKey: this.normalizeText(command.idempotencyKey, 'idempotencyKey'),
      requestContext: this.normalizeRequestContext(command.requestContext),
      causationId: command.causationId
        ? this.normalizeText(command.causationId, 'causationId')
        : null,
    };
    const requestHash = this.requestHash(normalized);
    return { ...normalized, requestHash };
  }

  private normalizeProviderReference(
    command: RecordProviderReferenceCommand,
  ): NormalizedRecordProviderReferenceCommand {
    if (
      command.partnerKey !== NIBSS_NIP_PARTNER_KEY ||
      !Object.values(ExternalOperationReferenceType).includes(command.referenceType) ||
      !Object.values(ExternalOperationReferenceSource).includes(command.source)
    ) {
      throw new ConflictException('The provider reference contract is invalid');
    }
    return {
      ...command,
      externalOperationId: this.normalizeUuid(command.externalOperationId, 'externalOperationId'),
      referenceValue: this.normalizeProviderValue(command.referenceValue, 'referenceValue'),
      namespace: this.normalizeNamespace(command.namespace),
      observedAt: this.normalizeTimestamp(command.observedAt),
      requestContext: this.normalizeRequestContext(command.requestContext),
    };
  }

  private requestHash(command: NormalizedCreateExternalOperationWithoutHash): string {
    return createHash('sha256')
      .update(
        this.canonicalJson({
          accountingUnit: command.accountingUnit,
          capabilityKey: command.capabilityKey,
          customerId: command.customerId,
          currency: command.currency,
          internalCommandId: command.internalCommandId,
          ledgerAccountId: command.ledgerAccountId,
          operationType: command.operationType,
          partnerKey: command.partnerKey,
          resourceId: command.resourceId,
          resourceType: command.resourceType,
          targetMappingReference: command.targetMappingReference,
          amountMinor: command.amountMinor,
          walletAccountId: command.walletAccountId,
        }),
      )
      .digest('hex');
  }

  private canonicalJson(value: unknown): string {
    if (value === null || typeof value !== 'object') {
      return JSON.stringify(value) ?? 'null';
    }
    if (Array.isArray(value)) {
      return `[${value.map((item) => this.canonicalJson(item)).join(',')}]`;
    }
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${this.canonicalJson(object[key])}`)
      .join(',')}}`;
  }

  private externalOperationReference(externalOperationId: string): string {
    return `external-operation:v${EXTERNAL_OPERATION_CONTRACT_VERSION}:${this.sha256(
      `${NIBSS_NIP_PARTNER_KEY}:${externalOperationId}:external-operation`,
    )}`;
  }

  private providerIdempotencyKey(externalOperationId: string): string {
    return `${EXTERNAL_OPERATION_PROVIDER_IDEMPOTENCY_SCOPE}:${this.sha256(externalOperationId)}`;
  }

  private normalizeTargetMappingReference(value: string): string {
    const normalized = value.trim().toLowerCase();
    if (!TARGET_MAPPING_PATTERN.test(normalized)) {
      throw new ConflictException('targetMappingReference is invalid');
    }
    return normalized;
  }

  private normalizeNgn(value: string): 'NGN' {
    if (normalizeCurrency(value) !== 'NGN') {
      throw new ConflictException('The selected external operation supports NGN only');
    }
    return 'NGN';
  }

  private normalizeUuid(value: string, field: string): string {
    const normalized = value.trim().toLowerCase();
    if (!UUID_PATTERN.test(normalized)) {
      throw new ConflictException(`${field} must be a UUID`);
    }
    return normalized;
  }

  private normalizeText(value: string, field: string): string {
    const normalized = value.trim();
    if (
      !normalized ||
      normalized.length > MAX_TEXT_LENGTH ||
      !SAFE_REFERENCE_PATTERN.test(normalized)
    ) {
      throw new ConflictException(`${field} is invalid`);
    }
    return normalized;
  }

  private normalizeProviderValue(value: string, field: string): string {
    const normalized = value.trim();
    if (
      !normalized ||
      normalized.length > MAX_TEXT_LENGTH ||
      !SAFE_REFERENCE_PATTERN.test(normalized)
    ) {
      throw new ConflictException(`${field} is invalid`);
    }
    return normalized;
  }

  private normalizeNamespace(value: string): string {
    const normalized = this.normalizeText(value, 'namespace');
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,119}$/.test(normalized)) {
      throw new ConflictException('namespace is invalid');
    }
    return normalized;
  }

  private normalizeRequestContext(context: RequestContext): RequestContext {
    return {
      requestId: this.normalizeText(context.requestId, 'requestId'),
      correlationId: this.normalizeText(context.correlationId, 'correlationId'),
      traceId: this.normalizeText(context.traceId, 'traceId'),
    };
  }

  private normalizeTimestamp(value: string | undefined): Date {
    const parsed = new Date(value ?? new Date().toISOString());
    if (Number.isNaN(parsed.getTime())) {
      throw new ConflictException('observedAt is invalid');
    }
    return parsed;
  }

  private sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  private async recordAudit(context: ExternalOperationAuditContext): Promise<void> {
    if (!context.operation) {
      return;
    }
    await this.auditService.record(context.manager, {
      entityType: 'A6_EXTERNAL_OPERATION',
      entityId: context.operation.externalOperationId,
      action: context.action,
      actor: 'a6-external-operation',
      correlationId: context.requestContext.correlationId,
      requestId: context.requestContext.requestId,
      newValues: {
        externalOperationReference: context.operation.externalOperationReference,
        partnerKey: context.operation.partnerKey,
        capabilityKey: context.operation.capabilityKey,
        operationType: context.operation.operationType,
        resourceType: context.operation.resourceType,
        resourceId: context.operation.resourceId,
        internalCommandId: context.operation.internalCommandId,
        customerId: context.operation.customerId,
        walletAccountId: context.operation.walletAccountId,
        ledgerAccountId: context.operation.ledgerAccountId,
        targetMappingReference: context.operation.targetMappingReference,
        amountMinor: context.operation.amountMinor,
        currency: context.operation.currency,
        accountingUnit: context.operation.accountingUnit,
        internalIdempotencyScope: context.operation.internalIdempotencyScope,
        internalIdempotencyKey: context.operation.internalIdempotencyKey,
        providerIdempotencyScope: context.operation.providerIdempotencyScope,
        providerIdempotencyKey: context.operation.providerIdempotencyKey,
        requestHash: context.operation.requestHash,
        ...(context.reference
          ? {
              providerReferenceType: context.reference.referenceType,
              providerReferenceHash: this.sha256(context.reference.referenceValue),
              providerReferenceNamespace: context.reference.namespace,
            }
          : {}),
        ...(context.failureCode ? { failureCode: context.failureCode } : {}),
      },
    });
  }

  private isUniqueViolation(error: unknown): boolean {
    if (!(error instanceof QueryFailedError)) {
      return false;
    }
    const driverError = error.driverError as { code?: string };
    return driverError.code === '23505';
  }
}
