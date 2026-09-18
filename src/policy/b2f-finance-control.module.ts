import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthorizationModule } from '../authorization/authorization.module';
import { OperationsModule } from '../operations/operations.module';
import { B2FFinanceControlDecision, B2FFinanceControlPolicy } from './b2f-finance-control.entity';
import { B2FFinanceControlService } from './b2f-finance-control.service';

@Module({
  imports: [
    forwardRef(() => OperationsModule),
    forwardRef(() => AuthorizationModule),
    TypeOrmModule.forFeature([B2FFinanceControlPolicy, B2FFinanceControlDecision]),
  ],
  providers: [B2FFinanceControlService],
  exports: [B2FFinanceControlService],
})
export class B2FFinanceControlModule {}
