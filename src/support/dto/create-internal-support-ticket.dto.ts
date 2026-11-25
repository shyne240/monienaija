import { IsOptional, IsUUID } from 'class-validator';

import { CreateSupportTicketDto } from './create-support-ticket.dto';

export class CreateInternalSupportTicketDto extends CreateSupportTicketDto {
  @IsOptional()
  @IsUUID()
  targetCustomerId?: string;

  @IsOptional()
  @IsUUID()
  targetAgentId?: string;
}
