import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateBeneficiaryDto {
  @IsString()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(1)
  @MaxLength(100)
  nickname!: string;
}
