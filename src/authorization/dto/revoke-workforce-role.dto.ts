import { IsArray, IsISO8601, IsInt, IsOptional, IsUUID, Min } from 'class-validator';

/**
 * Body of `DELETE /api/v1/internal/a2/workforce/roles/:principalId/:roleKey`.
 *
 * `approvalIds` is part of the declared request contract (the maker-checker policy decides how many
 * distinct approvals are required), so its shape is validated here while the *count*, distinctness
 * and self-approval rules stay with the domain service.
 */
export class RevokeWorkforceRoleDto {
  @IsISO8601()
  effectiveFrom!: string;

  @IsISO8601()
  effectiveTo!: string;

  @IsArray()
  @IsUUID(undefined, { each: true })
  approvalIds!: string[];

  @IsOptional()
  @IsInt()
  @Min(1)
  expectedVersion?: number;
}
