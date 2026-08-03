import { Transform } from 'class-transformer';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

function trimString(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class AssignVirtualAccountDto {
  @IsString()
  @Matches(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
  walletId!: string;

  @IsString()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @Matches(/^[A-Z0-9]{3,20}$/)
  bankCode!: string;

  @IsString()
  @Transform(({ value }: { value: unknown }) => trimString(value))
  @Matches(/^\d{4,32}$/)
  accountNumber!: string;

  @IsString()
  @Transform(({ value }: { value: unknown }) => trimString(value))
  @MinLength(2)
  @MaxLength(160)
  accountName!: string;

  @IsString()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @Matches(/^[A-Z0-9_.:-]{2,80}$/)
  provider!: string;
}
