import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';

import { ProductGovernanceKind, ProductGovernanceStatus } from '../product-governance.enums';

export class ProductGovernanceQueryDto {
  @IsEnum(ProductGovernanceKind)
  @IsOptional()
  kind?: ProductGovernanceKind;

  @IsEnum(ProductGovernanceStatus)
  @IsOptional()
  status?: ProductGovernanceStatus;

  @Type(() => Number)
  @IsInt()
  @IsOptional()
  @Min(1)
  @Max(500)
  limit?: number;
}
