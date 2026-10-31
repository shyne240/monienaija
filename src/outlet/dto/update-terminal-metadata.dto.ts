import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

/** Device label and serial only; ownership, reference, code and lifecycle are separate. */
export class UpdateTerminalMetadataDto {
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  label?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  serialNumber?: string | null;
}
