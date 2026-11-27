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

import {
  RETURN_DISPUTE_DECISIONS,
  SETTLEMENT_DECISIONS,
  SETTLEMENT_REPORT_TYPES,
  STATEMENT_DESTINATIONS,
  TRANSACTION_MATCH_DECISIONS,
  type ReturnDisputeResolutionDecision,
  type SettlementDecision,
  type SettlementReportType,
  type StatementDestination,
  type TransactionMatchDecision,
} from '../settlement-reconciliation.types';

function trim(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class ImportSettlementReportDto {
  @IsOptional()
  @IsString()
  @Matches(UUID_PATTERN)
  institutionId?: string;

  @IsString()
  @Transform(({ value }) => trim(value))
  @MinLength(2)
  @MaxLength(64)
  providerKey!: string;

  @IsIn(SETTLEMENT_REPORT_TYPES)
  reportType!: SettlementReportType;

  @IsString()
  @Transform(({ value }) => trim(value))
  @MinLength(1)
  @MaxLength(255)
  fileName!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(4_000_000)
  content!: string;

  @IsOptional()
  @IsISO8601({ strict: false })
  periodStart?: string;

  @IsOptional()
  @IsISO8601({ strict: false })
  periodEnd?: string;

  @IsOptional()
  @IsIn(STATEMENT_DESTINATIONS)
  statementDestination?: StatementDestination;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{3}$/)
  defaultCurrency?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => trim(value))
  @MaxLength(500)
  note?: string;
}

export class ListSettlementReconciliationQueryDto {
  @IsOptional()
  @IsString()
  @Matches(UUID_PATTERN)
  institutionId?: string;

  @IsOptional()
  @IsIn(SETTLEMENT_REPORT_TYPES)
  reportType?: SettlementReportType;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  status?: string;

  @IsOptional()
  @IsString()
  @Matches(UUID_PATTERN)
  importId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  search?: string;
}

export class ProposeTransactionMatchResolutionDto {
  @IsIn(TRANSACTION_MATCH_DECISIONS)
  decision!: TransactionMatchDecision;

  @IsOptional()
  @IsString()
  @Matches(UUID_PATTERN)
  selectedCandidateId?: string;

  @IsOptional()
  @IsString()
  @Matches(UUID_PATTERN)
  linkedJournalId?: string;

  @IsString()
  @Transform(({ value }) => trim(value))
  @MinLength(5)
  @MaxLength(1000)
  note!: string;
}

export class ProposeSettlementMatchResolutionDto {
  @IsIn(SETTLEMENT_DECISIONS)
  decision!: SettlementDecision;

  @IsOptional()
  @IsString()
  @Matches(UUID_PATTERN)
  linkedStatementRowId?: string;

  @IsOptional()
  @IsString()
  @Matches(UUID_PATTERN)
  linkedJournalId?: string;

  @IsOptional()
  @IsString()
  @Matches(UUID_PATTERN)
  linkedComparisonId?: string;

  @IsString()
  @Transform(({ value }) => trim(value))
  @MinLength(5)
  @MaxLength(1000)
  note!: string;
}

export class ProposeReturnDisputeResolutionDto {
  @IsIn(RETURN_DISPUTE_DECISIONS)
  decision!: ReturnDisputeResolutionDecision;

  @IsOptional()
  @IsString()
  @Matches(UUID_PATTERN)
  linkedJournalId?: string;

  @IsOptional()
  @IsString()
  @Matches(UUID_PATTERN)
  linkedInternalDisputeId?: string;

  @IsString()
  @Transform(({ value }) => trim(value))
  @MinLength(5)
  @MaxLength(1000)
  note!: string;
}

export class ReviewReconciliationProposalDto {
  @IsIn(['APPROVE', 'REJECT'])
  decision!: 'APPROVE' | 'REJECT';

  @IsString()
  @Transform(({ value }) => trim(value))
  @MinLength(5)
  @MaxLength(1000)
  note!: string;
}
