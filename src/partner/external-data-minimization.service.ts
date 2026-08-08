import { randomUUID } from 'node:crypto';

import { Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';

import {
  REDACTED_VALUE,
  redactRecord,
  redactSensitiveData,
} from '../common/sensitive-data-redaction';
import { AuditService } from '../operations/audit.service';
import type { AuditEventCommand } from '../operations/operations.types';
import { ExternalDataClassificationEntity } from './external-data-classification.entity';
import { ExternalDataClassificationRegistry } from './external-data-classification.registry';
import { ExternalConsentAssertionEntity } from './external-consent-assertion.entity';
import {
  EXTERNAL_CONSENT_APPROVED_JURISDICTIONS,
  EXTERNAL_CONSENT_PURPOSES,
  EXTERNAL_DATA_HANDLING_LEVELS,
  EXTERNAL_DATA_MINIMIZATION_AUDIT_ENTITY_TYPE,
  EXTERNAL_DATA_MINIMIZATION_DEFAULT_RETENTION_DAYS,
  EXTERNAL_DATA_MINIMIZATION_DISCLOSURE_RETENTION_DAYS,
  EXTERNAL_DATA_MINIMIZATION_IDEMPOTENCY_RETENTION_DAYS,
  EXTERNAL_DATA_MINIMIZATION_SUPPORT_TRACE_RETENTION_DAYS,
  EXTERNAL_DATA_MINIMIZATION_MAX_DATASET_LENGTH,
  EXTERNAL_DATA_MINIMIZATION_MAX_FIELD_NAME_LENGTH,
  EXTERNAL_DATA_MINIMIZATION_MAX_KEY_LENGTH,
  EXTERNAL_DATA_MINIMIZATION_MAX_OWNER_LENGTH,
  EXTERNAL_DATA_MINIMIZATION_MAX_REASON_LENGTH,
  EXTERNAL_DATA_MINIMIZATION_MAX_SOURCE_DOMAIN_LENGTH,
  EXTERNAL_DATA_MINIMIZATION_OWNER,
  EXTERNAL_DATA_MINIMIZATION_PARTNER_KEY,
  EXTERNAL_DATA_MINIMIZATION_CAPABILITY_KEY,
  EXTERNAL_DATA_MINIMIZATION_CONTRACT_NAME,
  EXTERNAL_DATA_MINIMIZATION_CONTRACT_VERSION,
  EXTERNAL_SECRET_CATEGORIES,
  EXTERNAL_DISCLOSURE_AUDIENCES,
  EXTERNAL_DATA_MINIMIZATION_AUDIENCE_MAXIMUM_LEVELS,
  ExternalConsentSource,
  ExternalConsentStatus,
  ExternalDataControlAction,
  ExternalDataHandlingLevel,
  ExternalDisclosureAudience,
  ExternalLegalHoldAuthority,
  ExternalLegalHoldScope,
  ExternalLegalHoldStatus,
  ExternalPartnerPayloadRejectionCode,
  ExternalSecretCategory,
} from './external-data-minimization.enums';
import {
  ExternalConsentAssertion,
  ExternalConsentView,
  ExternalDataClassificationEntry,
  ExternalDataClassificationView,
  ExternalDataControlAuditContext,
  ExternalDataMinimizationException,
  ExternalDisclosureView,
  ExternalLegalHoldRecord,
  ExternalLegalHoldView,
  ExternalPartnerPayload,
  ExternalPartnerPayloadValidation,
  ExternalRetentionEntry,
  ExternalRetentionView,
  ExternalSecretClassification,
  ExternalSecretClassificationView,
  ExternalSupportTraceView,
  SECRET_FIELD_NAMES,
} from './external-data-minimization.types';
import { ExternalLegalHoldEntity } from './external-legal-hold.entity';
import { ExternalRetentionClassificationEntity } from './external-retention-classification.entity';
import { ExternalSecretClassificationEntity } from './external-secret-classification.entity';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAFE_TEXT_PATTERN = /^[\x20-\x7E]+$/;

interface NormalizedClassification {
  fieldName: string;
  level: ExternalDataHandlingLevel;
  sourceDomain: string;
  owner: string;
  secretCategory: ExternalSecretCategory | null;
  retentionDays: number;
  holdSupport: boolean;
  audienceMaximums: Readonly<Record<ExternalDisclosureAudience, ExternalDataHandlingLevel>>;
}

interface NormalizedConsent {
  consentId: string;
  customerId: string;
  source: ExternalConsentSource;
  targetId: string;
  targetVersion: number;
  purpose: string;
  jurisdiction: string;
  mandateReference: string;
  mandateVersion: number;
  grantedAt: Date;
  expiresAt: Date;
  grantedBy: string;
  revocable: boolean;
  revokedAt: Date | null;
  status: ExternalConsentStatus;
  recordedAt: Date;
}

interface NormalizedRetention {
  retentionId: string;
  dataset: string;
  level: ExternalDataHandlingLevel;
  owner: string;
  retentionDays: number;
  holdSupport: boolean;
  recordedAt: Date;
}

interface NormalizedLegalHold {
  holdId: string;
  scope: ExternalLegalHoldScope;
  referenceId: string;
  owner: string;
  authority: ExternalLegalHoldAuthority;
  reason: string;
  imposedAt: Date;
  imposedBy: string;
  releasedAt: Date | null;
  releasedBy: string | null;
  notes: string | null;
  status: ExternalLegalHoldStatus;
}

@Injectable()
export class ExternalDataMinimizationService {
  private readonly enabled: boolean;

  constructor(
    @InjectRepository(ExternalDataClassificationEntity)
    private readonly classificationRepository: Repository<ExternalDataClassificationEntity>,
    @InjectRepository(ExternalConsentAssertionEntity)
    private readonly consentRepository: Repository<ExternalConsentAssertionEntity>,
    @InjectRepository(ExternalRetentionClassificationEntity)
    private readonly retentionRepository: Repository<ExternalRetentionClassificationEntity>,
    @InjectRepository(ExternalLegalHoldEntity)
    private readonly legalHoldRepository: Repository<ExternalLegalHoldEntity>,
    @InjectRepository(ExternalSecretClassificationEntity)
    private readonly secretRepository: Repository<ExternalSecretClassificationEntity>,
    private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
    private readonly registry: ExternalDataClassificationRegistry,
    @Optional() private readonly configService?: ConfigService,
  ) {
    this.enabled = this.configService?.get<boolean>('A6_DATA_MINIMIZATION_ENABLED') ?? true;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  contractName(): string {
    return EXTERNAL_DATA_MINIMIZATION_CONTRACT_NAME;
  }

  contractVersion(): number {
    return EXTERNAL_DATA_MINIMIZATION_CONTRACT_VERSION;
  }

  audienceMaximumLevel(audience: ExternalDisclosureAudience): ExternalDataHandlingLevel {
    return EXTERNAL_DATA_MINIMIZATION_AUDIENCE_MAXIMUM_LEVELS[audience];
  }

  // --- Classification ---

  classifyField(entry: ExternalDataClassificationEntry): ExternalDataClassificationView {
    const normalized = this.normalizeClassificationEntry(entry);
    return {
      classificationId: randomUUID(),
      fieldName: normalized.fieldName,
      level: normalized.level,
      sourceDomain: normalized.sourceDomain,
      owner: normalized.owner,
      recordedAt: new Date(),
      classificationRegistryVersion: this.registry.registryVersion(),
    };
  }

  async recordClassification(
    entry: ExternalDataClassificationEntry,
    audit: ExternalDataControlAuditContext = {},
  ): Promise<ExternalDataClassificationView> {
    const view = this.classifyField(entry);
    return this.withTransaction(async (manager) => {
      await manager.getRepository(ExternalDataClassificationEntity).save({
        fieldName: view.fieldName,
        sourceDomain: view.sourceDomain,
        level: view.level,
        owner: view.owner,
        secretCategory: entry.secretCategory,
        retentionDays: entry.retentionDays,
        holdSupport: entry.holdSupport,
        audienceMaximums: { ...entry.audienceMaximums },
      } satisfies Partial<ExternalDataClassificationEntity>);
      await this.recordAudit(manager, {
        entityId: view.classificationId,
        action: ExternalDataControlAction.CLASSIFICATION_RECORDED,
        audit,
        newValues: {
          fieldName: view.fieldName,
          level: view.level,
          sourceDomain: view.sourceDomain,
          owner: view.owner,
          secretCategory: entry.secretCategory ?? null,
          retentionDays: entry.retentionDays,
          holdSupport: entry.holdSupport,
        },
      });
      return view;
    });
  }

  // --- Consent ---

  validateConsent(consent: ExternalConsentAssertion, now: Date = new Date()): void {
    if (!UUID_PATTERN.test(consent.customerId)) {
      throw new ExternalDataMinimizationException(
        'CONSENT_GRANTOR_MISSING',
        'Consent customerId must be a UUID',
      );
    }
    if (!UUID_PATTERN.test(consent.targetId)) {
      throw new ExternalDataMinimizationException(
        'CONSENT_TARGET_STALE',
        'Consent targetId must be a UUID',
      );
    }
    if (!Number.isSafeInteger(consent.targetVersion) || consent.targetVersion < 1) {
      throw new ExternalDataMinimizationException(
        'CONSENT_TARGET_STALE',
        'Consent targetVersion must be a positive integer',
      );
    }
    if (!Number.isSafeInteger(consent.mandateVersion) || consent.mandateVersion < 1) {
      throw new ExternalDataMinimizationException(
        'CONSENT_GRANTOR_MISSING',
        'Consent mandateVersion must be a positive integer',
      );
    }
    if (!EXTERNAL_CONSENT_PURPOSES.has(consent.purpose)) {
      throw new ExternalDataMinimizationException(
        'CONSENT_PURPOSE_MISMATCH',
        `Consent purpose ${consent.purpose} is not in the approved purpose set`,
      );
    }
    if (!EXTERNAL_CONSENT_APPROVED_JURISDICTIONS.has(consent.jurisdiction)) {
      throw new ExternalDataMinimizationException(
        'CONSENT_JURISDICTION_MISMATCH',
        `Consent jurisdiction ${consent.jurisdiction} is not in the approved jurisdiction set`,
      );
    }
    if (consent.grantedBy.trim().length === 0) {
      throw new ExternalDataMinimizationException(
        'CONSENT_GRANTOR_MISSING',
        'Consent grantedBy must be a non-empty principal',
      );
    }
    if (consent.grantedAt.getTime() > now.getTime()) {
      throw new ExternalDataMinimizationException(
        'CONSENT_EXPIRED',
        'Consent grantedAt is in the future',
      );
    }
    if (consent.expiresAt.getTime() <= now.getTime()) {
      throw new ExternalDataMinimizationException(
        'CONSENT_EXPIRED',
        'Consent expiresAt is not in the future',
      );
    }
    if (consent.revokedAt !== null) {
      throw new ExternalDataMinimizationException('CONSENT_REVOKED', 'Consent is revoked');
    }
  }

  async recordConsent(
    consent: ExternalConsentAssertion,
    audit: ExternalDataControlAuditContext = {},
  ): Promise<ExternalConsentView> {
    this.validateConsent(consent);
    const normalized = this.normalizeConsent(consent);
    return this.withTransaction(async (manager) => {
      await manager.getRepository(ExternalConsentAssertionEntity).save({
        customerId: normalized.customerId,
        source: normalized.source,
        targetId: normalized.targetId,
        targetVersion: normalized.targetVersion,
        purpose: normalized.purpose,
        jurisdiction: normalized.jurisdiction,
        mandateReference: normalized.mandateReference,
        mandateVersion: normalized.mandateVersion,
        grantedAt: normalized.grantedAt,
        expiresAt: normalized.expiresAt,
        grantedBy: normalized.grantedBy,
        revocable: normalized.revocable,
        revokedAt: normalized.revokedAt,
        status: normalized.status,
      } satisfies Partial<ExternalConsentAssertionEntity>);
      await this.recordAudit(manager, {
        entityId: normalized.consentId,
        action: ExternalDataControlAction.CONSENT_RECORDED,
        audit,
        newValues: {
          customerId: normalized.customerId,
          source: normalized.source,
          targetId: normalized.targetId,
          targetVersion: normalized.targetVersion,
          purpose: normalized.purpose,
          jurisdiction: normalized.jurisdiction,
          mandateVersion: normalized.mandateVersion,
          status: normalized.status,
        },
      });
      return this.toConsentView(normalized);
    });
  }

  async revokeConsent(
    consentId: string,
    revokedAt: Date = new Date(),
    audit: ExternalDataControlAuditContext = {},
  ): Promise<ExternalConsentView> {
    const id = this.normalizeUuid(consentId, 'consentId');
    return this.withTransaction(async (manager) => {
      const repository = manager.getRepository(ExternalConsentAssertionEntity);
      const existing = await repository.findOne({ where: { id } });
      if (!existing) {
        throw new ExternalDataMinimizationException(
          'CLASSIFICATION_NOT_REGISTERED',
          `Consent ${id} was not found`,
        );
      }
      if (existing.revokedAt !== null) {
        throw new ExternalDataMinimizationException(
          'CONSENT_REVOKED',
          `Consent ${id} is already revoked`,
        );
      }
      existing.revokedAt = revokedAt;
      existing.status = ExternalConsentStatus.REVOKED;
      existing.updatedAt = revokedAt;
      await repository.save(existing);
      await this.recordAudit(manager, {
        entityId: id,
        action: ExternalDataControlAction.CONSENT_REVOKED,
        audit,
        newValues: {
          revokedAt: revokedAt.toISOString(),
          status: ExternalConsentStatus.REVOKED,
        },
      });
      return this.toConsentView(this.normalizeConsentFromEntity(existing, id));
    });
  }

  // --- Retention ---

  classifyRetention(entry: ExternalRetentionEntry): ExternalRetentionView {
    const normalized = this.normalizeRetentionEntry(entry);
    return {
      retentionId: randomUUID(),
      dataset: normalized.dataset,
      level: normalized.level,
      owner: normalized.owner,
      retentionDays: normalized.retentionDays,
      holdSupport: normalized.holdSupport,
      recordedAt: new Date(),
    };
  }

  async recordRetention(
    entry: ExternalRetentionEntry,
    audit: ExternalDataControlAuditContext = {},
  ): Promise<ExternalRetentionView> {
    const view = this.classifyRetention(entry);
    return this.withTransaction(async (manager) => {
      await manager.getRepository(ExternalRetentionClassificationEntity).save({
        dataset: view.dataset,
        level: view.level,
        owner: view.owner,
        retentionDays: view.retentionDays,
        holdSupport: view.holdSupport,
      } satisfies Partial<ExternalRetentionClassificationEntity>);
      await this.recordAudit(manager, {
        entityId: view.retentionId,
        action: ExternalDataControlAction.RETENTION_RECORDED,
        audit,
        newValues: {
          dataset: view.dataset,
          level: view.level,
          owner: view.owner,
          retentionDays: view.retentionDays,
          holdSupport: view.holdSupport,
        },
      });
      return view;
    });
  }

  // --- Legal hold ---

  async imposeLegalHold(
    record: ExternalLegalHoldRecord,
    audit: ExternalDataControlAuditContext = {},
  ): Promise<ExternalLegalHoldView> {
    const normalized = this.normalizeLegalHold(record);
    return this.withTransaction(async (manager) => {
      const repository = manager.getRepository(ExternalLegalHoldEntity);
      const existing = await repository.findOne({
        where: { scope: normalized.scope, referenceId: normalized.referenceId },
      });
      if (existing && existing.status === ExternalLegalHoldStatus.ACTIVE) {
        throw new ExternalDataMinimizationException(
          'RETENTION_HOLD_ACTIVE',
          `Legal hold for ${normalized.scope}:${normalized.referenceId} is already active`,
        );
      }
      await repository.save({
        scope: normalized.scope,
        referenceId: normalized.referenceId,
        owner: normalized.owner,
        authority: normalized.authority,
        reason: normalized.reason,
        imposedAt: normalized.imposedAt,
        imposedBy: normalized.imposedBy,
        releasedAt: null,
        releasedBy: null,
        notes: normalized.notes,
        status: ExternalLegalHoldStatus.ACTIVE,
      } satisfies Partial<ExternalLegalHoldEntity>);
      await this.recordAudit(manager, {
        entityId: normalized.holdId,
        action: ExternalDataControlAction.HOLD_IMPOSED,
        audit,
        newValues: {
          scope: normalized.scope,
          referenceId: normalized.referenceId,
          owner: normalized.owner,
          authority: normalized.authority,
          reason: normalized.reason,
          imposedAt: normalized.imposedAt.toISOString(),
        },
      });
      return this.toLegalHoldView(normalized);
    });
  }

  async releaseLegalHold(
    holdId: string,
    releasedBy: string,
    audit: ExternalDataControlAuditContext = {},
  ): Promise<ExternalLegalHoldView> {
    const id = this.normalizeUuid(holdId, 'holdId');
    const principal = releasedBy.trim();
    if (principal.length === 0) {
      throw new ExternalDataMinimizationException(
        'HOLD_RELEASED_BY_MISSING',
        'Hold releasedBy must be a non-empty principal',
      );
    }
    return this.withTransaction(async (manager) => {
      const repository = manager.getRepository(ExternalLegalHoldEntity);
      const existing = await repository.findOne({ where: { id } });
      if (!existing) {
        throw new ExternalDataMinimizationException(
          'HOLD_NOT_FOUND',
          `Legal hold ${id} was not found`,
        );
      }
      if (existing.status === ExternalLegalHoldStatus.RELEASED) {
        throw new ExternalDataMinimizationException(
          'HOLD_ALREADY_RELEASED',
          `Legal hold ${id} is already released`,
        );
      }
      const releasedAt = new Date();
      existing.releasedAt = releasedAt;
      existing.releasedBy = principal;
      existing.status = ExternalLegalHoldStatus.RELEASED;
      existing.updatedAt = releasedAt;
      await repository.save(existing);
      await this.recordAudit(manager, {
        entityId: id,
        action: ExternalDataControlAction.HOLD_RELEASED,
        audit,
        newValues: {
          releasedAt: releasedAt.toISOString(),
          releasedBy: principal,
          status: ExternalLegalHoldStatus.RELEASED,
        },
      });
      return this.toLegalHoldView(this.normalizeLegalHoldFromEntity(existing, id));
    });
  }

  async isHeld(scope: ExternalLegalHoldScope, referenceId: string): Promise<boolean> {
    const repository = this.legalHoldRepository;
    const hold = await repository.findOne({
      where: { scope, referenceId, status: ExternalLegalHoldStatus.ACTIVE },
    });
    return hold !== null;
  }

  // --- Secret classification ---

  classifySecret(entry: ExternalSecretClassification): ExternalSecretClassificationView {
    if (entry.reference.trim().length === 0) {
      throw new ExternalDataMinimizationException(
        'SECRET_LEVEL_INVALID',
        'Secret reference must be a non-empty opaque handle',
      );
    }
    if (!EXTERNAL_SECRET_CATEGORIES.has(entry.category)) {
      throw new ExternalDataMinimizationException(
        'SECRET_LEVEL_INVALID',
        `Secret category ${entry.category} is not in the approved secret categories`,
      );
    }
    if (entry.notes !== null && !SAFE_TEXT_PATTERN.test(entry.notes)) {
      throw new ExternalDataMinimizationException(
        'SECRET_LEVEL_INVALID',
        'Secret notes must be printable ASCII when present',
      );
    }
    return {
      classificationId: randomUUID(),
      category: entry.category,
      owner: entry.owner,
      reference: entry.reference,
      notes: entry.notes,
      recordedAt: new Date(),
    };
  }

  async recordSecret(
    entry: ExternalSecretClassification,
    audit: ExternalDataControlAuditContext = {},
  ): Promise<ExternalSecretClassificationView> {
    const view = this.classifySecret(entry);
    return this.withTransaction(async (manager) => {
      await manager.getRepository(ExternalSecretClassificationEntity).save({
        category: view.category,
        owner: view.owner,
        reference: view.reference,
        notes: view.notes,
      } satisfies Partial<ExternalSecretClassificationEntity>);
      await this.recordAudit(manager, {
        entityId: view.classificationId,
        action: ExternalDataControlAction.SECRET_CLASSIFICATION_RECORDED,
        audit,
        newValues: {
          category: view.category,
          owner: view.owner,
          reference: view.reference,
          secretStored: false,
        },
      });
      return view;
    });
  }

  // --- Disclosure ---

  classifyDisclosure(
    fieldName: string,
    level: ExternalDataHandlingLevel,
    audience: ExternalDisclosureAudience,
  ): ExternalDisclosureView {
    if (!EXTERNAL_DATA_HANDLING_LEVELS.has(level)) {
      throw new ExternalDataMinimizationException(
        'CLASSIFICATION_LEVEL_INVALID',
        `Disclosure level ${level} is not an approved level`,
      );
    }
    if (!EXTERNAL_DISCLOSURE_AUDIENCES.has(audience)) {
      throw new ExternalDataMinimizationException(
        'DISCLOSURE_FIELD_NOT_REGISTERED',
        `Audience ${audience} is not an approved audience`,
      );
    }
    const entry = this.registry.tryGet(fieldName);
    if (!entry) {
      throw new ExternalDataMinimizationException(
        'DISCLOSURE_FIELD_NOT_REGISTERED',
        `Disclosure field ${fieldName} is not registered`,
      );
    }
    if (entry.level !== level) {
      throw new ExternalDataMinimizationException(
        'CLASSIFICATION_LEVEL_INVALID',
        `Disclosure level ${level} does not match the registered level ${entry.level} for ${fieldName}`,
      );
    }
    if (
      entry.level === ExternalDataHandlingLevel.HIGHLY_RESTRICTED &&
      audience !== ExternalDisclosureAudience.SECURITY
    ) {
      throw new ExternalDataMinimizationException(
        'DISCLOSURE_REJECTED_HIGHLY_RESTRICTED',
        `HIGHLY_RESTRICTED field ${fieldName} cannot be disclosed to audience ${audience}`,
      );
    }
    const audienceMaximum = this.audienceMaximumLevel(audience);
    if (this.compareLevel(entry.level, audienceMaximum) > 0) {
      throw new ExternalDataMinimizationException(
        'DISCLOSURE_AUDIENCE_TOO_LOW',
        `Audience ${audience} cannot receive ${entry.level} field ${fieldName}`,
      );
    }
    return {
      viewId: randomUUID(),
      externalOperationId: '',
      audience,
      fields: { [fieldName]: entry.level },
      maskedFields: [],
      generatedAt: new Date(),
    };
  }

  async projectDisclosure(
    view: ExternalDisclosureView,
    audience: ExternalDisclosureAudience,
    audit: ExternalDataControlAuditContext = {},
  ): Promise<ExternalDisclosureView> {
    if (!EXTERNAL_DISCLOSURE_AUDIENCES.has(audience)) {
      throw new ExternalDataMinimizationException(
        'DISCLOSURE_AUDIENCE_TOO_LOW',
        `Audience ${audience} is not an approved audience`,
      );
    }
    const audienceMaximum = this.audienceMaximumLevel(audience);
    const projected: Record<string, unknown> = {};
    const maskedFields: string[] = [];
    for (const [fieldName, rawValue] of Object.entries(view.fields)) {
      const entry = this.registry.tryGet(fieldName);
      if (!entry) {
        throw new ExternalDataMinimizationException(
          'DISCLOSURE_FIELD_NOT_REGISTERED',
          `Disclosure field ${fieldName} is not registered`,
        );
      }
      if (
        entry.level === ExternalDataHandlingLevel.HIGHLY_RESTRICTED &&
        audience !== ExternalDisclosureAudience.SECURITY
      ) {
        throw new ExternalDataMinimizationException(
          'DISCLOSURE_REJECTED_HIGHLY_RESTRICTED',
          `HIGHLY_RESTRICTED field ${fieldName} cannot be disclosed to audience ${audience}`,
        );
      }
      if (this.compareLevel(entry.level, audienceMaximum) > 0) {
        maskedFields.push(fieldName);
        projected[fieldName] = this.maskForLevel(entry.level, audience);
        continue;
      }
      projected[fieldName] = rawValue;
    }
    const projection: ExternalDisclosureView = {
      viewId: randomUUID(),
      externalOperationId: view.externalOperationId,
      audience,
      fields: projected,
      maskedFields,
      generatedAt: new Date(),
    };
    return this.withTransaction(async (manager) => {
      await this.recordAudit(manager, {
        entityId: projection.viewId,
        action: ExternalDataControlAction.DISCLOSED,
        audit,
        newValues: {
          externalOperationId: projection.externalOperationId,
          audience,
          fieldCount: Object.keys(projection.fields).length,
          maskedFieldCount: maskedFields.length,
        },
      });
      return projection;
    });
  }

  buildSupportTrace(
    externalOperationId: string,
    audience: ExternalDisclosureAudience,
    trace: Readonly<Record<string, unknown>>,
  ): ExternalSupportTraceView {
    const maskedFields: string[] = [];
    const projected: Record<string, unknown> = {};
    const audienceMaximum = this.audienceMaximumLevel(audience);
    for (const [fieldName, value] of Object.entries(trace)) {
      if (this.containsSecretFieldName(fieldName)) {
        throw new ExternalDataMinimizationException(
          'SECRET_IN_SUPPORT_TRACE',
          `Support trace contains secret field name ${fieldName}`,
        );
      }
      const entry = this.registry.tryGet(fieldName);
      if (!entry) {
        maskedFields.push(fieldName);
        projected[fieldName] = REDACTED_VALUE;
        continue;
      }
      if (this.compareLevel(entry.level, audienceMaximum) > 0) {
        maskedFields.push(fieldName);
        projected[fieldName] = this.maskForLevel(entry.level, audience);
        continue;
      }
      if (
        entry.level === ExternalDataHandlingLevel.HIGHLY_RESTRICTED &&
        audience !== ExternalDisclosureAudience.SECURITY
      ) {
        throw new ExternalDataMinimizationException(
          'SECRET_IN_SUPPORT_TRACE',
          `Support trace contains HIGHLY_RESTRICTED field ${fieldName}`,
        );
      }
      projected[fieldName] = redactSensitiveData(value);
    }
    const normalizedId = this.normalizeUuid(externalOperationId, 'externalOperationId');
    const view: ExternalSupportTraceView = {
      traceId: randomUUID(),
      externalOperationId: normalizedId,
      audience,
      trace: projected,
      maskedFields,
      generatedAt: new Date(),
    };
    return view;
  }

  async recordSupportTrace(
    view: ExternalSupportTraceView,
    audit: ExternalDataControlAuditContext = {},
  ): Promise<ExternalSupportTraceView> {
    return this.withTransaction(async (manager) => {
      await this.recordAudit(manager, {
        entityId: view.traceId,
        action: ExternalDataControlAction.SUPPORT_TRACE_BUILT,
        audit,
        newValues: {
          externalOperationId: view.externalOperationId,
          audience: view.audience,
          fieldCount: Object.keys(view.trace).length,
          maskedFieldCount: view.maskedFields.length,
        },
      });
      return view;
    });
  }

  // --- Partner payload validation ---

  validatePartnerPayload(payload: ExternalPartnerPayload): ExternalPartnerPayloadValidation {
    const rejected: { field: string; reason: string }[] = [];
    const missing: string[] = [];
    const recommended: string[] = [];
    if (payload.partnerKey !== EXTERNAL_DATA_MINIMIZATION_PARTNER_KEY) {
      rejected.push({
        field: 'partnerKey',
        reason: ExternalPartnerPayloadRejectionCode.UNKNOWN_FIELD,
      });
    }
    if (payload.capabilityKey !== EXTERNAL_DATA_MINIMIZATION_CAPABILITY_KEY) {
      rejected.push({
        field: 'capabilityKey',
        reason: ExternalPartnerPayloadRejectionCode.UNKNOWN_FIELD,
      });
    }
    const recommendedFields = new Set<string>([
      'externalOperationReference',
      'targetMappingReference',
      'amountMinor',
      'currency',
      'accountingUnit',
      'requestId',
      'correlationId',
      'providerIdempotencyKey',
    ]);
    for (const field of recommendedFields) {
      if (!(field in payload.payload)) {
        missing.push(field);
      } else {
        recommended.push(field);
      }
    }
    for (const [field, value] of Object.entries(payload.payload)) {
      if (this.isCustomerIdentityField(field)) {
        rejected.push({
          field,
          reason: ExternalPartnerPayloadRejectionCode.CUSTOMER_IDENTITY_PRESENT,
        });
        continue;
      }
      if (this.isWalletIdentityField(field)) {
        rejected.push({
          field,
          reason: ExternalPartnerPayloadRejectionCode.WALLET_IDENTITY_PRESENT,
        });
        continue;
      }
      if (this.isLedgerIdentityField(field)) {
        rejected.push({
          field,
          reason: ExternalPartnerPayloadRejectionCode.LEDGER_IDENTITY_PRESENT,
        });
        continue;
      }
      if (this.isJournalIdentityField(field)) {
        rejected.push({
          field,
          reason: ExternalPartnerPayloadRejectionCode.JOURNAL_IDENTITY_PRESENT,
        });
        continue;
      }
      if (this.containsRawRiskNarrative(field, value)) {
        rejected.push({
          field,
          reason: ExternalPartnerPayloadRejectionCode.RAW_RISK_NARRATIVE,
        });
        continue;
      }
      if (this.containsRawComplianceNote(field, value)) {
        rejected.push({
          field,
          reason: ExternalPartnerPayloadRejectionCode.RAW_COMPLIANCE_NOTE,
        });
        continue;
      }
      if (this.containsRawDeviceFingerprint(field, value)) {
        rejected.push({
          field,
          reason: ExternalPartnerPayloadRejectionCode.RAW_DEVICE_FINGERPRINT,
        });
        continue;
      }
      if (this.containsRawCallbackMaterial(value)) {
        rejected.push({
          field,
          reason: ExternalPartnerPayloadRejectionCode.RAW_CALLBACK_SECRET,
        });
        continue;
      }
      if (this.containsSecretFieldName(field)) {
        rejected.push({
          field,
          reason: ExternalPartnerPayloadRejectionCode.RAW_SECRET_PRESENT,
        });
        continue;
      }
      if (this.containsSecretValue(value)) {
        rejected.push({
          field,
          reason: ExternalPartnerPayloadRejectionCode.RAW_SECRET_PRESENT,
        });
      }
    }
    return {
      valid: rejected.length === 0,
      rejectedFields: rejected,
      missingFields: missing,
      recommendedFields: recommended,
      auditRecorded: false,
    };
  }

  async validateAndAuditPartnerPayload(
    payload: ExternalPartnerPayload,
    audit: ExternalDataControlAuditContext = {},
  ): Promise<ExternalPartnerPayloadValidation> {
    const validation = this.validatePartnerPayload(payload);
    if (!validation.valid) {
      return this.withTransaction(async (manager) => {
        await this.recordAudit(manager, {
          entityId: payload.partnerKey,
          action: ExternalDataControlAction.PARTNER_PAYLOAD_REJECTED,
          audit,
          newValues: {
            partnerKey: payload.partnerKey,
            capabilityKey: payload.capabilityKey,
            rejectedFieldCount: validation.rejectedFields.length,
            missingFieldCount: validation.missingFields.length,
            auditRecorded: true,
          },
        });
        return { ...validation, auditRecorded: true };
      });
    }
    return validation;
  }

  // --- Helpers ---

  private compareLevel(left: ExternalDataHandlingLevel, right: ExternalDataHandlingLevel): number {
    const order: ExternalDataHandlingLevel[] = [
      ExternalDataHandlingLevel.PUBLIC,
      ExternalDataHandlingLevel.INTERNAL,
      ExternalDataHandlingLevel.CONFIDENTIAL,
      ExternalDataHandlingLevel.RESTRICTED,
      ExternalDataHandlingLevel.HIGHLY_RESTRICTED,
    ];
    return order.indexOf(left) - order.indexOf(right);
  }

  private maskForLevel(
    level: ExternalDataHandlingLevel,
    audience: ExternalDisclosureAudience,
  ): string {
    if (level === ExternalDataHandlingLevel.HIGHLY_RESTRICTED) {
      return `[HIGHLY_RESTRICTED:${audience}]`;
    }
    if (level === ExternalDataHandlingLevel.RESTRICTED) {
      return `[RESTRICTED:${audience}]`;
    }
    return REDACTED_VALUE;
  }

  private normalizeClassificationEntry(
    entry: ExternalDataClassificationEntry,
  ): NormalizedClassification {
    if (!EXTERNAL_DATA_HANDLING_LEVELS.has(entry.level)) {
      throw new ExternalDataMinimizationException(
        'CLASSIFICATION_LEVEL_INVALID',
        `Level ${entry.level} is not an approved level`,
      );
    }
    const fieldName = this.normalizeText(
      entry.fieldName,
      'fieldName',
      EXTERNAL_DATA_MINIMIZATION_MAX_FIELD_NAME_LENGTH,
    );
    const sourceDomain = this.normalizeText(
      entry.sourceDomain,
      'sourceDomain',
      EXTERNAL_DATA_MINIMIZATION_MAX_SOURCE_DOMAIN_LENGTH,
    );
    const owner = this.normalizeText(
      entry.owner,
      'owner',
      EXTERNAL_DATA_MINIMIZATION_MAX_OWNER_LENGTH,
    );
    return {
      fieldName,
      level: entry.level,
      sourceDomain,
      owner,
      secretCategory: entry.secretCategory,
      retentionDays: entry.retentionDays,
      holdSupport: entry.holdSupport,
      audienceMaximums: entry.audienceMaximums,
    };
  }

  private normalizeConsent(consent: ExternalConsentAssertion): NormalizedConsent {
    return this.normalizeConsentFromEntity(consent, randomUUID());
  }

  private normalizeConsentFromEntity(
    consent: ExternalConsentAssertion,
    consentId: string,
  ): NormalizedConsent {
    return {
      consentId,
      customerId: this.normalizeUuid(consent.customerId, 'customerId'),
      source: consent.source,
      targetId: this.normalizeUuid(consent.targetId, 'targetId'),
      targetVersion: consent.targetVersion,
      purpose: this.normalizeText(consent.purpose, 'purpose', 80),
      jurisdiction: this.normalizeText(consent.jurisdiction, 'jurisdiction', 2),
      mandateReference: this.normalizeText(
        consent.mandateReference,
        'mandateReference',
        EXTERNAL_DATA_MINIMIZATION_MAX_OWNER_LENGTH,
      ),
      mandateVersion: consent.mandateVersion,
      grantedAt: consent.grantedAt,
      expiresAt: consent.expiresAt,
      grantedBy: this.normalizeText(
        consent.grantedBy,
        'grantedBy',
        EXTERNAL_DATA_MINIMIZATION_MAX_OWNER_LENGTH,
      ),
      revocable: consent.revocable,
      revokedAt: consent.revokedAt,
      status:
        consent.revokedAt === null ? ExternalConsentStatus.ACTIVE : ExternalConsentStatus.REVOKED,
      recordedAt: new Date(),
    };
  }

  private normalizeRetentionEntry(entry: ExternalRetentionEntry): NormalizedRetention {
    if (!EXTERNAL_DATA_HANDLING_LEVELS.has(entry.level)) {
      throw new ExternalDataMinimizationException(
        'CLASSIFICATION_LEVEL_INVALID',
        `Retention level ${entry.level} is not an approved level`,
      );
    }
    if (entry.level === ExternalDataHandlingLevel.HIGHLY_RESTRICTED && entry.retentionDays < 365) {
      throw new ExternalDataMinimizationException(
        'RETENTION_BELOW_FLOOR',
        'HIGHLY_RESTRICTED retention must be >= 365 days',
      );
    }
    if (
      entry.level !== ExternalDataHandlingLevel.RESTRICTED &&
      entry.level !== ExternalDataHandlingLevel.HIGHLY_RESTRICTED &&
      !entry.holdSupport
    ) {
      throw new ExternalDataMinimizationException(
        'RETENTION_MISSING',
        'Non-RESTRICTED retention must declare holdSupport',
      );
    }
    if (entry.retentionDays < 0) {
      throw new ExternalDataMinimizationException(
        'RETENTION_BELOW_FLOOR',
        'Retention days must be >= 0',
      );
    }
    return {
      retentionId: randomUUID(),
      dataset: this.normalizeText(
        entry.dataset,
        'dataset',
        EXTERNAL_DATA_MINIMIZATION_MAX_DATASET_LENGTH,
      ),
      level: entry.level,
      owner: this.normalizeText(entry.owner, 'owner', EXTERNAL_DATA_MINIMIZATION_MAX_OWNER_LENGTH),
      retentionDays: entry.retentionDays,
      holdSupport: entry.holdSupport,
      recordedAt: new Date(),
    };
  }

  private normalizeLegalHold(record: ExternalLegalHoldRecord): NormalizedLegalHold {
    return this.normalizeLegalHoldFromEntity(record, randomUUID());
  }

  private normalizeLegalHoldFromEntity(
    record: ExternalLegalHoldRecord,
    holdId: string,
  ): NormalizedLegalHold {
    if (record.authority.trim().length === 0) {
      throw new ExternalDataMinimizationException(
        'HOLD_AUTHORITY_MISSING',
        'Legal hold authority must be a non-empty value',
      );
    }
    if (record.owner.trim().length === 0) {
      throw new ExternalDataMinimizationException(
        'HOLD_AUTHORITY_MISSING',
        'Legal hold owner must be a non-empty value',
      );
    }
    return {
      holdId,
      scope: record.scope,
      referenceId: this.normalizeUuid(record.referenceId, 'referenceId'),
      owner: this.normalizeText(record.owner, 'owner', EXTERNAL_DATA_MINIMIZATION_MAX_OWNER_LENGTH),
      authority: record.authority,
      reason: this.normalizeText(
        record.reason,
        'reason',
        EXTERNAL_DATA_MINIMIZATION_MAX_REASON_LENGTH,
      ),
      imposedAt: record.imposedAt,
      imposedBy: this.normalizeText(
        record.imposedBy,
        'imposedBy',
        EXTERNAL_DATA_MINIMIZATION_MAX_OWNER_LENGTH,
      ),
      releasedAt: record.releasedAt,
      releasedBy: record.releasedBy,
      notes: record.notes,
      status:
        record.releasedAt === null
          ? ExternalLegalHoldStatus.ACTIVE
          : ExternalLegalHoldStatus.RELEASED,
    };
  }

  private containsSecretFieldName(name: string): boolean {
    const normalized = name.replace(/[-_]/g, '').toLowerCase();
    if (SECRET_FIELD_NAMES.has(normalized)) return true;
    // Use word-boundary match so 'pin' does not match 'mapping', 'partner' etc.
    // Also handle common short tokens by length floor.
    for (const field of SECRET_FIELD_NAMES) {
      if (field.length < 4) continue;
      if (normalized.includes(field)) return true;
    }
    return false;
  }

  private containsSecretValue(value: unknown): boolean {
    if (typeof value !== 'string') return false;
    const lower = value.toLowerCase();
    if (/(pin|otp|secret|password|token|signature|private_key)=/i.test(lower)) return true;
    if (/^sha256:/i.test(lower)) return true;
    return false;
  }

  private isCustomerIdentityField(field: string): boolean {
    const lower = field.toLowerCase();
    return lower === 'customerid' || lower.endsWith('customerid') || lower === 'customer_id';
  }

  private isWalletIdentityField(field: string): boolean {
    const lower = field.toLowerCase();
    return (
      lower === 'walletaccountid' ||
      lower.endsWith('walletaccountid') ||
      lower.endsWith('customerwalletid')
    );
  }

  private isLedgerIdentityField(field: string): boolean {
    const lower = field.toLowerCase();
    return (
      lower === 'ledgeraccountid' ||
      lower.endsWith('ledgeraccountid') ||
      lower === 'ledger_account_id'
    );
  }

  private isJournalIdentityField(field: string): boolean {
    const lower = field.toLowerCase();
    return (
      lower === 'journalid' || lower.endsWith('journalid') || lower.endsWith('reversaljournalid')
    );
  }

  private containsRawCallbackMaterial(value: unknown): boolean {
    if (typeof value !== 'string') return false;
    const lower = value.toLowerCase();
    return /(callback[_-]?secret|callback[_-]?signature|signature[_-]?hash|raw[_-]?payload)/i.test(
      lower,
    );
  }

  private containsRawRiskNarrative(field: string, value: unknown): boolean {
    if (typeof value !== 'string') return false;
    const lower = field.toLowerCase();
    return (
      lower.includes('risknarrative') || lower.includes('risknote') || lower.includes('riskcomment')
    );
  }

  private containsRawComplianceNote(field: string, value: unknown): boolean {
    if (typeof value !== 'string') return false;
    const lower = field.toLowerCase();
    return (
      lower.includes('compliancenote') ||
      lower.includes('compliancecomment') ||
      lower.includes('casecomment')
    );
  }

  private containsRawDeviceFingerprint(field: string, value: unknown): boolean {
    if (typeof value !== 'string') return false;
    const lower = field.toLowerCase();
    return lower.includes('devicefingerprint') || lower.includes('fingerprintraw');
  }

  private normalizeText(value: string, field: string, maxLength: number): string {
    const normalized = (value ?? '').trim();
    if (
      normalized.length === 0 ||
      normalized.length > maxLength ||
      !SAFE_TEXT_PATTERN.test(normalized)
    ) {
      throw new ExternalDataMinimizationException(
        'CLASSIFICATION_NOT_REGISTERED',
        `${field} is invalid`,
      );
    }
    return normalized;
  }

  private normalizeUuid(value: string, field: string): string {
    const normalized = value.trim().toLowerCase();
    if (!UUID_PATTERN.test(normalized)) {
      throw new ExternalDataMinimizationException(
        'CLASSIFICATION_NOT_REGISTERED',
        `${field} must be a UUID`,
      );
    }
    return normalized;
  }

  private async withTransaction<T>(callback: (manager: EntityManager) => Promise<T>): Promise<T> {
    return this.dataSource.transaction('READ COMMITTED', async (manager) => {
      try {
        return await callback(manager);
      } catch (error) {
        if (error instanceof ExternalDataMinimizationException) {
          throw error;
        }
        throw new ExternalDataMinimizationException(
          'DATA_CONTROL_AUDIT_FAILED',
          error instanceof Error ? error.message : 'Data control transaction failed',
        );
      }
    });
  }

  private async recordAudit(
    manager: EntityManager,
    input: {
      entityId: string;
      action: ExternalDataControlAction;
      audit: ExternalDataControlAuditContext;
      newValues: Record<string, unknown>;
      previousValues?: Record<string, unknown> | null;
    },
  ): Promise<void> {
    const command: AuditEventCommand = {
      entityType: EXTERNAL_DATA_MINIMIZATION_AUDIT_ENTITY_TYPE,
      entityId: input.entityId,
      action: input.action,
      actor: input.audit.actor ?? EXTERNAL_DATA_MINIMIZATION_OWNER,
      correlationId: input.audit.correlationId ?? undefined,
      requestId: input.audit.requestId ?? undefined,
      previousValues: input.previousValues ? redactRecord(input.previousValues) : undefined,
      newValues: redactRecord(input.newValues),
    };
    try {
      await this.auditService.record(manager, command);
    } catch (error) {
      throw new ExternalDataMinimizationException(
        'DATA_CONTROL_AUDIT_FAILED',
        error instanceof Error ? error.message : 'Audit recording failed',
      );
    }
  }

  private toConsentView(normalized: NormalizedConsent): ExternalConsentView {
    return {
      consentId: normalized.consentId,
      customerId: normalized.customerId,
      source: normalized.source,
      targetId: normalized.targetId,
      targetVersion: normalized.targetVersion,
      purpose: normalized.purpose,
      jurisdiction: normalized.jurisdiction,
      mandateReference: normalized.mandateReference,
      mandateVersion: normalized.mandateVersion,
      grantedAt: normalized.grantedAt,
      expiresAt: normalized.expiresAt,
      grantedBy: normalized.grantedBy,
      revocable: normalized.revocable,
      revokedAt: normalized.revokedAt,
      status: normalized.status,
      recordedAt: normalized.recordedAt,
    };
  }

  private toLegalHoldView(normalized: NormalizedLegalHold): ExternalLegalHoldView {
    return {
      holdId: normalized.holdId,
      scope: normalized.scope,
      referenceId: normalized.referenceId,
      owner: normalized.owner,
      authority: normalized.authority,
      reason: normalized.reason,
      imposedAt: normalized.imposedAt,
      imposedBy: normalized.imposedBy,
      releasedAt: normalized.releasedAt,
      releasedBy: normalized.releasedBy,
      notes: normalized.notes,
      status: normalized.status,
    };
  }

  // --- Constants exposure for tests and configuration ---

  static readonly DEFAULT_RETENTION_DAYS = EXTERNAL_DATA_MINIMIZATION_DEFAULT_RETENTION_DAYS;
  static readonly DISCLOSURE_RETENTION_DAYS = EXTERNAL_DATA_MINIMIZATION_DISCLOSURE_RETENTION_DAYS;
  static readonly IDEMPOTENCY_RETENTION_DAYS =
    EXTERNAL_DATA_MINIMIZATION_IDEMPOTENCY_RETENTION_DAYS;
  static readonly SUPPORT_TRACE_RETENTION_DAYS =
    EXTERNAL_DATA_MINIMIZATION_SUPPORT_TRACE_RETENTION_DAYS;
  static readonly MAX_KEY_LENGTH = EXTERNAL_DATA_MINIMIZATION_MAX_KEY_LENGTH;
}
