import {
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
import { IsUUID } from 'class-validator';
import type { FastifyRequest } from 'fastify';
import { KycRegistrationCompletionService } from './kyc-registration-completion.service';
import { KycFoundationError } from './kyc.types';
class CompleteSyntheticDto {
  @IsUUID() sessionId!: string;
  @IsUUID() attemptId!: string;
}
@Controller('customers/registration-sessions')
export class KycRegistrationCompletionController {
  constructor(private readonly completion: KycRegistrationCompletionService) {}
  @Header('Cache-Control', 'no-store')
  @Post('synthetic-complete')
  @HttpCode(200)
  async complete(@Body() body: CompleteSyntheticDto, @Req() req: FastifyRequest) {
    const token =
      typeof req.headers.authorization === 'string'
        ? /^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.headers.authorization)?.[1]
        : undefined;
    if (!token) throw new UnauthorizedException('Registration authorization invalid');
    try {
      return await this.completion.complete(body.sessionId, token, body.attemptId);
    } catch (e) {
      if (e instanceof KycFoundationError) {
        if (e.code === 'CONFLICT') throw new ConflictException('Registration request conflict');
        if (e.code === 'DISABLED')
          throw new ServiceUnavailableException('Synthetic completion unavailable');
        throw new UnauthorizedException('Registration authorization invalid');
      }
      throw new ServiceUnavailableException('Registration service unavailable');
    }
  }
}
