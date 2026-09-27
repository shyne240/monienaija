import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { CommercialDecisionSnapshotController } from './commercial-decision-snapshot.controller';
import { CommercialDecisionSnapshot } from './commercial-decision-snapshot.entity';
import { CommercialDecisionSnapshotService } from './commercial-decision-snapshot.service';

/**
 * V1-COMMERCIAL-DECISION-01 — Commercial Decision Snapshot foundation.
 * Exposes the snapshot service for future in-flow wiring (recordDecisionWithManager joins an
 * existing SERIALIZABLE boundary) and the read-only workforce surface.
 */
@Module({
  imports: [TypeOrmModule.forFeature([CommercialDecisionSnapshot])],
  controllers: [CommercialDecisionSnapshotController],
  providers: [CommercialDecisionSnapshotService],
  exports: [CommercialDecisionSnapshotService],
})
export class CommercialDecisionModule {}
