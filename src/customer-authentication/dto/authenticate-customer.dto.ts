import { IsString, MaxLength, MinLength } from 'class-validator';

export class AuthenticateCustomerDto {
  // Passwords are never trimmed or transformed: the verification service compares the exact
  // submitted value against the stored hash. Only length is bounded to reject abusive payloads.
  @IsString()
  @MinLength(1)
  @MaxLength(1024)
  password!: string;
}
