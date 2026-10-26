import { IsEmail, IsOptional, IsString, Length, Matches } from 'class-validator';

export class CreateAggregatorDto {
  @IsString()
  @Length(3, 80)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9_.-]{2,79}$/)
  reference!: string;

  @IsString()
  @Length(3, 80)
  @Matches(/^[A-Z0-9][A-Z0-9_.-]{2,79}$/)
  code!: string;

  @IsString()
  @Length(2, 320)
  corporateName!: string;

  @IsOptional()
  @IsString()
  @Length(2, 160)
  displayName?: string;

  @IsOptional()
  @IsEmail()
  @Length(5, 320)
  contactEmail?: string;

  @IsOptional()
  @IsString()
  @Length(7, 20)
  contactPhone?: string;
}
