import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthorizationModule } from '../authorization/authorization.module';
import { OperationsModule } from '../operations/operations.module';
import { PilotControl } from './pilot-control.entity';
import { PilotControlService } from './pilot-control.service';

@Module({
  imports: [AuthorizationModule, OperationsModule, TypeOrmModule.forFeature([PilotControl])],
  providers: [PilotControlService],
  exports: [PilotControlService],
})
export class PilotControlModule {}
