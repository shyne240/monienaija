import { IsOptional, IsString, Length, MaxLength } from 'class-validator';

export class CreateOutletDto {
  @IsString()
  @Length(3, 80)
  reference!: string;

  @IsOptional()
  @IsString()
  @Length(3, 80)
  code?: string;

  @IsString()
  @Length(2, 320)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  displayName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  addressLine?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  state?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  country?: string;
}
