import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  HttpException,
  Param,
  Post,
  Req,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import { KycFoundationError } from './kyc.types';
import { KycTierPolicyService } from './kyc-tier-policy.service';
interface WorkforceRequest {
  authorizationPrincipal?: AuthorizationPrincipal;
}
@Controller('internal/kyc/tier-policies')
export class KycTierPolicyController {
  constructor(private readonly governance: KycTierPolicyService) {}
  private async run<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof KycFoundationError) {
        if (e.code === 'INVALID') throw new BadRequestException('Invalid tier policy');
        if (e.code === 'CONFLICT') throw new ConflictException('Tier policy conflict');
        if (e.code === 'BLOCKED') throw new UnauthorizedException('Tier policy access denied');
        throw new ServiceUnavailableException('Tier policy unavailable');
      }
      if (e instanceof HttpException) throw e;
      throw new ServiceUnavailableException('Tier policy unavailable');
    }
  }
  @Get() view(@Req() req: WorkforceRequest) {
    return this.run(() => this.governance.view(req.authorizationPrincipal));
  }
  @Get('proposals') proposals(@Req() req: WorkforceRequest) {
    return this.run(() => this.governance.proposals(req.authorizationPrincipal));
  }
  @Post('proposals')
  @HttpCode(200)
  propose(@Req() req: WorkforceRequest, @Body() body: unknown) {
    return this.run(() => {
      if (!body || typeof body !== 'object' || Array.isArray(body))
        throw new BadRequestException('Invalid tier policy');
      const v = body as Record<string, unknown>;
      if (
        Object.keys(v).sort().join(',') !== 'definition,expectedVersion,requestId' ||
        typeof v.requestId !== 'string' ||
        typeof v.expectedVersion !== 'number'
      )
        throw new BadRequestException('Invalid tier policy');
      return this.governance.propose(req.authorizationPrincipal, {
        requestId: v.requestId,
        expectedVersion: v.expectedVersion,
        definition: v.definition,
      });
    });
  }
  @Post('proposals/:id/approve')
  @HttpCode(200)
  approve(@Req() req: WorkforceRequest, @Param('id') id: string) {
    return this.run(() => this.governance.decide(req.authorizationPrincipal, id, true));
  }
  @Post('proposals/:id/reject')
  @HttpCode(200)
  reject(@Req() req: WorkforceRequest, @Param('id') id: string) {
    return this.run(() => this.governance.decide(req.authorizationPrincipal, id, false));
  }
}
