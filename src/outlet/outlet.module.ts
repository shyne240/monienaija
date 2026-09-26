import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { OperationsModule } from '../operations/operations.module';
import { AgentOutlet } from './agent-outlet.entity';
import { AgentTerminal } from './agent-terminal.entity';
import { OutletService } from './outlet.service';
import { TerminalService } from './terminal.service';
import { OutletController } from './outlet.controller';

@Module({
  imports: [OperationsModule, TypeOrmModule.forFeature([AgentOutlet, AgentTerminal])],
  controllers: [OutletController],
  providers: [OutletService, TerminalService],
  exports: [OutletService, TerminalService],
})
export class OutletModule {}
