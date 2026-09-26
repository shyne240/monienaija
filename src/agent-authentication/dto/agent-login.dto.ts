import { IsString, IsUUID, Length } from 'class-validator';

export class AgentLoginDto {
  @IsUUID()
  agentId!: string;

  @IsString()
  @Length(1, 1024)
  password!: string;
}
