import { IsBoolean, IsOptional, IsString, Length } from 'class-validator';

export class UpdateAgentClassDto {
  @IsOptional()
  @IsString()
  @Length(1, 160)
  name?: string;

  @IsOptional()
  @IsString()
  @Length(1, 500)
  description?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  requirements?: Record<string, unknown>;

  @IsOptional()
  requiredInformation?: unknown;

  @IsOptional()
  requiredDocumentCategories?: unknown;

  @IsOptional()
  applicableServices?: unknown;

  @IsOptional()
  applicableLimits?: unknown;

  @IsOptional()
  expectedVersion?: number;
}
