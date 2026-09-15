import { Transform, Type } from 'class-transformer';
import {
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

function trimString(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

/**
 * Resource the privileged action applies to.
 *
 * `id` is deliberately a bounded string rather than a UUID: approvals issued for finance role
 * administration are keyed by the assignment reference (for example `a2-fin-role-<hash>`), which is
 * what the consuming domain path compares against. The stored column is varchar(255).
 */
export class PrivilegedApprovalResourceDto {
  @Transform(({ value }: { value: unknown }) => trimString(value))
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  type!: string;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => trimString(value))
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  id?: string;
}

/**
 * Body of `POST /api/v1/internal/a2/workforce/approvals/request`.
 *
 * Mirrors the bounds the approval service already enforces (SHA-256 hex fingerprint, reason and
 * approval scope limits, stored column widths) so malformed input is rejected before the domain
 * layer. The maker-checker policy for `action` (unknown action, missing rule, authorisation) is
 * unchanged and still evaluated by the service.
 */
export class RequestPrivilegedApprovalDto {
  @Transform(({ value }: { value: unknown }) => trimString(value))
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  action!: string;

  @IsObject()
  @ValidateNested()
  @Type(() => PrivilegedApprovalResourceDto)
  resource!: PrivilegedApprovalResourceDto;

  @Transform(({ value }: { value: unknown }) => trimString(value))
  @IsString()
  @Matches(/^[a-f0-9]{64}$/i)
  actionFingerprint!: string;

  @Transform(({ value }: { value: unknown }) => trimString(value))
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason!: string;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => trimString(value))
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  approvalScope?: string;
}
