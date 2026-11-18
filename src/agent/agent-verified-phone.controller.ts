import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Patch,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import { AgentVerifiedPhoneService } from './agent-verified-phone.service';

interface AgentRequest {
  authorizationPrincipal?: AuthorizationPrincipal;
}
function principal(req: AgentRequest): AuthorizationPrincipal {
  if (!req.authorizationPrincipal || req.authorizationPrincipal.type !== 'AGENT')
    throw new UnauthorizedException('Agent session required');
  return req.authorizationPrincipal;
}
function bodyObject(body: unknown, allowed: string[]): Record<string, unknown> {
  if (
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    Object.keys(body).some((k) => !allowed.includes(k))
  )
    throw new BadRequestException('Invalid request body');
  return body as Record<string, unknown>;
}

@Controller('agents/me/contact')
export class AgentVerifiedPhoneController {
  constructor(private readonly phones: AgentVerifiedPhoneService) {}
  @Get() get(@Req() req: AgentRequest) {
    return this.phones.get(principal(req));
  }
  @Post('phone') verify(@Req() req: AgentRequest, @Body() raw: unknown) {
    const body = bodyObject(raw, ['phone', 'verificationToken']);
    if (typeof body.phone !== 'string' || typeof body.verificationToken !== 'string')
      throw new BadRequestException('phone and verificationToken are required');
    return this.phones.verify(principal(req), body.phone, body.verificationToken);
  }
  @Patch('notification-preferences') preference(@Req() req: AgentRequest, @Body() raw: unknown) {
    const body = bodyObject(raw, ['smsEnabled']);
    if (typeof body.smsEnabled !== 'boolean')
      throw new BadRequestException('smsEnabled must be a boolean');
    return this.phones.setSmsPreference(principal(req), body.smsEnabled);
  }
}
