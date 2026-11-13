import { IsIn, IsString, Length } from 'class-validator';

export class CashOutReconciliationDto {
  @IsString() @Length(1, 255) idempotencyKey!: string;
  @IsIn(['UNKNOWN_OUTCOME', 'REPLACEMENT_UNKNOWN', 'RECEIPT_UNAVAILABLE'])
  reason!: 'UNKNOWN_OUTCOME' | 'REPLACEMENT_UNKNOWN' | 'RECEIPT_UNAVAILABLE';
}
