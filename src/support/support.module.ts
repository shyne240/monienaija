import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { OperationsModule } from '../operations/operations.module';
import { SupportTicket } from './support-ticket.entity';
import { SupportTicketMessage } from './support-ticket-message.entity';
import { SupportService } from './support.service';
import { SupportCustomerController } from './support-customer.controller';
import { SupportAgentController } from './support-agent.controller';
import { SupportInternalController } from './support-internal.controller';

@Module({
  imports: [OperationsModule, TypeOrmModule.forFeature([SupportTicket, SupportTicketMessage])],
  controllers: [SupportCustomerController, SupportAgentController, SupportInternalController],
  providers: [SupportService],
  exports: [SupportService],
})
export class SupportModule {}
