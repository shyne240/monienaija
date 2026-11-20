import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { PrivilegedActionApprovalStatus } from '../privileged-action-approval.enums';

export class ListPrivilegedApprovalsDto {
  @IsOptional()
  @IsEnum(PrivilegedActionApprovalStatus)
  status?: PrivilegedActionApprovalStatus;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  actionType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  resourceType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  institutionId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}
