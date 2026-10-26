import { Module, forwardRef } from '@nestjs/common';

import { AuthorizationModule } from '../authorization/authorization.module';
import { PartnerModule } from '../partner/partner.module';
import { ExternalReconciliationService } from './external-reconciliation.service';
import { ReconciliationController } from './reconciliation.controller';
import { ReconciliationService } from './reconciliation.service';
import { TransferReconciliationService } from './transfer-reconciliation.service';

@Module({
  imports: [forwardRef(() => AuthorizationModule), PartnerModule],
  controllers: [ReconciliationController],
  providers: [ExternalReconciliationService, ReconciliationService, TransferReconciliationService],
  exports: [ExternalReconciliationService, ReconciliationService, TransferReconciliationService],
})
export class ReconciliationModule {}
