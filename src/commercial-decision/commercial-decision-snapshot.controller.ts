import { BadRequestException, Controller, ForbiddenException, Get, Param, Query, Req, UnauthorizedException } from '@nestjs/common';

import type { AuthorizationPrincipal } from '../authorization/authorization.types';

import { CommercialDecisionSnapshotService } from './commercial-decision-snapshot.service';

interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  authorizationPrincipal?: AuthorizationPrincipal;
}

/**
 * V1-COMMERCIAL-DECISION-01 — read-only workforce surface over commercial decision snapshots.
 *
 * Routes:
 *   GET /api/v1/internal/commercial-decision-snapshots            (list, deterministic pagination)
 *   GET /api/v1/internal/commercial-decision-snapshots/:id        (single safe projection)
 *
 * Safety posture:
 *  - Workforce-only (OPERATOR/SERVICE/PRIVILEGED), defense-in-depth on top of the route policy.
 *  - Read-only: no create/update/delete endpoints. Snapshots are written internally by the
 *    snapshot service; corrections are new compensating rows, never edits.
 *  - Safe projection: `request_hash` is never returned. The schema carries no secrets/PINs/OTPs
 *    and no wallet balances.
 */
@Controller('internal')
export class CommercialDecisionSnapshotController {
  constructor(private readonly service: CommercialDecisionSnapshotService) {}

  @Get('commercial-decision-snapshots')
  async list(
    @Req() req: AuthenticatedRequest,
    @Query('product') product?: string,
    @Query('principalType') principalType?: string,
    @Query('principalId') principalId?: string,
    @Query('decisionStatus') decisionStatus?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    this.requireWorkforce(req);
    return this.service.list({
      product: this.clean(product),
      principalType: this.clean(principalType),
      principalId: this.clean(principalId),
      decisionStatus: this.clean(decisionStatus),
      page,
      limit,
    });
  }

  @Get('commercial-decision-snapshots/:id')
  async getOne(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    this.requireWorkforce(req);
    if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id.trim())) {
      throw new BadRequestException('id must be UUID');
    }
    return this.service.findById(id.trim());
  }

  private requireWorkforce(req: AuthenticatedRequest): void {
    const principal = req.authorizationPrincipal;
    if (!principal) throw new UnauthorizedException('Authentication required');
    const allowed = ['OPERATOR', 'SERVICE', 'PRIVILEGED'];
    if (!allowed.includes(principal.type as string)) {
      throw new ForbiddenException('Privileged access required — OPERATOR/SERVICE/PRIVILEGED only');
    }
  }

  private clean(v?: string): string | undefined {
    if (v === undefined || v === null) return undefined;
    const t = v.trim();
    return t.length === 0 ? undefined : t;
  }
}
