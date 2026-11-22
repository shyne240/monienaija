import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
  Req,
} from '@nestjs/common';

import { AuthorizationService } from '../authorization/authorization.service';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import { AuditService } from './audit.service';
import type { AuditInspectionQuery, AuditOutcome } from './audit-inspection.types';

interface AuthenticatedRequest {
  headers?: Record<string, string | string[] | undefined>;
  authorizationPrincipal?: AuthorizationPrincipal;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ENTITY_TYPE_PATTERN = /^[A-Z0-9_]{2,80}$/;
const OUTCOMES = new Set<AuditOutcome>(['ALLOWED', 'DENIED', 'RECORDED']);

/**
 * ARENA 4 — Operational Audit inspection.
 *
 * Additive to the existing `GET /internal/audit` (which keeps its documented SUPPORT exception
 * and is unchanged). This surface requires BOTH catalogue functions `audit.view` and
 * `audit.search` from an OPERATOR/PRIVILEGED workforce principal, so the deeper reporting shape
 * (server-side filters, outcome, institution scope, approval history) is never reachable by a
 * principal that could not already read audit records.
 *
 * Privacy is inherited, not re-implemented: every query goes through
 * `AuditService.restrictedQuery()`, which excludes customer-preference and compliance-case
 * records and provider-secret audit metadata by default. Credential-shaped values are already
 * masked by the audit projection (`sanitizeDiagnosticIdentifier`, provider sanitizers). No raw
 * KYC evidence exists in `audit_events`; document/evidence payloads live elsewhere and are not
 * joined here.
 */
@Controller('internal')
export class AuditInspectionController {
  constructor(
    private readonly auditService: AuditService,
    private readonly auth: AuthorizationService,
  ) {}

  @Get('audit/inspection')
  async inspect(
    @Req() req: AuthenticatedRequest,
    @Query('actor') actorRaw?: string,
    @Query('action') actionRaw?: string,
    @Query('entityType') entityTypeRaw?: string,
    @Query('entityId') entityIdRaw?: string,
    @Query('correlationId') correlationIdRaw?: string,
    @Query('institutionId') institutionIdRaw?: string,
    @Query('outcome') outcomeRaw?: string,
    @Query('from') fromRaw?: string,
    @Query('to') toRaw?: string,
    @Query('page') pageRaw?: string,
    @Query('limit') limitRaw?: string,
  ) {
    await this.authorize(req);
    const actor = this.text(actorRaw, 'actor', 160);
    const action = this.text(actionRaw, 'action', 160);
    const entityType = this.entityType(entityTypeRaw);
    const entityId = this.text(entityIdRaw, 'entityId', 255);
    const correlationId = this.text(correlationIdRaw, 'correlationId', 255);
    const institutionId = this.institutionId(institutionIdRaw);
    const outcome = this.outcome(outcomeRaw);
    const from = this.timestamp(fromRaw, 'from');
    const to = this.timestamp(toRaw, 'to');
    const query: AuditInspectionQuery = {
      ...(actor ? { actor } : {}),
      ...(action ? { action } : {}),
      ...(entityType ? { entityType } : {}),
      ...(entityId ? { entityId } : {}),
      ...(correlationId ? { correlationId } : {}),
      ...(institutionId ? { institutionId } : {}),
      ...(outcome ? { outcome } : {}),
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
      page: this.boundedInteger(pageRaw, 'page', 1, 100000, 1),
      limit: this.boundedInteger(limitRaw, 'limit', 1, 100, 25),
    };
    if (query.from && query.to && query.from.getTime() > query.to.getTime()) {
      throw new BadRequestException('from must not be after to');
    }
    return this.auditService.inspect(query);
  }

  @Get('audit/inspection/:id')
  async detail(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    await this.authorize(req);
    if (!UUID_PATTERN.test(id)) {
      throw new BadRequestException('id must be a UUID');
    }
    const detail = await this.auditService.inspectOne(id);
    // One generic response for "absent" and "excluded by policy" so detail lookup is not an
    // oracle for the existence of restricted records.
    if (!detail) throw new NotFoundException('Audit record not found');
    return detail;
  }

  private authorize(req: AuthenticatedRequest): Promise<string> {
    return this.auth.requireFunction(
      req.authorizationPrincipal,
      'audit.view',
      'internal-audit-inspection',
      ['OPERATOR', 'PRIVILEGED'],
    );
  }

  private text(raw: string | undefined, field: string, maxLength: number): string | undefined {
    if (raw === undefined || raw === null) return undefined;
    const trimmed = raw.trim();
    if (!trimmed) return undefined;
    if (trimmed.length > maxLength) {
      throw new BadRequestException(`${field} must be at most ${maxLength} characters`);
    }
    return trimmed;
  }

  private entityType(raw?: string): string | undefined {
    const value = this.text(raw, 'entityType', 80);
    if (!value) return undefined;
    const normalized = value.toUpperCase();
    if (!ENTITY_TYPE_PATTERN.test(normalized)) {
      throw new BadRequestException('entityType must be an upper-case entity type');
    }
    return normalized;
  }

  private institutionId(raw?: string): string | undefined {
    const value = this.text(raw, 'institutionId', 36);
    if (!value) return undefined;
    if (!UUID_PATTERN.test(value)) {
      throw new BadRequestException('institutionId must be a UUID');
    }
    return value;
  }

  private outcome(raw?: string): AuditOutcome | undefined {
    const value = this.text(raw, 'outcome', 16);
    if (!value) return undefined;
    const normalized = value.toUpperCase() as AuditOutcome;
    if (!OUTCOMES.has(normalized)) {
      throw new BadRequestException('outcome must be one of ALLOWED, DENIED, RECORDED');
    }
    return normalized;
  }

  private timestamp(raw: string | undefined, field: string): Date | undefined {
    const value = this.text(raw, field, 40);
    if (!value) return undefined;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException(`${field} must be an ISO-8601 timestamp`);
    }
    return parsed;
  }

  private boundedInteger(
    raw: string | undefined,
    field: string,
    min: number,
    max: number,
    fallback: number,
  ): number {
    if (raw === undefined || raw === null || raw === '') return fallback;
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < min || value > max) {
      throw new BadRequestException(`${field} must be an integer between ${min} and ${max}`);
    }
    return value;
  }
}
