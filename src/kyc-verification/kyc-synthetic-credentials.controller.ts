import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Header,
  HttpCode,
  Post,
  Req,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { IsUUID, Matches } from 'class-validator';
import type { FastifyRequest } from 'fastify';
import { KycFoundationError } from './kyc.types';
import { KycSyntheticCredentialsService } from './kyc-synthetic-credentials.service';
class SessionDto {
  @IsUUID() sessionId!: string;
}
class SetupDto extends SessionDto {
  @Matches(/^\d{6}$/) passcode!: string;
  @Matches(/^\d{6}$/) passcodeConfirmation!: string;
  @Matches(/^\d{6}$/) pin!: string;
  @Matches(/^\d{6}$/) pinConfirmation!: string;
}
@Controller('customers/registration-sessions')
export class KycSyntheticCredentialsController {
  constructor(private readonly credentials: KycSyntheticCredentialsService) {}
  @Header('Cache-Control', 'no-store')
  @Post('synthetic-credentials/status')
  @HttpCode(200)
  async status(@Body() body: SessionDto, @Req() req: FastifyRequest) {
    const token =
      typeof req.headers.authorization === 'string'
        ? /^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.headers.authorization)?.[1]
        : undefined;
    if (!token) throw new UnauthorizedException('Registration authorization invalid');
    try {
      return await this.credentials.status(body.sessionId, token);
    } catch (e) {
      if (e instanceof KycFoundationError && e.code === 'DISABLED')
        throw new ServiceUnavailableException('Synthetic setup unavailable');
      if (e instanceof KycFoundationError && e.code === 'CONFLICT')
        throw new ConflictException('Credential setup unavailable');
      if (e instanceof KycFoundationError)
        throw new UnauthorizedException('Registration authorization invalid');
      throw new ServiceUnavailableException('Registration service unavailable');
    }
  }
  @Header('Cache-Control', 'no-store')
  @Post('synthetic-credentials')
  @HttpCode(200)
  async setup(@Body() body: SetupDto, @Req() req: FastifyRequest) {
    const token =
      typeof req.headers.authorization === 'string'
        ? /^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.headers.authorization)?.[1]
        : undefined;
    if (!token) throw new UnauthorizedException('Registration authorization invalid');
    try {
      return await this.credentials.setup({ ...body, authorization: token });
    } catch (e) {
      if (e instanceof KycFoundationError) {
        if (e.code === 'INVALID') throw new BadRequestException('Invalid credential setup');
        if (e.code === 'CONFLICT') throw new ConflictException('Credential setup unavailable');
        if (e.code === 'DISABLED')
          throw new ServiceUnavailableException('Synthetic setup unavailable');
        throw new UnauthorizedException('Registration authorization invalid');
      }
      throw new ServiceUnavailableException('Registration service unavailable');
    }
  }
}
