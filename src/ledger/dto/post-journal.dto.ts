import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';

import { LedgerEntryDirection } from '../ledger.enums';

function trimString(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

function normalizeMinorUnitInput(value: unknown): unknown {
  if (typeof value === 'number' && Number.isSafeInteger(value)) {
    return String(value);
  }

  return typeof value === 'string' ? value.trim() : value;
}

export class PostJournalLineDto {
  @IsString()
  @Matches(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
  accountId!: string;

  @IsEnum(LedgerEntryDirection)
  direction!: LedgerEntryDirection;

  /** Integer minor units, serialized as a string to preserve BIGINT precision. */
  @Transform(({ value }: { value: unknown }) => normalizeMinorUnitInput(value))
  @IsString()
  @Matches(/^[1-9]\d*$/)
  amountMinor!: string;
}

export class PostJournalDto {
  /** Also accepted as the Idempotency-Key header by the controller. */
  @IsString()
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => trimString(value))
  @MaxLength(255)
  idempotencyKey?: string;

  @IsString()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @Matches(/^[A-Za-z]{3}$/)
  currency!: string;

  @IsString()
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @Matches(/^[A-Z][A-Z0-9_:-]{1,63}$/)
  accountingUnit?: string;

  @IsString()
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => trimString(value))
  @MaxLength(255)
  reference?: string;

  @IsString()
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => trimString(value))
  @MaxLength(255)
  description?: string;

  @IsString()
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => trimString(value))
  @MaxLength(255)
  correlationId?: string;

  @IsObject()
  @IsOptional()
  metadata?: Record<string, unknown>;

  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => PostJournalLineDto)
  lines!: PostJournalLineDto[];
}

export class ReverseJournalDto {
  @IsString()
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => trimString(value))
  @MaxLength(255)
  idempotencyKey?: string;

  @IsString()
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => trimString(value))
  @MaxLength(255)
  reason?: string;
}
