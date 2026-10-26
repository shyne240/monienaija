import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min, isUUID } from 'class-validator';

import { CustomerProofOfAddressDocumentStatus } from './customer-proof-of-address.enums';

export class ListProofOfAddressDocumentsDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;

  @IsOptional()
  @IsEnum(CustomerProofOfAddressDocumentStatus)
  documentStatus?: CustomerProofOfAddressDocumentStatus;
}

export class WithdrawProofOfAddressDocumentDto {
  @IsString()
  @MaxLength(1000)
  reason!: string;
}

export class ArchiveProofOfAddressDocumentDto {
  @IsString()
  @MaxLength(1000)
  reason!: string;
}

export class ProofOfAddressHistoryQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}

export interface ProofOfAddressUploadFields {
  residentialAddressId: string;
  category: string;
  documentType: string;
  issuerName?: string;
  documentDate?: string;
  supersedesSubmissionId?: string;
}

export function parseUploadFields(fields: Record<string, string>): ProofOfAddressUploadFields {
  const allowed = new Set([
    'residentialAddressId',
    'category',
    'documentType',
    'issuerName',
    'documentDate',
    'supersedesSubmissionId',
  ]);
  for (const key of Object.keys(fields)) {
    if (!allowed.has(key)) throw new Error(`Unexpected upload field: ${key}`);
  }
  const residentialAddressId = fields.residentialAddressId?.trim();
  const category = fields.category?.trim();
  const documentType = fields.documentType?.trim();
  if (!residentialAddressId || !category || !documentType) {
    throw new Error('residentialAddressId, category, and documentType are required');
  }
  if (!isUUID(residentialAddressId)) throw new Error('residentialAddressId must be a UUID');
  if (category.length > 60 || documentType.length > 100) {
    throw new Error('Proof of Address classification is too long');
  }
  const issuerName = fields.issuerName?.trim();
  if (issuerName && issuerName.length > 200) throw new Error('issuerName is too long');
  const documentDate = fields.documentDate?.trim();
  if (documentDate && !isValidCalendarDate(documentDate)) {
    throw new Error('documentDate must be a valid YYYY-MM-DD calendar date');
  }
  const supersedesSubmissionId = fields.supersedesSubmissionId?.trim();
  if (supersedesSubmissionId && !isUUID(supersedesSubmissionId)) {
    throw new Error('supersedesSubmissionId must be a UUID');
  }
  return {
    residentialAddressId,
    category,
    documentType,
    ...(issuerName ? { issuerName } : {}),
    ...(documentDate ? { documentDate } : {}),
    ...(supersedesSubmissionId ? { supersedesSubmissionId } : {}),
  };
}

function isValidCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}
