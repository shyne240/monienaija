import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Req,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';

import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import { CustomerFundingService } from './customer-funding.service';
import { CreateCustomerFundingRequestDto } from './dto/create-customer-funding-request.dto';
import {
  ApproveCustomerFundingRequestDto,
  RejectCustomerFundingRequestDto,
} from './dto/review-customer-funding-request.dto';

interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  authorizationPrincipal?: AuthorizationPrincipal;
}

@Controller('internal')
export class CustomerFundingInternalController {
  constructor(private readonly fundingService: CustomerFundingService) {}

  @Post('customers/:customerId/funding-requests')
  async create(
    @Param('customerId') customerId: string,
    @Body() dto: CreateCustomerFundingRequestDto,
    @Headers('idempotency-key') idempotencyKeyHeader: string | undefined,
    @Headers('Idempotency-Key') idempotencyKeyHeader2: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    const principal = this.requireWorkforce(req);
    const idempotencyKey =
      dto.idempotencyKey?.trim() ||
      idempotencyKeyHeader?.trim() ||
      idempotencyKeyHeader2?.trim() ||
      '';
    return this.fundingService.createRequest({
      customerId,
      amountMinor: dto.amountMinor,
      currency: dto.currency,
      externalReference: dto.externalReference,
      channel: dto.channel,
      description: dto.description,
      correlationId: dto.correlationId,
      idempotencyKey,
      principal,
    });
  }

  @Post('customer-funding-requests/:id/approve')
  async approve(
    @Param('id') id: string,
    @Body() dto: ApproveCustomerFundingRequestDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const principal = this.requireWorkforce(req);
    return this.fundingService.approve({
      fundingRequestId: id,
      correlationId: dto.correlationId,
      principal,
    });
  }

  @Post('customer-funding-requests/:id/reject')
  async reject(
    @Param('id') id: string,
    @Body() dto: RejectCustomerFundingRequestDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const principal = this.requireWorkforce(req);
    return this.fundingService.reject({
      fundingRequestId: id,
      correlationId: dto.correlationId,
      rejectionReason: dto.reason,
      principal,
    });
  }

  // Alternate routes for audit convenience (also matches audit's /internal/customers/:id/funding-requests/:fundingRequestId/approve)
  @Post('customers/:customerId/funding-requests/:id/approve')
  async approveByCustomer(
    @Param('id') id: string,
    @Body() dto: ApproveCustomerFundingRequestDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.approve(id, dto, req);
  }

  @Post('customers/:customerId/funding-requests/:id/reject')
  async rejectByCustomer(
    @Param('id') id: string,
    @Body() dto: RejectCustomerFundingRequestDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.reject(id, dto, req);
  }

  @Get('customer-funding-requests/:id')
  async getOne(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    this.requireWorkforce(req);
    return this.fundingService.getById(id);
  }

  @Get('customers/:customerId/funding-requests')
  async listForCustomer(
    @Param('customerId') customerId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    this.requireWorkforce(req);
    return this.fundingService.listInternal(customerId);
  }

  @Get('customer-funding-requests')
  async listAll(@Req() req: AuthenticatedRequest) {
    this.requireWorkforce(req);
    return this.fundingService.listInternal();
  }

  private requireWorkforce(req: AuthenticatedRequest): AuthorizationPrincipal {
    const principal = req.authorizationPrincipal;
    if (!principal) throw new UnauthorizedException('Authentication required');
    if (principal.type === 'CUSTOMER' || principal.type === 'AGENT' || (principal.type as string) === 'AGGREGATOR') {
      throw new ForbiddenException('Customer/Agent not allowed on workforce route');
    }
    if (!['SUPPORT', 'OPERATOR', 'SERVICE', 'PRIVILEGED'].includes(principal.type)) {
      throw new ForbiddenException(`Principal type ${principal.type} not allowed`);
    }
    return principal;
  }
}
