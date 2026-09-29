import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { LedgerModule } from '../ledger/ledger.module';
import { CommercialAccountingRegistryEntry } from './commercial-accounting-registry.entity';
import { CommercialAccountingRegistryService } from './commercial-accounting-registry.service';
import { CommercialAccountingConfigService } from './commercial-accounting-config.service';
import { CommercialAccountingService } from './commercial-accounting.service';

/**
 * V1-COMMERCIAL-ACCOUNTING-IMPLEMENTATION-01 — commercial accounting boundary module.
 * Inert unless COMMERCIAL_ACCOUNTING_ENABLED=true; treatment/timing explicit config (runtime).
 */
@Module({
  imports: [LedgerModule, TypeOrmModule.forFeature([CommercialAccountingRegistryEntry])],
  providers: [
    CommercialAccountingConfigService,
    CommercialAccountingRegistryService,
    CommercialAccountingService,
  ],
  exports: [
    CommercialAccountingConfigService,
    CommercialAccountingRegistryService,
    CommercialAccountingService,
  ],
})
export class CommercialAccountingModule {}
