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
 * V1-LIMIT-05 — Workforce-only limit diagnostics & manual reservation recovery boundary.
 *
 * Routes:
 *   GET  /api/v1/internal/limit-usages                     (OPERATOR/SERVICE/PRIVILEGED — read-only)
 *   GET  /api/v1/internal/limit-reservations               (OPERATOR/SERVICE/PRIVILEGED — read-only)
 *   POST /api/v1/internal/limit-reservation-recovery/release (PRIVILEGED only — explicit manual release)
 *
 * RoutePolicyRegistry maps /api/v1/internal/limit-* to WORKFORCE_SESSION with
 * OPERATOR/SERVICE/PRIVILEGED (SUPPORT/CUSTOMER/AGENT/AGGREGATOR excluded); the checks below
 * are defense-in-depth on top of the guard. The recovery route additionally requires the
 * strictest PRIVILEGED role because it mutates reservation state.
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

  private requireWorkforce(req: AuthenticatedRequest): void {
    const principal = req.authorizationPrincipal;
    if (!principal) throw new UnauthorizedException('Authentication required');
    const allowed = ['OPERATOR', 'SERVICE', 'PRIVILEGED'];
    if (!allowed.includes(principal.type as string)) {
      throw new ForbiddenException('Privileged access required — OPERATOR/SERVICE/PRIVILEGED only');
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
