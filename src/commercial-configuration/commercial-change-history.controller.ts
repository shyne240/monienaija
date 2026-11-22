import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';

import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import { PrivilegedActionApprovalReadService } from '../authorization/privileged-action-approval-read.service';

interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  authorizationPrincipal?: AuthorizationPrincipal;
}

/**
 * Arena 3 Phase 4 — READ-ONLY governed change history for one commercial resource.
 *
 *   GET /api/v1/internal/commercial-configuration/change-history
 *       ?actionType=FEE_RULE_MODIFY&resourceId=<rule id>&limit=20
 *
 * Why this route exists: an operator must be able to tell PROPOSED / APPROVED / APPLIED apart for
 * the rule they are looking at, and audit who requested and who decided a change. The decision
 * endpoints require an approval id the caller already holds; this is the discoverability half,
 * scoped to ONE resource the caller names.
 *
 * There is deliberately no "list all approvals" capability and no write verb here.
 */
@Controller('internal')
export class CommercialChangeHistoryController {
  constructor(private readonly history: PrivilegedActionApprovalReadService) {}

  @Get('commercial-configuration/change-history')
  async list(
    @Req() req: AuthenticatedRequest,
    @Query('actionType') actionType?: string,
    @Query('resourceId') resourceId?: string,
    @Query('limit') limit?: string,
  ) {
    const principal = req.authorizationPrincipal;
    if (!principal) throw new UnauthorizedException('Authentication required');
    const allowed = ['OPERATOR', 'SERVICE', 'PRIVILEGED'];
    if (!allowed.includes(principal.type as string))
      throw new ForbiddenException(
        'Commercial change history is workforce-only — OPERATOR/SERVICE/PRIVILEGED only',
      );
    if (!actionType?.trim()) throw new BadRequestException('actionType is required');
    if (!resourceId?.trim()) throw new BadRequestException('resourceId is required');
    let take: number | undefined;
    if (limit !== undefined && limit !== '') {
      const parsed = Number.parseInt(limit, 10);
      if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 50)
        throw new BadRequestException('limit must be between 1 and 50');
      take = parsed;
    }
    return this.history.history(principal, { actionType, resourceId, limit: take });
  }
}
