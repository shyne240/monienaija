import { Module } from '@nestjs/common';

import { ReconciliationController } from './reconciliation.controller';
import { ReconciliationService } from './reconciliation.service';
import { TransferReconciliationService } from './transfer-reconciliation.service';

@Module({
  controllers: [ReconciliationController],
  providers: [ReconciliationService, TransferReconciliationService],
  exports: [ReconciliationService, TransferReconciliationService],
})
export class ReconciliationModule {}
