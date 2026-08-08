import { Module } from '@nestjs/common';

import { PartnerModule } from '../partner/partner.module';
import { ExternalReconciliationService } from './external-reconciliation.service';
import { ReconciliationController } from './reconciliation.controller';
import { ReconciliationService } from './reconciliation.service';
import { TransferReconciliationService } from './transfer-reconciliation.service';

@Module({
  imports: [PartnerModule],
  controllers: [ReconciliationController],
  providers: [ExternalReconciliationService, ReconciliationService, TransferReconciliationService],
  exports: [ExternalReconciliationService, ReconciliationService, TransferReconciliationService],
})
export class ReconciliationModule {}
