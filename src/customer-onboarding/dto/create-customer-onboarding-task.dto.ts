import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

import {
  CustomerOnboardingTaskStatus,
  CustomerOnboardingTaskType,
} from '../customer-onboarding.enums';

export class CreateCustomerOnboardingTaskDto {
  @IsEnum(CustomerOnboardingTaskType)
  type!: CustomerOnboardingTaskType;

  @IsEnum(CustomerOnboardingTaskStatus)
  @IsOptional()
  status: CustomerOnboardingTaskStatus = CustomerOnboardingTaskStatus.PENDING;

  @IsBoolean()
  isRequired!: boolean;

  @IsString()
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(1)
  @MaxLength(160)
  completedBy?: string;

  @IsString()
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @MaxLength(500)
  notes?: string;

  @IsString()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(1)
  @MaxLength(160)
  actor!: string;
}
