import { Controller, Get, Query } from '@nestjs/common';

import { RecipientResolutionService } from './recipient-resolution.service';

@Controller('recipients')
export class RecipientResolutionController {
  constructor(private readonly resolutionService: RecipientResolutionService) {}

  @Get('resolve')
  async resolve(@Query('identifier') identifier: string) {
    // identifier may be query param named identifier or receivingNumber
    const id = identifier ?? '';
    return this.resolutionService.resolve(id);
  }

  @Get('resolve-phone')
  async resolvePhone(@Query('phone') phone: string) {
    return this.resolutionService.resolve(phone);
  }
}
