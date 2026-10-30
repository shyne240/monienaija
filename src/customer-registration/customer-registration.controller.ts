import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';

import { CompleteRegistrationDto } from './dto/complete-registration.dto';
import { RequestRegistrationOtpDto } from './dto/request-registration-otp.dto';
import { VerifyRegistrationOtpDto } from './dto/verify-registration-otp.dto';
import { CustomerRegistrationService } from './customer-registration.service';

/**
 * V1-CUSTOMER-01 — public customer registration front door (unauthenticated).
 *
 * Provides:
 * - Phone OTP request (bounded by cooldown and rate limits).
 * - Phone OTP verification -> one-time registration token.
 * - Customer registration completion (creates active customer with verified phone,
 *   provisions primary NGN wallet, sets password credential, or creates draft).
 */
@Controller('customers/registration')
export class CustomerRegistrationController {
  constructor(private readonly registrationService: CustomerRegistrationService) {}

  /** Request (or resend, bounded by cooldown) a phone-verification OTP. Generic response. */
  @Post('otp')
  @HttpCode(200)
  requestOtp(@Body() dto: RequestRegistrationOtpDto, @Req() req: { ip?: string }) {
    return this.registrationService.requestOtp(dto.phone, this.sourceIp(req));
  }

  /** Verify an OTP → one-time registration token bound to the normalized phone. */
  @Post('otp/verify')
  @HttpCode(200)
  verifyOtp(@Body() dto: VerifyRegistrationOtpDto) {
    return this.registrationService.verifyOtp(dto.phone, dto.code);
  }

  /**
   * Complete registration: consumes the verification token.
   * If password is provided: creates an ACTIVE customer, hashes password with PBKDF2,
   * provisions primary NGN wallet atomically, and creates verified phone contact record.
   * If password is not provided: creates a DRAFT customer with verified phone.
   */
  @Post()
  @HttpCode(201)
  complete(@Body() dto: CompleteRegistrationDto, @Req() req: { ip?: string }) {
    return this.registrationService.completeRegistration(
      dto.phone,
      dto.verificationToken,
      this.sourceIp(req),
      dto.password,
      dto.displayName,
      dto.idempotencyKey,
    );
  }

  private sourceIp(req: { ip?: string }): string {
    return typeof req.ip === 'string' && req.ip.length > 0 ? req.ip : 'unknown';
  }
}
