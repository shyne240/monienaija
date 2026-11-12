import {
  Body,
  Controller,
  Header,
  HttpCode,
  Post,
  Req,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { IsIn, IsUUID, Matches } from 'class-validator';
import type { FastifyRequest } from 'fastify';
import { KycFoundationError } from '../kyc-verification/kyc.types';
import { MobileAccountClaimService } from './mobile-account-claim.service';
import { MobileOnboardingAuthService } from './mobile-onboarding-auth.service';
class RouteDto {
  @IsUUID() sessionId!: string;
}
class MatchDto extends RouteDto {
  @IsIn(['BVN', 'NIN']) kind!: 'BVN' | 'NIN';
  @Matches(/^\d{11}$/) identifier!: string;
}
class SetupDto extends RouteDto {
  @Matches(/^\d{6}$/) passcode!: string;
  @Matches(/^\d{6}$/) passcodeConfirmation!: string;
  @Matches(/^\d{6}$/) pin!: string;
  @Matches(/^\d{6}$/) pinConfirmation!: string;
}
class LoginDto {
  @IsUUID() sessionId!: string;
  @Matches(/^\d{6}$/) passcode!: string;
}
@Controller('customers/registration-sessions')
export class MobileOnboardingAuthController {
  constructor(
    private readonly auth: MobileOnboardingAuthService,
    private readonly claims: MobileAccountClaimService,
  ) {}
  private token(req: FastifyRequest): string {
    const token =
      typeof req.headers.authorization === 'string'
        ? /^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.headers.authorization)?.[1]
        : undefined;
    if (!token) throw new UnauthorizedException('Authentication failed');
    return token;
  }
  private async run<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof KycFoundationError) throw new UnauthorizedException('Authentication failed');
      throw new ServiceUnavailableException('Authentication unavailable');
    }
  }
  @Header('Cache-Control', 'no-store')
  @Post('onboarding-route')
  @HttpCode(200)
  route(@Body() b: RouteDto, @Req() req: FastifyRequest) {
    return this.run(() => this.auth.route(b.sessionId, this.token(req)));
  }
  @Header('Cache-Control', 'no-store')
  @Post('claim-match')
  @HttpCode(200)
  match(@Body() b: MatchDto, @Req() req: FastifyRequest) {
    return this.run(() => this.claims.match(b.sessionId, this.token(req), b.kind, b.identifier));
  }
  @Header('Cache-Control', 'no-store')
  @Post('claim-credentials')
  @HttpCode(200)
  setup(@Body() b: SetupDto, @Req() req: FastifyRequest) {
    return this.run(() => this.claims.setup({ ...b, authorization: this.token(req) }));
  }
  @Header('Cache-Control', 'no-store')
  @Post('onboarding-login')
  @HttpCode(200)
  login(@Body() b: LoginDto, @Req() req: FastifyRequest) {
    return this.run(() => this.auth.login(b.sessionId, this.token(req), b.passcode));
  }
  @Header('Cache-Control', 'no-store')
  @Post('onboarding-session')
  @HttpCode(200)
  status(@Req() req: FastifyRequest) {
    return this.run(() => this.auth.session(this.token(req)));
  }
  @Header('Cache-Control', 'no-store')
  @Post('onboarding-logout')
  @HttpCode(200)
  logout(@Req() req: FastifyRequest) {
    return this.run(() => this.auth.session(this.token(req), true));
  }
}
