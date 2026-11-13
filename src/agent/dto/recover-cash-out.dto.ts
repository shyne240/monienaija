import { IsString, Length } from 'class-validator';

export class RecoverCashOutDto {
  @IsString()
  @Length(1, 255)
  idempotencyKey!: string;
}
