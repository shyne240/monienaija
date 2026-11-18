import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditEvent } from '../operations/audit-event.entity';
import { AuditService } from '../operations/audit.service';
import { DisputeService } from './dispute.service';

/**
 * ARENA 3D Group 24 — complaints and transaction disputes.
 *
 * Exported and not exposed over HTTP. Raising a dispute as a customer, and deciding one as staff, need
 * different authorization policies, and deciding an upheld claim needs a financial-control policy. Those are
 * access decisions this group does not make on its own. The service API is complete and tested; adding a
 * controller is the remaining step once the policy is set.
 *
 * Note what this module does **not** import: `LedgerModule`. That is not an oversight. A dispute records what
 * is owed; executing it is the ledger reversal governance path's job.
 */
@Module({
  imports: [TypeOrmModule.forFeature([AuditEvent])],
  providers: [AuditService, DisputeService],
  exports: [DisputeService],
})
export class DisputesModule {}
