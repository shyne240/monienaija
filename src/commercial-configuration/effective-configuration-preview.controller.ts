import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';

import { AuthorizationService } from '../authorization/authorization.service';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';

import { EffectiveConfigurationPreviewService } from './effective-configuration-preview.service';
import type { EffectiveConfigurationPreviewQuery } from './effective-configuration-preview.service';

interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  authorizationPrincipal?: AuthorizationPrincipal;
}

/**
 * Arena 3 Phase 3 — workforce-only READ-ONLY effective-configuration preview.
 *
 *   GET /api/v1/internal/commercial-configuration/effective-preview
 *       ?productCode=&currency=&principalType=&principalId=&agentClassId=&segmentCodes=
 *       &institutionId=&direction=&channel=&amountMinor=&serviceClass=&at=
 *
 * Contract (asserted by test/v1-commercial-configuration-authoring.integration.spec.ts):
 *   - GET only. There is no POST/PATCH companion: a preview cannot submit a change.
 *   - Requires an authenticated workforce principal (OPERATOR/SERVICE/PRIVILEGED) with the
 *     `limit.view` function. Every resolver this composes is already readable by a `limit.view`
 *     holder through the catalogue/fee/commission/reward read routes, so this adds no disclosure
 *     and invents no new function code.
 *   - Returns 200 with explicit MISSING / AMBIGUOUS / NOT_APPLICABLE / UNAVAILABLE section
 *     statuses rather than turning absent configuration into an error. A BLOCKER explanation is
 *     evidence about configuration, not a failed request.
 *   - Never writes: no admission, reservation, charge, accrual, credit or posting.
 */
@Controller('internal')
export class EffectiveConfigurationPreviewController {
  constructor(
    private readonly preview: EffectiveConfigurationPreviewService,
    private readonly auth: AuthorizationService,
  ) {}

  @Get('commercial-configuration/effective-preview')
  async effectivePreview(
    @Req() req: AuthenticatedRequest,
    @Query('productCode') productCode?: string,
    @Query('currency') currency?: string,
    @Query('principalType') principalType?: string,
    @Query('principalId') principalId?: string,
    @Query('agentClassId') agentClassId?: string,
    @Query('segmentCodes') segmentCodes?: string | string[],
    @Query('institutionId') institutionId?: string,
    @Query('direction') direction?: string,
    @Query('channel') channel?: string,
    @Query('amountMinor') amountMinor?: string,
    @Query('serviceClass') serviceClass?: string,
    @Query('at') at?: string,
  ) {
    await this.authorize(req);
    if (
      segmentCodes !== undefined &&
      typeof segmentCodes !== 'string' &&
      !Array.isArray(segmentCodes)
    )
      throw new BadRequestException('segmentCodes must be a comma-separated list');
    const query: EffectiveConfigurationPreviewQuery = {
      productCode,
      currency,
      principalType,
      principalId,
      agentClassId,
      segmentCodes,
      institutionId,
      direction,
      channel,
      amountMinor,
      serviceClass,
      at,
    };
    return this.preview.preview(query);
  }

  private async authorize(req: AuthenticatedRequest): Promise<void> {
    const principal = req.authorizationPrincipal;
    if (!principal) throw new UnauthorizedException('Authentication required');
    const allowed = ['OPERATOR', 'SERVICE', 'PRIVILEGED'];
    if (!allowed.includes(principal.type as string))
      throw new ForbiddenException(
        'Effective-configuration preview is workforce-only — OPERATOR/SERVICE/PRIVILEGED only',
      );
    // `limit.view` is the catalogue read function every operative limit surface already requires;
    // reusing it avoids inventing a function code or a role grant.
    await this.auth.requireFunction(principal, 'limit.view', 'commercial_configuration_preview', [
      'OPERATOR',
      'SERVICE',
      'PRIVILEGED',
    ]);
  }
}
