import { Body, Controller, Get, Header, HttpCode, Post, Req } from '@nestjs/common';
import { IsIn, IsOptional, IsString, Length } from 'class-validator';
import { Transform } from 'class-transformer';

import {
  CustomerCredentialRecoveryService,
  type CompleteRecoveryView,
  type RecoveryPolicyView,
  type RequestRecoveryChallengeView,
  type VerifyRecoveryChallengeView,
} from './customer-credential-recovery.service';

interface RequestWithIp {
  ip?: string;
  headers: Record<string, string | string[] | undefined>;
}

class RequestChallengeDto {
  @IsString()
  @Length(7, 32)
  phone!: string;

  @IsString()
  @IsIn(['LOGIN_PASSCODE', 'TRANSACTION_PIN'])
  purpose!: string;

  /** Stable, client-generated installation identifier — used only to label the security event. */
  @IsOptional()
  @IsString()
  @Length(8, 128)
  deviceId?: string;
}

class VerifyChallengeDto {
  @IsString()
  @Length(1, 64)
  challengeId!: string;

  @IsString()
  @Length(4, 12)
  code!: string;

  @IsOptional()
  @IsString()
  @Length(8, 128)
  deviceId?: string;
}

class CompleteRecoveryDto {
  @IsString()
  @Length(1, 256)
  recoveryToken!: string;

  @IsString()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @Length(4, 32)
  newSecret!: string;

  @IsString()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @Length(4, 32)
  confirmation!: string;

  @IsOptional()
  @IsString()
  @Length(8, 128)
  deviceId?: string;
}

/**
 * ARENA 4 — customer self-service credential recovery (unauthenticated, fail-closed).
 *
 * Registered as `CUSTOMER_LOGIN`-class public route policies: the caller holds no session yet by
 * definition. Authority comes from the OTP + identity-evidence gate inside the service, never from
 * the request shape. Nothing here issues a session.
 */
@Controller('customers/credential-recovery')
export class CustomerCredentialRecoveryController {
  constructor(private readonly recovery: CustomerCredentialRecoveryService) {}

  @Get('policy')
  @Header('Cache-Control', 'no-store')
  policy(): RecoveryPolicyView {
    return this.recovery.policy();
  }

  @Post('challenges')
  @HttpCode(202)
  @Header('Cache-Control', 'no-store')
  requestChallenge(
    @Body() dto: RequestChallengeDto,
    @Req() request: RequestWithIp,
  ): Promise<RequestRecoveryChallengeView> {
    return this.recovery.requestChallenge(dto.phone, dto.purpose, this.sourceIp(request));
  }

  @Post('challenges/verify')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  verifyChallenge(@Body() dto: VerifyChallengeDto): Promise<VerifyRecoveryChallengeView> {
    return this.recovery.verifyChallenge(dto.challengeId, dto.code, dto.deviceId);
  }

  @Post('complete')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  complete(@Body() dto: CompleteRecoveryDto): Promise<CompleteRecoveryView> {
    return this.recovery.complete(dto.recoveryToken, dto.newSecret, dto.confirmation, dto.deviceId);
  }

  private sourceIp(request: RequestWithIp): string {
    const forwarded = request.headers['x-forwarded-for'];
    const header = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    const first = header?.split(',')[0]?.trim();
    return first || request.ip || 'unknown';
  }
}
