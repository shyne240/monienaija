import { Module } from '@nestjs/common';

import { AuthorizationModule } from '../authorization/authorization.module';
import { InstitutionModule } from '../institution/institution.module';
import { PlatformFundsController } from './platform-funds.controller';
import { PlatformFundsService } from './platform-funds.service';

/**
 * Finance → Reconciliation, "Platform Funds vs. Bank Balance".
 *
 * Institution scope resolution and the audit trail are imported from their owning modules (the
 * same providers Arena 1/Arena 2 use) so this workflow never re-derives authority. No financial
 * write path exists here by design.
 */
@Module({
  imports: [AuthorizationModule, InstitutionModule],
  controllers: [PlatformFundsController],
  providers: [PlatformFundsService],
  exports: [PlatformFundsService],
})
export class PlatformFundsModule {}
