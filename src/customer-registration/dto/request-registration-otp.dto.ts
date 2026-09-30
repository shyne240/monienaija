import { Transform } from 'class-transformer';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class RequestRegistrationOtpDto {
  /** Nigerian mobile in any accepted rendering: 08XXXXXXXXX, 8XXXXXXXXX, +2348XXXXXXXXX, 2348XXXXXXXXX. */
  @IsString()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(10)
  @MaxLength(20)
  @Matches(/^[+0-9()\-\s]+$/, { message: 'phone must be a Nigerian phone number' })
  phone!: string;
}
