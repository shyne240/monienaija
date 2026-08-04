import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

import { CustomerApprovalDecisionStatus } from '../customer-onboarding.enums';

export class CreateCustomerApprovalDecisionDto {
  @IsEnum(CustomerApprovalDecisionStatus)
  decision!: CustomerApprovalDecisionStatus;

  @IsString()
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @MaxLength(500)
  reason?: string;

  @IsString()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(1)
  @MaxLength(160)
  decidedBy!: string;
}
