import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditEvent } from '../operations/audit-event.entity';
import { AuditService } from '../operations/audit.service';
import { FraudDetectionService } from './fraud-detection.service';

/**
 * ARENA 3D Group 22 — fraud signal detection.
 *
 * Wired as its own module and exported, so the operations centre and (later) an operational endpoint can
 * consume findings without importing each other. It deliberately has no controller yet: nothing in this
 * group exposes findings over HTTP, and adding a surface would require deciding who may read fraud data —
 * a question this group does not answer.
 *
 * `AuditService` is provided here rather than imported from `OperationsModule` to keep the dependency a
 * plain class, consistent with how `OperationsModule` provides it: the intent is a shared audit writer, not
 * a module cycle.
 */
@Module({
  // AuditService injects Repository<AuditEvent>, so the repository must be registered in this scope even
  // though the writes themselves happen inside the fraud service's own transaction manager.
  imports: [TypeOrmModule.forFeature([AuditEvent])],
  providers: [AuditService, FraudDetectionService],
  exports: [FraudDetectionService],
})
export class FraudModule {}
