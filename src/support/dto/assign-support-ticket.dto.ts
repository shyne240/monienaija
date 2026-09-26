import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class AssignSupportTicketDto {
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  assignedTo!: string;

  @IsOptional()
  version?: number;
}
