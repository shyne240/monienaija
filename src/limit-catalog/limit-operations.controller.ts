import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';

import type { AuthorizationPrincipal } from '../authorization/authorization.types';

import { LimitDiagnosticsService } from './limit-diagnostics.service';
import { LimitReservationRecoveryService } from './limit-reservation-recovery.service';

interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  authorizationPrincipal?: AuthorizationPrincipal;
}

/**
 * V1-LIMIT-05 — Limit diagnostics & manual reservation recovery boundary.
 *
 * Routes:
 *   GET  /api/v1/internal/limit-usages                     (OPERATOR/SERVICE/PRIVILEGED + limit.view — read-only)
 *   GET  /api/v1/internal/limit-reservations               (OPERATOR/SERVICE/PRIVILEGED + limit.view — read-only)
 *   POST /api/v1/internal/limit-reservation-recovery/release (PRIVILEGED only — explicit manual release)
 *
 * AUDIT F-03 / P0-03 (docs/audit/20261028) CORRECTION: the diagnostics GETs previously checked
 * ONLY the workforce principal type, while the approved Admin Web policy (LimitAssignmentScreen,
 * navigation-access) gates the same diagnostics behind the catalogue function `limit.view`.
 * Because every non-administrative A2 workforce role collapses to principal.type OPERATOR, the
 * type-only check admitted workforce roles that hold no limit function (OPERATIONS, COMPLIANCE,
 * RISK_FRAUD, CUSTOMER_SERVICE, TREASURY, ...) to sensitive operational metadata. The type
 * allowlist is now AND-combined with a server-side `limit.view` requirement — the identical
 * pattern used by V1-ADMIN-AUTHORIZATION-HARDENING-01 (agent lifecycle) and
 * AdminNotificationProviderController.requireFunction. Access is narrowed, never broadened:
 * the roles granted limit.view in the catalogue (SUPER_ADMIN, FINANCE_PREPARER,
 * FINANCE_CONTROLLER, FINANCE_AUDITOR, AGENT_NETWORK_MANAGER) all resolve to OPERATOR/PRIVILEGED
 * and keep access. RoutePolicyRegistry additionally declares requiredFunctions ['limit.view']
 * for the two GET paths, so the RuntimeAccessGuard V1-SPRINT3-GUARD-01 slice denies
 * function-less principals (403 Authorization denied: FUNCTION_MISSING) before this controller;
 * the check below remains the authoritative controller gate. Query parameters can never widen
 * access: RoutePolicyRegistry.resolve() strips the query string before matching, filters are
 * parsed after authorization, and the recovery route stays PRIVILEGED-only — reservation
 * release is a separate mutation and is NOT conflated with these reads.
 */
@Controller('internal')
export class LimitOperationsController {
  constructor(
    private readonly diagnostics: LimitDiagnosticsService,
    private readonly recovery: LimitReservationRecoveryService,
  ) {}

  @Get('limit-usages')
  async listUsages(
    @Req() req: AuthenticatedRequest,
    @Query('limitProfileCode') limitProfileCode?: string,
    @Query('principalType') principalType?: string,
    @Query('principalId') principalId?: string,
    @Query('product') product?: string,
    @Query('dimension') dimension?: string,
    @Query('currency') currency?: string,
    @Query('windowKey') windowKey?: string,
    @Query('windowType') windowType?: string,
    @Query('windowFrom') windowFrom?: string,
    @Query('windowTo') windowTo?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    this.requireWorkforce(req);
    return this.diagnostics.listUsages({
      limitProfileCode,
      principalType,
      principalId,
      product,
      dimension,
      currency,
      windowKey,
      windowType,
      windowFrom,
      windowTo,
      page: this.optionalInt(page, 'page'),
      limit: this.optionalInt(limit, 'limit'),
    });
  }

  @Get('limit-reservations')
  async listReservations(
    @Req() req: AuthenticatedRequest,
    @Query('status') status?: string,
    @Query('limitProfileCode') limitProfileCode?: string,
    @Query('principalType') principalType?: string,
    @Query('principalId') principalId?: string,
    @Query('product') product?: string,
    @Query('dimension') dimension?: string,
    @Query('currency') currency?: string,
    @Query('windowKey') windowKey?: string,
    @Query('idempotencyKey') idempotencyKey?: string,
    @Query('correlationId') correlationId?: string,
    @Query('reservedFrom') reservedFrom?: string,
    @Query('reservedTo') reservedTo?: string,
    @Query('stale') stale?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    this.requireWorkforce(req);
    let staleBool: boolean | undefined;
    if (stale !== undefined && stale !== '') {
      if (stale === 'true') staleBool = true;
      else if (stale === 'false') staleBool = false;
      else throw new BadRequestException('stale must be true or false');
    }
    return this.diagnostics.listReservations({
      status,
      limitProfileCode,
      principalType,
      principalId,
      product,
      dimension,
      currency,
      windowKey,
      idempotencyKey,
      correlationId,
      reservedFrom,
      reservedTo,
      stale: staleBool,
      page: this.optionalInt(page, 'page'),
      limit: this.optionalInt(limit, 'limit'),
    });
  }

  /**
   * Manual recovery boundary — NOT an automatic reaper. Releases exactly one reservation
   * after human investigation. PRIVILEGED-only; reason required; audited; RELEASED-only.
   * See LimitReservationRecoveryService for the orphan analysis and automatic-reaping blocker.
   */
  @Post('limit-reservation-recovery/release')
  async releaseReservation(
    @Req() req: AuthenticatedRequest,
    @Body() body: { reservationId?: string; reason?: string; correlationId?: string },
  ) {
    this.requirePrivileged(req);
    const actor = this.actorOf(req);
    return this.recovery.releaseManually({
      reservationId: body?.reservationId ?? '',
      actor,
      reason: body?.reason ?? '',
      correlationId: body?.correlationId ?? null,
    });
  }

  private optionalInt(v: string | undefined, name: string): number | undefined {
    if (v === undefined || v === '') return undefined;
    const n = Number.parseInt(v, 10);
    if (isNaN(n) || !Number.isSafeInteger(n)) throw new BadRequestException(`${name} must be an integer`);
    return n;
  }

  /**
   * Diagnostics reader gate: workforce principal-type allowlist AND the catalogue function
   * `limit.view` (fail-closed). Type denial keeps this controller's pre-existing 403 message
   * convention; a type-permitted principal missing the function gets 403 FUNCTION_MISSING —
   * fully authenticated, simply not entitled to this read (correct HTTP semantics per
   * AuthorizationService.requireFunction's FUNCTION_MISSING carve-out).
   */
  private requireWorkforce(req: AuthenticatedRequest): void {
    const principal = req.authorizationPrincipal;
    if (!principal) throw new UnauthorizedException('Authentication required');
    const allowed = ['OPERATOR', 'SERVICE', 'PRIVILEGED'];
    if (!allowed.includes(principal.type as string)) {
      throw new ForbiddenException('Privileged access required — OPERATOR/SERVICE/PRIVILEGED only');
    }
    if (!principal.scopes?.includes('limit.view')) {
      throw new ForbiddenException('FUNCTION_MISSING');
    }
  }

  private requirePrivileged(req: AuthenticatedRequest): void {
    const principal = req.authorizationPrincipal;
    if (!principal) throw new UnauthorizedException('Authentication required');
    if ((principal.type as string) !== 'PRIVILEGED') {
      throw new ForbiddenException('Manual reservation release requires the PRIVILEGED workforce role');
    }
  }

  private actorOf(req: AuthenticatedRequest): string {
    const p = req.authorizationPrincipal as unknown as { principalId?: string; type?: string } | undefined;
    return p?.principalId ?? p?.type ?? 'workforce';
  }
}
