import { IsOptional, IsString, IsUUID, Length, MaxLength } from 'class-validator';

export class CreateTerminalDto {
  @IsString()
  @Length(3, 80)
  reference!: string;

  @IsOptional()
  @IsString()
  @Length(3, 80)
  code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  label?: string;

  @IsUUID()
  outletId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  serialNumber?: string;
}
