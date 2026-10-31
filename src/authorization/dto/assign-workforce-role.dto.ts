import {
  IsArray,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/**
 * Body of `POST /api/v1/internal/a2/workforce/roles`.
 *
 * Only the transport shape is validated here. The role vocabulary comes from configuration
 * (`A2_FINANCE_ROLES_JSON`), the assignment window, maker-checker policy, MFA assurance and the
 * `FINANCE_ADMIN` prohibition are all enforced by the role-administration domain service, so an
 * unknown role or an unapproved assignment still fails exactly as before (403), not as a DTO error.
 */
export class AssignWorkforceRoleDto {
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  targetPrincipalId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  roleKey!: string;

  @IsISO8601()
  effectiveFrom!: string;

  @IsISO8601()
  effectiveTo!: string;

  @IsOptional()
  @IsArray()
  @IsUUID(undefined, { each: true })
  approvalIds?: string[];

  @IsOptional()
  @IsInt()
  @Min(1)
  expectedVersion?: number;
}
