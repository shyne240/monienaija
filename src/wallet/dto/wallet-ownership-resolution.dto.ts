import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

import {
  WalletOwnershipEvidenceType,
  WalletOwnershipResolutionClass,
} from '../wallet-ownership-resolution.enums';

const trim = (value: unknown): unknown => (typeof value === 'string' ? value.trim() : value);

/**
 * Maker request for a governed REVIEW -> CUSTOMER / AGENT / SYSTEM ownership resolution.
 *
 * The caller supplies only the decision and the evidence it is based on. The approval fingerprint,
 * the evidence digest/summary and every authoritative fact are computed server-side.
 */
export class RequestWalletOwnershipResolutionDto {
  @IsEnum(WalletOwnershipResolutionClass)
  resolutionClass!: WalletOwnershipResolutionClass;

  /** Authoritative customer or agent UUID; required for CUSTOMER/AGENT, forbidden for SYSTEM. */
  @IsOptional()
  @Transform(({ value }) => trim(value))
  @IsUUID()
  targetOwnerId?: string;

  /** Registered `wallet_system_owners.code`; required for SYSTEM only. */
  @IsOptional()
  @Transform(({ value }) => trim(value))
  @IsString()
  @MaxLength(40)
  @Matches(/^[A-Za-z][A-Za-z0-9_]{2,39}$/)
  systemOwnerCode?: string;

  @IsEnum(WalletOwnershipEvidenceType)
  evidenceType!: WalletOwnershipEvidenceType;

  @IsString()
  @Transform(({ value }) => trim(value))
  @MinLength(1)
  @MaxLength(160)
  evidenceReference!: string;

  @IsString()
  @Transform(({ value }) => trim(value))
  @MinLength(1)
  @MaxLength(500)
  reason!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(60)
  @Max(86_400)
  expiresInSeconds?: number;
}

/** Checker execution; must repeat the exact approved payload plus the approval id. */
export class ExecuteWalletOwnershipResolutionDto extends RequestWalletOwnershipResolutionDto {
  @Transform(({ value }) => trim(value))
  @IsUUID()
  approvalId!: string;
}
