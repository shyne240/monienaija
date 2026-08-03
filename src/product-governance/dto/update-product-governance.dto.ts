import { Transform } from 'class-transformer';
import { IsEnum, IsObject, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

import { ProductGovernanceStatus } from '../product-governance.enums';

export class UpdateProductGovernanceDto {
  @IsString()
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(1)
  @MaxLength(200)
  name?: string;

  @IsEnum(ProductGovernanceStatus)
  @IsOptional()
  status?: ProductGovernanceStatus;

  @IsObject()
  @IsOptional()
  payload?: Record<string, unknown>;

  @IsString()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(1)
  @MaxLength(160)
  actor!: string;
}
