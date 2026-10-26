import { createHash, randomBytes, randomUUID } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, IsNull, QueryFailedError, Repository } from 'typeorm';

import { CustomerAddress } from '../customer/customer-address.entity';
import { AuditService } from '../operations/audit.service';
import type { AuditEventCommand } from '../operations/operations.types';
import {
  CANDIDATE_PROOF_OF_ADDRESS_MIME_TYPES,
  DEFAULT_PROOF_OF_ADDRESS_MAX_UPLOAD_BYTES,
  isCandidateProofType,
} from './customer-proof-of-address.constants';
import {
  PROOF_OF_ADDRESS_CONFIG,
  PROOF_OF_ADDRESS_STORAGE,
  type ProofOfAddressConfiguration,
} from './customer-proof-of-address.config';
import { CustomerProofOfAddressDocumentHistory } from './customer-proof-of-address-document-history.entity';
import { CustomerProofOfAddressSubmission } from './customer-proof-of-address-submission.entity';
import {
  CustomerProofOfAddressDocumentHistoryAction,
  CustomerProofOfAddressDocumentStatus,
  CustomerProofOfAddressReviewStatus,
  CustomerProofOfAddressScannerResult,
} from './customer-proof-of-address.enums';
import type {
  ProofOfAddressActor,
  ProofOfAddressDocumentContent,
  ProofOfAddressDocumentHistoryPage,
  ProofOfAddressDocumentPage,
  ProofOfAddressDocumentView,
  ProofOfAddressRequestAuditContext,
} from './customer-proof-of-address.types';
import { PrivateDocumentEncryptionService } from './private-document-encryption.service';
import { PROOF_OF_ADDRESS_MALWARE_SCANNER } from './customer-proof-of-address.tokens';
import type { ProofOfAddressMalwareScanner } from './clamav-malware-scanner.service';
import { validateProofOfAddressFile } from './proof-of-address-file-validation';
import type { PrivateProofOfAddressStorage } from './proof-of-address-storage.interface';

const ACTIVE_DUPLICATE_STATUSES = [
  CustomerProofOfAddressDocumentStatus.AVAILABLE,
  CustomerProofOfAddressDocumentStatus.QUARANTINED,
  CustomerProofOfAddressDocumentStatus.SUPERSEDED,
];

export interface UploadProofOfAddressCommand {
  fields: {
    residentialAddressId: string;
    category: string;
    documentType: string;
    issuerName?: string;
    documentDate?: string;
    supersedesSubmissionId?: string;
  };
  fileName: string;
  claimedMimeType: string;
  bytes: Buffer;
  idempotencyKey: string;
  actor: ProofOfAddressActor;
  auditContext: ProofOfAddressRequestAuditContext;
}

export interface UploadProofOfAddressResult {
  document: ProofOfAddressDocumentView;
  replayed: boolean;
}

@Injectable()
export class CustomerProofOfAddressService {
  private readonly logger = new Logger(CustomerProofOfAddressService.name);

  constructor(
    @InjectRepository(CustomerProofOfAddressSubmission)
    private readonly submissionRepository: Repository<CustomerProofOfAddressSubmission>,
    @InjectRepository(CustomerProofOfAddressDocumentHistory)
    private readonly historyRepository: Repository<CustomerProofOfAddressDocumentHistory>,
    @InjectRepository(CustomerAddress)
    private readonly addressRepository: Repository<CustomerAddress>,
    private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
    private readonly encryption: PrivateDocumentEncryptionService,
    @Inject(PROOF_OF_ADDRESS_STORAGE)
    private readonly storage: PrivateProofOfAddressStorage,
    @Inject(PROOF_OF_ADDRESS_MALWARE_SCANNER)
    private readonly scanner: ProofOfAddressMalwareScanner,
    @Inject(PROOF_OF_ADDRESS_CONFIG)
    private readonly config: ProofOfAddressConfiguration,
  ) {}

  capabilities() {
    return {
      enabled: this.config.enabled,
      maxUploadBytes: this.config.maxUploadBytes,
      allowedMimeTypes: [...CANDIDATE_PROOF_OF_ADDRESS_MIME_TYPES],
      previewAvailable: this.config.enabled,
      documentaryReviewEnabled: false,
      physicalVerificationEnabled: false,
      tier3OrWalletChangesEnabled: false,
    };
  }

  async listDocuments(
    customerId: string,
    page: number,
    limit: number,
    documentStatus: CustomerProofOfAddressDocumentStatus | undefined,
    actor: ProofOfAddressActor,
    auditContext: ProofOfAddressRequestAuditContext,
  ): Promise<ProofOfAddressDocumentPage> {
    this.ensureEnabled();
    const query = this.submissionRepository
      .createQueryBuilder('document')
      .where('document.customerId = :customerId', { customerId });
    if (documentStatus) {
      query.andWhere('document.documentStatus = :documentStatus', { documentStatus });
    }
    const [rows, total] = await query
      .orderBy('document.createdAt', 'DESC')
      .addOrderBy('document.revisionNumber', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    await this.recordAudit({
      entityType: 'CUSTOMER_PROOF_OF_ADDRESS_COLLECTION',
      entityId: customerId,
      action: 'LISTED',
      actor: actor.principalId,
      correlationId: auditContext.correlationId,
      requestId: auditContext.requestId,
      newValues: { page, limit, returned: rows.length },
    });
    return { items: rows.map((row) => this.toView(row)), page, limit, total };
  }

  async listHistory(
    customerId: string,
    submissionId: string,
    page: number,
    limit: number,
    actor: ProofOfAddressActor,
    auditContext: ProofOfAddressRequestAuditContext,
  ): Promise<ProofOfAddressDocumentHistoryPage> {
    this.ensureEnabled();
    const document = await this.findCustomerDocument(customerId, submissionId);
    const [rows, total] = await this.historyRepository.findAndCount({
      where: { customerId, submissionId: document.id },
      order: { createdAt: 'DESC', id: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    await this.recordAudit({
      entityType: 'CUSTOMER_PROOF_OF_ADDRESS',
      entityId: document.id,
      action: 'HISTORY_VIEWED',
      actor: actor.principalId,
      correlationId: auditContext.correlationId,
      requestId: auditContext.requestId,
      newValues: { page, limit, returned: rows.length },
    });
    return {
      items: rows.map((row) => ({
        id: row.id,
        submissionId: row.submissionId,
        action: row.action,
        previousDocumentStatus: row.previousDocumentStatus,
        newDocumentStatus: row.newDocumentStatus,
        actorPrincipalId: row.actorPrincipalId,
        actorRoleKey: row.actorRoleKey,
        reason: row.reason,
        metadata: row.metadata,
        createdAt: row.createdAt,
      })),
      page,
      limit,
      total,
    };
  }

  async upload(
    customerId: string,
    command: UploadProofOfAddressCommand,
  ): Promise<UploadProofOfAddressResult> {
    this.ensureEnabled();
    if (!isCandidateProofType(command.fields.category, command.fields.documentType)) {
      throw new BadRequestException('The selected evidence type is not a configured candidate');
    }
    const validatedFile = validateProofOfAddressFile(
      command.fileName,
      command.claimedMimeType,
      command.bytes,
      this.config.maxUploadBytes || DEFAULT_PROOF_OF_ADDRESS_MAX_UPLOAD_BYTES,
    );
    const idempotencyKey = normalizeIdempotencyKey(command.idempotencyKey);
    const idempotencyKeyHash = createHash('sha256').update(idempotencyKey).digest('hex');
    const checksum = createHash('sha256').update(command.bytes).digest('hex');

    const priorRequest = await this.submissionRepository.findOne({
      where: { customerId, idempotencyKeyHash },
    });
    if (priorRequest) {
      if (!isSameUploadRequest(priorRequest, command, validatedFile, checksum)) {
        throw new ConflictException(
          'The idempotency key was already used for a different Proof of Address request',
        );
      }
      await this.recordAudit({
        entityType: 'CUSTOMER_PROOF_OF_ADDRESS',
        entityId: priorRequest.id,
        action: 'UPLOAD_REPLAYED',
        actor: command.actor.principalId,
        correlationId: command.auditContext.correlationId,
        requestId: command.auditContext.requestId,
        newValues: { documentStatus: priorRequest.documentStatus },
      });
      return { document: this.toView(priorRequest), replayed: true };
    }

    const address = await this.addressRepository.findOne({
      where: {
        id: command.fields.residentialAddressId,
        customerId,
        deletedAt: IsNull(),
      },
    });
    if (!address) throw new NotFoundException('Residential address not found for this customer');

    const scanResult = await this.scanner.scan(command.bytes).catch(() => 'UNAVAILABLE' as const);
    const documentStatus =
      scanResult === 'CLEAN'
        ? CustomerProofOfAddressDocumentStatus.AVAILABLE
        : CustomerProofOfAddressDocumentStatus.QUARANTINED;
    let encrypted: { keyVersion: string; bytes: Buffer };
    try {
      encrypted = await this.encryption.encrypt(command.bytes);
    } catch {
      throw new ServiceUnavailableException('Proof of Address document encryption is unavailable');
    }
    const objectKey = randomBytes(32).toString('hex');
    let objectWriteAttempted = false;

    try {
      const result = await this.dataSource.transaction(async (manager) => {
        // Serialize same-customer content and idempotency attempts without adding a blocking
        // unique digest constraint to the already-applied 0093 schema.
        await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
          `poa-content:${customerId}:${checksum}`,
        ]);
        await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
          `poa-idempotency:${customerId}:${idempotencyKeyHash}`,
        ]);

        const submissions = manager.getRepository(CustomerProofOfAddressSubmission);
        const replay = await submissions.findOne({ where: { customerId, idempotencyKeyHash } });
        if (replay) {
          if (!isSameUploadRequest(replay, command, validatedFile, checksum)) {
            throw new ConflictException(
              'The idempotency key was already used for a different Proof of Address request',
            );
          }
          return { row: replay, replayed: true };
        }
        const duplicate = await submissions.findOne({
          where: {
            customerId,
            sha256Checksum: checksum,
            documentStatus: In(ACTIVE_DUPLICATE_STATUSES),
          },
        });
        if (duplicate) {
          throw new ConflictException(
            'An active Proof of Address submission already contains this document',
          );
        }

        let submissionGroupId: string = randomUUID();
        let revisionNumber = 1;
        let supersedesSubmissionId: string | null = null;
        let oldGroup: CustomerProofOfAddressSubmission[] = [];
        if (command.fields.supersedesSubmissionId) {
          const oldRow = await submissions
            .createQueryBuilder('document')
            .setLock('pessimistic_write')
            .where('document.id = :id', { id: command.fields.supersedesSubmissionId })
            .andWhere('document.customerId = :customerId', { customerId })
            .getOne();
          if (!oldRow) throw new NotFoundException('Previous Proof of Address revision not found');
          if (oldRow.residentialAddressId !== address.id) {
            throw new ConflictException(
              'A replacement must remain linked to the same residential address',
            );
          }
          if (
            oldRow.category !== command.fields.category ||
            oldRow.documentType !== command.fields.documentType
          ) {
            throw new ConflictException(
              'A replacement must preserve the original evidence classification',
            );
          }
          if (
            [
              CustomerProofOfAddressDocumentStatus.WITHDRAWN,
              CustomerProofOfAddressDocumentStatus.ARCHIVED,
            ].includes(oldRow.documentStatus)
          ) {
            throw new ConflictException('A withdrawn or archived document cannot be replaced');
          }
          const latest = await submissions.findOne({
            where: { customerId, submissionGroupId: oldRow.submissionGroupId },
            order: { revisionNumber: 'DESC' },
          });
          if (!latest || latest.id !== oldRow.id) {
            throw new ConflictException('A replacement must supersede the latest revision');
          }
          submissionGroupId = oldRow.submissionGroupId;
          revisionNumber = oldRow.revisionNumber + 1;
          supersedesSubmissionId = oldRow.id;
          oldGroup = await submissions.find({
            where: { customerId, submissionGroupId },
          });
        }

        const now = new Date();
        const newRow = submissions.create({
          id: randomUUID(),
          submissionGroupId,
          revisionNumber,
          supersedesSubmissionId,
          customerId,
          residentialAddressId: address.id,
          category: command.fields.category,
          documentType: command.fields.documentType,
          issuerName: command.fields.issuerName ?? null,
          documentDate: command.fields.documentDate ?? null,
          reviewStatus: CustomerProofOfAddressReviewStatus.PENDING,
          storageObjectKey: objectKey,
          originalFileName: validatedFile.originalFileName,
          detectedMimeType: validatedFile.detectedMimeType,
          fileSizeBytes: String(command.bytes.length),
          sha256Checksum: checksum,
          encryptionKeyVersion: encrypted.keyVersion,
          documentStatus,
          scannerResult: scanResult as CustomerProofOfAddressScannerResult,
          scannerCheckedAt: now,
          idempotencyKeyHash,
          createdByPrincipalId: command.actor.principalId,
          createdByRoleKey: command.actor.roleKey,
          uploadedByPrincipalId: command.actor.principalId,
          uploadedAt: now,
          reviewedByPrincipalId: null,
          reviewedAt: null,
          rejectionReason: null,
          withdrawnByPrincipalId: null,
          withdrawnAt: null,
          withdrawalReason: null,
          archivedByPrincipalId: null,
          archivedAt: null,
          archiveReason: null,
        });

        objectWriteAttempted = true;
        try {
          await this.storage.put(objectKey, encrypted.bytes);
        } catch {
          throw new ServiceUnavailableException('Proof of Address private storage is unavailable');
        }
        await submissions.save(newRow);

        const histories = manager.getRepository(CustomerProofOfAddressDocumentHistory);
        await histories.save(
          histories.create({
            submissionId: newRow.id,
            customerId,
            action: CustomerProofOfAddressDocumentHistoryAction.UPLOADED,
            previousDocumentStatus: null,
            newDocumentStatus: documentStatus,
            actorPrincipalId: command.actor.principalId,
            actorRoleKey: command.actor.roleKey,
            reason: null,
            metadata: {
              detectedMimeType: validatedFile.detectedMimeType,
              fileSizeBytes: command.bytes.length,
              revisionNumber,
            },
          }),
        );
        const scanAction =
          scanResult === 'CLEAN'
            ? CustomerProofOfAddressDocumentHistoryAction.SCAN_CLEAN
            : CustomerProofOfAddressDocumentHistoryAction.QUARANTINED;
        await histories.save(
          histories.create({
            submissionId: newRow.id,
            customerId,
            action: scanAction,
            previousDocumentStatus: documentStatus,
            newDocumentStatus: documentStatus,
            actorPrincipalId: 'SYSTEM_CLAMAV',
            actorRoleKey: 'SYSTEM',
            reason: null,
            metadata: { scannerResult: scanResult },
          }),
        );

        if (documentStatus === CustomerProofOfAddressDocumentStatus.AVAILABLE) {
          for (const old of oldGroup) {
            if (old.documentStatus !== CustomerProofOfAddressDocumentStatus.AVAILABLE) continue;
            old.documentStatus = CustomerProofOfAddressDocumentStatus.SUPERSEDED;
            await submissions.save(old);
            await histories.save(
              histories.create({
                submissionId: old.id,
                customerId,
                action: CustomerProofOfAddressDocumentHistoryAction.SUPERSEDED,
                previousDocumentStatus: CustomerProofOfAddressDocumentStatus.AVAILABLE,
                newDocumentStatus: CustomerProofOfAddressDocumentStatus.SUPERSEDED,
                actorPrincipalId: command.actor.principalId,
                actorRoleKey: command.actor.roleKey,
                reason: null,
                metadata: { replacedByRevision: revisionNumber },
              }),
            );
          }
        }

        await this.auditService.record(manager, {
          entityType: 'CUSTOMER_PROOF_OF_ADDRESS',
          entityId: newRow.id,
          action:
            documentStatus === CustomerProofOfAddressDocumentStatus.AVAILABLE
              ? 'DOCUMENT_UPLOADED_AND_SCANNED_CLEAN'
              : 'DOCUMENT_UPLOADED_AND_QUARANTINED',
          actor: command.actor.principalId,
          correlationId: command.auditContext.correlationId,
          requestId: command.auditContext.requestId,
          newValues: {
            documentStatus,
            scannerResult: scanResult,
            detectedMimeType: validatedFile.detectedMimeType,
            fileSizeBytes: command.bytes.length,
            revisionNumber,
          },
        });
        return { row: newRow, replayed: false };
      });

      if (result.replayed) {
        // A concurrent request with the same idempotency token won the transaction. This request
        // has not written an object because the replay branch returns before storage.put.
        return { document: this.toView(result.row), replayed: true };
      }
      return { document: this.toView(result.row), replayed: false };
    } catch (error) {
      if (objectWriteAttempted) {
        await this.storage.remove(objectKey).catch(() => {
          this.logger.error(
            'Failed to remove an unreferenced encrypted PoA object after transaction failure',
          );
        });
      }
      if (isUniqueViolation(error)) {
        const existing = await this.submissionRepository.findOne({
          where: { customerId, idempotencyKeyHash },
        });
        if (existing && isSameUploadRequest(existing, command, validatedFile, checksum)) {
          return { document: this.toView(existing), replayed: true };
        }
        throw new ConflictException('Duplicate Proof of Address submission');
      }
      throw error;
    }
  }

  async getContent(
    customerId: string,
    submissionId: string,
    actor: ProofOfAddressActor,
    auditContext: ProofOfAddressRequestAuditContext,
  ): Promise<ProofOfAddressDocumentContent> {
    this.ensureEnabled();
    const document = await this.findCustomerDocument(customerId, submissionId);
    if (document.documentStatus !== CustomerProofOfAddressDocumentStatus.AVAILABLE) {
      throw new ConflictException('This document is not available for preview or download');
    }
    if (
      !document.storageObjectKey ||
      !document.encryptionKeyVersion ||
      !document.detectedMimeType ||
      !document.sha256Checksum
    ) {
      throw new ServiceUnavailableException('The encrypted document metadata is incomplete');
    }

    try {
      const encryptedBytes = await this.storage.get(document.storageObjectKey);
      const bytes = await this.encryption.decrypt(encryptedBytes, document.encryptionKeyVersion);
      const checksum = createHash('sha256').update(bytes).digest('hex');
      if (
        checksum !== document.sha256Checksum ||
        bytes.length !== Number(document.fileSizeBytes) ||
        !CANDIDATE_PROOF_OF_ADDRESS_MIME_TYPES.includes(
          document.detectedMimeType as (typeof CANDIDATE_PROOF_OF_ADDRESS_MIME_TYPES)[number],
        )
      ) {
        throw new Error('Stored Proof of Address integrity check failed');
      }
      await this.recordAudit({
        entityType: 'CUSTOMER_PROOF_OF_ADDRESS',
        entityId: document.id,
        action: 'DOCUMENT_CONTENT_ACCESSED',
        actor: actor.principalId,
        correlationId: auditContext.correlationId,
        requestId: auditContext.requestId,
        newValues: {
          documentStatus: document.documentStatus,
          detectedMimeType: document.detectedMimeType,
        },
      });
      return {
        bytes,
        mimeType: document.detectedMimeType as ProofOfAddressDocumentContent['mimeType'],
        fileName: document.originalFileName ?? 'proof-of-address-document',
        fileSizeBytes: bytes.length,
      };
    } catch {
      // Do not return storage, decryption, checksum, or key-material details to the caller.
      throw new ServiceUnavailableException(
        'The Proof of Address document is temporarily unavailable',
      );
    }
  }

  async withdraw(
    customerId: string,
    submissionId: string,
    reason: string,
    actor: ProofOfAddressActor,
    auditContext: ProofOfAddressRequestAuditContext,
  ): Promise<ProofOfAddressDocumentView> {
    this.ensureEnabled();
    const safeReason = requireActionReason(reason);
    const updated = await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(CustomerProofOfAddressSubmission);
      const document = await repository
        .createQueryBuilder('document')
        .setLock('pessimistic_write')
        .where('document.id = :submissionId', { submissionId })
        .andWhere('document.customerId = :customerId', { customerId })
        .getOne();
      if (!document) throw new NotFoundException('Proof of Address document not found');
      if (
        [
          CustomerProofOfAddressDocumentStatus.WITHDRAWN,
          CustomerProofOfAddressDocumentStatus.ARCHIVED,
        ].includes(document.documentStatus)
      ) {
        throw new ConflictException('The document is already withdrawn or archived');
      }
      const previousStatus = document.documentStatus;
      const now = new Date();
      document.documentStatus = CustomerProofOfAddressDocumentStatus.WITHDRAWN;
      document.withdrawnByPrincipalId = actor.principalId;
      document.withdrawnAt = now;
      document.withdrawalReason = safeReason;
      await repository.save(document);
      await this.appendHistory(manager, {
        submissionId: document.id,
        customerId,
        action: CustomerProofOfAddressDocumentHistoryAction.WITHDRAWN,
        previousDocumentStatus: previousStatus,
        newDocumentStatus: document.documentStatus,
        actor,
        reason: safeReason,
      });
      await this.auditService.record(manager, {
        entityType: 'CUSTOMER_PROOF_OF_ADDRESS',
        entityId: document.id,
        action: 'DOCUMENT_WITHDRAWN',
        actor: actor.principalId,
        correlationId: auditContext.correlationId,
        requestId: auditContext.requestId,
        previousValues: { documentStatus: previousStatus },
        newValues: { documentStatus: document.documentStatus, reason: safeReason },
      });
      return document;
    });
    return this.toView(updated);
  }

  async archive(
    customerId: string,
    submissionId: string,
    reason: string,
    actor: ProofOfAddressActor,
    auditContext: ProofOfAddressRequestAuditContext,
  ): Promise<ProofOfAddressDocumentView> {
    this.ensureEnabled();
    const safeReason = requireActionReason(reason);
    const updated = await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(CustomerProofOfAddressSubmission);
      const document = await repository
        .createQueryBuilder('document')
        .setLock('pessimistic_write')
        .where('document.id = :submissionId', { submissionId })
        .andWhere('document.customerId = :customerId', { customerId })
        .getOne();
      if (!document) throw new NotFoundException('Proof of Address document not found');
      if (document.documentStatus !== CustomerProofOfAddressDocumentStatus.WITHDRAWN) {
        throw new ConflictException('A document must be withdrawn before it can be archived');
      }
      const previousStatus = document.documentStatus;
      document.documentStatus = CustomerProofOfAddressDocumentStatus.ARCHIVED;
      document.archivedByPrincipalId = actor.principalId;
      document.archivedAt = new Date();
      document.archiveReason = safeReason;
      await repository.save(document);
      await this.appendHistory(manager, {
        submissionId: document.id,
        customerId,
        action: CustomerProofOfAddressDocumentHistoryAction.ARCHIVED,
        previousDocumentStatus: previousStatus,
        newDocumentStatus: document.documentStatus,
        actor,
        reason: safeReason,
      });
      await this.auditService.record(manager, {
        entityType: 'CUSTOMER_PROOF_OF_ADDRESS',
        entityId: document.id,
        action: 'DOCUMENT_ARCHIVED',
        actor: actor.principalId,
        correlationId: auditContext.correlationId,
        requestId: auditContext.requestId,
        previousValues: { documentStatus: previousStatus },
        newValues: { documentStatus: document.documentStatus, reason: safeReason },
      });
      return document;
    });
    return this.toView(updated);
  }

  private ensureEnabled(): void {
    if (!this.config.enabled) {
      throw new ServiceUnavailableException('Proof of Address document management is disabled');
    }
  }

  private async findCustomerDocument(
    customerId: string,
    submissionId: string,
  ): Promise<CustomerProofOfAddressSubmission> {
    const row = await this.submissionRepository.findOne({
      where: { id: submissionId, customerId },
    });
    if (!row) throw new NotFoundException('Proof of Address document not found');
    return row;
  }

  private async appendHistory(
    manager: EntityManager,
    input: {
      submissionId: string;
      customerId: string;
      action: CustomerProofOfAddressDocumentHistoryAction;
      previousDocumentStatus: CustomerProofOfAddressDocumentStatus | null;
      newDocumentStatus: CustomerProofOfAddressDocumentStatus | null;
      actor: ProofOfAddressActor;
      reason?: string | null;
      metadata?: Record<string, unknown>;
    },
  ): Promise<void> {
    const repository = manager.getRepository(CustomerProofOfAddressDocumentHistory);
    await repository.save(
      repository.create({
        submissionId: input.submissionId,
        customerId: input.customerId,
        action: input.action,
        previousDocumentStatus: input.previousDocumentStatus,
        newDocumentStatus: input.newDocumentStatus,
        actorPrincipalId: input.actor.principalId,
        actorRoleKey: input.actor.roleKey,
        reason: input.reason ?? null,
        metadata: input.metadata ?? {},
      }),
    );
  }

  private async recordAudit(command: AuditEventCommand): Promise<void> {
    await this.dataSource.transaction((manager) => this.auditService.record(manager, command));
  }

  private toView(row: CustomerProofOfAddressSubmission): ProofOfAddressDocumentView {
    return {
      id: row.id,
      submissionGroupId: row.submissionGroupId,
      revisionNumber: row.revisionNumber,
      supersedesSubmissionId: row.supersedesSubmissionId,
      customerId: row.customerId,
      residentialAddressId: row.residentialAddressId,
      category: row.category,
      documentType: row.documentType,
      issuerName: row.issuerName,
      documentDate: row.documentDate,
      reviewStatus: row.reviewStatus,
      documentStatus: row.documentStatus,
      scannerResult: row.scannerResult,
      originalFileName: row.originalFileName,
      detectedMimeType: row.detectedMimeType,
      fileSizeBytes: row.fileSizeBytes,
      createdByPrincipalId: row.createdByPrincipalId,
      uploadedByPrincipalId: row.uploadedByPrincipalId,
      uploadedAt: row.uploadedAt,
      withdrawnAt: row.withdrawnAt,
      archivedAt: row.archivedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}

function isSameUploadRequest(
  existing: CustomerProofOfAddressSubmission,
  command: UploadProofOfAddressCommand,
  file: { originalFileName: string; detectedMimeType: string },
  checksum: string,
): boolean {
  return (
    existing.sha256Checksum === checksum &&
    existing.residentialAddressId === command.fields.residentialAddressId &&
    existing.category === command.fields.category &&
    existing.documentType === command.fields.documentType &&
    existing.issuerName === (command.fields.issuerName ?? null) &&
    existing.documentDate === (command.fields.documentDate ?? null) &&
    existing.supersedesSubmissionId === (command.fields.supersedesSubmissionId ?? null) &&
    existing.originalFileName === file.originalFileName &&
    existing.detectedMimeType === file.detectedMimeType
  );
}

function normalizeIdempotencyKey(value: string): string {
  const key = typeof value === 'string' ? value.trim() : '';
  if (!/^[A-Za-z0-9._-]{16,128}$/.test(key)) {
    throw new BadRequestException('A 16–128 character Idempotency-Key header is required');
  }
  return key;
}

function hasControlCharacters(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f;
  });
}

function requireActionReason(value: string): string {
  const reason = typeof value === 'string' ? value.trim() : '';
  if (!reason || reason.length > 1000 || hasControlCharacters(reason)) {
    throw new BadRequestException('A non-empty reason of at most 1000 characters is required');
  }
  return reason;
}

function isUniqueViolation(error: unknown): boolean {
  if (!(error instanceof QueryFailedError)) return false;
  const driverError = error.driverError as { code?: string };
  return driverError.code === '23505';
}
