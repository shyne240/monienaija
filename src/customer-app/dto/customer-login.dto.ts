import { Transform } from 'class-transformer';
import { IsOptional, IsString, Length } from 'class-validator';

export class CustomerLoginDto {
  /**
   * Accepts customer UUID, customer reference (e.g. mn-8012345678), or
   * Nigerian phone number (e.g. 08012345678, +2348012345678, 8012345678).
   */
  @IsOptional()
  @IsString()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @Length(1, 160)
  customerId?: string;

  /** Alias identifier for customerId / phone / reference */
  @IsOptional()
  @IsString()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @Length(1, 160)
  identifier?: string;

  /** Alias phone field for login */
  @IsOptional()
  @IsString()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @Length(1, 160)
  phone?: string;

  @IsString()
  @Length(1, 1024)
  password!: string;
}
