import { Transform } from 'class-transformer';
import {
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

function trim(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

const MINOR_UNITS_SIGNED = /^-?\d{1,19}$/;

/** Staff-selected inputs for a comparison. Amounts and money are integer strings, never floats. */
export class CreateComparisonDto {
  @IsString()
  @Matches(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
  settlementAccountId!: string;

  /** Reporting cutoff for the ledger side (posted journals at or before this instant are in scope). */
  @IsISO8601({ strict: true })
  ledgerCutoff!: string;

  /** Cutoff the bank statement Finance verified is made up to. */
  @IsISO8601({ strict: true })
  bankCutoff!: string;

  /** Statement/reference Finance recorded for the independently verified bank balance. */
  @IsString()
  @Transform(({ value }) => trim(value))
  @MinLength(3)
  @MaxLength(255)
  statementReference!: string;

  /** Signed integer minor units of the actual bank balance Finance verified. String, never float. */
  @IsString()
  @Transform(({ value }) => trim(value))
  @Matches(MINOR_UNITS_SIGNED, {
    message: 'bankBalanceMinor must be a signed integer string of minor units',
  })
  bankBalanceMinor!: string;
}

export class UpdateComparisonDto {
  @IsOptional()
  @IsISO8601({ strict: true })
  ledgerCutoff?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  bankCutoff?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => trim(value))
  @MinLength(3)
  @MaxLength(255)
  statementReference?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => trim(value))
  @Matches(MINOR_UNITS_SIGNED, {
    message: 'bankBalanceMinor must be a signed integer string of minor units',
  })
  bankBalanceMinor?: string;
}

export class AddTimingItemDto {
  @IsString()
  @Transform(({ value }) => trim(value))
  @MinLength(3)
  @MaxLength(160)
  title!: string;

  /** The external/internal reference the timing item is evidenced by (statement line, entry ref…). */
  @IsString()
  @Transform(({ value }) => trim(value))
  @MinLength(3)
  @MaxLength(120)
  reference!: string;

  /** Why this item explains part of the difference. Required and reviewed. */
  @IsString()
  @Transform(({ value }) => trim(value))
  @MinLength(3)
  @MaxLength(1000)
  explanation!: string;

  /**
   * Signed integer minor units. Positive explains why the bank holds MORE than the ledger expects
   * (e.g. deposit in transit); negative explains why it holds LESS (e.g. bank charges not yet
   * posted). Zero is refused — a zero line explains nothing.
   */
  @IsString()
  @Transform(({ value }) => trim(value))
  @Matches(/^-?\d{1,18}$/, {
    message: 'amountMinor must be a signed integer string of minor units',
  })
  amountMinor!: string;
}

export class SubmitComparisonDto {
  /** Reason recorded on the governed approval request. MFA session is required by the action. */
  @IsString()
  @Transform(({ value }) => trim(value))
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}

export class ReviewComparisonDto {
  @IsIn(['APPROVE', 'REJECT'])
  decision!: 'APPROVE' | 'REJECT';

  /** The checker's decision note. Recorded verbatim in the approval, the snapshot and the audit. */
  @IsString()
  @Transform(({ value }) => trim(value))
  @MinLength(3)
  @MaxLength(1000)
  reason!: string;
}

export class PreviewComparisonDto {
  @IsString()
  @Matches(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
  settlementAccountId!: string;

  @IsISO8601({ strict: true })
  ledgerCutoff!: string;
}

export class ListComparisonsQueryDto {
  @IsOptional()
  @IsIn(['PLATFORM', 'INSTITUTION'])
  scope?: 'PLATFORM' | 'INSTITUTION';

  @IsOptional()
  @IsIn(['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED'])
  status?: 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED';

  @IsOptional()
  @IsString()
  institutionId?: string;

  @IsOptional()
  limit?: string;

  @IsOptional()
  offset?: string;
}
