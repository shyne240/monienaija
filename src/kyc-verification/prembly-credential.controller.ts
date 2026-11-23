import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Header,
  HttpCode,
  HttpException,
  NotFoundException,
  Param,
  Post,
  Req,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import { KycFoundationError } from './kyc.types';
import {
  PremblyCredentialGovernanceService,
  type PremblyCredentialProposalCommand,
} from './prembly-credential-governance.service';

interface WorkforceRequest {
  authorizationPrincipal?: AuthorizationPrincipal;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

@Controller('internal/kyc/providers/prembly')
export class PremblyCredentialController {
  constructor(private readonly credentials: PremblyCredentialGovernanceService) {}

  private async run<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof KycFoundationError) {
        if (error.code === 'INVALID')
          throw new BadRequestException('Invalid Prembly credential request');
        if (error.code === 'CONFLICT')
          throw new ConflictException('Prembly credential governance conflict');
        if (error.code === 'BLOCKED')
          throw new ForbiddenException('Prembly credential action denied');
        if (error.code === 'NOT_FOUND')
          throw new NotFoundException('Prembly credential proposal not found');
        throw new ServiceUnavailableException('Prembly credential service unavailable');
      }
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException('Prembly credential service unavailable');
    }
  }

  @Get('credentials')
  @Header('Cache-Control', 'no-store')
  status(@Req() req: WorkforceRequest) {
    return this.run(() => this.credentials.status(req.authorizationPrincipal));
  }

  @Get('credential-proposals')
  @Header('Cache-Control', 'no-store')
  proposals(@Req() req: WorkforceRequest) {
    return this.run(() => this.credentials.proposals(req.authorizationPrincipal));
  }

  @Post('credential-proposals')
  @Header('Cache-Control', 'no-store')
  @HttpCode(200)
  propose(@Req() req: WorkforceRequest, @Body() body: unknown) {
    return this.run(() => {
      if (!isRecord(body)) throw new BadRequestException('Invalid Prembly credential request');
      const allowed = ['apiKey', 'environment', 'operation', 'requestId'];
      if (Object.keys(body).some((key) => !allowed.includes(key)))
        throw new BadRequestException('Invalid Prembly credential request');
      if (
        typeof body.requestId !== 'string' ||
        (body.environment !== 'sandbox' && body.environment !== 'production') ||
        (body.operation !== 'SET' && body.operation !== 'CLEAR') ||
        (body.operation === 'SET' && typeof body.apiKey !== 'string') ||
        (body.operation === 'CLEAR' && Object.prototype.hasOwnProperty.call(body, 'apiKey'))
      )
        throw new BadRequestException('Invalid Prembly credential request');
      const command: PremblyCredentialProposalCommand = {
        requestId: body.requestId,
        environment: body.environment,
        operation: body.operation,
        ...(typeof body.apiKey === 'string' ? { apiKey: body.apiKey } : {}),
      };
      return this.credentials.propose(req.authorizationPrincipal, command);
    });
  }

  @Post('credential-proposals/:id/approve')
  @Header('Cache-Control', 'no-store')
  @HttpCode(200)
  approve(@Req() req: WorkforceRequest, @Param('id') id: string) {
    return this.run(() => this.credentials.decide(req.authorizationPrincipal, id, true));
  }

  @Post('credential-proposals/:id/reject')
  @Header('Cache-Control', 'no-store')
  @HttpCode(200)
  reject(@Req() req: WorkforceRequest, @Param('id') id: string) {
    return this.run(() => this.credentials.decide(req.authorizationPrincipal, id, false));
  }

  @Post('test-connection')
  @Header('Cache-Control', 'no-store')
  @HttpCode(200)
  testConnection(@Req() req: WorkforceRequest) {
    return this.run(() => this.credentials.testSandboxConnection(req.authorizationPrincipal));
  }
}
