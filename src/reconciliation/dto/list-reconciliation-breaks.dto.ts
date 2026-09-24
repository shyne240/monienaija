import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * A5T14 — query parameters for the read-only reconciliation break detail.
 *
 * Mirrors the repository's established query-DTO convention (see
 * `ListJournalsDto` and `CustomerQueryDto`). The global ValidationPipe runs
 * with `whitelist` and `forbidNonWhitelisted`, so an unrecognized query
 * parameter is rejected rather than silently ignored.
 *
 * Pagination only: the existing reconciliation architecture defines no approved
 * filter vocabulary for breaks, so none is invented here.
 */
export class ListReconciliationBreaksDto {
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
