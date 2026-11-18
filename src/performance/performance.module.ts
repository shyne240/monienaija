import { Module } from '@nestjs/common';

import { PerformanceAcceptanceService } from './performance-acceptance.service';

/**
 * ARENA 3D Group 28 — performance acceptance.
 *
 * Exported and not exposed over HTTP. The report is an operator tool, and a public endpoint that plans queries
 * against live tables is an information-disclosure surface for no operational benefit.
 */
@Module({
  providers: [PerformanceAcceptanceService],
  exports: [PerformanceAcceptanceService],
})
export class PerformanceModule {}
