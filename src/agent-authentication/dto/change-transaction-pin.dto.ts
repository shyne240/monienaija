import { IsString, Length } from 'class-validator';

/** V1-AGENT-05 — known-PIN change. currentPin proves possession of the existing Transaction
 *  PIN (verified through the SAME hashing/lockout machinery as transaction authorization);
 *  newPin replaces it. Never logged (platform redacts PIN fields). */
export class ChangeTransactionPinDto {
  @IsString()
  @Length(4, 32)
  currentPin!: string;

  @IsString()
  @Length(4, 32)
  newPin!: string;
}
