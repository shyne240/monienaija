import { IsOptional, IsString, Length } from 'class-validator';

export class CreateAgentApplicationDto {
  @IsOptional()
  @IsString()
  applicantReference?: string;

  @IsOptional()
  @IsString()
  agentClassId?: string;

  @IsOptional()
  @IsString()
  @Length(1, 80)
  agentClassReference?: string;

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
  @Length(1, 160)
  actor?: string;
}
