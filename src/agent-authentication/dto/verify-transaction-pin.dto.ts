import { IsString, Length } from 'class-validator';

export class VerifyTransactionPinDto {
  @IsString()
  @Length(4, 32)
  pin!: string;
}
