import { IsOptional, IsString, Length } from 'class-validator';

export class SetTransactionPinDto {
  @IsString()
  @Length(4, 32)
  pin!: string;

  @IsOptional()
  @IsString()
  @Length(1, 1024)
  pinConfirmation?: string;
}
