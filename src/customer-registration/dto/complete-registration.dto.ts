import { Transform } from 'class-transformer';
import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class CompleteRegistrationDto {
  /** Must match (after normalization) the phone that passed OTP verification. */
  @IsString()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(10)
  @MaxLength(20)
  @Matches(/^[+0-9()\-\s]+$/, { message: 'phone must be a Nigerian phone number' })
  phone!: string;

  /** One-time token returned by POST /customers/registration/otp/verify. */
  @IsString()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(20)
  @MaxLength(128)
  verificationToken!: string;

  /** Password for customer self-service authentication. Min 8 characters. */
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password?: string;

  /** Optional customer display name. */
  @IsOptional()
  @IsString()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(1)
  @MaxLength(100)
  displayName?: string;

  /** Optional idempotency key for network retry safety. */
  @IsOptional()
  @IsString()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(8)
  @MaxLength(255)
  idempotencyKey?: string;
}
