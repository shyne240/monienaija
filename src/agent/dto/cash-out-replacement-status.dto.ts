import { IsString, Length } from 'class-validator';

export class CashOutReplacementStatusDto {
  @IsString()
  @Length(1, 255)
  idempotencyKey!: string;

  @IsString()
  @Length(1, 255)
  replacementOperationKey!: string;
}
