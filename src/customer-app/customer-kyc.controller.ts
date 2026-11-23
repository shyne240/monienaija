import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Header,
  HttpCode,
  Post,
  Req,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Equals, IsIn, IsInt, IsString, IsUUID, Matches, MaxLength, Min } from 'class-validator';

import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import { DEFAULT_SESSION_AUDIENCE } from '../customer-authentication/authentication-session.service';
import { KycCustomerVerificationService } from '../kyc-verification/kyc-customer-verification.service';
import { KycFoundationError } from '../kyc-verification/kyc.types';
import { CustomerKycViewService, type CustomerKycView } from './customer-kyc-view.service';

interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  authorizationPrincipal?: AuthorizationPrincipal;
}

class CustomerKycKindDto {
  @IsIn(['BVN', 'NIN']) kind!: 'BVN' | 'NIN';
}
class CustomerKycConsentDto extends CustomerKycKindDto {
  @IsUUID() requestId!: string;
  @Equals(true) accepted!: boolean;
  @IsString() @MaxLength(64) noticeVersion!: string;
  @IsIn(['MONNIFY', 'DOJAH', 'PREMBLY']) expectedProvider!: 'MONNIFY' | 'DOJAH' | 'PREMBLY';
  @IsInt() @Min(1) expectedRouteVersion!: number;
}
class CustomerKycWithdrawDto {
  @IsUUID() consentId!: string;
}
class CustomerKycVerifyDto extends CustomerKycWithdrawDto {
  @IsUUID() requestId!: string;
  @IsIn(['BVN', 'NIN']) kind!: 'BVN' | 'NIN';
  @Matches(/^\d{11}$/) identifier!: string;
}

/**
 * ARENA 4 (customer app) — `GET /customers/me/kyc`.
 *
 * Minimal, additive, self-only read added because the mobile app needs the customer's real KYC
 * tier, the approved policy's requirement shape and the platform's actual ability to assess
 * evidence. It exposes no internal identifiers, no threshold values, no policy author/checker
 * metadata and no other customer's data. The `/customers/me/*` route policy already restricts every
 * path here to a CUSTOMER SELF principal, and this handler re-checks the principal type.
 */
@Controller('customers/me/kyc')
export class CustomerKycController {
  constructor(
    private readonly view: CustomerKycViewService,
    private readonly verification: KycCustomerVerificationService,
  ) {}

  private requestContext(req: AuthenticatedRequest): { customerId: string; token: string } {
    const principal = req.authorizationPrincipal;
    const header = req.headers.authorization;
    const match = typeof header === 'string' ? /^Bearer ([A-Za-z0-9_-]{43})$/.exec(header) : null;
    if (!principal || principal.type !== 'CUSTOMER' || !principal.customerId || !match) {
      throw new UnauthorizedException('Customer authentication required');
    }
    return { customerId: principal.customerId, token: match[1]! };
  }

  private async run<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof KycFoundationError) {
        if (error.code === 'CONFLICT') throw new ConflictException('KYC request conflict');
        if (error.code === 'DISABLED')
          throw new ServiceUnavailableException('Verification unavailable');
        if (error.code === 'INVALID') throw new BadRequestException('Invalid KYC request');
        if (error.code === 'NOT_FOUND') throw new UnauthorizedException('Customer not found');
        throw new UnauthorizedException('Customer authentication required');
      }
      if (
        error instanceof BadRequestException ||
        error instanceof ConflictException ||
        error instanceof ServiceUnavailableException ||
        error instanceof UnauthorizedException
      )
        throw error;
      throw new ServiceUnavailableException('KYC service unavailable');
    }
  }

  @Get()
  @Header('Cache-Control', 'no-store')
  async get(@Req() req: AuthenticatedRequest): Promise<CustomerKycView> {
    const { customerId } = this.requestContext(req);
    return this.view.view(customerId);
  }

  /** Authenticated customer-side view and recovery state for consent-bound verification attempts. */
  @Post('status')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  status(@Req() req: AuthenticatedRequest) {
    return this.run(() => {
      const { token } = this.requestContext(req);
      return this.verification.status(token, DEFAULT_SESSION_AUDIENCE);
    });
  }

  @Post('availability')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  availability(@Body() body: CustomerKycKindDto, @Req() req: AuthenticatedRequest) {
    return this.run(() => {
      const { token } = this.requestContext(req);
      return this.verification.availability(token, DEFAULT_SESSION_AUDIENCE, body.kind);
    });
  }

  @Post('consent')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  consent(@Body() body: CustomerKycConsentDto, @Req() req: AuthenticatedRequest) {
    return this.run(() => {
      const { token } = this.requestContext(req);
      return this.verification.grantConsent({
        token,
        audience: DEFAULT_SESSION_AUDIENCE,
        requestId: body.requestId,
        kind: body.kind,
        accepted: body.accepted,
        noticeVersion: body.noticeVersion,
        expectedProvider: body.expectedProvider,
        expectedRouteVersion: body.expectedRouteVersion,
      });
    });
  }

  @Post('consent/withdraw')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  withdrawConsent(@Body() body: CustomerKycWithdrawDto, @Req() req: AuthenticatedRequest) {
    return this.run(async () => {
      const { token } = this.requestContext(req);
      await this.verification.withdrawConsent({
        token,
        audience: DEFAULT_SESSION_AUDIENCE,
        consentId: body.consentId,
      });
      return { status: 'WITHDRAWN' as const };
    });
  }

  @Post('verification')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  verify(@Body() body: CustomerKycVerifyDto, @Req() req: AuthenticatedRequest) {
    return this.run(() => {
      const { token } = this.requestContext(req);
      return this.verification.verify({
        token,
        audience: DEFAULT_SESSION_AUDIENCE,
        requestId: body.requestId,
        consentId: body.consentId,
        kind: body.kind,
        identifier: body.identifier,
      });
    });
  }
}
