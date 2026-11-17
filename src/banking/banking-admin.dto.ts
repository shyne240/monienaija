import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/**
 * Request bodies for the administrative banking surface.
 *
 * These are explicit DTOs rather than `Record<string, unknown>` on purpose. A loosely-typed body makes
 * every field a runtime guess, which is how a `[object Object]` ends up in an audit record or a
 * provider configuration. Typing them also means the global `ValidationPipe` rejects an unknown field
 * combination before any handler runs.
 *
 * No DTO on this surface accepts a secret. Provider credentials are represented by a fingerprint of a
 * bundle held elsewhere; the value itself never crosses this boundary in either direction.
 */
export class ProposeProviderConfigurationDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  requestId!: string;

  // Optimistic concurrency: the caller states the version it read, so a proposal cannot silently
  // overwrite a decision that happened in between.
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  providerKey!: string;

  @IsIn(['sandbox', 'production'])
  environment!: 'sandbox' | 'production';

  @IsObject()
  definition!: Record<string, unknown>;

  /**
   * A fingerprint of the credential bundle, never the bundle. Null means "no credentials referenced",
   * which is a legitimate state for a configuration that is being staged before credentialing.
   */
  @IsOptional()
  @IsString()
  @MaxLength(128)
  credentialBundleFingerprint?: string | null;

  @IsBoolean()
  routingApproved!: boolean;

  @IsBoolean()
  operationalReady!: boolean;

  @IsString()
  @MinLength(8)
  @MaxLength(2000)
  reason!: string;
}

export class DecideProviderProposalDto {
  @IsBoolean()
  approve!: boolean;
}

export class StartReconciliationDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  providerKey!: string;
}

export class ResolveReconciliationExceptionDto {
  @IsIn(['MATCHED', 'ACCEPTED_DIFFERENCE', 'ESCALATED'])
  resolution!: 'MATCHED' | 'ACCEPTED_DIFFERENCE' | 'ESCALATED';

  @IsString()
  @MinLength(4)
  @MaxLength(2000)
  note!: string;
}
