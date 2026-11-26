import { createHash } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

import {
  CommercialRuleGovernanceService,
  governedChangeConsumptionError,
} from '../authorization/commercial-rule-governance.service';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import {
  CUSTOMER_CLASS_TIER_DEFAULTS_ACTION,
  governedChangeFingerprint,
} from '../authorization/governed-action.registry';
import { PrivilegedActionApprovalService } from '../authorization/privileged-action-approval.service';
import { AuditService } from '../operations/audit.service';
import { CustomerClass } from './customer-class.entity';
import { isUsableCustomerClass } from './customer-class-assignment.service';

export const CUSTOMER_KYC_TIERS = ['LEVEL_1', 'LEVEL_2', 'LEVEL_3'] as const;
export type CustomerKycTier = (typeof CUSTOMER_KYC_TIERS)[number];

export interface TierDefaultClassView {
  tier: CustomerKycTier;
  classId: string | null;
  classCode: string | null;
  className: string | null;
  status: 'PENDING_APPROVAL' | 'APPROVED';
  approvedAt: Date | null;
  approvedBy: string | null;
  approvalId: string | null;
  reason: string | null;
  globalDefaultClassCodeAtMigration: string | null;
  classUsable: boolean;
  version: number;
}

export interface TierDefaultMappingsView {
  mappings: TierDefaultClassView[];
  globalDefault: { classId: string; classCode: string; className: string } | null;
  allApproved: boolean;
  pendingApprovalCount: number;
}

interface MappingRow {
  tier: string;
  class_id: string;
  status: string;
  approved_at: Date | null;
  approved_by: string | null;
  approval_id: string | null;
  reason: string | null;
  global_default_class_code_at_migration: string | null;
  version: number;
  class_code: string | null;
  class_name: string | null;
  class_status: string | null;
  class_enabled: boolean | null;
  class_configuration_status: string | null;
  class_deleted_at: Date | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `audit_events.entity_id` is `UUID NOT NULL`, but this table is keyed by the tier code
 * (`LEVEL_1`..`LEVEL_3`), which is not a UUID. Writing the tier code there fails the insert, so
 * the mapping is approved and the audit write then breaks the surrounding transaction. Derive a
 * stable name-based UUID (RFC 4122 v5 layout over a fixed namespace) from the tier code so every
 * tier always maps to the same audit entity id and the tier itself stays in the payload.
 */
export const TIER_DEFAULT_AUDIT_NAMESPACE = '2f1c1d9e-5b3a-5c7e-9a11-6d4c0b8f7e21';

export function tierDefaultAuditEntityId(tier: string): string {
  const bytes = createHash('sha1')
    .update(Buffer.from(TIER_DEFAULT_AUDIT_NAMESPACE.replace(/-/g, ''), 'hex'))
    .update(tier)
    .digest()
    .subarray(0, 16);
  // Set the version (5) and RFC 4122 variant bits.
  bytes.writeUInt8((bytes.readUInt8(6) & 0x0f) | 0x50, 6);
  bytes.writeUInt8((bytes.readUInt8(8) & 0x3f) | 0x80, 8);
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

@Injectable()
export class CustomerTierDefaultClassService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
    private readonly approvals: PrivilegedActionApprovalService,
    private readonly commercialGovernance: CommercialRuleGovernanceService,
  ) {}

  async list(): Promise<TierDefaultMappingsView> {
    return this.dataSource.transaction((manager) => this.listInManager(manager));
  }

  async listInManager(manager: EntityManager): Promise<TierDefaultMappingsView> {
    const mappings = await this.loadMappings(manager);
    const global = await this.loadGlobalDefault(manager);
    const pendingApprovalCount = mappings.filter((m) => m.status !== 'APPROVED').length;
    return {
      mappings,
      globalDefault: global,
      allApproved: pendingApprovalCount === 0 && mappings.length === 3,
      pendingApprovalCount,
    };
  }

  async propose(
    principal: AuthorizationPrincipal,
    command: { tierDefaults: Record<string, string>; reason: string },
  ) {
    const payload = await this.normalizePayload(command.tierDefaults, command.reason);
    return this.commercialGovernance.requestChange({
      principal,
      action: CUSTOMER_CLASS_TIER_DEFAULTS_ACTION.action,
      resourceId: null,
      payload,
      reason: payload.reason as string,
    });
  }

  async execute(
    principal: AuthorizationPrincipal,
    approvalId: string,
    command: { tierDefaults: Record<string, string>; reason: string },
  ) {
    if (!UUID.test(approvalId?.trim() ?? '')) {
      throw new BadRequestException('approvalId must be a UUID');
    }
    const payload = await this.normalizePayload(command.tierDefaults, command.reason);
    const definition = CUSTOMER_CLASS_TIER_DEFAULTS_ACTION;
    const approval = await this.approvals.getApproval(approvalId);
    if (
      !approval ||
      approval.actionType !== definition.action ||
      approval.resourceType !== definition.resourceType ||
      approval.resourceId !== null
    ) {
      throw new ForbiddenException('Approval does not govern tier default class configuration');
    }
    const fingerprint = governedChangeFingerprint(
      definition.action,
      definition.resourceType,
      null,
      payload,
    );

    return this.dataSource.transaction(async (manager) => {
      const decision = await this.approvals.consumeInTransaction(manager, {
        principal,
        approvalId,
        actionType: definition.action,
        resource: { type: definition.resourceType },
        actionFingerprint: fingerprint,
      });
      if (!decision.approved) {
        if (
          [
            'ROLE_MISSING',
            'FUNCTION_MISSING',
            'PRINCIPAL_TYPE_DENIED',
            'MFA_REQUIRED',
            'SUPER_ADMIN_NOT_ALLOWED',
          ].includes(decision.reason ?? '')
        ) {
          throw new ForbiddenException(
            `Tier default approval execution denied: ${decision.reason}`,
          );
        }
        throw governedChangeConsumptionError(decision.reason, decision.approval?.status);
      }

      const mappings = payload.tierDefaults as Record<CustomerKycTier, string>;
      const actor = principal.principalId;
      const now = new Date();
      await this.lockMappings(manager);
      const saved: TierDefaultClassView[] = [];
      for (const tier of CUSTOMER_KYC_TIERS) {
        const classId = mappings[tier];
        const classRow = await this.lockClass(manager, classId);
        if (!classRow) throw new NotFoundException(`Customer class ${classId} not found`);
        if (!isUsableCustomerClass(classRow)) {
          throw new ConflictException(
            `Customer class ${classRow.code} is not usable for tier ${tier} default`,
          );
        }
        const existing = await manager.query<Array<Record<string, unknown>>>(
          `SELECT * FROM customer_tier_default_classes WHERE tier = $1 FOR UPDATE`,
          [tier],
        );
        if (existing.length === 0) {
          await manager.query(
            `INSERT INTO customer_tier_default_classes
              (tier, class_id, status, approved_at, approved_by, approval_id, reason, created_by, updated_by, version)
             VALUES ($1,$2,'APPROVED',$3,$4,$5,$6,$7,$7,1)`,
            [tier, classId, now, actor, approvalId, payload.reason, actor],
          );
        } else {
          const prev = existing[0] as Record<string, unknown>;
          await manager.query(
            `UPDATE customer_tier_default_classes
                SET class_id=$2, status='APPROVED', approved_at=$3, approved_by=$4, approval_id=$5,
                    reason=$6, updated_by=$7, version=version+1, updated_at=NOW()
              WHERE tier=$1`,
            [tier, classId, now, actor, approvalId, payload.reason, actor],
          );
          await this.auditService.record(manager, {
            entityType: 'CUSTOMER_CLASS_TIER_DEFAULT',
            entityId: tierDefaultAuditEntityId(tier),
            action: 'UPDATED',
            actor,
            previousValues: {
              tier,
              classId: prev.class_id,
              status: prev.status,
              approvalId: prev.approval_id,
              version: prev.version,
            },
            newValues: {
              tier,
              classId,
              status: 'APPROVED',
              approvalId,
              version: Number(prev.version ?? 1) + 1,
            },
          });
        }
        if (existing.length === 0) {
          await this.auditService.record(manager, {
            entityType: 'CUSTOMER_CLASS_TIER_DEFAULT',
            entityId: tierDefaultAuditEntityId(tier),
            action: 'CREATED',
            actor,
            newValues: { tier, classId, status: 'APPROVED', approvalId },
          });
        }
        saved.push({
          tier,
          classId,
          classCode: classRow.code,
          className: classRow.name,
          status: 'APPROVED',
          approvedAt: now,
          approvedBy: actor,
          approvalId,
          reason: payload.reason as string,
          globalDefaultClassCodeAtMigration:
            (existing[0]?.global_default_class_code_at_migration as string | null) ?? null,
          classUsable: true,
          version:
            existing.length === 0
              ? 1
              : Number((existing[0] as Record<string, unknown>).version ?? 1) + 1,
        });
      }

      return {
        mappings: saved,
        approvalId,
        executedAt: now.toISOString(),
      };
    });
  }

  async getApprovedDefaultForTier(
    manager: EntityManager,
    tier: string,
  ): Promise<{
    tier: CustomerKycTier;
    classId: string;
    classCode: string;
    className: string;
  } | null> {
    if (!CUSTOMER_KYC_TIERS.includes(tier as CustomerKycTier)) return null;
    const rows = await manager.query<MappingRow[]>(
      `SELECT m.*, c.code AS class_code, c.name AS class_name, c.status AS class_status,
              c.enabled AS class_enabled, c.configuration_status AS class_configuration_status,
              c.deleted_at AS class_deleted_at
         FROM customer_tier_default_classes m
         JOIN customer_classes c ON c.id = m.class_id
        WHERE m.tier = $1
        FOR UPDATE OF m`,
      [tier],
    );
    const row = rows[0];
    if (!row || row.status !== 'APPROVED') return null;
    const usable = isUsableCustomerClass({
      enabled: Boolean(row.class_enabled),
      status: String(row.class_status ?? ''),
      configurationStatus: String(row.class_configuration_status ?? ''),
      deletedAt: row.class_deleted_at ?? null,
    });
    if (!usable) return null;
    return {
      tier: tier as CustomerKycTier,
      classId: row.class_id,
      classCode: String(row.class_code),
      className: String(row.class_name),
    };
  }

  private async normalizePayload(
    tierDefaults: Record<string, string>,
    reasonRaw: string,
  ): Promise<Record<string, unknown>> {
    if (!tierDefaults || typeof tierDefaults !== 'object' || Array.isArray(tierDefaults)) {
      throw new BadRequestException('tierDefaults must map LEVEL_1, LEVEL_2, LEVEL_3 to class IDs');
    }
    const reason = typeof reasonRaw === 'string' ? reasonRaw.trim() : '';
    if (reason.length < 3 || reason.length > 500) {
      throw new BadRequestException('reason must be 3-500 characters');
    }
    const normalized: Record<string, string> = {};
    for (const tier of CUSTOMER_KYC_TIERS) {
      const value = tierDefaults[tier];
      if (typeof value !== 'string' || !UUID.test(value.trim())) {
        throw new BadRequestException(`tierDefaults.${tier} must be a class UUID`);
      }
      normalized[tier] = value.trim().toLowerCase();
    }
    const extraKeys = Object.keys(tierDefaults).filter(
      (k) => !CUSTOMER_KYC_TIERS.includes(k as CustomerKycTier),
    );
    if (extraKeys.length > 0) {
      throw new BadRequestException(`Unknown tier keys: ${extraKeys.join(', ')}`);
    }

    // Validate classes exist and are usable at proposal time so operators get early feedback.
    // Execution revalidates inside the transaction.
    for (const tier of CUSTOMER_KYC_TIERS) {
      const rows = await this.dataSource.query<Array<Record<string, unknown>>>(
        `SELECT * FROM customer_classes WHERE id = $1 AND deleted_at IS NULL`,
        [normalized[tier]],
      );
      const row = rows[0] as unknown as CustomerClass | undefined;
      if (!row) throw new NotFoundException(`Customer class for ${tier} not found`);
      const cls = this.normalizeClassRow(row);
      if (!isUsableCustomerClass(cls)) {
        throw new ConflictException(`Customer class ${cls.code} is not usable for ${tier} default`);
      }
    }

    return {
      tierDefaults: normalized,
      reason,
    };
  }

  private async loadMappings(manager: EntityManager): Promise<TierDefaultClassView[]> {
    const rows = await manager.query<MappingRow[]>(
      `SELECT m.tier, m.class_id, m.status, m.approved_at, m.approved_by, m.approval_id, m.reason,
              m.global_default_class_code_at_migration, m.version,
              c.code AS class_code, c.name AS class_name, c.status AS class_status,
              c.enabled AS class_enabled, c.configuration_status AS class_configuration_status,
              c.deleted_at AS class_deleted_at
         FROM customer_tier_default_classes m
         LEFT JOIN customer_classes c ON c.id = m.class_id
        ORDER BY CASE m.tier WHEN 'LEVEL_1' THEN 1 WHEN 'LEVEL_2' THEN 2 WHEN 'LEVEL_3' THEN 3 ELSE 9 END`,
    );
    return rows.map((row) => {
      const classUsable = row.class_code
        ? isUsableCustomerClass({
            enabled: Boolean(row.class_enabled),
            status: String(row.class_status ?? ''),
            configurationStatus: String(row.class_configuration_status ?? ''),
            deletedAt: row.class_deleted_at ?? null,
          })
        : false;
      return {
        tier: row.tier as CustomerKycTier,
        classId: row.class_id ?? null,
        classCode: row.class_code ?? null,
        className: row.class_name ?? null,
        status: (row.status as 'PENDING_APPROVAL' | 'APPROVED') ?? 'PENDING_APPROVAL',
        approvedAt: row.approved_at ?? null,
        approvedBy: row.approved_by ?? null,
        approvalId: row.approval_id ?? null,
        reason: row.reason ?? null,
        globalDefaultClassCodeAtMigration: row.global_default_class_code_at_migration ?? null,
        classUsable,
        version: Number(row.version ?? 1),
      };
    });
  }

  private async loadGlobalDefault(
    manager: EntityManager,
  ): Promise<{ classId: string; classCode: string; className: string } | null> {
    const rows = await manager.query<Array<{ id: string; code: string; name: string }>>(
      `SELECT id, code, name FROM customer_classes WHERE is_default = TRUE AND deleted_at IS NULL LIMIT 1`,
    );
    const row = rows[0];
    if (!row) return null;
    return { classId: row.id, classCode: row.code, className: row.name };
  }

  private async lockMappings(manager: EntityManager): Promise<void> {
    await manager.query(
      `SELECT pg_advisory_xact_lock(hashtextextended('customer-tier-default-classes-v1', 0))`,
    );
  }

  private async lockClass(manager: EntityManager, classId: string): Promise<CustomerClass | null> {
    const rows = await manager.query<CustomerClass[]>(
      `SELECT * FROM customer_classes WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
      [classId],
    );
    const row = rows[0];
    return row ? this.normalizeClassRow(row) : null;
  }

  private normalizeClassRow(row: CustomerClass): CustomerClass {
    const raw = row as unknown as Record<string, unknown>;
    if (typeof raw.configuration_status === 'string')
      row.configurationStatus = raw.configuration_status;
    if (typeof raw.is_default === 'boolean') row.isDefault = raw.is_default;
    if (raw.deleted_at !== undefined) row.deletedAt = (raw.deleted_at as Date | null) ?? null;
    if (raw.created_at instanceof Date) row.createdAt = raw.created_at;
    if (raw.updated_at instanceof Date) row.updatedAt = raw.updated_at;
    row.version = Number(raw.version ?? row.version);
    return row;
  }
}
