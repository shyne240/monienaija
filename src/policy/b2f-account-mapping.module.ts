import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthorizationModule } from '../authorization/authorization.module';
import { LedgerModule } from '../ledger/ledger.module';
import { OperationsModule } from '../operations/operations.module';
import { B2FFinanceAccountMapping } from './b2f-account-mapping.entity';
import { B2FAccountMappingService } from './b2f-account-mapping.service';
import { B2FFinanceControlModule } from './b2f-finance-control.module';
@Module({
  imports: [
    OperationsModule,
    AuthorizationModule,
    LedgerModule,
    B2FFinanceControlModule,
    TypeOrmModule.forFeature([B2FFinanceAccountMapping]),
  ],
  providers: [B2FAccountMappingService],
  exports: [B2FAccountMappingService],
})
export class B2FAccountMappingModule {}
