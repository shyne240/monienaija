import { IsInt, IsOptional, IsString, Length, MaxLength, Min, ValidateIf } from 'class-validator';

/** Only mutable location metadata; ownership, reference, code and lifecycle are separate. */
export class UpdateOutletMetadataDto {
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @Length(2, 320)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  displayName?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  addressLine?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  state?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  country?: string | null;
}
