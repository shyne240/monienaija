import { IsEnum, IsOptional } from 'class-validator';

import { SupportTicketStatus } from '../support.enums';

export class UpdateSupportTicketStatusDto {
  @IsEnum(SupportTicketStatus)
  status!: SupportTicketStatus;

  @IsOptional()
  version?: number;
}
