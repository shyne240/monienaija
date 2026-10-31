import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength } from 'class-validator';

function trimString(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

/**
 * Body of `POST /api/v1/internal/a2/workforce/approvals/:id/approve`.
 *
 * The decision comment is recorded in the audit and security-event payloads, so it is bounded like
 * the other free-text approval fields instead of being an unbounded jsonb payload. The approval id,
 * approver eligibility and separation-of-duties rules stay with the domain service.
 */
export class DecidePrivilegedApprovalDto {
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => trimString(value))
  @IsString()
  @MaxLength(500)
  comment?: string;
}
