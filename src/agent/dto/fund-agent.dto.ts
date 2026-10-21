import { IsOptional, IsString, IsUUID, Length, Matches } from 'class-validator';

export class FundAgentDto {
  @IsString()
  @Length(1, 255)
  idempotencyKey!: string;

  // minor units as string to avoid float, e.g., "1000"
  @IsString()
  @Matches(/^\d+$/, { message: 'amountMinor must be a positive integer string' })
  amountMinor!: string;

  @IsOptional()
  @IsString()
  @Length(1, 3)
  currency?: string;

  @IsOptional()
  @IsString()
  @Length(1, 255)
  reference?: string;

  @IsOptional()
  @IsString()
  @Length(1, 255)
  correlationId?: string;

  @IsOptional()
  @IsString()
  @Length(1, 255)
  description?: string;

  @IsOptional()
  @IsString()
  metadata?: Record<string, unknown>;
}

export class DefundAgentDto extends FundAgentDto {}

export class AggregatorFundAgentDto extends FundAgentDto {
  // aggregatorId is path param, not body, but DTO may be used for validation
}
