import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';

import { AssignVirtualAccountDto } from './dto/assign-virtual-account.dto';
import { VirtualAccountService } from './virtual-account.service';

@Controller('virtual-accounts')
export class VirtualAccountController {
  constructor(private readonly virtualAccountService: VirtualAccountService) {}

  @Post()
  assign(@Body() dto: AssignVirtualAccountDto) {
    return this.virtualAccountService.assign(dto);
  }

  @Get()
  list(@Query('walletId') walletId?: string) {
    return this.virtualAccountService.list(walletId);
  }

  @Get('lookup')
  lookup(@Query('accountNumber') accountNumber = '', @Query('provider') provider = '') {
    return this.virtualAccountService.lookup(accountNumber, provider);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.virtualAccountService.get(id);
  }

  @Post(':id/deactivate')
  deactivate(@Param('id') id: string) {
    return this.virtualAccountService.deactivate(id);
  }
}
