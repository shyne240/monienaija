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
import { KycProviderGovernanceService } from './kyc-provider-governance.service';
interface WorkforceRequest {
  authorizationPrincipal?: AuthorizationPrincipal;
}
@Controller('internal/kyc/providers')
export class KycProviderGovernanceController {
  constructor(private readonly governance: KycProviderGovernanceService) {}
  private async run<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof KycFoundationError) {
        if (e.code === 'INVALID') throw new BadRequestException('Invalid provider configuration');
        if (e.code === 'CONFLICT') throw new ConflictException('Provider configuration conflict');
        if (e.code === 'BLOCKED')
          throw new UnauthorizedException('Provider configuration access denied');
        throw new ServiceUnavailableException('Provider configuration unavailable');
      }
      if (e instanceof HttpException) throw e;
      throw new ServiceUnavailableException('Provider configuration unavailable');
    }
  }
  @Get() view(@Req() req: WorkforceRequest) {
    return this.run(() => this.governance.view(req.authorizationPrincipal));
  }
  @Get('history') history(@Req() req: WorkforceRequest) {
    return this.run(() => this.governance.history(req.authorizationPrincipal));
  }
  @Get('proposals') proposals(@Req() req: WorkforceRequest) {
    return this.run(() => this.governance.proposals(req.authorizationPrincipal));
  }
  @Post('proposals')
  @HttpCode(200)
  propose(@Req() req: WorkforceRequest, @Body() body: unknown) {
    return this.run(() => {
      if (!body || typeof body !== 'object' || Array.isArray(body))
        throw new BadRequestException('Invalid provider configuration');
      const v = body as Record<string, unknown>;
      if (
        Object.keys(v).sort().join(',') !== 'configuration,expectedVersion,reason,requestId' ||
        typeof v.requestId !== 'string' ||
        typeof v.expectedVersion !== 'number' ||
        typeof v.reason !== 'string'
      )
        throw new BadRequestException('Invalid provider configuration');
      return this.governance.propose(req.authorizationPrincipal, {
        requestId: v.requestId,
        expectedVersion: v.expectedVersion,
        configuration: v.configuration,
        reason: v.reason as 'INITIAL_SETUP' | 'ROUTING_CHANGE' | 'PROVIDER_DISABLE',
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
