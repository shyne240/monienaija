import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

import {
  CustomerInstitutionEnrolmentStatus,
  FinancialInstitutionStatus,
  FinancialInstitutionType,
  InstitutionAffiliationChangeKind,
  InstitutionAffiliationEvidenceType,
  INSTITUTION_ATTRIBUTION_EVIDENCE_TYPES,
  InstitutionAttributionEvidenceType,
  InstitutionFinancialEligibility,
  LedgerInstitutionalPurpose,
} from '../institution.enums';

const trim = (value: unknown): unknown => (typeof value === 'string' ? value.trim() : value);
const trimUpper = (value: unknown): unknown =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;
const trimLower = (value: unknown): unknown =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

/** Administratively registers an institution. Never confers operational authority. */
export class RegisterInstitutionDto {
  @IsString()
  @Transform(({ value }) => trim(value))
  @MinLength(3)
  @MaxLength(80)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._-]+$/)
  reference!: string;

  @IsString()
  @Transform(({ value }) => trimUpper(value))
  @MinLength(3)
  @MaxLength(40)
  @Matches(/^[A-Z0-9][A-Z0-9_]+$/)
  code!: string;

  @IsString()
  @Transform(({ value }) => trim(value))
  @MinLength(2)
  @MaxLength(320)
  legalName!: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => trim(value))
  @MaxLength(160)
  displayName?: string;

  @IsEnum(FinancialInstitutionType)
  institutionType!: FinancialInstitutionType;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => trim(value))
  @MaxLength(160)
  regulatorName?: string;

  /** Evidence for verification only. It never activates financial services. */
  @IsOptional()
  @IsString()
  @Transform(({ value }) => trim(value))
  @MaxLength(160)
  licenceReference?: string;
}

/** Records regulatory evidence. Administrative; authority requires a separate approval. */
export class RecordRegulatoryEvidenceDto {
  @IsString()
  @Transform(({ value }) => trim(value))
  @MinLength(1)
  @MaxLength(160)
  evidenceReference!: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => trimLower(value))
  @Matches(/^[a-f0-9]{64}$/)
  evidenceDigest?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => trim(value))
  @MaxLength(160)
  regulatorName?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => trim(value))
  @MaxLength(160)
  licenceReference?: string;
}

export class RequestInstitutionLifecycleDto {
  @IsEnum(FinancialInstitutionStatus)
  targetStatus!: FinancialInstitutionStatus;

  @IsString()
  @Transform(({ value }) => trim(value))
  @MinLength(10)
  @MaxLength(500)
  reason!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(60)
  @Max(86400)
  expiresInSeconds?: number;
}

export class ExecuteInstitutionLifecycleDto extends RequestInstitutionLifecycleDto {
  @IsUUID()
  @Transform(({ value }) => trim(value))
  approvalId!: string;
}

export class RequestInstitutionAffiliationDto {
  @IsUUID()
  @Transform(({ value }) => trim(value))
  institutionId!: string;

  @IsEnum(InstitutionAffiliationChangeKind)
  changeKind!: InstitutionAffiliationChangeKind;

  @IsEnum(InstitutionAffiliationEvidenceType)
  evidenceType!: InstitutionAffiliationEvidenceType;

  @IsString()
  @Transform(({ value }) => trim(value))
  @MinLength(1)
  @MaxLength(160)
  evidenceReference!: string;

  @IsString()
  @Transform(({ value }) => trim(value))
  @MinLength(10)
  @MaxLength(500)
  reason!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(60)
  @Max(86400)
  expiresInSeconds?: number;
}

export class ExecuteInstitutionAffiliationDto extends RequestInstitutionAffiliationDto {
  @IsUUID()
  @Transform(({ value }) => trim(value))
  approvalId!: string;
}

export class LinkAggregatorDto {
  @IsUUID()
  @Transform(({ value }) => trim(value))
  aggregatorId!: string;
}

export class GrantInstitutionScopeDto {
  @IsString()
  @Transform(({ value }) => trim(value))
  @MinLength(3)
  @MaxLength(160)
  principalId!: string;
}

export class AttributionGapQueryDto {
  @IsOptional()
  @IsUUID()
  @Transform(({ value }) => trim(value))
  entityId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;
}

// ------------------------------------------------------- ARENA 4 Phase 2: financial ownership

/**
 * KYC reuse declaration. The triad is all-or-nothing: evidence + consent + applicable policy are
 * required together, and the service additionally proves the customer actually holds reusable KYC.
 */
export class KycReuseDto {
  @IsString()
  @Transform(({ value }) => trim(value))
  @MinLength(1)
  @MaxLength(160)
  evidenceReference!: string;

  @IsString()
  @Transform(({ value }) => trim(value))
  @MinLength(1)
  @MaxLength(160)
  consentReference!: string;

  @IsString()
  @Transform(({ value }) => trim(value))
  @MinLength(1)
  @MaxLength(160)
  policyReference!: string;
}

export class RequestEnrolmentDto {
  @IsUUID()
  @Transform(({ value }) => trim(value))
  customerId!: string;

  @IsString()
  @Transform(({ value }) => trim(value))
  @MinLength(3)
  @MaxLength(80)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._-]+$/)
  reference!: string;

  @IsEnum(CustomerInstitutionEnrolmentStatus)
  targetStatus!: CustomerInstitutionEnrolmentStatus;

  @IsOptional()
  @IsEnum(InstitutionFinancialEligibility)
  financialEligibility?: InstitutionFinancialEligibility;

  @IsString()
  @Transform(({ value }) => trim(value))
  @MinLength(10)
  @MaxLength(500)
  statusReason!: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => KycReuseDto)
  kycReuse?: KycReuseDto;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(60)
  @Max(86400)
  expiresInSeconds?: number;
}

export class ExecuteEnrolmentDto extends RequestEnrolmentDto {
  @IsUUID()
  @Transform(({ value }) => trim(value))
  approvalId!: string;
}

export class RequestWalletAttributionDto {
  @IsUUID()
  @Transform(({ value }) => trim(value))
  walletId!: string;

  @IsIn([...INSTITUTION_ATTRIBUTION_EVIDENCE_TYPES])
  evidenceType!: InstitutionAttributionEvidenceType;

  @IsString()
  @Transform(({ value }) => trim(value))
  @MinLength(1)
  @MaxLength(160)
  evidenceReference!: string;

  @IsString()
  @Transform(({ value }) => trim(value))
  @MinLength(10)
  @MaxLength(500)
  reason!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(60)
  @Max(86400)
  expiresInSeconds?: number;
}

export class ExecuteWalletAttributionDto extends RequestWalletAttributionDto {
  @IsUUID()
  @Transform(({ value }) => trim(value))
  approvalId!: string;
}

export class OpenInstitutionLedgerAccountDto {
  @IsString()
  @Transform(({ value }) => trim(value))
  @MinLength(3)
  @MaxLength(100)
  code!: string;

  @IsString()
  @Transform(({ value }) => trim(value))
  @MinLength(2)
  @MaxLength(160)
  name!: string;

  @IsIn(['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'])
  accountType!: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';

  @IsIn(['DEBIT', 'CREDIT'])
  normalBalance!: 'DEBIT' | 'CREDIT';

  @IsString()
  @Transform(({ value }) => trimUpper(value))
  @Matches(/^[A-Z]{3}$/)
  currency!: string;

  @IsIn([
    LedgerInstitutionalPurpose.SETTLEMENT,
    LedgerInstitutionalPurpose.SUSPENSE,
    LedgerInstitutionalPurpose.CLEARING,
  ])
  purpose!:
    | LedgerInstitutionalPurpose.SETTLEMENT
    | LedgerInstitutionalPurpose.SUSPENSE
    | LedgerInstitutionalPurpose.CLEARING;

  @IsOptional()
  @IsBoolean()
  allowNegativeBalance?: boolean;
}

export class DesignatePlatformLedgerAccountDto {
  @IsUUID()
  @Transform(({ value }) => trim(value))
  ledgerAccountId!: string;
}

export class FinancialContextQueryDto {
  @IsOptional()
  @IsUUID()
  @Transform(({ value }) => trim(value))
  institutionId?: string;

  @IsOptional()
  @IsUUID()
  @Transform(({ value }) => trim(value))
  agentId?: string;

  @IsOptional()
  @IsUUID()
  @Transform(({ value }) => trim(value))
  customerId?: string;

  @IsOptional()
  @IsArray()
  @IsUUID(undefined, { each: true })
  walletIds?: string[];

  @IsOptional()
  @IsArray()
  @IsUUID(undefined, { each: true })
  ledgerAccountIds?: string[];
}
