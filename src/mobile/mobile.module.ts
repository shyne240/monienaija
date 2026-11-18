import { Module } from '@nestjs/common';

import { MobileClientSupportService } from './mobile-client-support.service';

/**
 * ARENA 3D Group 25 — customer and agent mobile client support.
 *
 * Exported, not controlled. The service is deliberately safe to call from any request path: `evaluate()`
 * never throws and never blocks an unknown or malformed version, so a client bug cannot become an outage.
 * Wiring it into the customer and agent controllers is a per-endpoint decision — some endpoints should
 * enforce `allowed`, others should only surface the advisory — and making that choice for every existing
 * route at once would change behaviour on surfaces this group has not examined.
 */
@Module({
  providers: [MobileClientSupportService],
  exports: [MobileClientSupportService],
})
export class MobileModule {}
