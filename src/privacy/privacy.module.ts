import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditEvent } from '../operations/audit-event.entity';
import { AuditService } from '../operations/audit.service';
import { ErasureService } from './erasure.service';

/**
 * ARENA 3D Group 27 — privacy and retention.
 *
 * Exported and not exposed. A data-subject erasure request is one of the highest-impact operations the system
 * offers, and who may *raise*, *approve* and *execute* one are three different authorization decisions. In
 * particular the approver must not be the requester, which is a policy this module does not invent on its own.
 *
 * Note what this module does not import: `LedgerModule`. Erasure anonymises profile-shaped columns; it never
 * reaches financial records, and the schema-level immutability of the ledger would refuse it if it tried.
 */
@Module({
  imports: [TypeOrmModule.forFeature([AuditEvent])],
  providers: [AuditService, ErasureService],
  exports: [ErasureService],
})
export class PrivacyModule {}
