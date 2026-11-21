import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
  Validate,
} from 'class-validator';

import { CustomerFieldPolicyConstraint } from '../../customer/customer-validation.constraints';
import { CustomerClassConfigurationStatus, CustomerClassStatus } from '../customer-class.enums';

const CLASS_CODE = /^[A-Z0-9_]{3,80}$/;

export class CreateCustomerClassDto {
  /** Optional catalogue reference; defaults to CUSTOMER-CLASS-<code>. */
  @IsOptional()
  @IsString()
  @MaxLength(80)
  @Matches(/^[A-Za-z0-9._-]{3,80}$/)
  reference?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  @Matches(CLASS_CODE, { message: 'code must match ^[A-Z0-9_]{3,80}$' })
  code!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @Validate(CustomerFieldPolicyConstraint, ['name', 160])
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string | null;

  @IsOptional()
  @IsIn(Object.values(CustomerClassStatus))
  status?: CustomerClassStatus;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsIn(Object.values(CustomerClassConfigurationStatus))
  configurationStatus?: CustomerClassConfigurationStatus;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class UpdateCustomerClassDto {
  @IsOptional()
  @IsString()
  @MaxLength(160)
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string | null;

  @IsOptional()
  @IsIn(Object.values(CustomerClassStatus))
  status?: CustomerClassStatus;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsIn(Object.values(CustomerClassConfigurationStatus))
  configurationStatus?: CustomerClassConfigurationStatus;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

export class AssignCustomerClassDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  @Matches(CLASS_CODE, { message: 'classCode must match ^[A-Z0-9_]{3,80}$' })
  classCode!: string;

  @IsString()
  @MinLength(3)
  @MaxLength(500)
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  reason!: string;

  /** Optimistic concurrency against the live assignment row. */
  @IsOptional()
  @IsInt()
  @Min(1)
  expectedVersion?: number;

  /** Coordination-contract snake_case alias. */
  @IsOptional()
  @IsInt()
  @Min(1)
  expected_version?: number;

  @IsOptional()
  @IsISO8601({ strict: true })
  effective_from?: string;

  /** Optional effective timestamp (ISO-8601). Never in the future. */
  @IsOptional()
  @IsISO8601({ strict: true })
  effectiveFrom?: string;
}
