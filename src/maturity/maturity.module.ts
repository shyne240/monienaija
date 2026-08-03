import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { OperationsModule } from '../operations/operations.module';
import { ProductionModule } from '../production/production.module';
import { ReconciliationModule } from '../reconciliation/reconciliation.module';
import { GovernanceMetadata } from './governance-metadata.entity';
import { GovernanceService } from './governance.service';
import { MaturityController } from './maturity.controller';
import { MaturityService } from './maturity.service';
import { OperationalReportService } from './operational-report.service';
import { RetentionService } from './retention.service';

@Module({
  imports: [
    OperationsModule,
    ProductionModule,
    ReconciliationModule,
    TypeOrmModule.forFeature([GovernanceMetadata]),
  ],
  controllers: [MaturityController],
  providers: [GovernanceService, MaturityService, OperationalReportService, RetentionService],
  exports: [GovernanceService, MaturityService, RetentionService],
})
export class MaturityModule {}
