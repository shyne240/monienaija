import { Body, Controller, Headers, HttpCode, Post, UnauthorizedException } from '@nestjs/common';
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
    };
  }
}
