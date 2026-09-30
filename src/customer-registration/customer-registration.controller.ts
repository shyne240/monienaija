import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';

import { CompleteRegistrationDto } from './dto/complete-registration.dto';
import { RequestRegistrationOtpDto } from './dto/request-registration-otp.dto';
import { VerifyRegistrationOtpDto } from './dto/verify-registration-otp.dto';
import { CustomerRegistrationService } from './customer-registration.service';

/**
 * V1-CUSTOMER-ONBOARDING-01 — public customer registration front door (unauthenticated).
 *
 * These three routes are explicitly listed in RoutePolicyRegistry PUBLIC_ROUTES — the same
 * convention as the existing unauthenticated health endpoints (there is no session-bearing
 * auth mode applicable pre-registration; CUSTOMER_LOGIN covers only session issuance for
 * existing customers). They deliberately do NOT live on the internal fail-closed
 * /customers POST route, which remains unchanged.
 *
 * Scope boundary: this controller can only create DRAFT customers and verify phones. It
 * cannot activate, create wallets, create credentials, or mint sessions.
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
   * Complete registration: consumes the verification token, creates a DRAFT customer with
   * a verified primary PHONE contact method. Creates nothing else.
   */
  @Post()
  @HttpCode(201)
  complete(@Body() dto: CompleteRegistrationDto, @Req() req: { ip?: string }) {
    return this.registrationService.completeRegistration(
      dto.phone,
      dto.verificationToken,
      this.sourceIp(req),
    );
  }

  private sourceIp(req: { ip?: string }): string {
    return typeof req.ip === 'string' && req.ip.length > 0 ? req.ip : 'unknown';
  }
}
