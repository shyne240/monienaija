import { Controller, Get, Query } from '@nestjs/common';

import { OutletService } from './outlet.service';

/** Public, read-only locator projection. Never returns agent identities or private contact data. */
@Controller('public/agents')
export class PublicAgentLocatorController {
  constructor(private readonly outletService: OutletService) {}

  @Get('cash-to-cash-outlets')
  listCashToCashOutlets(
    @Query('state') state?: string,
    @Query('city') city?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.outletService.listPublicCashToCashOutlets({ state, city, page, limit });
  }
}
