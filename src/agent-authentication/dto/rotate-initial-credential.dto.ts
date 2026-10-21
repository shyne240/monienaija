import { IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

/** V1-AGENT-CREDENTIALS-01 — mandatory first-login rotation of a workforce-issued
 *  temporary credential. currentPassword proves possession of the temporary secret;
 *  newPassword replaces it. Never logged (platform redacts password fields). */
export class RotateInitialCredentialDto {
  @IsUUID()
  agentId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(1024)
  currentPassword!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  newPassword!: string;
}
