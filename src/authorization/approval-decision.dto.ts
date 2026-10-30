import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ApprovalDecisionDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;
}

export class ApprovalRejectionDto extends ApprovalDecisionDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
