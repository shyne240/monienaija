import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';

import { PrivilegedActionApprovalStatus } from '../privileged-action-approval.enums';

/**
 * A2T12 — query parameters for the read-only privileged-approval listing.
 *
 * Mirrors the existing repository query-DTO convention (see `CustomerQueryDto`).
 * The global ValidationPipe runs with `whitelist` and `forbidNonWhitelisted`,
 * so any unrecognized query parameter is rejected rather than ignored.
 */
export class PrivilegedApprovalQueryDto {
  @IsEnum(PrivilegedActionApprovalStatus)
  @IsOptional()
  status?: PrivilegedActionApprovalStatus;

  @Type(() => Number)
  @IsInt()
  @IsOptional()
  @Min(1)
  page?: number;

  @Type(() => Number)
  @IsInt()
  @IsOptional()
  @Min(1)
  @Max(100)
  limit?: number;
}
