import { IsOptional, IsString, Length } from 'class-validator';

export class UpdateAgentApplicationDto {
  @IsOptional()
  @IsString()
  @Length(1, 320)
  businessName?: string;

  @IsOptional()
  @IsString()
  @Length(1, 320)
  contactEmail?: string;

  @IsOptional()
  payload?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  agentClassId?: string;

  @IsOptional()
  expectedVersion?: number;

  @IsOptional()
  @IsString()
  @Length(1, 160)
  actor?: string;
}
