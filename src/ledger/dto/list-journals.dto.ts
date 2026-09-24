import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * A5T12 — query parameters for the read-only ledger journal listing.
 *
 * Mirrors the existing repository query-DTO convention (see `CustomerQueryDto`).
 * The global ValidationPipe runs with `whitelist` and `forbidNonWhitelisted`,
 * so an unrecognized query parameter is rejected rather than silently ignored.
 *
 * Deliberately pagination-only: no filters are introduced in this first
 * implementation.
 */
export class ListJournalsDto {
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
