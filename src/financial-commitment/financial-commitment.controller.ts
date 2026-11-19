import { Body, Controller, Get, Headers, HttpCode, NotFoundException, Param, Post, UnauthorizedException } from '@nestjs/common';
import { IsString, IsUUID, Matches, MaxLength } from 'class-validator';

import { FinancialCommitmentService } from './financial-commitment.service';

class InitiateWithdrawalCommitmentDto {
  @IsUUID()
  walletAccountId!: string;

  @IsUUID()
  beneficiaryId!: string;

  @IsString()
  @Matches(/^[1-9]\d{0,18}$/)
  amountMinor!: string;

  @IsString()
  @Matches(/^NGN$/)
  currency!: string;

  @IsString()
  @Matches(/^\d{4,12}$/)
  @MaxLength(12)
  pin!: string;
}

/** Customer-self initiation only. This never submits to a provider; unavailable execution
 * authority makes the registered production boundary fail closed. */
@Controller('customers/me/withdrawal-commitments')
export class FinancialCommitmentController {
  constructor(private readonly commitments: FinancialCommitmentService) {}

  @Post()
  @HttpCode(201)
  async initiate(
    @Body() dto: InitiateWithdrawalCommitmentDto,
    @Headers('authorization') authorization?: string,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const token =
      typeof authorization === 'string'
        ? /^Bearer ([A-Za-z0-9_-]{43})$/.exec(authorization)?.[1]
        : undefined;
    if (!token) throw new UnauthorizedException('Customer session required');
    const result = await this.commitments.initiate({
      ...dto,
      token,
      idempotencyKey: idempotencyKey ?? '',
    });
    return {
      commitmentId: result.commitment.id,
      withdrawalId: result.commitment.withdrawal_id,
      externalOperationId: result.commitment.external_operation_id,
      state: result.commitment.state,
      replayed: result.replayed,
      /** Null when no banking dispatch intent exists for this commitment. */
      operationReference: result.operationReference,
    };
  }

  @Get('by-idempotency/:idempotencyKey')
  async byIdempotency(
    @Param('idempotencyKey') idempotencyKey: string,
    @Headers('authorization') authorization?: string,
  ) {
    const token =
      typeof authorization === 'string'
        ? /^Bearer ([A-Za-z0-9_-]{43})$/.exec(authorization)?.[1]
        : undefined;
    if (!token) throw new UnauthorizedException('Customer session required');
    // Reuse initiate path's session validation (valid session => principal) without needing PIN.
    // We only need to resolve customerId from the session — use the same session service via initiate's internal.
    // Instead, decode via commitments service that validates via AuthenticationSessionService.
    // For now, call lookup via a dedicated helper that validates session internally.
    // To avoid duplicating session logic, we delegate to a new service helper that takes token.
    const customerId = await this.commitments.resolveCustomerIdFromToken(token);
    const found = await this.commitments.lookupByIdempotencyForCustomer(customerId, idempotencyKey);
    if (!found) throw new NotFoundException('Commitment not found');
    return {
      commitmentId: found.commitment.id,
      state: found.commitment.state,
      operationReference: found.operationReference,
    };
  }
}
