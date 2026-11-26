import {
  IsIn,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/**
 * Body of `POST /api/v1/internal/a2/workforce/roles/approval-requests`.
 *
 * Prepares the maker-checker approval a governed role change needs, and returns its id. The
 * fingerprint is computed by `A2FinanceRoleAdministrationService.fingerprint()` — the same method
 * the consuming assignment path compares against — so a client never has to reproduce the hash
 * (and can no longer substitute a hand-typed approval id for a different change).
 */
export class PrepareRoleChangeApprovalDto {
  @IsIn(['ASSIGN', 'REVOKE'])
  operation!: 'ASSIGN' | 'REVOKE';

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
  @IsInt()
  @Min(1)
  expectedVersion?: number;

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason!: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  approvalScope?: string;
}
