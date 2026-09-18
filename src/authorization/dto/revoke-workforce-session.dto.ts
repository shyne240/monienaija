import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Body of `DELETE /api/v1/internal/a2/workforce/sessions/:id`.
 *
 * The revocation reason is persisted in `workforce_session.revoke_reason` (varchar(500)), so the
 * bound mirrors the stored column: an oversized or empty reason is a client error instead of silent
 * truncation or an empty audit trail.
 */
export class RevokeWorkforceSessionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason!: string;
}
