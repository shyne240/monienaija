import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Body of `POST /api/v1/internal/a2/workforce/bootstrap`.
 *
 * The statement is a signed, canonical-JSON JWS verified against the trusted bootstrap JWKS
 * (environment, audience, principal binding, signing key and single-use nonce are all checked by the
 * bootstrap service). As with the session assertion, the DTO only bounds the transport shape.
 */
export class ConsumeWorkforceBootstrapDto {
  @IsString()
  @MinLength(1)
  @MaxLength(8192)
  statement!: string;
}
