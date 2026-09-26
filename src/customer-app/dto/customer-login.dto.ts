import { IsString, IsUUID, Length } from 'class-validator';

export class CustomerLoginDto {
  @IsUUID()
  customerId!: string;

  @IsString()
  @Length(1, 1024)
  password!: string;
}
