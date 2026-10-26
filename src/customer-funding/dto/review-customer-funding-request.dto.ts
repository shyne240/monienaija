import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ApproveCustomerFundingRequestDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  correlationId?: string;
}

export class RejectCustomerFundingRequestDto {
  @IsString()
  @MaxLength(500)
  reason!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  correlationId?: string;
}
