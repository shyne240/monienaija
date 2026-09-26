import { IsOptional, IsString, Length } from 'class-validator';

export class RejectAgentApplicationDto {
  @IsOptional()
  @IsString()
  @Length(1, 500)
  reason?: string;
}
