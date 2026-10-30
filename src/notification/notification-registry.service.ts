/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion -- raw TypeORM query results are typed at the boundary */
import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

import { AuthorizationService } from '../authorization/authorization.service';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import { governedChangeConsumptionError } from '../authorization/commercial-rule-governance.service';
import {
  governedAction,
  governedChangeFingerprint,
} from '../authorization/governed-action.registry';
import { PrivilegedActionApprovalService } from '../authorization/privileged-action-approval.service';
import { sha256 } from '../authorization/workforce-crypto';
import { AuditService } from '../operations/audit.service';
import {
  NOTIFICATION_DEFAULTS_V1,
  NOTIFICATION_SECURITY_DEFAULTS_V1,
} from './notification-defaults-v1';
import {
  NotificationTemplateService,
  type TemplateChannel,
  type TemplateContent,
} from './notification-template.service';

interface ConfigRow {
  id: string;
  event_type: string;
  channel: TemplateChannel;
  delivery_class: string;
  is_enabled: boolean;
  is_locked: boolean;
  version: number;
}
interface TemplateRow {
  id: string;
  event_type: string;
  channel: TemplateChannel;
  locale: string;
  version: number;
  is_active: boolean;
  subject: string | null;
  body: string;
  created_by: string;
  created_at: Date;
}
export interface NotificationChange {
  type: 'TEMPLATE' | 'TEMPLATE_ROLLBACK' | 'CONFIGURATION';
  eventType: string;
  channel: TemplateChannel;
  expectedVersion: number;
  locale?: 'en-NG';
  subject?: string | null;
  body?: string;
  sourceVersion?: number;
  enabled?: boolean;
}
interface StoredRequest {
  approval_id: string;
  payload: NotificationChange;
  created_by: string;
  created_at: Date;
  reason: string;
}

const resourceType = 'NOTIFICATION_EVENT_CONFIGURATION';
const templateAction = 'NOTIFICATION_TEMPLATE_CHANGE';
const configAction = 'NOTIFICATION_EVENT_CONFIGURATION_CHANGE';
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class NotificationRegistryService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly templates: NotificationTemplateService,
    private readonly auth: AuthorizationService,
    private readonly approvals: PrivilegedActionApprovalService,
    private readonly audit: AuditService,
  ) {}

  /** Existing read function, plus the independent checker who must inspect proposals. */
  async requireRead(principal: AuthorizationPrincipal | undefined): Promise<void> {
    if (principal?.roles.includes('FINANCE_CONTROLLER')) {
      const decision = await this.auth.authorize(
        principal,
        {
          resourceType,
          action: 'NOTIFICATION_REVIEW',
          allowedPrincipalTypes: ['OPERATOR', 'PRIVILEGED'],
          requiredRoles: ['FINANCE_CONTROLLER'],
          minimumAssurance: 'MFA',
          customerAccess: 'NONE',
        },
        { type: resourceType },
      );
      if (!decision.allowed) throw new ForbiddenException('Notification review access denied');
      return;
    }
    await this.auth.requireFunction(principal, 'notification.view_deliveries', resourceType, [
      'OPERATOR',
      'PRIVILEGED',
    ]);
  }

  async listEvents() {
    const rows = (await this.dataSource.query(`
      SELECT c.event_type, c.channel, c.delivery_class, c.is_enabled, c.is_locked, c.version,
             t.version AS active_template_version
        FROM notification_event_configurations c
        LEFT JOIN notification_templates t ON t.event_type=c.event_type AND t.channel=c.channel
          AND t.locale='en-NG' AND t.is_active=true
       ORDER BY c.event_type, c.channel`)) as Array<
      ConfigRow & { active_template_version: number | null }
    >;
    const definitions = [
      ...NOTIFICATION_DEFAULTS_V1.map((d) => ({
        eventType: d.eventType as string,
        deliveryClass: d.kind as string,
        editable: true,
        variables: [...d.variables] as string[],
      })),
      ...NOTIFICATION_SECURITY_DEFAULTS_V1.map((eventType) => ({
        eventType: eventType as string,
        deliveryClass: 'SECURITY',
        editable: false,
        variables: [] as string[],
      })),
    ];
    return {
      items: definitions.map((definition) => {
        const channels = Object.fromEntries(
          (['SMS', 'EMAIL'] as const).map((channel) => {
            const row = rows.find(
              (value) => value.event_type === definition.eventType && value.channel === channel,
            );
            if (!row || row.delivery_class !== definition.deliveryClass)
              throw new Error('Notification catalogue configuration unavailable');
            return [
              channel,
              {
                enabled: row.is_enabled,
                locked: row.is_locked,
                configurationVersion: row.version,
                activeTemplateVersion: row.active_template_version,
              },
            ];
          }),
        );
        return { ...definition, channels };
      }),
    };
  }

  async listTemplates(
    eventType: unknown,
    channel: unknown,
    locale: unknown,
    limitRaw?: unknown,
    beforeRaw?: unknown,
  ) {
    const identity = this.templateIdentity(eventType, channel, locale);
    const limit = this.queryInteger(limitRaw, 50, 1, 100, 'limit');
    const beforeVersion =
      beforeRaw === undefined
        ? null
        : this.queryInteger(beforeRaw, 1, 1, 2_147_483_647, 'beforeVersion');
    const rows = (await this.dataSource.query(
      `SELECT * FROM notification_templates
      WHERE event_type=$1 AND channel=$2 AND locale=$3 AND ($4::integer IS NULL OR version < $4)
      ORDER BY version DESC LIMIT $5`,
      [identity.eventType, identity.channel, identity.locale, beforeVersion, limit + 1],
    )) as TemplateRow[];
    const page = rows.slice(0, limit);
    return {
      ...identity,
      items: page.map((row) => this.templateView(row)),
      nextBeforeVersion: rows.length > limit ? page[page.length - 1]!.version : null,
    };
  }

  async listChanges(statusRaw?: unknown, pageRaw?: unknown, limitRaw?: unknown) {
    const statuses = ['REQUESTED', 'APPROVED', 'REJECTED', 'CANCELLED', 'CONSUMED', 'EXPIRED'];
    if (
      statusRaw !== undefined &&
      (typeof statusRaw !== 'string' || !statuses.includes(statusRaw))
    ) {
      throw new BadRequestException('Invalid approval status');
    }
    const page = this.queryInteger(pageRaw, 1, 1, 1000, 'page');
    const limit = this.queryInteger(limitRaw, 25, 1, 100, 'limit');
    const rows = (await this.dataSource.query(
      `SELECT r.approval_id, r.change_type, r.payload->>'eventType' AS event_type,
      r.payload->>'channel' AS channel, r.created_by, r.created_at, a.status, a.approved_by, a.expires_at
      FROM notification_change_requests r JOIN privileged_action_approvals a ON a.id=r.approval_id
      WHERE ($1::text IS NULL OR a.status=$1) ORDER BY r.created_at DESC, r.approval_id DESC LIMIT $2 OFFSET $3`,
      [statusRaw ?? null, limit + 1, (page - 1) * limit],
    )) as Array<Record<string, unknown>>;
    return {
      page,
      limit,
      hasMore: rows.length > limit,
      items: rows.slice(0, limit).map((row) => ({
        approvalId: row.approval_id,
        type: row.change_type,
        eventType: row.event_type,
        channel: row.channel,
        createdBy: row.created_by,
        createdAt: row.created_at,
        status: row.status,
        approvedBy: row.approved_by,
        expiresAt: row.expires_at,
      })),
    };
  }

  async preview(raw: unknown) {
    const body = this.record(raw);
    this.onlyKeys(body, ['eventType', 'channel', 'locale', 'subject', 'body']);
    const identity = this.templateIdentity(body.eventType, body.channel, body.locale);
    let content: TemplateContent;
    if (body.body === undefined) {
      if (body.subject !== undefined) throw new BadRequestException('subject requires body');
      const rows = (await this.dataSource.query(
        `SELECT subject, body FROM notification_templates
        WHERE event_type=$1 AND channel=$2 AND locale=$3 AND is_active`,
        [identity.eventType, identity.channel, identity.locale],
      )) as TemplateContent[];
      if (rows.length !== 1) throw new NotFoundException('Active template not found');
      content = rows[0]!;
    } else {
      content = this.content(identity.channel, body.subject, body.body);
    }
    return {
      ...identity,
      ...this.templates.preview(identity.eventType, identity.channel, content),
    };
  }

  /** Persist a frozen, reviewable proposal and its approval in the SAME transaction. */
  async requestChange(principal: AuthorizationPrincipal, raw: unknown) {
    if (principal?.readOnlyPrincipal) throw new ForbiddenException('Read-only principal');
    const maker = await this.auth.authorize(
      principal,
      {
        resourceType,
        action: 'NOTIFICATION_REQUEST',
        allowedPrincipalTypes: ['OPERATOR', 'PRIVILEGED'],
        requiredRoles: ['SUPER_ADMIN'],
        requiredFunctions: ['notification.view_deliveries'],
        minimumAssurance: 'MFA',
        customerAccess: 'NONE',
      },
      { type: resourceType },
    );
    if (!maker.allowed) throw new ForbiddenException('Notification change request denied');
    const input = this.record(raw);
    const type = input.type;
    if (type !== 'TEMPLATE' && type !== 'TEMPLATE_ROLLBACK' && type !== 'CONFIGURATION')
      throw new BadRequestException('Invalid change type');
    const allowed =
      type === 'CONFIGURATION'
        ? ['type', 'eventType', 'channel', 'enabled', 'expectedVersion', 'reason']
        : type === 'TEMPLATE'
          ? [
              'type',
              'eventType',
              'channel',
              'locale',
              'subject',
              'body',
              'expectedVersion',
              'reason',
            ]
          : [
              'type',
              'eventType',
              'channel',
              'locale',
              'sourceVersion',
              'expectedVersion',
              'reason',
            ];
    this.onlyKeys(input, allowed);
    const identity = this.templateIdentity(input.eventType, input.channel, input.locale);
    const expectedVersion = this.positiveInteger(input.expectedVersion, 'expectedVersion');
    const reason = this.reason(input.reason);
    const action = type === 'CONFIGURATION' ? configAction : templateAction;
    const definition = governedAction(action)!;

    return this.safeTransaction(async (manager) => {
      const config = await this.config(manager, identity.eventType, identity.channel);
      let change: NotificationChange;
      if (type === 'CONFIGURATION') {
        if (config.is_locked) throw new ForbiddenException('Notification configuration is locked');
        if (typeof input.enabled !== 'boolean')
          throw new BadRequestException('enabled must be a boolean');
        if (config.version !== expectedVersion)
          throw new ConflictException('Configuration version has changed');
        change = {
          type,
          eventType: identity.eventType,
          channel: identity.channel,
          enabled: input.enabled,
          expectedVersion,
        };
      } else {
        const active = await this.activeTemplate(
          manager,
          identity.eventType,
          identity.channel,
          identity.locale,
        );
        if (active.version !== expectedVersion)
          throw new ConflictException('Template version has changed');
        let content: TemplateContent;
        let sourceVersion: number | undefined;
        if (type === 'TEMPLATE_ROLLBACK') {
          sourceVersion = this.positiveInteger(input.sourceVersion, 'sourceVersion');
          const versions = (await manager.query(
            `SELECT subject, body FROM notification_templates
            WHERE event_type=$1 AND channel=$2 AND locale=$3 AND version=$4`,
            [identity.eventType, identity.channel, identity.locale, sourceVersion],
          )) as TemplateContent[];
          if (!versions[0]) throw new NotFoundException('Source template version not found');
          content = versions[0];
        } else {
          content = this.content(identity.channel, input.subject, input.body);
        }
        this.templates.validateTemplate(identity.eventType, identity.channel, content);
        // Verify expansion against fixed safe samples before the proposal can be approved.
        this.templates.preview(identity.eventType, identity.channel, content);
        change = {
          type,
          ...identity,
          ...content,
          expectedVersion,
          ...(sourceVersion === undefined ? {} : { sourceVersion }),
        };
      }
      const fingerprint = governedChangeFingerprint(
        action,
        resourceType,
        config.id,
        change as unknown as Record<string, unknown>,
      );
      const approvalId = randomUUID();
      const decision = await this.approvals.requestInTransaction(manager, {
        id: approvalId,
        principal,
        policy: {
          resourceType,
          action,
          allowedPrincipalTypes: ['OPERATOR', 'PRIVILEGED'],
          requiredRoles: definition.initiatingRoles,
          requiredFunctions: definition.initiatingFunctionCodes,
          minimumAssurance: 'MFA',
          customerAccess: 'NONE',
        },
        resource: { type: resourceType, id: config.id },
        actionFingerprint: fingerprint,
        reason,
        requestDetails: {
          type,
          eventType: identity.eventType,
          channel: identity.channel,
          expectedVersion,
          proposalId: approvalId,
        },
      });
      if (!decision.approval)
        throw new ForbiddenException(
          `Notification change denied: ${decision.reason ?? 'UNAUTHORIZED'}`,
        );
      await manager.query(
        `INSERT INTO notification_change_requests (approval_id, change_type, payload, created_by)
        VALUES ($1,$2,$3::jsonb,$4)`,
        [approvalId, type, JSON.stringify(change), principal.principalId],
      );
      await this.audit.record(manager, {
        entityType: 'NOTIFICATION_CHANGE',
        entityId: approvalId,
        action: 'NOTIFICATION_CHANGE_REQUESTED',
        actor: principal.principalId,
        newValues: {
          eventType: identity.eventType,
          channel: identity.channel,
          type,
          expectedVersion,
          fingerprint,
        },
      });
      return {
        approvalId,
        status: decision.approval.status,
        actionType: action,
        actionFingerprint: fingerprint,
        requestedAt: decision.approval.requestedAt,
        expiresAt: decision.approval.expiresAt,
      };
    });
  }

  async getChange(approvalId: string) {
    this.checkUuid(approvalId);
    const rows = (await this.dataSource.query(
      `SELECT r.*, a.reason FROM notification_change_requests r
      JOIN privileged_action_approvals a ON a.id=r.approval_id WHERE r.approval_id=$1`,
      [approvalId],
    )) as StoredRequest[];
    if (!rows[0]) throw new NotFoundException('Notification change not found');
    const approval = await this.approvals.getApproval(approvalId);
    if (!approval) throw new NotFoundException('Approval not found');
    return {
      approvalId,
      change: rows[0].payload,
      reason: rows[0].reason,
      createdBy: rows[0].created_by,
      createdAt: rows[0].created_at,
      status: approval.status,
      requestedBy: approval.requesterPrincipalId,
      approvedBy: approval.approvedBy,
      expiresAt: approval.expiresAt,
    };
  }

  /** Consume approval, write the new version/configuration and append audit atomically. */
  async executeChange(principal: AuthorizationPrincipal, approvalId: string) {
    this.checkUuid(approvalId);
    if (principal?.readOnlyPrincipal) throw new ForbiddenException('Read-only principal');
    const authorized = await this.auth.authorize(
      principal,
      {
        resourceType,
        action: 'NOTIFICATION_EXECUTE',
        allowedPrincipalTypes: ['OPERATOR', 'PRIVILEGED'],
        requiredRoles: ['FINANCE_CONTROLLER'],
        requiredScopes: ['privileged:approve'],
        minimumAssurance: 'MFA',
        customerAccess: 'NONE',
      },
      { type: resourceType },
    );
    if (!authorized.allowed) throw new ForbiddenException('Notification execution denied');
    return this.safeTransaction(async (manager) => {
      const records = (await manager.query(
        `SELECT r.*, a.reason FROM notification_change_requests r
        JOIN privileged_action_approvals a ON a.id=r.approval_id WHERE r.approval_id=$1`,
        [approvalId],
      )) as StoredRequest[];
      if (!records[0]) throw new NotFoundException('Notification change not found');
      const change = records[0].payload;
      const identity = this.templateIdentity(change.eventType, change.channel, change.locale);
      const config = await this.config(manager, identity.eventType, identity.channel, true);
      const action = change.type === 'CONFIGURATION' ? configAction : templateAction;
      const fingerprint = governedChangeFingerprint(
        action,
        resourceType,
        config.id,
        change as unknown as Record<string, unknown>,
      );
      const consumed = await this.approvals.consumeInTransaction(manager, {
        principal,
        approvalId,
        actionType: action,
        resource: { type: resourceType, id: config.id },
        actionFingerprint: fingerprint,
      });
      if (!consumed.approved)
        throw governedChangeConsumptionError(consumed.reason, consumed.approval?.status);
      // Do not allow a privileged:execute delegate, the maker, or a different checker to execute.
      if (
        consumed.approval?.approvedBy !== principal.principalId ||
        consumed.approval.requesterPrincipalId === principal.principalId
      ) {
        throw new ForbiddenException('Only the independent approving checker may execute');
      }
      if (change.type === 'CONFIGURATION') {
        if (config.is_locked) throw new ForbiddenException('Notification configuration is locked');
        if (config.version !== change.expectedVersion)
          throw new ConflictException('Configuration version has changed');
        if (typeof change.enabled !== 'boolean')
          throw new BadRequestException('Invalid stored configuration');
        await manager.query(
          `UPDATE notification_event_configurations SET is_enabled=$1, version=version+1,
          updated_by=$2, updated_at=now() WHERE id=$3`,
          [change.enabled, principal.principalId, config.id],
        );
        await this.audit.record(manager, {
          entityType: resourceType,
          entityId: config.id,
          action: 'NOTIFICATION_CONFIGURATION_CHANGED',
          actor: principal.principalId,
          previousValues: { enabled: config.is_enabled, version: config.version },
          newValues: { enabled: change.enabled, version: config.version + 1, approvalId },
        });
        return {
          approvalId,
          type: change.type,
          eventType: change.eventType,
          channel: change.channel,
          enabled: change.enabled,
          version: config.version + 1,
        };
      }
      const current = await this.activeTemplate(
        manager,
        identity.eventType,
        identity.channel,
        identity.locale,
      );
      if (current.version !== change.expectedVersion)
        throw new ConflictException('Template version has changed');
      const content = this.content(identity.channel, change.subject, change.body);
      this.templates.validateTemplate(identity.eventType, identity.channel, content);
      this.templates.preview(identity.eventType, identity.channel, content);
      await manager.query(`UPDATE notification_templates SET is_active=false WHERE id=$1`, [
        current.id,
      ]);
      const inserted = (await manager.query(
        `INSERT INTO notification_templates
        (event_type, channel, locale, version, is_active, subject, body, created_by)
        VALUES ($1,$2,$3,$4,true,$5,$6,$7) RETURNING *`,
        [
          identity.eventType,
          identity.channel,
          identity.locale,
          current.version + 1,
          content.subject,
          content.body,
          principal.principalId,
        ],
      )) as TemplateRow[];
      await this.audit.record(manager, {
        entityType: 'NOTIFICATION_TEMPLATE',
        entityId: inserted[0]!.id,
        action: 'NOTIFICATION_TEMPLATE_VERSION_ACTIVATED',
        actor: principal.principalId,
        previousValues: {
          version: current.version,
          bodyHash: sha256(current.body),
          subjectHash: current.subject ? sha256(current.subject) : null,
        },
        newValues: {
          version: inserted[0]!.version,
          bodyHash: sha256(content.body),
          subjectHash: content.subject ? sha256(content.subject) : null,
          approvalId,
          sourceVersion: change.sourceVersion ?? null,
        },
      });
      return { approvalId, type: change.type, template: this.templateView(inserted[0]!) };
    });
  }

  // Driver errors can include bound template text. Do not let raw SQL parameters reach the
  // Nest exception logger or API response; the transaction is rolled back before this returns.
  private async safeTransaction<T>(work: (manager: EntityManager) => Promise<T>): Promise<T> {
    try {
      return await this.dataSource.transaction(work);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException('Notification change could not be persisted');
    }
  }

  private async config(
    manager: EntityManager,
    eventType: string,
    channel: TemplateChannel,
    lock = false,
  ): Promise<ConfigRow> {
    const rows = (await manager.query(
      `SELECT * FROM notification_event_configurations WHERE event_type=$1 AND channel=$2${lock ? ' FOR UPDATE' : ''}`,
      [eventType, channel],
    )) as ConfigRow[];
    if (!rows[0]) throw new NotFoundException('Notification configuration not found');
    if (rows[0].delivery_class === 'SECURITY')
      throw new ForbiddenException('Security notifications are locked');
    return rows[0];
  }

  private async activeTemplate(
    manager: EntityManager,
    eventType: string,
    channel: TemplateChannel,
    locale: string,
  ): Promise<TemplateRow> {
    const rows = (await manager.query(
      `SELECT * FROM notification_templates WHERE event_type=$1 AND channel=$2 AND locale=$3 AND is_active`,
      [eventType, channel, locale],
    )) as TemplateRow[];
    if (rows.length !== 1) throw new NotFoundException('Active template not found');
    return rows[0]!;
  }

  private templateView(row: TemplateRow) {
    return {
      id: row.id,
      eventType: row.event_type,
      channel: row.channel,
      locale: row.locale,
      version: row.version,
      active: row.is_active,
      subject: row.subject,
      body: row.body,
      createdBy: row.created_by,
      createdAt: row.created_at,
    };
  }

  private templateIdentity(
    eventType: unknown,
    channel: unknown,
    locale: unknown,
  ): { eventType: string; channel: TemplateChannel; locale: 'en-NG' } {
    if (typeof eventType !== 'string') throw new BadRequestException('eventType is required');
    this.templates.requireDefinition(eventType);
    if (channel !== 'SMS' && channel !== 'EMAIL')
      throw new BadRequestException('channel must be SMS or EMAIL');
    if (locale !== undefined && locale !== 'en-NG')
      throw new BadRequestException('Only locale en-NG is supported');
    return { eventType, channel, locale: 'en-NG' };
  }
  private content(channel: TemplateChannel, subject: unknown, body: unknown): TemplateContent {
    if (typeof body !== 'string') throw new BadRequestException('body must be a string');
    if (channel === 'SMS' && subject !== undefined && subject !== null)
      throw new BadRequestException('SMS subject must be null');
    if (channel === 'EMAIL' && typeof subject !== 'string')
      throw new BadRequestException('Email subject is required');
    return { subject: channel === 'SMS' ? null : (subject as string), body };
  }
  private queryInteger(
    value: unknown,
    fallback: number,
    min: number,
    max: number,
    field: string,
  ): number {
    if (value === undefined) return fallback;
    if (typeof value !== 'string' || !/^[0-9]+$/.test(value))
      throw new BadRequestException(`Invalid ${field}`);
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < min || number > max)
      throw new BadRequestException(`Invalid ${field}`);
    return number;
  }
  private positiveInteger(value: unknown, field: string): number {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 2_147_483_646)
      throw new BadRequestException(`${field} must be a positive integer`);
    return value;
  }
  private reason(value: unknown): string {
    if (typeof value !== 'string' || value.trim().length < 5 || value.trim().length > 500)
      throw new BadRequestException('reason must contain 5–500 characters');
    this.templates.assertSafe(value);
    if (/\d{6,}/.test(value))
      throw new BadRequestException('reason must not contain sensitive values');
    return value.trim();
  }
  private record(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new BadRequestException('Object body required');
    return value as Record<string, unknown>;
  }
  private onlyKeys(record: Record<string, unknown>, allowed: string[]): void {
    if (Object.keys(record).some((key) => !allowed.includes(key)))
      throw new BadRequestException('Unexpected request field');
  }
  private checkUuid(id: string): void {
    if (!uuidPattern.test(id)) throw new BadRequestException('Invalid approval id');
  }
}
