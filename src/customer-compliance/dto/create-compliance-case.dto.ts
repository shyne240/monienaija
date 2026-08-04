import { Transform } from 'class-transformer';
import { IsEnum, IsString, Matches, MaxLength, MinLength } from 'class-validator';

import { ComplianceCaseCategory, ComplianceCaseSeverity } from '../customer-compliance.enums';

export class CreateComplianceCaseDto {
  @IsString()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @MinLength(1)
  @MaxLength(100)
  @Matches(/^[a-z0-9][a-z0-9_.:-]{0,99}$/)
  caseNumber!: string;

  @IsEnum(ComplianceCaseCategory)
  category!: ComplianceCaseCategory;

  @IsEnum(ComplianceCaseSeverity)
  severity!: ComplianceCaseSeverity;

  @IsString()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(1)
  @MaxLength(160)
  actor!: string;
}
