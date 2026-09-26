import { IsString, IsUUID } from 'class-validator';

export class AssignAgentDto {
  @IsString()
  @IsUUID()
  agentId!: string;
}
