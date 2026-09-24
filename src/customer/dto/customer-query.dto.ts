import { Transform, Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';

import {
  CustomerKycLevel,
  CustomerKycStatus,
  CustomerStatus,
  CustomerType,
} from '../customer.enums';

/**
 * A1T28 — normalizes a repeated or comma-separated query parameter into a
 * string array so each status dimension can carry multiple values.
 *
 * Accepts both established shapes: `?status=ACTIVE&status=SUSPENDED` and
 * `?status=ACTIVE,SUSPENDED`. A single value (`?status=ACTIVE`) still works
 * exactly as before, so existing callers are unaffected. An empty value is
 * treated as "no filter" rather than an empty match; an unknown value is
 * rejected by `@IsEnum(..., { each: true })`.
 */
function toMultiValue({ value }: { value: unknown }): unknown {
  if (value === undefined || value === null) return undefined;
  // Only primitives are meaningful here; anything else is passed through
  // untouched so @IsEnum reports it rather than being coerced to a string.
  const raw: unknown[] = Array.isArray(value)
    ? (value as unknown[])
    : typeof value === 'string'
      ? value.split(',')
      : [value];
  const isPrimitive = (entry: unknown): entry is string | number =>
    typeof entry === 'string' || typeof entry === 'number';
  // A non-primitive entry is handed back untouched so @IsEnum reports it
  // instead of it being coerced into a meaningless string.
  if (!raw.every(isPrimitive)) return value;
  const normalized = raw.map((entry) => `${entry}`.trim()).filter((entry) => entry.length > 0);
  return normalized.length > 0 ? normalized : undefined;
}

/**
 * A1T28 multi-status customer query.
 *
 * Every field below is an INDEPENDENT status dimension already persisted on the
 * `customers` aggregate. They are never collapsed into a single status field,
 * and one dimension is never inferred from another.
 */
export class CustomerQueryDto {
  /** Customer lifecycle status. Multiple values are OR-ed. */
  @Transform(toMultiValue)
  @IsEnum(CustomerStatus, { each: true })
  @IsOptional()
  status?: CustomerStatus[];

  /** KYC decision status — persisted since A1 but previously not queryable. */
  @Transform(toMultiValue)
  @IsEnum(CustomerKycStatus, { each: true })
  @IsOptional()
  kycStatus?: CustomerKycStatus[];

  /** KYC tier — persisted since A1 but previously not queryable. */
  @Transform(toMultiValue)
  @IsEnum(CustomerKycLevel, { each: true })
  @IsOptional()
  kycLevel?: CustomerKycLevel[];

  /** Customer type. Multiple values are OR-ed. */
  @Transform(toMultiValue)
  @IsEnum(CustomerType, { each: true })
  @IsOptional()
  type?: CustomerType[];

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
