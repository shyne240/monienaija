import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsString, MaxLength, MinLength } from 'class-validator';

import { ContactMethodType } from '../customer.enums';

export class CreateContactMethodDto {
  @IsEnum(ContactMethodType)
  type!: ContactMethodType;

  @IsString()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(1)
  @MaxLength(255)
  value!: string;

  @IsBoolean()
  isPrimary!: boolean;

  @IsString()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(1)
  @MaxLength(160)
  actor!: string;
}
