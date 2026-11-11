import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Header,
  HttpCode,
  HttpException,
  Post,
  Req,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  Equals,
  IsEmail,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';
import type { FastifyRequest } from 'fastify';
import { KycRegistrationSessionService } from './kyc-registration-session.service';
import { KycRegistrationVerificationService } from './kyc-registration-verification.service';
import { KycFoundationError } from './kyc.types';

class StartDto {
  @IsString() @MaxLength(40) phone!: string;
}
class SessionDto {
  @IsUUID() sessionId!: string;
}
class OtpIssueDto extends SessionDto {
  @IsUUID() requestId!: string;
}
class OtpVerifyDto extends SessionDto {
  @Matches(/^\d{6}$/) code!: string;
}
class ConsentDto extends SessionDto {
  @IsUUID() requestId!: string;
  @IsIn(['BVN', 'NIN']) kind!: 'BVN' | 'NIN';
  @Equals(true) accepted!: boolean;
  @Equals('synthetic-test-v1') noticeVersion!: string;
  @IsISO8601({ strict: true }) expiresAt!: string;
}
class SyntheticProfileDto extends SessionDto {
  @IsString() @MaxLength(100) firstName!: string;
  @IsString() @MaxLength(100) lastName!: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) dateOfBirth!: string;
  @IsOptional() @IsEmail() @MaxLength(254) email?: string;
}
class WithdrawDto extends SessionDto {
  @IsUUID() consentId!: string;
}
class AvailabilityDto extends SessionDto {
  @IsIn(['BVN', 'NIN']) kind!: 'BVN' | 'NIN';
}
class VerifyDto extends WithdrawDto {
  @IsUUID() requestId!: string;
  @IsIn(['BVN', 'NIN']) kind!: 'BVN' | 'NIN';
  @Equals('00000000000') identifier!: string;
}
/** Public entrypoints authenticate with a purpose-limited registration bearer, never a customer session. */
@Controller('customers/registration-sessions')
export class KycRegistrationSessionController {
  constructor(
    private readonly sessions: KycRegistrationSessionService,
    private readonly verification: KycRegistrationVerificationService,
  ) {}
  private bearer(req: FastifyRequest): string {
    const value = req.headers.authorization;
    const match = typeof value === 'string' ? /^Bearer ([A-Za-z0-9_-]{43})$/.exec(value) : null;
    if (!match) throw new UnauthorizedException('Registration authorization invalid');
    return match[1]!;
  }
  private ip(req: FastifyRequest): string {
    if (typeof req.ip !== 'string' || !req.ip)
      throw new ServiceUnavailableException('Request source unavailable');
    return req.ip;
  }
  private async run<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (e) {
      if (e instanceof KycFoundationError) {
        if (e.code === 'CONFLICT') throw new ConflictException('Registration request conflict');
        if (e.code === 'DISABLED')
          throw new ServiceUnavailableException('Verification unavailable');
        if (e.code === 'INVALID') throw new BadRequestException('Invalid registration request');
        throw new UnauthorizedException('Registration authorization invalid');
      }
      if (e instanceof HttpException) throw e;
      throw new ServiceUnavailableException('Registration service unavailable');
    }
  }
  /** The simulation is never enabled outside test runtime. */
  @Header('Cache-Control', 'no-store')
  @Post('simulation-availability')
  @HttpCode(200)
  simulationAvailability() {
    return { available: this.sessions.simulationAvailable(), simulated: true };
  }
  @Header('Cache-Control', 'no-store')
  @Post('start')
  @HttpCode(200)
  start(@Body() body: StartDto, @Req() req: FastifyRequest) {
    return this.run(() => this.sessions.create(body.phone, this.ip(req)));
  }
  @Header('Cache-Control', 'no-store')
  @Post('otp')
  @HttpCode(200)
  issue(@Body() body: OtpIssueDto, @Req() req: FastifyRequest) {
    return this.run(async () => {
      await this.sessions.issueOtp(body.sessionId, this.bearer(req), body.requestId, this.ip(req));
      return { status: 'OTP_REQUEST_ACCEPTED' };
    });
  }
  @Header('Cache-Control', 'no-store')
  @Post('otp/verify')
  @HttpCode(200)
  verifyOtp(@Body() body: OtpVerifyDto, @Req() req: FastifyRequest) {
    return this.run(() =>
      this.sessions.verifyOtp(body.sessionId, this.bearer(req), body.code, this.ip(req)),
    );
  }
  @Header('Cache-Control', 'no-store')
  @Post('synthetic-profile')
  @HttpCode(200)
  profile(@Body() body: SyntheticProfileDto, @Req() req: FastifyRequest) {
    return this.run(() =>
      this.sessions.syntheticProfile(body.sessionId, this.bearer(req), {
        firstName: body.firstName,
        lastName: body.lastName,
        dateOfBirth: body.dateOfBirth,
        email: body.email,
      }),
    );
  }
  @Header('Cache-Control', 'no-store')
  @Post('synthetic-profile/status')
  @HttpCode(200)
  profileStatus(@Body() body: SessionDto, @Req() req: FastifyRequest) {
    return this.run(() => this.sessions.syntheticProfile(body.sessionId, this.bearer(req)));
  }
  @Header('Cache-Control', 'no-store')
  @Post('synthetic-verification')
  @HttpCode(200)
  syntheticVerify(@Body() body: VerifyDto, @Req() req: FastifyRequest) {
    return this.run(() =>
      this.verification.verify({
        sessionId: body.sessionId,
        authorization: this.bearer(req),
        consentId: body.consentId,
        requestId: body.requestId,
        kind: body.kind,
        identifier: body.identifier,
        useProfile: true,
      }),
    );
  }
  @Header('Cache-Control', 'no-store')
  @Post('consent')
  @HttpCode(200)
  consent(@Body() body: ConsentDto, @Req() req: FastifyRequest) {
    return this.run(async () => ({
      id: await this.sessions.grantConsent(
        body.sessionId,
        this.bearer(req),
        body.requestId,
        body.kind,
        body.noticeVersion,
        new Date(body.expiresAt),
      ),
    }));
  }
  @Header('Cache-Control', 'no-store')
  @Post('consent/withdraw')
  @HttpCode(200)
  withdraw(@Body() body: WithdrawDto, @Req() req: FastifyRequest) {
    return this.run(async () => {
      await this.sessions.withdrawConsent(body.sessionId, this.bearer(req), body.consentId);
      return { status: 'WITHDRAWN' };
    });
  }
  @Header('Cache-Control', 'no-store')
  @Post('availability')
  @HttpCode(200)
  availability(@Body() body: AvailabilityDto, @Req() req: FastifyRequest) {
    return this.run(() =>
      this.verification.availability(body.sessionId, this.bearer(req), body.kind),
    );
  }
  @Header('Cache-Control', 'no-store')
  @Post('verification')
  @HttpCode(200)
  verify(@Body() body: VerifyDto, @Req() req: FastifyRequest) {
    return this.run(() =>
      this.verification.verify({
        sessionId: body.sessionId,
        authorization: this.bearer(req),
        consentId: body.consentId,
        requestId: body.requestId,
        kind: body.kind,
        identifier: body.identifier,
      }),
    );
  }
  @Header('Cache-Control', 'no-store')
  @Post('status')
  @HttpCode(200)
  status(@Body() body: SessionDto, @Req() req: FastifyRequest) {
    return this.run(() => this.sessions.status(body.sessionId, this.bearer(req)));
  }
  @Header('Cache-Control', 'no-store')
  @Post('revoke')
  @HttpCode(200)
  revoke(@Body() body: SessionDto, @Req() req: FastifyRequest) {
    return this.run(async () => {
      await this.sessions.revoke(body.sessionId, this.bearer(req));
      return { status: 'REVOKED' };
    });
  }
}
