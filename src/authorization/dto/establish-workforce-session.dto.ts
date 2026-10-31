import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Body of `POST /api/v1/internal/a2/workforce/sessions`.
 *
 * The assertion *is* the credential: possession of a signed, MFA-assured assertion from the
 * configured issuer is what establishes a workforce session. The DTO therefore only bounds the
 * transport shape (a non-empty string within a generous JWS bound); signature, issuer, audience,
 * validity window and MFA assurance are verified by the assertion service against the trusted JWKS,
 * never by the DTO. `MaxLength` is a payload bound, not a security threshold.
 */
export class EstablishWorkforceSessionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(8192)
  idToken!: string;
}
