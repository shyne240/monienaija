import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

import {
  SupportTicketCategory,
  SupportTicketPriority,
} from '../support.enums';

export class CreateSupportTicketDto {
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  subject!: string;

  @IsEnum(SupportTicketCategory)
  category!: SupportTicketCategory;

  @IsString()
  @MinLength(3)
  @MaxLength(4000)
  description!: string;

  @IsOptional()
  @IsEnum(SupportTicketPriority)
  priority?: SupportTicketPriority;

  @IsOptional()
  @IsUUID()
  fundingRequestId?: string;

  @IsOptional()
  @IsUUID()
  relatedTransferId?: string;
}
