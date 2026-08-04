import { Transform } from 'class-transformer';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class CreateWalletAliasDto {
  @IsString()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @MinLength(1)
  @MaxLength(160)
  @Matches(/^[a-z0-9][a-z0-9_.:-]{0,159}$/)
  alias!: string;

  @IsString()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(1)
  @MaxLength(160)
  actor!: string;
}
